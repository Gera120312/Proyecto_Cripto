require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcrypt');
const dbPromise = require('./database.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { encryptVideo } = require('./cryptoService.js');

// --- 2. Configuración ---
const app = express();
const PORT = 3000;

// ═══════════════════════════════════════════════════════════════════
// CRIPTOGRAFÍA ASIMÉTRICA ECDSA PARA JWT
// ═══════════════════════════════════════════════════════════════════
//
//  CLAVE PRIVADA (private.pem):
//    - Se usa ÚNICAMENTE para FIRMAR tokens JWT
//    - NUNCA debe salir del servidor backend
//    - Es como tu "mano y bolígrafo" que estampa tu firma
//    - Si alguien la roba, puede falsificar tokens
//
//  CLAVE PÚBLICA (public.pem):
//    - Se usa ÚNICAMENTE para VERIFICAR tokens JWT
//    - Puede distribuirse libremente (incluso al frontend)
//    - Es como una fotocopia de tu firma que otros usan para validar
//    - No sirve para crear tokens, solo para verificarlos
//
// Algoritmo: ES256 (ECDSA con SHA-256 y curva P-256)
// ═══════════════════════════════════════════════════════════════════

const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, 'keys', 'private.pem'), 'utf8');
const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'keys', 'public.pem'), 'utf8');

console.log('✓ Claves ECDSA cargadas exitosamente');
console.log('  • Clave PRIVADA: para FIRMAR tokens');
console.log('  • Clave PÚBLICA: para VERIFICAR tokens');

// --- Configuración de Multer (Dónde guardar los archivos temporales) ---
const storage = multer.diskStorage({
    // 1. Definir la carpeta destino: uploads/temp
    destination: (req, file, cb) => {
        const tempPath = path.join(__dirname, 'uploads', 'temp');
        fs.mkdirSync(tempPath, { recursive: true });
        cb(null, tempPath);
    },
    // 2. Definir el nombre del archivo: Usar un timestamp para evitar colisiones
    filename: (req, file, cb) => {
        // Usamos Date.now() para que cada archivo tenga un nombre único temporal
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Mantenemos la extensión original (.mp4)
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });
// -------------------------------------------------------


// --- Middlewares ---
app.use(cors());
app.use(express.json());

// Backend - Punto 3: Middleware de Seguridad (verifyToken)
// Este middleware verifica la validez y autenticidad del token JWT.
// Si el token es válido, se decodifica y se adjunta la información del usuario al objeto req.
// Si el token es inválido o no se proporciona, se devuelve un error 401 o 403.
// Este middleware protege rutas privadas como /upload, /videos, /get-key, etc.
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: "No se proporcionó token" });
    
    // Verificar con la CLAVE PÚBLICA usando algoritmo ES256
    jwt.verify(token, PUBLIC_KEY, { algorithms: ['ES256'] }, (err, user) => {
        if (err) {
            console.error('Error al verificar token:', err.message);
            return res.status(403).json({ error: "Token inválido" });
        }
        req.user = user;
        next();
    });
}
// Final del punto 3


