require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const dbPromise = require('./database.js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

// --- 2. Configuración ---
const app = express();
const PORT = 3000;

// Zero-Trust: sin claves maestras ni JWT; sesiones por UUID
const sessions = new Map(); // token -> { userId, username, expiresAt }
const loginChallenges = new Map(); // username -> nonce (Buffer)

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

// --- Configuración de CORS ---
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'https://semigovernmentally-trichromatic-stephnie.ngrok-free.dev'
];

app.use(cors({
    origin: function (origin, callback) {
        // Permitir solicitudes sin origin (como herramientas de desarrollo o file://)
        if (!origin) return callback(null, true);
        
        if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('Origen bloqueado por CORS:', origin);
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true
}));
app.use(express.json({ limit: '500mb' })); // Aumentar límite para videos reencriptados
app.use(express.urlencoded({ limit: '500mb', extended: true }));


// Backend - Punto 3: Middleware de Seguridad (verifyToken)
// Este middleware verifica la validez y autenticidad del token JWT.
// Si el token es válido, se decodifica y se adjunta la información del usuario al objeto req.
// Si el token es inválido o no se proporciona, se devuelve un error 401 o 403.
// Este middleware protege rutas privadas como /upload, /videos, /get-key, etc.
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No se proporcionó token' });
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
        return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = { id: session.userId, username: session.username };
    next();
}
// Final del punto 3


