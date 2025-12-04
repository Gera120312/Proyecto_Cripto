#!/usr/bin/env node
/**
 * Script para generar una llave maestra para Key Wrapping
 * Esta llave se guarda automáticamente en el archivo .env
 * y NUNCA debe commitirse al repositorio.
 */

const sodium = require('sodium-native');
const fs = require('fs');
const path = require('path');

console.log('='.repeat(70));
console.log('GENERADOR DE LLAVE MAESTRA PARA KEY WRAPPING');
console.log('='.repeat(70));
console.log('');

// Generar una llave maestra de 256 bits (32 bytes) para XSalsa20-Poly1305
const masterKey = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
sodium.randombytes_buf(masterKey);

const masterKeyHex = masterKey.toString('hex');

console.log('✓ Llave maestra generada exitosamente.');
console.log('');
console.log('IMPORTANTE: Guarda esta llave de forma segura.');
console.log('Esta llave se usará para proteger todas las llaves de videos en la BD.');
console.log('');
console.log('═'.repeat(70));
console.log('LLAVE MAESTRA (hex):');
console.log('');
console.log(masterKeyHex);
console.log('');
console.log('═'.repeat(70));
console.log('');

// Ruta del archivo .env
const envPath = path.join(__dirname, '.env');

// Leer el archivo .env existente o crear uno nuevo
let envContent = '';
if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    console.log('✓ Archivo .env existente encontrado');
} else {
    console.log('✓ Creando nuevo archivo .env');
}

// Función para actualizar o agregar una variable de entorno
function updateEnvVariable(content, varName, value) {
    const regex = new RegExp(`^${varName}=.*$`, 'm');
    if (regex.test(content)) {
        // Si la variable existe, actualizarla
        return content.replace(regex, `${varName}=${value}`);
    } else {
        // Si no existe, agregarla al final
        return content + (content.endsWith('\n') ? '' : '\n') + `${varName}=${value}\n`;
    }
}

// Actualizar o agregar la Master Key
envContent = updateEnvVariable(envContent, 'MASTER_KEY', masterKeyHex);

// Guardar el archivo .env
fs.writeFileSync(envPath, envContent, { mode: 0o600 }); // Solo el propietario puede leer/escribir

console.log('✓ Llave maestra guardada en el archivo .env');
console.log('  • Variable: MASTER_KEY');
console.log('');
console.log('═'.repeat(70));
console.log('ADVERTENCIA: Si pierdes esta llave, NO PODRÁS descifrar los videos');
console.log('            almacenados en la base de datos.');
console.log('═'.repeat(70));
console.log('');
