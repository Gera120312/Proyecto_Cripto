// Frontend Zero-Trust / E2EE with BYOK
// Requirements: Web Crypto API nativa del navegador para AES-256-GCM
// Uses Web Crypto API for RSA-2048 (RSA-OAEP wrap, RSA-PSS sign), PBKDF2 (SHA-256), and AES-256-GCM

const E2EE = (() => {
  // API Base URL (fallback to localhost:3000)
  const getApiUrl = () => window.API_BASE_URL || 'http://localhost:3000';
  
  // Utility: base64 (optimizado para archivos grandes)
  const b64 = {
    encode: (buf) => {
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunkSize = 0x8000; // 32KB chunks para evitar stack overflow
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
    },
    decode: (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
  };

  // Utility: Generate random bytes
  function generateRandomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  // Utility: PEM export/import for RSA keys
  async function generateRSAKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt']
    );
    return keyPair;
  }

  async function exportPublicKeyPem(publicKey) {
    const spki = await crypto.subtle.exportKey('spki', publicKey);
    const b64key = b64.encode(spki);
    const chunks = b64key.match(/.{1,64}/g).join('\n');
    return `-----BEGIN PUBLIC KEY-----\n${chunks}\n-----END PUBLIC KEY-----\n`;
  }

  async function exportPrivateKeyPem(privateKey) {
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
    const b64key = b64.encode(pkcs8);
    const chunks = b64key.match(/.{1,64}/g).join('\n');
    return `-----BEGIN PRIVATE KEY-----\n${chunks}\n-----END PRIVATE KEY-----\n`;
  }

  function downloadPrivateKeyPem(pem, filename = 'private_key.pem') {
    const blob = new Blob([pem], { type: 'application/x-pem-file' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Import PEM public key for RSA-OAEP
  async function importPublicKeyPem(pem) {
    const b64Body = pem.replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, '');
    const der = b64.decode(b64Body);
    return crypto.subtle.importKey(
      'spki',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    );
  }

  // Import PEM private key; for PSS signing we import separate key
  async function importPrivateKeyPemForPSS(pem) {
    const b64Body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const der = b64.decode(b64Body);
    return crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSA-PSS', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }

  async function importPrivateKeyPemForOAEP(pem) {
    const b64Body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const der = b64.decode(b64Body);
    return crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  }

  // PBKDF2(SHA-256) hashing client-side
  async function pbkdf2Hash(password, salt, iterations = 100_000, length = 32) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations }, keyMaterial, length * 8);
    return b64.encode(bits);
  }

  // RSA-PSS sign nonce
  async function signNoncePSS(privateKeyPSS, nonceBytes) {
    const signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, privateKeyPSS, nonceBytes);
    return b64.encode(signature);
  }

  // RSA-OAEP wrap (encrypt) random VideoKey (32 bytes)
  async function wrapVideoKeyRSAOAEP(publicKey, videoKeyBytes) {
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, videoKeyBytes);
    return b64.encode(wrapped);
  }

  // RSA-OAEP unwrap (decrypt) to recover VideoKey
  async function unwrapVideoKeyRSAOAEP(privateKeyOAEP, wrappedB64) {
    console.log('[Unwrap] wrappedB64 length:', wrappedB64.length);
    console.log('[Unwrap] wrappedB64 first 50 chars:', wrappedB64.substring(0, 50));
    const wrapped = b64.decode(wrappedB64);
    console.log('[Unwrap] wrapped bytes length:', wrapped.length);
    console.log('[Unwrap] privateKeyOAEP algorithm:', privateKeyOAEP.algorithm);
    try {
      const keyBytes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKeyOAEP, wrapped);
      console.log('[Unwrap] SUCCESS - keyBytes length:', keyBytes.byteLength);
      return new Uint8Array(keyBytes);
    } catch (err) {
      console.error('[Unwrap] FAILED:', err);
      console.error('[Unwrap] privateKey type:', privateKeyOAEP.type);
      console.error('[Unwrap] privateKey extractable:', privateKeyOAEP.extractable);
      console.error('[Unwrap] privateKey usages:', privateKeyOAEP.usages);
      throw err;
    }
  }

  // AES-256-GCM via Web Crypto API (nativo del navegador)
  async function encryptBlobAESGCM(blob, keyBytes) {
    // Importar la clave
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    // Generar IV aleatorio (12 bytes)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Obtener datos del blob
    const data = new Uint8Array(await blob.arrayBuffer());
    
    // Encriptar
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        data
    );
    
    return { cipher: new Uint8Array(encrypted), nonce: iv };
  }

  async function encryptBytesAESGCM(dataBytes, keyBytes, nonceBytes) {
    // Importar la clave
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    // Encriptar
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonceBytes },
        cryptoKey,
        dataBytes
    );
    
    return new Uint8Array(encrypted);
  }

  async function decryptBytesAESGCM(cipherBytes, keyBytes, nonceBytes) {
    // Importar la clave
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    
    // Desencriptar
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonceBytes },
        cryptoKey,
        cipherBytes
    );
    
    return new Uint8Array(decrypted);
  }

  // Memory hygiene: zero key
  function zero(bytes) { if (bytes) bytes.fill(0); }

  // Generar miniatura desde el archivo de video
  async function generateAndSaveThumbnail(token, videoId, file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.style.display = 'none';
      
      video.onloadedmetadata = () => {
        // Buscar keyframe (usar 1 segundo después del inicio)
        video.currentTime = Math.min(1, video.duration * 0.1);
      };
      
      video.onseeked = async () => {
        try {
          // Crear canvas y dibujar el frame
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          const ctx = canvas.getContext('2d');
          
          // Calcular dimensiones para mantener aspecto
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = canvas.width / canvas.height;
          
          let drawWidth, drawHeight, offsetX, offsetY;
          if (videoAspect > canvasAspect) {
            drawHeight = canvas.height;
            drawWidth = canvas.height * videoAspect;
            offsetX = (canvas.width - drawWidth) / 2;
            offsetY = 0;
          } else {
            drawWidth = canvas.width;
            drawHeight = canvas.width / videoAspect;
            offsetX = 0;
            offsetY = (canvas.height - drawHeight) / 2;
          }
          
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
          
          // Convertir a base64
          const thumbnailBase64 = canvas.toDataURL('image/jpeg', 0.7);
          
          // Enviar al servidor
          const saveResp = await fetch(`${getApiUrl()}/api/save-thumbnail`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              videoId,
              thumbnail: thumbnailBase64
            })
          });
          
          if (!saveResp.ok) {
            throw new Error('Error al guardar miniatura');
          }
          
          document.body.removeChild(video);
          resolve();
        } catch (err) {
          document.body.removeChild(video);
          reject(err);
        }
      };
      
      video.onerror = () => {
        document.body.removeChild(video);
        reject(new Error('Error al procesar el video para miniatura'));
      };
      
      document.body.appendChild(video);
      video.src = URL.createObjectURL(file);
    });
  }

  // Helper: Extract public key from private key PEM
  async function exportPublicKeyFromPrivate(privateKeyPem) {
    try {
      // Import private key as extractable so we can export it to JWK
      const b64Body = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, '');
      const der = b64.decode(b64Body);
      const privateKey = await crypto.subtle.importKey(
        'pkcs8',
        der,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true, // extractable = true to allow export
        ['decrypt']
      );
      
      const exported = await crypto.subtle.exportKey('jwk', privateKey);
      // Remove private key parameters to get public key
      const publicJwk = {
        kty: exported.kty,
        n: exported.n,
        e: exported.e,
        alg: 'RSA-OAEP-256',
        ext: true
      };
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicJwk,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
      );
      return await exportPublicKeyPem(publicKey);
    } catch (err) {
      throw new Error('No se pudo extraer la clave pública: ' + err.message);
    }
  }

  // API flows
  return {
    // Expose utility functions for manual key generation
    generateRSAKeyPair,
    exportPublicKeyPem,
    exportPrivateKeyPem,
    pbkdf2Hash,
    generateAndSaveThumbnail,
    
    // 1) Registro: genera RSA, descarga privada, envía username+hash+publicKey al backend
    register: async (username, password, salt = username) => {
      const { publicKey, privateKey } = await generateRSAKeyPair();
      const publicKeyPem = await exportPublicKeyPem(publicKey);
      const privateKeyPem = await exportPrivateKeyPem(privateKey);
      // Force download private key (never store client-side)
      downloadPrivateKeyPem(privateKeyPem, `${username}_private.pem`);
      // PBKDF2 hash client-side
      const passwordHash = await pbkdf2Hash(password, salt);
      const resp = await fetch(`${getApiUrl()}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passwordHash, publicKeyPem })
      });
      if (!resp.ok) throw new Error('Error registro');
      return await resp.json();
    },

    // 2) Login: start (nonce) then finish (RSA-PSS signature using uploaded private key)
    loginStart: async (username, password, salt = username) => {
      const passwordHash = await pbkdf2Hash(password, salt);
      const resp = await fetch(`${getApiUrl()}/login/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passwordHash })
      });
      if (!resp.ok) throw new Error('Credenciales inválidas');
      const data = await resp.json();
      return data.nonce; // base64
    },

    loginFinish: async (username, nonceBase64, privateKeyPem) => {
      const privateKeyPSS = await importPrivateKeyPemForPSS(privateKeyPem);
      const nonce = b64.decode(nonceBase64);
      const signatureBase64 = await signNoncePSS(privateKeyPSS, nonce);
      const resp = await fetch(`${getApiUrl()}/login/finish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, signatureBase64 })
      });
      if (!resp.ok) throw new Error('Firma inválida');
      const data = await resp.json();
      return data.token; // UUID session token
    },

    // 3) Upload: encrypt video client-side, wrap key with own public key, send multipart
    uploadEncryptedVideo: async ({ token, file, title, description, userPublicKeyPem }) => {
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const { cipher, nonce } = await encryptBlobAESGCM(file, keyBytes);
      const publicKey = await importPublicKeyPem(userPublicKeyPem);
      const wrappedKeyBase64 = await wrapVideoKeyRSAOAEP(publicKey, keyBytes);
      const wrappedHeaderBase64 = b64.encode(nonce);

      // Convertir el video cifrado a base64 para guardarlo como texto
      const cipherBase64 = b64.encode(cipher);

      const form = new FormData();
      const encBlob = new Blob([cipherBase64], { type: 'text/plain' });
      const encFile = new File([encBlob], `${file.name}.enc`);
      form.append('video', encFile);
      form.append('title', title);
      form.append('description', description || '');
      form.append('wrappedKeyBase64', wrappedKeyBase64);
      form.append('wrappedHeaderBase64', wrappedHeaderBase64);

      const headers = { 'Authorization': `Bearer ${token}` };
      // Header requerido por Ngrok si usas túnel
      if (API_URL.includes('ngrok')) {
        headers['ngrok-skip-browser-warning'] = 'true';
      }

      const resp = await fetch(`${getApiUrl()}/api/upload-video`, {
        method: 'POST', headers: headers, body: form
      });
      zero(keyBytes);
      if (!resp.ok) throw new Error('Error al subir video');
      const uploadData = await resp.json();
      
      // Generar miniatura después de subida exitosa
      if (uploadData.video && uploadData.video.id) {
        try {
          console.log('[Upload] Generando miniatura para video', uploadData.video.id);
          // Usar una referencia a generateAndSaveThumbnail directamente
          await generateAndSaveThumbnail(token, uploadData.video.id, file);
          console.log('[Upload] Miniatura generada exitosamente');
        } catch (err) {
          console.warn('[Upload] No se pudo generar miniatura, continuando sin ella:', err);
        }
      }
      
      return uploadData;
    },

    // 4) Share: owner unwraps key locally with private key, re-wraps for target user and uploads envelope
    shareVideo: async ({ token, videoId, ownerPrivateKeyPem, wrappedKeyBase64, wrappedHeaderBase64, targetPublicKeyPem, targetUsername }) => {
      console.log('[Share] videoId:', videoId, 'targetUsername:', targetUsername);
      console.log('[Share] wrappedKeyBase64 length:', wrappedKeyBase64.length);
      const ownerPrivateKeyOAEP = await importPrivateKeyPemForOAEP(ownerPrivateKeyPem);
      console.log('[Share] Owner private key imported, attempting unwrap...');
      const videoKeyBytes = await unwrapVideoKeyRSAOAEP(ownerPrivateKeyOAEP, wrappedKeyBase64);
      console.log('[Share] Unwrap successful, wrapping for target...');
      const targetPub = await importPublicKeyPem(targetPublicKeyPem);
      const newWrappedKeyBase64 = await wrapVideoKeyRSAOAEP(targetPub, videoKeyBytes);
      // header is nonce; reuse original
      const resp = await fetch(`${getApiUrl()}/share`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ videoId, targetUsername, wrappedKeyBase64: newWrappedKeyBase64, wrappedHeaderBase64 })
      });
      zero(videoKeyBytes);
      if (!resp.ok) throw new Error('Error al compartir');
      return await resp.json();
    },

    // 4b) Revoke - Proceso seguro con reencriptación
    revokeAccess: async ({ token, videoId, targetUsername, ownerPrivateKeyPem, filename }) => {
      // Paso 1: Obtener el sobre ORIGINAL del video (desde video_keys, no envelopes)
      // Necesitamos la envoltura original del propietario, no la del usuario actual
      const keyResp = await fetch(`${getApiUrl()}/get-owner-key/${videoId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!keyResp.ok) throw new Error('No se pudo obtener sobre del video');
      const { wrappedKeyBase64, wrappedHeaderBase64 } = await keyResp.json();

      // Paso 2: Desencriptar la llave actual del video usando la clave privada del propietario
      let privateKeyOAEP, oldVideoKey, oldNonce;
      try {
        privateKeyOAEP = await importPrivateKeyPemForOAEP(ownerPrivateKeyPem);
        oldVideoKey = await unwrapVideoKeyRSAOAEP(privateKeyOAEP, wrappedKeyBase64);
        oldNonce = b64.decode(wrappedHeaderBase64);
      } catch (err) {
        throw new Error('La clave privada proporcionada no coincide con la que se usó para subir el video. Asegúrate de usar la clave privada ORIGINAL del propietario.');
      }

      // Paso 3: Descargar y desencriptar el video
      console.log('[Revoke] Descargando video cifrado:', filename);
      const encResp = await fetch(`${getApiUrl()}/stream/${encodeURIComponent(filename)}`);
      if (!encResp.ok) throw new Error('No se pudo obtener el video cifrado');
      const encBase64 = await encResp.text();
      console.log('[Revoke] Video descargado, tamaño base64:', encBase64.length);
      console.log('[Revoke] Primeros 100 caracteres:', encBase64.substring(0, 100));
      const encBuf = b64.decode(encBase64);
      console.log('[Revoke] Video decodificado, tamaño bytes:', encBuf.length);
      console.log('[Revoke] oldVideoKey length:', oldVideoKey.length, 'oldNonce length:', oldNonce.length);
      const plainVideoBytes = await decryptBytesAESGCM(encBuf, oldVideoKey, oldNonce);
      zero(oldVideoKey);

      // Paso 4: Generar nueva llave y nonce para el video
      const newVideoKey = generateRandomBytes(32);
      const newNonce = generateRandomBytes(12);

      // Paso 5: Reencriptar el video con la nueva llave
      const newEncryptedVideo = await encryptBytesAESGCM(plainVideoBytes, newVideoKey, newNonce);
      const newEncryptedVideoBase64 = b64.encode(newEncryptedVideo);
      zero(plainVideoBytes);

      // Paso 6: Obtener lista de usuarios con acceso (excluyendo al que se revoca)
      const viewersResp = await fetch(`${getApiUrl()}/videos/${videoId}/viewers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!viewersResp.ok) throw new Error('No se pudo obtener lista de espectadores');
      const viewers = await viewersResp.json();
      const remainingViewers = viewers.filter(v => v.username !== targetUsername);

      // Paso 7: Crear nuevas envolturas para todos los usuarios restantes (incluyendo al propietario)
      const newEnvelopes = [];
      
      // Agregar sobre para el propietario - usar la clave pública del backend
      const ownerPubKeyResp = await fetch(`${getApiUrl()}/me/publicKey`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!ownerPubKeyResp.ok) throw new Error('No se pudo obtener tu clave pública');
      const { publicKey: ownerPublicKeyPem } = await ownerPubKeyResp.json();
      const ownerPublicKey = await importPublicKeyPem(ownerPublicKeyPem);
      const ownerWrappedKeyBase64 = await wrapVideoKeyRSAOAEP(ownerPublicKey, newVideoKey);
      newEnvelopes.push({
        username: 'owner', // El backend identificará al propietario
        wrappedKey: ownerWrappedKeyBase64,
        wrappedNonce: b64.encode(newNonce)
      });

      // Agregar sobres para los demás usuarios
      for (const viewer of remainingViewers) {
        const pubKeyResp = await fetch(`${getApiUrl()}/users/${viewer.username}/publicKey`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!pubKeyResp.ok) continue;
        const { publicKey: viewerPublicKeyPem } = await pubKeyResp.json();
        const viewerPublicKey = await importPublicKeyPem(viewerPublicKeyPem);
        const wrappedKeyBase64 = await wrapVideoKeyRSAOAEP(viewerPublicKey, newVideoKey);
        newEnvelopes.push({
          username: viewer.username,
          wrappedKey: wrappedKeyBase64,
          wrappedNonce: b64.encode(newNonce)
        });
      }

      zero(newVideoKey);

      // Paso 8: Enviar todo al backend
      const resp = await fetch(`${getApiUrl()}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          videoId,
          targetUsername,
          newEncryptedVideo: newEncryptedVideoBase64,
          newEnvelopes
        })
      });
      if (!resp.ok) throw new Error('Error al revocar');
      return await resp.json();
    },

    // 5) Playback: fetch envelope, decrypt stream locally, return Blob URL
    playback: async ({ token, videoId, filename, privateKeyPem }) => {
      // get envelope for current user
      const envResp = await fetch(`${getApiUrl()}/get-key/${videoId}`, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!envResp.ok) throw new Error('No se pudo obtener sobre');
      const { wrappedKeyBase64, wrappedHeaderBase64 } = await envResp.json();
      const privateKeyOAEP = await importPrivateKeyPemForOAEP(privateKeyPem);
      const keyBytes = await unwrapVideoKeyRSAOAEP(privateKeyOAEP, wrappedKeyBase64);
      const nonce = b64.decode(wrappedHeaderBase64);

      // fetch encrypted stream (ahora es base64)
      const encResp = await fetch(`/stream/${encodeURIComponent(filename)}`);
      if (!encResp.ok) throw new Error('No se pudo obtener el video cifrado');
      const encBase64 = await encResp.text();
      // Convertir de base64 a bytes
      const encBuf = b64.decode(encBase64);
      const plainBytes = await decryptBytesAESGCM(encBuf, keyBytes, nonce);
      zero(keyBytes);
      // create Blob URL
      const blob = new Blob([plainBytes], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      return url;
    },
  };
})();

// Example bindings for UI (optional use from app.js)
window.E2EE = E2EE;
