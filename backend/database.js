const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Esta función se llama una sola vez al iniciar el servidor
async function initializeDatabase() {
    try {
        // Abre (o crea si no existe) el archivo de la base de datos
        const db = await open({
            filename: './streaming.sqlite',
            driver: sqlite3.Database
        });

        console.log("Conectado a SQLite.");

        // 1. Tabla de USUARIOS
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                hash TEXT NOT NULL,
                rol TEXT NOT NULL
            )
        `);
        console.log("- Tabla 'users' lista.");

        // 2. Tabla de VIDEOS
        await db.exec(`
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                filename TEXT NOT NULL UNIQUE,
                uploader_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(uploader_id) REFERENCES users(id)
            )
        `);
        console.log("- Tabla 'videos' lista.");

        // 3. Tabla de LLAVES DE VIDEO
        await db.exec(`
            CREATE TABLE IF NOT EXISTS video_keys (
                video_id INTEGER PRIMARY KEY,
                key_hex TEXT NOT NULL,
                nonce_hex TEXT NOT NULL,
                FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
            )
        `);
        console.log("- Tabla 'video_keys' lista.");

        // 4. Tabla de PERMISOS
        await db.exec(`
            CREATE TABLE IF NOT EXISTS permissions (
                user_id INTEGER NOT NULL,
                video_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, video_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
            )
        `);
        console.log("- Tabla 'permissions' lista.");

        // --- NUEVO ---
        // 5. Tabla de SOLICITUDES (requests)
        // Guarda quién pide acceso a qué video y el estado de la solicitud.
        // Estados posibles: 'pending' (pendiente), 'approved' (aprobada), 'rejected' (rechazada).
        await db.exec(`
            CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                video_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, video_id, status),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
            )
        `);
        console.log("- Tabla 'requests' lista.");
        // ----------------
        
        return db; // Devuelve la conexión a la base de datos

    } catch (err) {
        console.error("Error al inicializar la base de datos:", err.message);
        process.exit(1);
    }
}

// Exportamos la promesa de la conexión
module.exports = initializeDatabase();