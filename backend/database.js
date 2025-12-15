const sqlite3 = require('sqlite3').verbose();

// Esta función se llama una sola vez al iniciar el servidor
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database('./streaming.sqlite', (err) => {
            if (err) {
                console.error("Error al abrir la base de datos:", err.message);
                process.exit(1);
            }
            console.log("Conectado a SQLite.");
        });

        db.serialize(() => {
            // 1. Tabla de USUARIOS
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    hash TEXT NOT NULL,
                    public_key TEXT,
                    rol TEXT NOT NULL
                )
            `, (err) => {
                if (err) console.error(err);
                else console.log("- Tabla 'users' lista.");
            });

            // 2. Tabla de VIDEOS
            db.run(`
                CREATE TABLE IF NOT EXISTS videos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    filename TEXT NOT NULL UNIQUE,
                    uploader_id INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(uploader_id) REFERENCES users(id)
                )
            `, (err) => {
                if (err) console.error(err);
                else console.log("- Tabla 'videos' lista.");
            });

            // 3. Tabla de LLAVES DE VIDEO (CON KEY WRAPPING RSA-OAEP)
            db.run(`
                CREATE TABLE IF NOT EXISTS video_keys (
                    video_id INTEGER PRIMARY KEY,
                    wrapped_key_base64 TEXT NOT NULL,
                    wrapped_header_base64 TEXT NOT NULL,
                    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) console.error(err);
                else console.log("- Tabla 'video_keys' lista (con Key Wrapping RSA-OAEP).");
            });

            // 4. Tabla de PERMISOS
            db.run(`
                CREATE TABLE IF NOT EXISTS permissions (
                    user_id INTEGER NOT NULL,
                    video_id INTEGER NOT NULL,
                    PRIMARY KEY (user_id, video_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) console.error(err);
                else console.log("- Tabla 'permissions' lista.");
            });

            // 5. Tabla de SOLICITUDES (requests)
            db.run(`
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
            `, (err) => {
                if (err) console.error(err);
                else console.log("- Tabla 'requests' lista.");
            });

            // 6. Tabla de SOBRES (envelopes) por usuario
            db.run(`
                CREATE TABLE IF NOT EXISTS envelopes (
                    user_id INTEGER NOT NULL,
                    video_id INTEGER NOT NULL,
                    wrapped_key_base64 TEXT NOT NULL,
                    wrapped_header_base64 TEXT NOT NULL,
                    PRIMARY KEY (user_id, video_id),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) console.error(err);
                else console.log("- Tabla 'envelopes' lista.");
                resolve(db);
            });
        });
    });
}

// Exportamos la promesa de la conexión
module.exports = initializeDatabase();