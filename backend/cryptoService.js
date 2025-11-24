const sodium = require('sodium-native');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

/**
 * El Motor de Cifrado
 * Toma un archivo de video, lo cifra con XChaCha20-Poly1305 (una variante robusta para streams),
 * guarda el resultado y devuelve las llaves necesarias.
 */
async function encryptVideo(inputFilename) {
    const tempDir = path.join(__dirname, 'uploads', 'temp');
    const encryptedDir = path.join(__dirname, 'uploads', 'encrypted');

    const inputPath = path.join(tempDir, inputFilename);
    // El archivo cifrado tendrá el mismo nombre pero terminara en .enc
    const outputFilename = `${inputFilename}.enc`;
    const outputPath = path.join(encryptedDir, outputFilename);

    console.log(`[Crypto] Iniciando cifrado de: ${inputFilename}`);

    // 1. Generar la LLAVE MAESTRA aleatoria (32 bytes)
    // Esta es la "contraseña" principal para este video.
    const key = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES);
    sodium.randombytes_buf(key);

    // 2. Preparar el "Header" (Cabecera/Nonce público)
    // Es una pieza de información pública necesaria para iniciar el descifrado.
    const header = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES);

    // 3. Inicializar el estado del stream de cifrado
    const state = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_init_push(state, header, key);

    // Creamos los streams de lectura y escritura
    const readStream = fs.createReadStream(inputPath);
    const writeStream = fs.createWriteStream(outputPath);

    // Escribimos el header público al principio del archivo cifrado
    writeStream.write(header);

    // Usamos un "transform stream" para cifrar los datos al vuelo mientras pasan
    async function* encryptStream(source) {
        for await (const chunk of source) {
            // Buffer para el pedazo cifrado (es un poco más grande por los datos de autenticación Poly1305)
            const encryptedChunk = Buffer.alloc(chunk.length + sodium.crypto_secretstream_xchacha20poly1305_ABYTES);
            
            // Ciframos este pedazo
            sodium.crypto_secretstream_xchacha20poly1305_push(state, encryptedChunk, chunk, null, sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE);
            
            // Para permitir descifrado por streaming, prefijamos cada bloque cifrado con su longitud (4 bytes, BE)
            const lenBuf = Buffer.alloc(4);
            lenBuf.writeUInt32BE(encryptedChunk.length, 0);
            yield Buffer.concat([lenBuf, encryptedChunk]);
        }
        // Finalizamos el stream (importante para asegurar la integridad del último bloque)
        const finalChunk = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_ABYTES);
        sodium.crypto_secretstream_xchacha20poly1305_push(state, finalChunk, Buffer.alloc(0), null, sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL);
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32BE(finalChunk.length, 0);
        yield Buffer.concat([lenBuf, finalChunk]);
    }

    try {
        // 4. Ejecutar el proceso: Leer -> Cifrar -> Escribir
        // 'pipeline' maneja el flujo de datos de forma eficiente y segura.
        await pipeline(readStream, encryptStream, writeStream);
        
        console.log(`[Crypto] Cifrado completado: ${outputFilename}`);

        // 5. LIMPIEZA CRÍTICA: Borrar el archivo original inseguro de temp/
        fs.unlinkSync(inputPath);
        console.log(`[Crypto] Archivo temporal inseguro eliminado: ${inputPath}`);

        // 6. Devolver las llaves (en hexadecimal para guardarlas en la BD)
        // Nota: En este modo streaming, el "nonce" inicial es parte del "header".
        return {
            encryptedFilename: outputFilename,
            keyHex: key.toString('hex'),
            headerHex: header.toString('hex')
        };

    } catch (err) {
        console.error("[Crypto] Error durante el cifrado:", err);
        // Si falla, intentamos borrar el archivo cifrado corrupto
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        throw err; // Relanzamos el error para que server.js lo maneje
    }
}

module.exports = { encryptVideo };

// Crear un stream legible que descifre un archivo generado por encryptVideo (formato con header + [len(4) + ciphertext]...)
const { Readable } = require('stream');

