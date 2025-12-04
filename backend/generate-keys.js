/**
 * Script para generar el par de claves ECDSA (Privada y Pública)
 * 
 * IMPORTANTE: 
 * - La clave PRIVADA se usa para FIRMAR los tokens JWT
 * - La clave PÚBLICA se usa para VERIFICAR los tokens JWT
 * - NUNCA compartas la clave privada
 * - Las claves se almacenan como variables de entorno en .env
 * 
 * Ejecutar: node generate-keys.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('\nGenerador de Claves ECDSA para CryptoStream\n');
console.log('━'.repeat(50));

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

// Convertir las claves a formato de una sola línea para variables de entorno
// Reemplazamos los saltos de línea con \n literal
const privateKeyEnv = privateKey.replace(/\n/g, '\\n');
const publicKeyEnv = publicKey.replace(/\n/g, '\\n');

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

// Actualizar o agregar las claves ECDSA
envContent = updateEnvVariable(envContent, 'ECDSA_PRIVATE_KEY', privateKeyEnv);
envContent = updateEnvVariable(envContent, 'ECDSA_PUBLIC_KEY', publicKeyEnv);

// Guardar el archivo .env
fs.writeFileSync(envPath, envContent, { mode: 0o600 }); // Solo el propietario puede leer/escribir

console.log('✓ Claves ECDSA agregadas al archivo .env');
console.log('  • ECDSA_PRIVATE_KEY: para FIRMAR tokens JWT');
console.log('  • ECDSA_PUBLIC_KEY: para VERIFICAR tokens JWT');

console.log('\nInformación de Seguridad:');
console.log('━'.repeat(50));
console.log('• Las claves están almacenadas en el archivo .env');
console.log('• La CLAVE PRIVADA se usa para FIRMAR tokens');
console.log('• La CLAVE PÚBLICA se usa para VERIFICAR tokens');
console.log('• NUNCA compartas la clave privada ni el archivo .env');
console.log('• El archivo .env NO debe subirse al repositorio');
console.log('• Algoritmo: ECDSA con curva P-256 (ES256)');
console.log('\nGeneración completada exitosamente!\n');
