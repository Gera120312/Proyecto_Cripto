// server.js — Backend para registro y login seguro (bcrypt + JWT)

const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcrypt');
const dbPromise = require('./database.js');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;

// Nota: en producción mover esto a una variable de entorno segura
const JWT_SECRET = process.env.JWT_SECRET || 'este-es-mi-secreto-temporal-para-la-semana-2';

// Middlewares
app.use(cors());
app.use(express.json());
// <-- IMPORTANTE: aceptar formularios application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

async function main() {
    const db = await dbPromise;

    // Rate limiters
    const loginLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 5, // limit each IP to 5 requests per windowMs
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Demasiados intentos. Intenta de nuevo más tarde.' }
    });

    const registerLimiter = rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5, // limit each IP to 5 registrations per hour
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Demasiados intentos de registro. Intenta más tarde.' }
    });

    // Endpoint de registro
    app.post('/register', registerLimiter, async (req, res) => {
        console.log("Petición recibida en /register");
        try {
            // Si vienes desde un <form> con application/x-www-form-urlencoded,
            // express.urlencoded() habrá llenado req.body correctamente.
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({ error: "Usuario y contraseña son requeridos" });
            }

            // Validación mínima del password (server-side)
            if (typeof password !== 'string' || password.length < 8) {
                return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
            }

            // Hashear la contraseña
            const saltRounds = 10;
            const salt = await bcrypt.genSalt(saltRounds);
            const hash = await bcrypt.hash(password, salt);

            const rol = "usuario_unificado";

            await db.run(
                'INSERT INTO users (username, hash, rol) VALUES (?, ?, ?)',
                [username, hash, rol]
            );

            console.log(`¡Nuevo usuario registrado: '${username}'!`);
            return res.status(201).json({ message: "Usuario registrado exitosamente" });

        } catch (err) {
            // Detección de usuario duplicado (constraint UNIQUE)
            if (err.message && err.message.includes("UNIQUE constraint failed")) {
                console.log(`Error: El usuario ya existe.`);
                return res.status(409).json({ error: "El nombre de usuario ya está en uso" });
            }
            console.error("Error en /register:", err.message || err);
            return res.status(500).json({ error: "Error interno del servidor" });
        }
    });

    // Endpoint de login
    app.post('/login', loginLimiter, async (req, res) => {
        console.log("Petición recibida en /login");
        try {
            const { username, password } = req.body;

            const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

            if (!user) {
                return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
            }

            const match = await bcrypt.compare(password, user.hash);
            if (!match) {
                return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
            }

            const payload = {
                id: user.id,
                username: user.username,
                rol: user.rol
            };

            const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
            return res.json({ token });

        } catch (err) {
            console.error("Error en /login:", err.message || err);
            return res.status(500).json({ error: "Error interno del servidor" });
        }
    });

    // Ruta de prueba
    app.get('/video-no-seguro', (req, res) => {
        res.json({ message: "Aquí iría el video no seguro (Semana 1)" });
    });

    // Iniciar servidor
    app.listen(PORT, () => {
        console.log(`Backend corriendo en http://localhost:${PORT}`);
        console.log("Endpoints activos: POST /register  POST /login  GET /video-no-seguro");
    });
}

main().catch(err => {
    console.error("Error arrancando la app:", err);
    process.exit(1);
});