async function* decryptGenerator(filePath, keyHex, headerHex) {
    const key = Buffer.from(keyHex, 'hex');
    const header = Buffer.from(headerHex, 'hex');

    const state = Buffer.alloc(sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES);
    sodium.crypto_secretstream_xchacha20poly1305_init_pull(state, header, key);

    const fd = fs.openSync(filePath, 'r');
    try {
        const headerSize = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
        let offset = headerSize;

        const stat = fs.fstatSync(fd);
        const fileSize = stat.size;

        // Detectar formato: intentar leer 4 bytes como length prefix
        // Si el valor parece razonable (menor que fileSize y mayor que ABYTES), asumimos nuevo formato
        // Si no, usamos formato legacy (sin prefijos)
        let hasLengthPrefix = false;
        if (offset + 4 <= fileSize) {
            const testBuf = Buffer.alloc(4);
            fs.readSync(fd, testBuf, 0, 4, offset);
            const testLen = testBuf.readUInt32BE(0);
            // Heurística: si el valor es razonable (no cero, menor que tamaño de archivo restante)
            // asumimos formato con length-prefix
            const remaining = fileSize - offset - 4;
            if (testLen > 0 && testLen <= remaining && testLen < 100 * 1024 * 1024) {
                hasLengthPrefix = true;
            }
        }

        if (hasLengthPrefix) {
            // NUEVO FORMATO: con prefijos de longitud
            console.log('[decryptGenerator] Detectado formato con length-prefix');
            while (offset < fileSize) {
                const lenBuf = Buffer.alloc(4);
                fs.readSync(fd, lenBuf, 0, 4, offset);
                offset += 4;
                const chunkLen = lenBuf.readUInt32BE(0);

                const cipherBuf = Buffer.alloc(chunkLen);
                fs.readSync(fd, cipherBuf, 0, chunkLen, offset);
                offset += chunkLen;

                const outMax = Math.max(0, cipherBuf.length - sodium.crypto_secretstream_xchacha20poly1305_ABYTES);
                const message = Buffer.alloc(outMax);
                const tagBuf = Buffer.alloc(1);

                const rc = sodium.crypto_secretstream_xchacha20poly1305_pull(state, message, tagBuf, cipherBuf);
                const bytesWritten = rc;
                if (bytesWritten > 0) {
                    yield message.slice(0, bytesWritten);
                }

                const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
                if (tagBuf[0] === TAG_FINAL) break;
            }
        } else {
            // FORMATO LEGACY: sin prefijos, leer en chunks fijos
            console.log('[decryptGenerator] Detectado formato legacy (sin length-prefix)');
            const CHUNK_SIZE = 64 * 1024; // 64KB chunks
            const cipherChunkSize = CHUNK_SIZE + sodium.crypto_secretstream_xchacha20poly1305_ABYTES;

            while (offset < fileSize) {
                const remaining = fileSize - offset;
                const toRead = Math.min(cipherChunkSize, remaining);
                
                const cipherBuf = Buffer.alloc(toRead);
                fs.readSync(fd, cipherBuf, 0, toRead, offset);
                offset += toRead;

                const outMax = Math.max(0, cipherBuf.length - sodium.crypto_secretstream_xchacha20poly1305_ABYTES);
                const message = Buffer.alloc(outMax);
                const tagBuf = Buffer.alloc(1);

                try {
                    const rc = sodium.crypto_secretstream_xchacha20poly1305_pull(state, message, tagBuf, cipherBuf);
                    const bytesWritten = rc;
                    if (bytesWritten > 0) {
                        yield message.slice(0, bytesWritten);
                    }

                    const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
                    if (tagBuf[0] === TAG_FINAL) break;
                } catch (err) {
                    console.error('[decryptGenerator] Error descifrando chunk:', err.message);
                    throw err;
                }
            }
        }

    } finally {
        try { fs.closeSync(fd); } catch (e) {}
    }
}

function createDecryptStream(filePath, keyHex, headerHex) {
    const gen = decryptGenerator(filePath, keyHex, headerHex);
    return Readable.from(gen);
}

module.exports.createDecryptStream = createDecryptStream;

/**
 * Genera un thumbnail de un video cifrado
 * Descifra el video a un archivo temporal, extrae un frame con ffmpeg, y elimina el temporal
 */
async function generateThumbnail(encryptedPath, keyHex, headerHex, outputPath) {
    const { spawn } = require('child_process');
    const tempDir = path.join(__dirname, 'uploads', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    
    const tempVideoPath = path.join(tempDir, `temp_${Date.now()}.mp4`);
    
    try {
        console.log('[Thumbnail] Descifrando video temporal...');
        
        // Descifrar el video a un archivo temporal
        const decryptStream = createDecryptStream(encryptedPath, keyHex, headerHex);
        const tempWriteStream = fs.createWriteStream(tempVideoPath);
        
        await pipeline(decryptStream, tempWriteStream);
        
        console.log('[Thumbnail] Generando thumbnail con ffmpeg...');
        
        // Usar ffmpeg para extraer un frame del video
        // Extraer el frame en el segundo 1 del video
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', tempVideoPath,           // Input file
                '-ss', '00:00:01.000',         // Seek to 1 second
                '-vframes', '1',               // Extract 1 frame
                '-vf', 'scale=320:-1',         // Scale to width 320, maintain aspect ratio
                '-y',                          // Overwrite output file
                outputPath                     // Output file
            ]);
            
            let stderr = '';
            
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    console.log('[Thumbnail] Thumbnail generado exitosamente.');
                    resolve();
                } else {
                    console.error('[Thumbnail] Error de ffmpeg:', stderr);
                    reject(new Error(`ffmpeg falló con código ${code}`));
                }
            });
            
            ffmpeg.on('error', (err) => {
                console.error('[Thumbnail] Error ejecutando ffmpeg:', err.message);
                reject(err);
            });
        });
        
    } finally {
        // Limpiar archivo temporal
        if (fs.existsSync(tempVideoPath)) {
            fs.unlinkSync(tempVideoPath);
            console.log('[Thumbnail] Archivo temporal eliminado.');
        }
    }
}

module.exports.generateThumbnail = generateThumbnail;