async function main() {
    const db = await dbPromise;

    // Backend - Punto 2: Inicio de Sesión y Emisión de Tokens
    // Este endpoint permite a los usuarios iniciar sesión de manera segura.
    // Se valida el nombre de usuario y la contraseña proporcionados.
    // Si las credenciales son correctas, se genera un token JWT firmado con la clave privada.
    // Este token incluye información del usuario y tiene una validez de 1 hora.
    app.post('/login', async (req, res) => {
        console.log("Petición recibida en /login");
        try {
            const { username, password } = req.body;
            const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user) {
                return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
            }
            if (await bcrypt.compare(password, user.hash)) {
                // Crear el payload con información del usuario
                const payload = { id: user.id, username: user.username, rol: user.rol };
                
                //  FIRMA DEL TOKEN CON LA CLAVE PRIVADA
                // Algoritmo: ES256 (ECDSA con SHA-256)
                // Esto genera una firma digital única que prueba la autenticidad del token
                const token = jwt.sign(payload, PRIVATE_KEY, { 
                    algorithm: 'ES256',
                    expiresIn: '1h' 
                });
                
                console.log(`✓ Token firmado exitosamente para usuario: ${username}`);
                res.json({ token: token });
            } else {
                res.status(401).json({ error: "Usuario o contraseña incorrectos" });
            }
        } catch (err) {
            console.error("Error en /login:", err.message);
            res.status(500).json({ error: "Error interno del servidor" });
        }
    });
    // Final del punto 2

    // Backend - Punto 1: Registro de Usuarios Seguro
    // Este endpoint permite registrar nuevos usuarios de manera segura.
    // Se valida que el nombre de usuario y la contraseña cumplan con los requisitos mínimos.
    // La contraseña se hashea utilizando bcrypt antes de almacenarse en la base de datos.
    app.post('/register', async (req, res) => {
        console.log("Petición recibida en /register");
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ error: "Usuario y contraseña son requeridos" });
            }

            // Validación de contraseña: al menos 8 caracteres, una mayúscula y un número
            if (typeof password !== 'string' || password.length < 8) {
                return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
            }
            const pwChecks = /(?=.*[A-Z])(?=.*\d)/;
            if (!pwChecks.test(password)) {
                return res.status(400).json({ error: 'La contraseña debe incluir al menos una letra mayúscula y un número.' });
            }

            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(password, salt);
            const rol = 'usuario_unificado';
            await db.run('INSERT INTO users (username, hash, rol) VALUES (?, ?, ?)', [username, hash, rol]);
            console.log(`¡Nuevo usuario registrado: '${username}'!`);
            res.status(201).json({ message: "Usuario registrado exitosamente" });
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: "El nombre de usuario ya está en uso" });
            }
            console.error("Error en /register:", err.message);
            res.status(500).json({ error: "Error interno del servidor" });
        }
    });
    // Final del punto 1

    // Backend - Punto 4: Subida de Videos con Cifrado Seguro
    // Este endpoint permite recibir archivos de video mediante multipart/form-data.
    // Los videos se almacenan temporalmente en la carpeta uploads/temp.
    // Posteriormente, se cifran utilizando el servicio encryptVideo con el algoritmo XChaCha20-Poly1305.
    // Las claves de cifrado y los nonces generados se almacenan de forma segura en la base de datos.
    // Finalmente, los archivos de video sin cifrar se eliminan automáticamente tras un cifrado exitoso.
    app.post('/upload', verifyToken, upload.single('video'), async (req, res) => {
        console.log("Petición recibida en /upload");

        // Si Multer falló o no envió archivo
        if (!req.file) {
            return res.status(400).json({ error: "No se seleccionó ningún archivo." });
        }

        const tempFilePath = req.file.path; // Ruta completa del archivo en temp/
        const tempFileName = req.file.filename; // Nombre del archivo en temp/
        const title = req.body.title;
        const description = req.body.description || ''; 
        const uploaderId = req.user.id;

        if (!title) {
            // Limpieza: si faltan datos, borramos el archivo temporal
            fs.unlinkSync(tempFilePath);
            return res.status(400).json({ error: "El título es obligatorio." });
        }

        console.log(`[Upload] Archivo recibido: ${req.file.originalname}`);
        console.log(`[Upload] Guardado temporalmente como: ${tempFileName}`);

        try {
            // --- PASO 1: Insertar metadatos básicos en la BD ---
            // Insertamos primero para obtener el 'video_id'. Usamos el nombre temporal por ahora.
            const result = await db.run(
                'INSERT INTO videos (title, description, filename, uploader_id) VALUES (?, ?, ?, ?)',
                [title, description, tempFileName, uploaderId]
            );
            // 'lastID' es el ID del video que acabamos de insertar
            const videoId = result.lastID;
            console.log(`[DB] Video insertado con ID: ${videoId}`);


            // --- PASO 2 (NUEVO): Llamar al Servicio de Cifrado ---
            console.log(`[Crypto] Iniciando proceso de cifrado para video ID ${videoId}...`);
            
            // Esta función es asíncrona: espera a que el cifrado termine.
            // Devuelve los datos necesarios y, crucialmente, BORRA el archivo de temp/.
            const cryptoResult = await encryptVideo(tempFileName);
            
            // cryptoResult contiene: { encryptedFilename, keyHex, headerHex }
            console.log(`[Crypto] Cifrado exitoso. Nuevo archivo: ${cryptoResult.encryptedFilename}`);


            // --- PASO 3 (NUEVO): Guardar las llaves en la BD ---
            // Esta es nuestra "bóveda" de seguridad.
            await db.run(
                'INSERT INTO video_keys (video_id, key_hex, nonce_hex) VALUES (?, ?, ?)',
                [videoId, cryptoResult.keyHex, cryptoResult.headerHex]
            );
            console.log(`[DB] Llaves guardadas seguramente para video ID ${videoId}.`);


            // --- PASO 4 (NUEVO): Actualizar el nombre del archivo en la tabla 'videos' ---
            // Ahora que tenemos el archivo final cifrado (.enc), actualizamos el registro.
            await db.run(
                'UPDATE videos SET filename = ? WHERE id = ?',
                [cryptoResult.encryptedFilename, videoId]
            );
            console.log(`[DB] Registro de video actualizado con el nombre de archivo cifrado.`);


            // --- PASO 5 (NUEVO): Dar permiso automático al creador ---
            // El dueño del video siempre debe poder verlo.
            try {
                await db.run(
                    'INSERT INTO permissions (user_id, video_id) VALUES (?, ?)',
                    [uploaderId, videoId]
                );
                console.log(`[DB] Permiso de visualización otorgado automáticamente al creador (User ID: ${uploaderId}) para el video ID ${videoId}.`);
            } catch (permErr) {
                // Si por algún motivo ya existía o hay un error, lo registramos pero no cancelamos la subida
                console.warn('[DB] No se pudo insertar permiso automático:', permErr.message || permErr);
            }


            // Preparar el objeto de video para devolver al frontend
            const videoObj = {
                id: videoId,
                title: title,
                filename: cryptoResult.encryptedFilename,
                uploader_id: uploaderId,
                uploader: req.user && req.user.username ? req.user.username : null,
                created_at: new Date().toISOString()
            };

            // ¡Todo salió bien! Devolvemos también el objeto del video para actualizar la UI sin recargar.
            res.status(201).json({ 
                message: "¡Video subido, cifrado y asegurado exitosamente!",
                video: videoObj
            });

        } catch (err) {
            console.error("[Error en /upload]:", err.message);
            
            // --- Limpieza en caso de error ---
            // 1. Si el archivo temporal sigue ahí, borrarlo.
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            
            // 2. Manejar errores de base de datos específicos
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: "Error de base de datos (título duplicado, etc)." });
            }
            
            // Error genérico
            res.status(500).json({ error: "Error interno del servidor durante el procesamiento del video." });
        }
    });
    // Final del punto 4

    // Backend - Punto 5: Listado de Videos
    // Este endpoint devuelve un catálogo de videos disponibles en la base de datos.
    // Incluye una bandera 'has_access' que indica si el usuario autenticado tiene permiso para acceder a cada video.
    // Utiliza el middleware verifyToken para garantizar que solo usuarios autenticados puedan acceder.
    // Los resultados se obtienen mediante una consulta SQL que une las tablas 'videos', 'users' y 'permissions'.
    app.get('/videos', verifyToken, async (req, res) => {
        const userId = req.user && req.user.id;
        console.log(`[GET /videos] Petición recibida del usuario ID: ${userId}. Obteniendo lista completa con estado de acceso.`);
        try {
            const videos = await db.all(`
                SELECT 
                    v.id, 
                    v.title,
                    v.description,
                    v.filename,
                    v.uploader_id,
                    u.username as uploader, 
                    v.created_at,
                    CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END as has_access
                FROM videos v
                JOIN users u ON v.uploader_id = u.id
                LEFT JOIN permissions p ON v.id = p.video_id AND p.user_id = ?
                ORDER BY v.created_at DESC
            `, [userId]);

            console.log(`[GET /videos] Lista enviada. Videos totales: ${videos.length}.`);
            res.json(videos);

        } catch (err) {
            console.error("Error en /videos:", err.message || err);
            res.status(500).json({ error: "Error al obtener la lista de videos." });
        }
    });

    // --- Endpoint para obtener detalles de un video específico ---
    app.get('/videos/:id', verifyToken, async (req, res) => {
        const videoId = req.params.id;
        const userId = req.user && req.user.id;
        
        try {
            const video = await db.get(`
                SELECT 
                    v.id, 
                    v.title,
                    v.description,
                    v.filename,
                    v.uploader_id,
                    u.username as uploader,
                    v.created_at
                FROM videos v
                JOIN users u ON v.uploader_id = u.id
                WHERE v.id = ?
            `, [videoId]);

            if (!video) {
                return res.status(404).json({ error: "Video no encontrado." });
            }

            res.json(video);
        } catch (err) {
            console.error("Error en /videos/:id:", err.message || err);
            res.status(500).json({ error: "Error al obtener detalles del video." });
        }
    });

    // --- NUEVO: Endpoint para actualizar título y descripción de un video ---
    app.put('/videos/:id', verifyToken, async (req, res) => {
        const videoId = req.params.id;
        const userId = req.user && req.user.id;
        const { title, description } = req.body;

        console.log(`[PUT /videos/${videoId}] Usuario ${userId} intenta actualizar video.`);

        if (!title || title.trim() === '') {
            return res.status(400).json({ error: "El título no puede estar vacío." });
        }

        try {
            // Verificar que el video existe y que el usuario es el dueño
            const video = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);
            
            if (!video) {
                return res.status(404).json({ error: "Video no encontrado." });
            }

            if (video.uploader_id !== userId) {
                return res.status(403).json({ error: "No tienes permiso para editar este video." });
            }

            // Actualizar título y descripción
            await db.run(
                'UPDATE videos SET title = ?, description = ? WHERE id = ?',
                [title.trim(), description || '', videoId]
            );

            console.log(`[PUT /videos/${videoId}] Video actualizado exitosamente.`);
            res.json({ message: "Video actualizado exitosamente." });

        } catch (err) {
            console.error(`Error en PUT /videos/${videoId}:`, err.message || err);
            res.status(500).json({ error: "Error al actualizar el video." });
        }
    });

    // --- NUEVO: Endpoint para obtener espectadores (viewers) de un video ---
    app.get('/videos/:id/viewers', verifyToken, async (req, res) => {
        const videoId = req.params.id;
        const userId = req.user && req.user.id;

        console.log(`[GET /videos/${videoId}/viewers] Usuario ${userId} solicita lista de espectadores.`);

        try {
            // Verificar que el video existe y que el usuario es el dueño
            const video = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);
            
            if (!video) {
                return res.status(404).json({ error: "Video no encontrado." });
            }

            if (video.uploader_id !== userId) {
                return res.status(403).json({ error: "No tienes permiso para ver los espectadores de este video." });
            }

            // Obtener lista de usuarios con permiso (excluyendo al creador)
            const viewers = await db.all(`
                SELECT u.id as user_id, u.username
                FROM permissions p
                JOIN users u ON p.user_id = u.id
                WHERE p.video_id = ? AND u.id != ?
                ORDER BY u.username
            `, [videoId, userId]);

            res.json(viewers);
        } catch (err) {
            console.error(`Error en GET /videos/${videoId}/viewers:`, err.message || err);
            res.status(500).json({ error: "Error al obtener espectadores." });
        }
    });

    // --- NUEVO: Endpoint para eliminar un espectador específico ---
    app.delete('/videos/:id/viewers/:userId', verifyToken, async (req, res) => {
        const videoId = req.params.id;
        const viewerUserId = req.params.userId;
        const ownerId = req.user && req.user.id;

        console.log(`[DELETE /videos/${videoId}/viewers/${viewerUserId}] Usuario ${ownerId} intenta quitar espectador.`);

        try {
            // Verificar que el video existe y que el usuario es el dueño
            const video = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);
            
            if (!video) {
                return res.status(404).json({ error: "Video no encontrado." });
            }

            if (video.uploader_id !== ownerId) {
                return res.status(403).json({ error: "No tienes permiso para gestionar espectadores de este video." });
            }

            // No permitir que el creador se quite a sí mismo
            if (parseInt(viewerUserId) === ownerId) {
                return res.status(400).json({ error: "No puedes quitarte el acceso a tu propio video." });
            }

            // Eliminar el permiso
            await db.run('DELETE FROM permissions WHERE user_id = ? AND video_id = ?', [viewerUserId, videoId]);

            console.log(`[DELETE /videos/${videoId}/viewers/${viewerUserId}] Permiso eliminado exitosamente.`);
            res.json({ message: "Espectador eliminado exitosamente." });

        } catch (err) {
            console.error(`Error en DELETE /videos/${videoId}/viewers/${viewerUserId}:`, err.message || err);
            res.status(500).json({ error: "Error al eliminar espectador." });
        }
    });

    // --- NUEVO: Endpoint para eliminar un video ---
    app.delete('/videos/:id', verifyToken, async (req, res) => {
        const videoId = req.params.id;
        const userId = req.user && req.user.id;

        console.log(`[DELETE /videos/${videoId}] Usuario ${userId} intenta eliminar video.`);

        try {
            // Verificar que el video existe y obtener información
            const video = await db.get('SELECT uploader_id, filename FROM videos WHERE id = ?', [videoId]);
            
            if (!video) {
                return res.status(404).json({ error: "Video no encontrado." });
            }

            if (video.uploader_id !== userId) {
                return res.status(403).json({ error: "No tienes permiso para eliminar este video." });
            }

            // SEGURIDAD: Validar que el nombre de archivo no contenga path traversal
            if (video.filename && (video.filename.includes('..') || video.filename.includes('/') || video.filename.includes('\\'))) {
                console.error(`[DELETE /videos/${videoId}] Nombre de archivo sospechoso: ${video.filename}`);
                return res.status(400).json({ error: "Nombre de archivo inválido." });
            }

            // Eliminar el archivo físico
            const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');
            const filePath = path.join(encryptedDir, video.filename);
            const normalizedPath = path.normalize(filePath);
            
            // SEGURIDAD: Verificar que la ruta esté dentro del directorio permitido
            if (normalizedPath.startsWith(encryptedDir) && fs.existsSync(normalizedPath)) {
                fs.unlinkSync(normalizedPath);
                console.log(`[DELETE /videos/${videoId}] Archivo físico eliminado: ${video.filename}`);
            }

            // Eliminar registros relacionados en cascada
            // 1. Eliminar las llaves del video
            await db.run('DELETE FROM video_keys WHERE video_id = ?', [videoId]);
            
            // 2. Eliminar permisos asociados
            await db.run('DELETE FROM permissions WHERE video_id = ?', [videoId]);
            
            // 3. Eliminar solicitudes pendientes
            await db.run('DELETE FROM requests WHERE video_id = ?', [videoId]);
            
            // 4. Finalmente, eliminar el video
            await db.run('DELETE FROM videos WHERE id = ?', [videoId]);

            console.log(`[DELETE /videos/${videoId}] Video y registros relacionados eliminados exitosamente.`);
            res.json({ message: "Video eliminado exitosamente." });

        } catch (err) {
            console.error(`Error en DELETE /videos/${videoId}:`, err.message || err);
            res.status(500).json({ error: "Error al eliminar el video." });
        }
    });

    // --- NUEVO: Endpoint para generar y servir thumbnail de un video ---
    app.get('/thumbnail/:videoId', async (req, res) => {
        // Autenticación: aceptar token desde header Authorization o query param
        const authHeader = req.headers['authorization'];
        const tokenFromHeader = authHeader && authHeader.split(' ')[1];
        const tokenFromQuery = req.query.token;
        const token = tokenFromHeader || tokenFromQuery;

        if (!token) return res.status(401).json({ error: 'No se proporcionó token' });

        // Verificar token con CLAVE PÚBLICA
        let user;
        try {
            user = jwt.verify(token, PUBLIC_KEY, { algorithms: ['ES256'] });
        } catch (err) {
            console.error('Error al verificar token en /thumbnail:', err.message);
            return res.status(403).json({ error: 'Token inválido' });
        }

        const userId = user && user.id;
        const videoId = req.params.videoId;

        console.log(`[GET /thumbnail/${videoId}] Usuario ${userId} solicita thumbnail.`);

        try {
            // Verificar que el video existe
            const video = await db.get('SELECT filename, uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!video) {
                return res.status(404).json({ error: 'Video no encontrado.' });
            }

            // Verificar permisos (debe tener acceso al video o ser el uploader)
            const hasPermission = await db.get(
                'SELECT 1 FROM permissions WHERE user_id = ? AND video_id = ?',
                [userId, videoId]
            );

            if (!hasPermission && video.uploader_id !== userId) {
                return res.status(403).json({ error: 'No tienes permiso para ver este thumbnail.' });
            }

            // SEGURIDAD: Validar que el nombre de archivo no contenga path traversal
            if (video.filename && (video.filename.includes('..') || video.filename.includes('/') || video.filename.includes('\\'))) {
                console.error(`[GET /thumbnail/${videoId}] Nombre de archivo sospechoso: ${video.filename}`);
                return res.status(400).json({ error: "Nombre de archivo inválido." });
            }

            // Ruta del thumbnail (lo guardaremos en uploads/thumbnails/)
            const thumbnailDir = path.join(__dirname, 'uploads', 'thumbnails');
            fs.mkdirSync(thumbnailDir, { recursive: true });
            
            const thumbnailFilename = `thumb_${videoId}.jpg`;
            const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);

            // Si el thumbnail ya existe, servirlo directamente
            if (fs.existsSync(thumbnailPath)) {
                return res.sendFile(thumbnailPath);
            }

            // Si no existe, generarlo
            const { generateThumbnail } = require('./cryptoService.js');
            const keyRow = await db.get('SELECT key_hex, nonce_hex FROM video_keys WHERE video_id = ?', [videoId]);
            
            if (!keyRow) {
                return res.status(404).json({ error: 'No se encontraron llaves para este video.' });
            }

            const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');
            const encryptedPath = path.join(encryptedDir, video.filename);
            const normalizedEncPath = path.normalize(encryptedPath);
            
            // SEGURIDAD: Verificar que la ruta esté dentro del directorio permitido
            if (!normalizedEncPath.startsWith(encryptedDir)) {
                console.error(`[GET /thumbnail/${videoId}] Intento de acceso fuera del directorio: ${normalizedEncPath}`);
                return res.status(403).json({ error: "Acceso denegado." });
            }
            
            await generateThumbnail(normalizedEncPath, keyRow.key_hex, keyRow.nonce_hex, thumbnailPath);
            
            console.log(`[GET /thumbnail/${videoId}] Thumbnail generado exitosamente.`);
            res.sendFile(thumbnailPath);

        } catch (err) {
            console.error(`[GET /thumbnail/${videoId}] Error:`, err.message || err);
            // Si falla la generación, devolver una imagen placeholder
            res.status(500).json({ error: 'Error al generar thumbnail.' });
        }
    });
    // Un usuario autenticado envía el ID del video que quiere ver.
    app.post('/requests', verifyToken, async (req, res) => {
        const userId = req.user && req.user.id; // El ID del usuario que pide
        const videoId = req.body && req.body.video_id; // El ID del video (viene en el JSON del body)

        console.log(`[POST /requests] Usuario ${userId} solicita acceso al video ${videoId}.`);

        if (!videoId) {
            return res.status(400).json({ error: "Se requiere el video_id." });
        }

        try {
            // 1. Verificar si el usuario YA tiene permiso en la tabla 'permissions'.
            const existingPermission = await db.get(
                'SELECT 1 FROM permissions WHERE user_id = ? AND video_id = ?',
                [userId, videoId]
            );

            if (existingPermission) {
                console.log(`[POST /requests] El usuario ${userId} ya tiene permiso para el video ${videoId}.`);
                return res.status(409).json({ error: "Ya tienes acceso a este video." });
            }

            // 2. Insertar la solicitud en la tabla 'requests'.
            try {
                await db.run(
                    'INSERT INTO requests (user_id, video_id) VALUES (?, ?)',
                    [userId, videoId]
                );
                console.log(`[POST /requests] Solicitud creada exitosamente.`);
                return res.status(201).json({ message: "Solicitud enviada. Pendiente de aprobación." });

            } catch (insertErr) {
                if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
                    console.log(`[POST /requests] Ya existe una solicitud pendiente para usuario ${userId} y video ${videoId}.`);
                    return res.status(409).json({ error: "Ya tienes una solicitud pendiente para este video." });
                }
                throw insertErr;
            }

        } catch (err) {
            console.error("Error en /requests:", err.message || err);
            if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
                return res.status(404).json({ error: "El video especificado no existe." });
            }
            res.status(500).json({ error: "Error al procesar la solicitud." });
        }
    });

    // --- NUEVO: Endpoint para obtener las solicitudes PENDIENTES del usuario autenticado ---
    // Devuelve un array de objetos con { id, video_id, created_at }
    app.get('/requests/mine', verifyToken, async (req, res) => {
        const userId = req.user && req.user.id;
        console.log(`[GET /requests/mine] Solicitando solicitudes PENDING para usuario ${userId}`);
        try {
            // Sólo devolver solicitudes con estado 'pending' para que el frontend no trate
            // solicitudes rechazadas/aprobadas como pendientes.
            const rows = await db.all(
                "SELECT id, video_id, status, created_at FROM requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC",
                [userId]
            );
            res.json(rows || []);
        } catch (err) {
            console.error('Error en /requests/mine:', err.message || err);
            res.status(500).json({ error: 'Error al obtener las solicitudes pendientes.' });
        }
    });

    // --- Endpoint para que el CREADOR vea las solicitudes a SUS videos ---
    app.get('/requests/managed', verifyToken, async (req, res) => {
        const creatorId = req.user.id;
        console.log(`[GET /requests/managed] Usuario ${creatorId} pide ver solicitudes a sus videos.`);

        try {
            const requests = await db.all(`
                SELECT 
                    r.id AS request_id,
                    r.status,
                    r.created_at,
                    v.id AS video_id,
                    v.title AS video_title,
                    u.id AS requester_id,
                    u.username AS requester_name
                FROM requests r
                JOIN videos v ON r.video_id = v.id
                JOIN users u ON r.user_id = u.id
                WHERE v.uploader_id = ? AND r.status = 'pending'
                ORDER BY r.created_at DESC
            `, [creatorId]);

            console.log(`[GET /requests/managed] Se encontraron ${requests.length} solicitudes pendientes.`);
            res.json(requests);

        } catch (err) {
            console.error("Error en /requests/managed:", err.message || err);
            res.status(500).json({ error: "Error al obtener las solicitudes." });
        }
    });

    // --- Endpoint para que el CREADOR apruebe/rechace una solicitud ---
    app.put('/requests/:id', verifyToken, async (req, res) => {
        const creatorId = req.user.id;
        const requestId = req.params.id;
        const newStatus = req.body && req.body.status; // 'approved' o 'rejected'

        console.log(`[PUT /requests/${requestId}] Usuario ${creatorId} intenta cambiar estado a '${newStatus}'.`);

        if (!['approved', 'rejected'].includes(newStatus)) {
            return res.status(400).json({ error: "Estado inválido. Debe ser 'approved' o 'rejected'." });
        }

        try {
            const request = await db.get(`
                SELECT r.id, r.user_id, r.video_id, v.uploader_id
                FROM requests r
                JOIN videos v ON r.video_id = v.id
                WHERE r.id = ?
            `, [requestId]);

            if (!request) {
                return res.status(404).json({ error: "Solicitud no encontrada." });
            }

            if (request.uploader_id !== creatorId) {
                console.log(`[Seguridad] Usuario ${creatorId} intentó gestionar solicitud de otro creador.`);
                return res.status(403).json({ error: "No tienes permiso para gestionar esta solicitud." });
            }

            // Evitar colisión de UNIQUE (user_id, video_id, status)
            const duplicate = await db.get(
                'SELECT id FROM requests WHERE user_id = ? AND video_id = ? AND status = ? AND id != ?',
                [request.user_id, request.video_id, newStatus, requestId]
            );

            if (duplicate) {
                // Ya existe un registro con el mismo estado; eliminamos la solicitud actual
                // y garantizamos efectos colaterales (permisos) si corresponde.
                if (newStatus === 'approved') {
                    await db.run(
                        'INSERT OR IGNORE INTO permissions (user_id, video_id) VALUES (?, ?)',
                        [request.user_id, request.video_id]
                    );
                }
                await db.run('DELETE FROM requests WHERE id = ?', [requestId]);
                console.log(`[Requests] Eliminada solicitud ${requestId} porque ya existía otra con mismo estado (merged).`);
                return res.json({ message: `Solicitud ${newStatus === 'approved' ? 'aprobada' : 'rechazada'} correctamente.` });
            }

            if (newStatus === 'approved') {
                await db.run(
                    'INSERT OR IGNORE INTO permissions (user_id, video_id) VALUES (?, ?)',
                    [request.user_id, request.video_id]
                );
                console.log(`[Permisos] Acceso concedido al usuario ${request.user_id} para el video ${request.video_id}.`);
            }

            await db.run('UPDATE requests SET status = ? WHERE id = ?', [newStatus, requestId]);

            res.json({ message: `Solicitud ${newStatus === 'approved' ? 'aprobada' : 'rechazada'} correctamente.` });

        } catch (err) {
            console.error(`Error en PUT /requests/${requestId}:`, err.message || err);
            res.status(500).json({ error: "Error al procesar la solicitud." });
        }
    });

    // --- NUEVO: Endpoint para servir el archivo de video CIFRADO ---
    // Este endpoint es público (no requiere token) porque el archivo
    // está cifrado y es inútil sin la clave. La seguridad está en /get-key.
    // Usamos un stream para servir archivos grandes eficientemente.
    app.get('/stream/:filename', async (req, res) => {
        const filename = req.params.filename;
        
        // SEGURIDAD: Validar que el nombre de archivo no contenga path traversal
        if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            console.error(`[GET /stream] Intento de path traversal detectado: ${filename}`);
            return res.status(400).json({ error: "Nombre de archivo inválido." });
        }
        
        // Construimos la ruta completa al archivo en la carpeta 'encrypted'
        const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');
        const filePath = path.join(encryptedDir, filename);
        
        // SEGURIDAD: Verificar que la ruta resultante esté dentro del directorio permitido
        const normalizedPath = path.normalize(filePath);
        if (!normalizedPath.startsWith(encryptedDir)) {
            console.error(`[GET /stream] Intento de acceso fuera del directorio permitido: ${normalizedPath}`);
            return res.status(403).json({ error: "Acceso denegado." });
        }

        console.log(`[GET /stream] Solicitud de archivo cifrado: ${filename}`);

        // 1. Verificar que el archivo existe
        if (!fs.existsSync(normalizedPath)) {
            console.error(`[GET /stream] Archivo no encontrado: ${normalizedPath}`);
            return res.status(404).json({ error: "Archivo de video no encontrado." });
        }

        // 2. Obtener el tamaño del archivo para las cabeceras HTTP
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;

        // 3. Configurar cabeceras para indicar que es un stream de video
        res.writeHead(200, {
            'Content-Length': fileSize,
            // Usamos un tipo MIME genérico para datos binarios, ya que no es un mp4 normal
            'Content-Type': 'application/octet-stream',
            // Sugerir al navegador que es un contenido para reproducir, no para descargar
            'Content-Disposition': 'inline'
        });

        // 4. Crear y conectar el stream de lectura del archivo con la respuesta HTTP
        // Esto envía el archivo pedazo a pedazo sin cargarlo todo en memoria RAM.
        const readStream = fs.createReadStream(normalizedPath);
        readStream.pipe(res);
        
        readStream.on('error', (err) => {
             console.error("[GET /stream] Error en el stream de lectura:", err);
             // No podemos enviar una respuesta JSON aquí porque las cabeceras ya se enviaron
             res.end(); 
        });
    });
    // ------------------------------------------------

    // --- NUEVO: Endpoint para entregar la clave/nonce de un video protegido ---
    // Devuelve { key: key_hex, nonce: nonce_hex } solo si el usuario está autorizado
    app.get('/get-key/:videoId', verifyToken, async (req, res) => {
        const userId = req.user && req.user.id;
        const videoId = Number(req.params.videoId);
        console.log(`[GET /get-key/${videoId}] Petición de usuario ${userId}`);

        if (!videoId) return res.status(400).json({ error: 'videoId inválido' });

        try {
            // Verificar que el usuario tenga permiso para el video (o sea el uploader)
            const perm = await db.get('SELECT 1 FROM permissions WHERE user_id = ? AND video_id = ?', [userId, videoId]);
            const uploaderCheck = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);

            if (!perm && (!uploaderCheck || uploaderCheck.uploader_id !== userId)) {
                console.log(`[GET /get-key] Usuario ${userId} no autorizado para video ${videoId}`);
                return res.status(403).json({ error: 'No tienes permiso para obtener la clave de este video.' });
            }

            const keyRow = await db.get('SELECT key_hex, nonce_hex FROM video_keys WHERE video_id = ?', [videoId]);
            if (!keyRow) return res.status(404).json({ error: 'No se encontraron llaves para este video.' });

            res.json({ key: keyRow.key_hex, nonce: keyRow.nonce_hex });
        } catch (err) {
            console.error('[GET /get-key] Error:', err);
            res.status(500).json({ error: 'Error interno al obtener la clave.' });
        }
    });

    // --- Compatibilidad: servir /uploads/<filename> desde uploads/encrypted ---
    // Esto permite que rutas antiguas del frontend como /uploads/<file> sigan funcionando.
    const encryptedPath = path.join(__dirname, 'uploads', 'encrypted');
    if (fs.existsSync(encryptedPath)) {
        app.use('/uploads', express.static(encryptedPath));
        console.log('Mapeada ruta estática /uploads ->', encryptedPath);
    } else {
        console.log('Carpeta encrypted no encontrada en uploads; /uploads no será mapeada.');
    }

    // --- NUEVO: Endpoint para reproducir (DESCIFRADO en servidor) un video por ID ---
    // Este endpoint está protegido y solo entrega el contenido descifrado si el usuario tiene permiso.
    // Soporta token via query param (?token=...) para permitir uso directo en <video src="">
    app.get('/play/:videoId', async (req, res) => {
        try {
            // Autenticación: aceptar token desde header Authorization o query param
            const authHeader = req.headers['authorization'];
            const tokenFromHeader = authHeader && authHeader.split(' ')[1];
            const tokenFromQuery = req.query.token;
            const token = tokenFromHeader || tokenFromQuery;

            if (!token) return res.status(401).json({ error: 'No se proporcionó token' });

            // Verificar token con CLAVE PÚBLICA
            let user;
            try {
                user = jwt.verify(token, PUBLIC_KEY, { algorithms: ['ES256'] });
            } catch (err) {
                console.error('Error al verificar token en /play:', err.message);
                return res.status(403).json({ error: 'Token inválido' });
            }

            const userId = user && user.id;
            const videoId = Number(req.params.videoId);
            if (!videoId) return res.status(400).json({ error: 'videoId inválido' });

            // Verificar permiso o ser uploader
            const perm = await db.get('SELECT 1 FROM permissions WHERE user_id = ? AND video_id = ?', [userId, videoId]);
            const videoRow = await db.get('SELECT filename, uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!videoRow) return res.status(404).json({ error: 'Video no encontrado' });
            if (!perm && videoRow.uploader_id !== userId) return res.status(403).json({ error: 'No tienes permiso para ver este video' });

            // SEGURIDAD: Validar que el nombre de archivo no contenga path traversal
            if (videoRow.filename && (videoRow.filename.includes('..') || videoRow.filename.includes('/') || videoRow.filename.includes('\\'))) {
                console.error(`[GET /play/${videoId}] Nombre de archivo sospechoso: ${videoRow.filename}`);
                return res.status(400).json({ error: "Nombre de archivo inválido." });
            }

            const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');
            const filePath = path.join(encryptedDir, videoRow.filename);
            const normalizedPath = path.normalize(filePath);
            
            // SEGURIDAD: Verificar que la ruta esté dentro del directorio permitido
            if (!normalizedPath.startsWith(encryptedDir)) {
                console.error(`[GET /play/${videoId}] Intento de acceso fuera del directorio: ${normalizedPath}`);
                return res.status(403).json({ error: "Acceso denegado." });
            }
            
            if (!fs.existsSync(normalizedPath)) return res.status(404).json({ error: 'Archivo cifrado no encontrado en servidor' });

            // Obtener llaves
            const keyRow = await db.get('SELECT key_hex, nonce_hex FROM video_keys WHERE video_id = ?', [videoId]);
            if (!keyRow) return res.status(404).json({ error: 'No se encontraron llaves para este video.' });

            // Crear stream descifrado y enviarlo
            const { createDecryptStream } = require('./cryptoService.js');
            const decryptStream = createDecryptStream(normalizedPath, keyRow.key_hex, keyRow.nonce_hex);

            res.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Content-Disposition': 'inline',
                'Accept-Ranges': 'none' // Indicar al navegador que no soportamos Range por ahora
            });

            decryptStream.pipe(res);
            decryptStream.on('error', (err) => {
                console.error('[/play/:videoId] Error en decryptStream:', err);
                try { res.end(); } catch (e) {}
            });

        } catch (err) {
            console.error('Error en /play/:videoId', err);
            if (!res.headersSent) res.status(500).json({ error: 'Error interno al preparar el video.' });
        }
    });


    // --- 7. Iniciar el servidor ---
    // Servir la carpeta `frontend` estáticamente (evita usar Live Server)
    const frontendPath = path.join(__dirname, '..', 'frontend');
    if (fs.existsSync(frontendPath)) {
        app.use(express.static(frontendPath));
        // Fallback SPA: devolver index.html para peticiones que acepten HTML
        app.get('*', (req, res, next) => {
            const accept = req.headers.accept || '';
            if (accept.includes('text/html')) {
                res.sendFile(path.join(frontendPath, 'index.html'));
            } else {
                next();
            }
        });
        console.log('Sirviendo archivos estáticos desde:', frontendPath);
    } else {
        console.log('No se encontró la carpeta frontend en:', frontendPath);
    }

    app.listen(PORT, () => {
        console.log(`Backend corriendo en http://localhost:${PORT}`);
        console.log("Endpoints activos: /login, /register, /upload (cifrado activo)");
    });
}

main();
