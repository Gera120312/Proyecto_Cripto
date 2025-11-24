/**
 * Script para generar el par de claves ECDSA (Privada y Pública)
 * 
 * IMPORTANTE: 
 * - La clave PRIVADA se usa para FIRMAR los tokens JWT
 * - La clave PÚBLICA se usa para VERIFICAR los tokens JWT
 * - NUNCA compartas la clave privada
 * 
 * Ejecutar: node generate-keys.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('\n🔐 Generador de Claves ECDSA para CryptoStream\n');
console.log('━'.repeat(50));

// Crear el directorio 'keys' si no existe
const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
    console.log('✓ Directorio "keys" creado');
}

// Generar el par de claves usando la curva P-256 (secp256r1)
// Esta es la curva estándar para ES256 (ECDSA con SHA-256)
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // También conocida como P-256 o secp256r1
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
});

// Rutas donde se guardarán las claves
const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

// Guardar la clave privada
fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 }); // Solo el propietario puede leer/escribir
console.log('✓ Clave PRIVADA guardada en:', privateKeyPath);

// Guardar la clave pública
fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o644 }); // Lectura para todos
console.log('✓ Clave PÚBLICA guardada en:', publicKeyPath);

console.log('\n📋 Información de Seguridad:');
console.log('━'.repeat(50));
console.log('• La CLAVE PRIVADA (private.pem) se usa para FIRMAR tokens');
console.log('• La CLAVE PÚBLICA (public.pem) se usa para VERIFICAR tokens');
console.log('• NUNCA compartas la clave privada (private.pem)');
console.log('• Puedes distribuir la clave pública libremente');
console.log('• Algoritmo: ECDSA con curva P-256 (ES256)');
console.log('\n✅ Generación completada exitosamente!\n');
