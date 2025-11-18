// database.js
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Inicializa la base de datos y crea la tabla si no existe
async function initializeDatabase() {
    try {
        const db = await open({
            filename: './streaming.sqlite',
            driver: sqlite3.Database
        });

        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                hash TEXT NOT NULL,
                rol TEXT NOT NULL
            )
        `);

        console.log("Base de datos SQLite conectada y tabla 'users' lista.");
        return db;

    } catch (err) {
        console.error("Error al inicializar la base de datos:", err.message);
        process.exit(1);
    }
}

module.exports = initializeDatabase();