async function main() {
    const dbRaw = await dbPromise;
    
    // Crear wrappers promisificados para los métodos de sqlite3
    const db = {
        get: promisify(dbRaw.get.bind(dbRaw)),
        all: promisify(dbRaw.all.bind(dbRaw)),
        run: function(sql, params) {
            return new Promise((resolve, reject) => {
                dbRaw.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ lastID: this.lastID, changes: this.changes });
                });
            });
        }
    };

    // Login Zero-Trust: Paso 1 (validación de hash PBKDF2 y desafío)
    app.post('/login/start', async (req, res) => {
        try {
            const { username, passwordHash } = req.body;
            if (!username || !passwordHash) return res.status(400).json({ error: 'Faltan campos' });
            const user = await db.get('SELECT id, username, hash FROM users WHERE username = ?', [username]);
            if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
            if (passwordHash !== user.hash) return res.status(401).json({ error: 'Credenciales inválidas' });
            const nonce = crypto.randomBytes(32);
            loginChallenges.set(username, nonce);
            res.json({ nonce: nonce.toString('base64') });
        } catch (err) {
            console.error('Error en /login/start:', err.message);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });

    // Login Zero-Trust: Paso 2 (respuesta con firma RSA-PSS y emisión de token de sesión UUID)
    app.post('/login/finish', async (req, res) => {
        try {
            const { username, signatureBase64 } = req.body;
            if (!username || !signatureBase64) return res.status(400).json({ error: 'Faltan campos' });
            const nonce = loginChallenges.get(username);
            if (!nonce) return res.status(400).json({ error: 'Desafío no encontrado o expirado' });

            const user = await db.get('SELECT id, public_key FROM users WHERE username = ?', [username]);
            if (!user || !user.public_key) return res.status(401).json({ error: 'Usuario inválido' });

            const verifier = crypto.createVerify('RSA-SHA256');
            verifier.update(nonce);
            verifier.end();
            const signature = Buffer.from(signatureBase64, 'base64');
            const ok = verifier.verify({ key: user.public_key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, signature);
            if (!ok) return res.status(401).json({ error: 'Firma inválida' });

            loginChallenges.delete(username);
            const token = crypto.randomUUID();
            sessions.set(token, { userId: user.id, username, expiresAt: Date.now() + 60 * 60 * 1000 });
            res.json({ token });
        } catch (err) {
            console.error('Error en /login/finish:', err.message);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });
    // Final del punto 2

    // Registro Zero-Trust: guarda username, hash PBKDF2 y llave pública
    app.post('/register', async (req, res) => {
        try {
            const { username, passwordHash, publicKeyPem } = req.body;
            if (!username || !passwordHash || !publicKeyPem) {
                return res.status(400).json({ error: 'Usuario, passwordHash y publicKey son requeridos' });
            }
            const rol = 'usuario_unificado';
            await db.run('INSERT INTO users (username, hash, public_key, rol) VALUES (?, ?, ?, ?)', [username, passwordHash, publicKeyPem, rol]);
            res.status(201).json({ message: 'Usuario registrado exitosamente' });
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(409).json({ error: 'El nombre de usuario ya está en uso' });
            }
            console.error('Error en /register:', err.message);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });
    // Final del punto 1

    // Subida Zero-Trust: el video llega ya cifrado y con sobre (BYOK)
    app.post('/api/upload-video', verifyToken, upload.single('video'), async (req, res) => {
        console.log("Petición recibida en /api/upload-video");

        // Si Multer falló o no envió archivo
        if (!req.file) {
            return res.status(400).json({ error: "No se seleccionó ningún archivo." });
        }

        const tempFilePath = req.file.path; // Ruta completa del archivo en temp/
        const tempFileName = req.file.filename; // Nombre del archivo en temp/
        const title = req.body.title;
        const description = req.body.description || '';
        const uploaderId = req.user.id;
        const wrappedKeyBase64 = req.body.wrappedKeyBase64;
        const wrappedHeaderBase64 = req.body.wrappedHeaderBase64;

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
            // En Zero-Trust, el cliente ya envió el archivo cifrado (.enc) y el sobre
            if (!wrappedKeyBase64 || !wrappedHeaderBase64) {
                fs.unlinkSync(tempFilePath);
                return res.status(400).json({ error: 'Faltan sobre y header envueltos' });
            }
            console.log(`[Upload] Recibido sobre BYOK para video ${videoId}.`);

            // Mover el archivo de temp/ a encrypted/
            const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');
            fs.mkdirSync(encryptedDir, { recursive: true });
            const encryptedFilePath = path.join(encryptedDir, tempFileName);
            fs.renameSync(tempFilePath, encryptedFilePath);
            console.log(`[Upload] Archivo movido de temp a encrypted: ${tempFileName}`);

            // --- PASO 3 (NUEVO): Guardar las llaves ENVUELTAS en la BD ---
            // Las llaves están protegidas con RSA-OAEP. Sin la clave privada RSA, son inútiles.
            await db.run(
                'INSERT INTO video_keys (video_id, wrapped_key_base64, wrapped_header_base64) VALUES (?, ?, ?)',
                [videoId, wrappedKeyBase64, wrappedHeaderBase64]
            );
            console.log(`[DB] Llaves envueltas guardadas seguramente para video ID ${videoId}.`);


            // --- PASO 4 (NUEVO): Actualizar el nombre del archivo en la tabla 'videos' ---
            // Ahora que tenemos el archivo final cifrado (.enc), actualizamos el registro.
            await db.run(
                'UPDATE videos SET filename = ? WHERE id = ?',
                [tempFileName, videoId]
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
                filename: tempFileName,
                uploader_id: uploaderId,
                uploader: req.user && req.user.username ? req.user.username : null,
                created_at: new Date().toISOString()
            };

            // ¡Todo salió bien! Devolvemos también el objeto del video para actualizar la UI sin recargar.
            res.status(201).json({ 
                message: "¡Video cifrado subido exitosamente!",
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

    // Endpoint para guardar miniatura (después de la subida del video)
    app.post('/api/save-thumbnail', verifyToken, async (req, res) => {
        try {
            const videoId = req.body.videoId;
            const thumbnailBase64 = req.body.thumbnail;
            
            if (!videoId || !thumbnailBase64) {
                return res.status(400).json({ error: 'videoId y thumbnail son requeridos' });
            }
            
            // Verificar que el usuario es el dueño del video
            const video = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!video || video.uploader_id !== req.user.id) {
                return res.status(403).json({ error: 'No tienes permiso para guardar una miniatura para este video' });
            }
            
            // Crear directorio de miniaturas si no existe
            const thumbnailDir = path.join(__dirname, 'uploads', 'thumbnails');
            fs.mkdirSync(thumbnailDir, { recursive: true });
            
            // Guardar miniatura
            const thumbnailFilename = `thumb_${videoId}.jpg`;
            const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);
            
            // Convertir base64 a buffer
            const buffer = Buffer.from(thumbnailBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
            fs.writeFileSync(thumbnailPath, buffer);
            
            console.log(`[Thumbnail] Miniatura guardada para video ${videoId}`);
            res.json({ message: 'Miniatura guardada exitosamente' });
        } catch (err) {
            console.error('Error en /api/save-thumbnail:', err.message);
            res.status(500).json({ error: 'Error al guardar la miniatura' });
        }
    });

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

            // Eliminar el thumbnail asociado
            const thumbnailDir = path.join(__dirname, 'uploads', 'thumbnails');
            const thumbnailFilename = `thumb_${videoId}.jpg`;
            const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);
            const normalizedThumbnailPath = path.normalize(thumbnailPath);
            
            // SEGURIDAD: Verificar que la ruta del thumbnail esté dentro del directorio permitido
            if (normalizedThumbnailPath.startsWith(thumbnailDir) && fs.existsSync(normalizedThumbnailPath)) {
                fs.unlinkSync(normalizedThumbnailPath);
                console.log(`[DELETE /videos/${videoId}] Thumbnail eliminado: ${thumbnailFilename}`);
            }

            // Eliminar registros relacionados en cascada
            // 1. Eliminar las llaves del video
            await db.run('DELETE FROM video_keys WHERE video_id = ?', [videoId]);
            
            // 2. Eliminar envelopes compartidos
            await db.run('DELETE FROM envelopes WHERE video_id = ?', [videoId]);
            
            // 3. Eliminar permisos asociados
            await db.run('DELETE FROM permissions WHERE video_id = ?', [videoId]);
            
            // 4. Eliminar solicitudes pendientes
            await db.run('DELETE FROM requests WHERE video_id = ?', [videoId]);
            
            // 5. Finalmente, eliminar el video
            await db.run('DELETE FROM videos WHERE id = ?', [videoId]);

            console.log(`[DELETE /videos/${videoId}] Video y registros relacionados eliminados exitosamente.`);
            res.json({ message: "Video eliminado exitosamente." });

        } catch (err) {
            console.error(`Error en DELETE /videos/${videoId}:`, err.message || err);
            res.status(500).json({ error: "Error al eliminar el video." });
        }
    });

    // Zero-Trust: servir thumbnails generados por el frontend
    app.get('/thumbnail/:videoId', async (req, res) => {
        try {
            const videoId = req.params.videoId;
            
            // Obtener token desde query parameter o header
            let token = req.query.token;
            console.log('[Thumbnail] Token desde query:', token ? token.substring(0, 20) + '...' : 'null');
            if (!token) {
                const authHeader = req.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
            }
            
            if (!token) {
                console.log('[Thumbnail] Error: Token no proporcionado');
                return res.status(401).json({ error: 'Token no proporcionado' });
            }
            
            // Verificar token en el sistema de sesiones
            const session = sessions.get(token);
            if (!session) {
                console.log('[Thumbnail] Error: Sesión no encontrada');
                return res.status(401).json({ error: 'Sesión inválida o expirada' });
            }
            
            if (session.expiresAt < Date.now()) {
                sessions.delete(token);
                console.log('[Thumbnail] Error: Sesión expirada');
                return res.status(401).json({ error: 'Sesión expirada' });
            }
            
            const userId = session.userId;
            console.log('[Thumbnail] Sesión válida para userId:', userId);
            
            // Verificar que el usuario tiene acceso al video
            const permission = await db.get(
                'SELECT 1 FROM permissions WHERE user_id = ? AND video_id = ?',
                [userId, videoId]
            );
            
            if (!permission) {
                return res.status(403).json({ error: 'No tienes acceso a este video' });
            }
            
            const thumbnailDir = path.join(__dirname, 'uploads', 'thumbnails');
            const thumbnailFilename = `thumb_${videoId}.jpg`;
            const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);
            
            // Verificar que la ruta está dentro del directorio permitido (prevención de path traversal)
            const normalizedThumbnailPath = path.normalize(thumbnailPath);
            if (!normalizedThumbnailPath.startsWith(thumbnailDir)) {
                return res.status(400).json({ error: 'Ruta inválida' });
            }
            
            // Si el thumbnail existe, servirlo
            if (fs.existsSync(normalizedThumbnailPath)) {
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.setHeader('Content-Type', 'image/jpeg');
                res.sendFile(normalizedThumbnailPath);
            } else {
                // Si no existe, devolver un placeholder
                res.status(404).json({ error: 'Thumbnail no disponible aún' });
            }
        } catch (err) {
            console.error('Error en /thumbnail/:videoId:', err.message);
            res.status(500).json({ error: 'Error al obtener el thumbnail' });
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
            // Usamos text/plain porque el archivo está en base64
            'Content-Type': 'text/plain',
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

    // Entregar sobre/envuelto para el usuario autenticado 
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

            // Si hay un sobre específico del usuario, usarlo; si no, usar el del uploader
            const envRow = await db.get('SELECT wrapped_key_base64, wrapped_header_base64 FROM envelopes WHERE user_id = ? AND video_id = ?', [userId, videoId]);
            if (envRow) {
                return res.json({ wrappedKeyBase64: envRow.wrapped_key_base64, wrappedHeaderBase64: envRow.wrapped_header_base64 });
            }
            const keyRow = await db.get('SELECT wrapped_key_base64, wrapped_header_base64 FROM video_keys WHERE video_id = ?', [videoId]);
            if (!keyRow) return res.status(404).json({ error: 'No se encontró sobre para este video.' });
            res.json({ wrappedKeyBase64: keyRow.wrapped_key_base64, wrappedHeaderBase64: keyRow.wrapped_header_base64 });
        } catch (err) {
            console.error('[GET /get-key] Error:', err);
            res.status(500).json({ error: 'Error interno al obtener la clave.' });
        }
    });

    // Endpoint para obtener la envoltura ORIGINAL del propietario (desde video_keys)
    // Usado para revocación - necesita la envoltura del uploader, no la del usuario actual
    app.get('/get-owner-key/:videoId', verifyToken, async (req, res) => {
        const userId = req.user && req.user.id;
        const videoId = Number(req.params.videoId);

        if (!videoId) return res.status(400).json({ error: 'videoId inválido' });

        try {
            // Verificar que el usuario sea el propietario del video
            const video = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!video) return res.status(404).json({ error: 'Video no encontrado' });
            
            if (video.uploader_id !== userId) {
                return res.status(403).json({ error: 'Solo el propietario puede obtener la envoltura original' });
            }

            // Obtener la envoltura original desde video_keys
            const keyRow = await db.get('SELECT wrapped_key_base64, wrapped_header_base64 FROM video_keys WHERE video_id = ?', [videoId]);
            if (!keyRow) return res.status(404).json({ error: 'No se encontró envoltura original para este video.' });
            
            res.json({ wrappedKeyBase64: keyRow.wrapped_key_base64, wrappedHeaderBase64: keyRow.wrapped_header_base64 });
        } catch (err) {
            console.error('[GET /get-owner-key] Error:', err);
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

    // Zero-Trust: reproducir descifrado lo hace el cliente; backend sirve cifrado
    app.get('/play/:videoId', verifyToken, async (req, res) => {
        const userId = req.user && req.user.id;
        const videoId = Number(req.params.videoId);
        if (!videoId) return res.status(400).json({ error: 'videoId inválido' });
        try {
            const perm = await db.get('SELECT 1 FROM permissions WHERE user_id = ? AND video_id = ?', [userId, videoId]);
            const videoRow = await db.get('SELECT filename, uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!videoRow) return res.status(404).json({ error: 'Video no encontrado' });
            if (!perm && videoRow.uploader_id !== userId) return res.status(403).json({ error: 'No tienes permiso para ver este video' });

            if (videoRow.filename && (videoRow.filename.includes('..') || videoRow.filename.includes('/') || videoRow.filename.includes('\\'))) {
                return res.status(400).json({ error: 'Nombre de archivo inválido' });
            }
            const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');
            const filePath = path.join(encryptedDir, videoRow.filename);
            const normalizedPath = path.normalize(filePath);
            if (!normalizedPath.startsWith(encryptedDir)) return res.status(403).json({ error: 'Acceso denegado' });
            if (!fs.existsSync(normalizedPath)) return res.status(404).json({ error: 'Archivo cifrado no encontrado' });

            const stat = fs.statSync(normalizedPath);
            res.writeHead(200, {
                'Content-Length': stat.size,
                'Content-Type': 'text/plain',
                'Content-Disposition': 'inline'
            });
            fs.createReadStream(normalizedPath).pipe(res);
        } catch (err) {
            console.error('Error en /play/:videoId', err);
            res.status(500).json({ error: 'Error interno' });
        }
    });

    // Compartir: registrar permiso y sobre para Usuario B
    app.post('/share', verifyToken, async (req, res) => {
        try {
            const { videoId, targetUsername, wrappedKeyBase64, wrappedHeaderBase64 } = req.body;
            if (!videoId || !targetUsername || !wrappedKeyBase64 || !wrappedHeaderBase64) {
                return res.status(400).json({ error: 'Faltan campos' });
            }
            const video = await db.get('SELECT id, uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!video) return res.status(404).json({ error: 'Video no encontrado' });
            if (video.uploader_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede compartir' });
            const target = await db.get('SELECT id FROM users WHERE username = ?', [targetUsername]);
            if (!target) return res.status(404).json({ error: 'Usuario destino no encontrado' });
            await db.run('INSERT OR IGNORE INTO permissions (user_id, video_id) VALUES (?, ?)', [target.id, videoId]);
            await db.run('INSERT OR REPLACE INTO envelopes (user_id, video_id, wrapped_key_base64, wrapped_header_base64) VALUES (?, ?, ?, ?)', [target.id, videoId, wrappedKeyBase64, wrappedHeaderBase64]);
            res.json({ message: 'Compartido exitosamente' });
        } catch (err) {
            console.error('Error en /share:', err.message || err);
            res.status(500).json({ error: 'Error interno' });
        }
    });

    // Revocar: eliminar permiso, reencriptar video y regenerar envolturas
    app.post('/revoke', verifyToken, async (req, res) => {
        try {
            const { videoId, targetUsername, newEncryptedVideo, newEnvelopes } = req.body;
            if (!videoId || !targetUsername) return res.status(400).json({ error: 'Faltan campos' });
            
            const video = await db.get('SELECT id, uploader_id, filename FROM videos WHERE id = ?', [videoId]);
            if (!video) return res.status(404).json({ error: 'Video no encontrado' });
            if (video.uploader_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede revocar' });
            
            const target = await db.get('SELECT id FROM users WHERE username = ?', [targetUsername]);
            if (!target) return res.status(404).json({ error: 'Usuario destino no encontrado' });
            
            // Si se proporciona el video reencriptado y nuevas envolturas, actualizar todo
            if (newEncryptedVideo && newEnvelopes) {
                console.log(`[Revoke] Reencriptando video ${videoId} y regenerando envolturas`);
                
                // Guardar el nuevo video encriptado
                const videoPath = path.join(__dirname, 'uploads', 'encrypted', video.filename);
                fs.writeFileSync(videoPath, newEncryptedVideo, 'utf8');
                
                // Eliminar todas las envolturas antiguas
                await db.run('DELETE FROM envelopes WHERE video_id = ?', [videoId]);
                
                // Insertar las nuevas envolturas y actualizar video_keys para el owner
                let ownerEnvelope = null;
                for (const envelope of newEnvelopes) {
                    let userId;
                    if (envelope.username === 'owner') {
                        userId = req.user.id;
                        ownerEnvelope = envelope; // Guardar para actualizar video_keys
                    } else {
                        const user = await db.get('SELECT id FROM users WHERE username = ?', [envelope.username]);
                        if (!user) continue;
                        userId = user.id;
                    }
                    
                    await db.run(
                        'INSERT INTO envelopes (user_id, video_id, wrapped_key_base64, wrapped_header_base64) VALUES (?, ?, ?, ?)',
                        [userId, videoId, envelope.wrappedKey, envelope.wrappedNonce]
                    );
                }
                
                // CRÍTICO: Actualizar video_keys con el nuevo envelope del owner
                if (ownerEnvelope) {
                    await db.run(
                        'UPDATE video_keys SET wrapped_key_base64 = ?, wrapped_header_base64 = ? WHERE video_id = ?',
                        [ownerEnvelope.wrappedKey, ownerEnvelope.wrappedNonce, videoId]
                    );
                    console.log(`[Revoke] video_keys actualizado con nuevo envelope del owner`);
                }
                
                console.log(`[Revoke] Video reencriptado, ${newEnvelopes.length} envolturas regeneradas`);
            }
            
            // Eliminar permiso del usuario revocado
            await db.run('DELETE FROM permissions WHERE user_id = ? AND video_id = ?', [target.id, videoId]);
            
            res.json({ message: 'Acceso revocado exitosamente' });
        } catch (err) {
            console.error('Error en /revoke:', err.message || err);
            res.status(500).json({ error: 'Error interno: ' + err.message });
        }
    });

    // Obtener la propia clave pública del usuario autenticado
    app.get('/me/publicKey', verifyToken, async (req, res) => {
        try {
            const userId = req.user && req.user.id;
            const user = await db.get('SELECT public_key FROM users WHERE id = ?', [userId]);
            if (!user || !user.public_key) return res.status(404).json({ error: 'Llave pública no encontrada' });
            res.json({ publicKey: user.public_key });
        } catch (err) {
            console.error('Error en /me/publicKey:', err.message || err);
            res.status(500).json({ error: 'Error interno' });
        }
    });

    // Listar todos los usuarios (para compartir)
    app.get('/users', verifyToken, async (req, res) => {
        try {
            const users = await db.all('SELECT id, username FROM users ORDER BY username');
            res.json(users);
        } catch (err) {
            console.error('Error en /users:', err.message || err);
            res.status(500).json({ error: 'Error interno' });
        }
    });

    // Obtener llave pública de un usuario específico
    app.get('/users/:username/publicKey', verifyToken, async (req, res) => {
        try {
            const { username } = req.params;
            const user = await db.get('SELECT public_key FROM users WHERE username = ?', [username]);
            if (!user || !user.public_key) return res.status(404).json({ error: 'Usuario o llave pública no encontrada' });
            res.json({ publicKey: user.public_key });
        } catch (err) {
            console.error('Error en /users/:username/publicKey:', err.message || err);
            res.status(500).json({ error: 'Error interno' });
        }
    });

    // Obtener lista de espectadores de un video (usuarios con acceso)
    app.get('/videos/:id/viewers', verifyToken, async (req, res) => {
        try {
            const videoId = req.params.id;
            const userId = req.user.id;
            const video = await db.get('SELECT uploader_id FROM videos WHERE id = ?', [videoId]);
            if (!video) return res.status(404).json({ error: 'Video no encontrado' });
            if (video.uploader_id !== userId) return res.status(403).json({ error: 'Solo el dueño puede ver espectadores' });
            const viewers = await db.all(`
                SELECT u.id, u.username
                FROM permissions p
                JOIN users u ON p.user_id = u.id
                WHERE p.video_id = ? AND u.id != ?
                ORDER BY u.username
            `, [videoId, userId]);
            res.json(viewers);
        } catch (err) {
            console.error('Error en /videos/:id/viewers:', err.message || err);
            res.status(500).json({ error: 'Error interno' });
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
        console.log(`Backend Zero-Trust corriendo en http://localhost:${PORT}`);
        console.log('Endpoints: /register, /login/start, /login/finish, /api/upload-video, /videos, /get-key/:videoId, /stream/:filename, /share, /revoke, /users, /users/:username/publicKey');
    });
}

main();
