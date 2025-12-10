#!/usr/bin/env node
/**
 * Script para generar un par de claves RSA para Key Wrapping
 * Estas claves se guardan automáticamente en el archivo .env
 * y NUNCA deben commitirse al repositorio.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('='.repeat(70));
console.log('GENERADOR DE CLAVES RSA PARA KEY WRAPPING');
console.log('='.repeat(70));
console.log('');

// Generar par de claves RSA de 2048 bits con padding OAEP
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
});

console.log('✓ Par de claves RSA generado exitosamente.');
console.log('  • Tamaño: 2048 bits');
console.log('  • Algoritmo: RSA-OAEP (SHA-256)');
console.log('');
console.log('IMPORTANTE: Guarda estas claves de forma segura.');
console.log('La clave privada se usará para descifrar las llaves de videos.');
console.log('');
console.log('═'.repeat(70));
console.log('CLAVE PÚBLICA RSA:');
console.log('');
console.log(publicKey);
console.log('═'.repeat(70));
console.log('CLAVE PRIVADA RSA:');
console.log('');
console.log(privateKey);
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
    // Convertir saltos de línea a \\n para formato de .env
    const escapedValue = value.replace(/\n/g, '\\n');
    const regex = new RegExp(`^${varName}=.*$`, 'm');
    if (regex.test(content)) {
        // Si la variable existe, actualizarla
        return content.replace(regex, `${varName}=${escapedValue}`);
    } else {
        // Si no existe, agregarla al final
        return content + (content.endsWith('\n') ? '' : '\n') + `${varName}=${escapedValue}\n`;
    }
}

// Actualizar o agregar las claves RSA
envContent = updateEnvVariable(envContent, 'RSA_PUBLIC_KEY', publicKey);
envContent = updateEnvVariable(envContent, 'RSA_PRIVATE_KEY', privateKey);

// Guardar el archivo .env
fs.writeFileSync(envPath, envContent, { mode: 0o600 }); // Solo el propietario puede leer/escribir

console.log('✓ Claves RSA guardadas en el archivo .env');
console.log('  • Variable: RSA_PUBLIC_KEY');
console.log('  • Variable: RSA_PRIVATE_KEY');
console.log('');
console.log('═'.repeat(70));
console.log('ADVERTENCIA: Si pierdes la clave privada, NO PODRÁS descifrar');
console.log('            las llaves de los videos almacenados.');
console.log('═'.repeat(70));
console.log('');
