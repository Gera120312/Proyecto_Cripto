# 🎬 CryptoStream — Sistema de Streaming Zero-Trust E2EE

**CryptoStream** es una plataforma de streaming de video con arquitectura **Zero-Trust** y **End-to-End Encryption (E2EE)** usando el modelo **BYOK (Bring Your Own Key)**.

**🔒 El servidor es completamente "ciego"** - NO puede descifrar videos ni llaves de usuarios.

---

## ✨ Características

- ✅ **End-to-End Encryption** - Cifrado/descifrado client-side
- ✅ **Zero-Knowledge Server** - Servidor no puede ver contenido
- ✅ **BYOK** - Usuarios generan y controlan sus llaves RSA
- ✅ **Challenge-Response Auth** - Login seguro con firma RSA-PSS
- ✅ **Share/Revoke** - Compartir videos con control granular
- ✅ **Crypto robusto** - RSA-2048, XChaCha20-Poly1305, PBKDF2

---

## 🚀 Inicio Rápido

### 1️⃣ Instalar Dependencias

```bash
cd backend
npm install
```

### 2️⃣ Iniciar el Servidor

```bash
./start-server.sh
```

El servidor iniciará en `http://localhost:3000`

### 3️⃣ Acceder a la Aplicación

Abre tu navegador en: **http://localhost:3000**

---

## 🔐 Arquitectura Zero-Trust

### Backend (Servidor Ciego)

El servidor **NUNCA** tiene acceso a:
- ❌ Llaves privadas de usuarios
- ❌ Contraseñas en texto plano
- ❌ Llaves de cifrado de videos (VideoKeys)
- ❌ Videos descifrados

Solo almacena:
- ✅ Videos cifrados (`.enc`)
- ✅ Llaves públicas RSA de usuarios
- ✅ Envelopes (VideoKeys envueltas con RSA-OAEP)
- ✅ Hashes PBKDF2 de contraseñas

### Frontend (Client-Side Crypto)

Todas las operaciones criptográficas ocurren en el navegador:
- 🔑 Generación de llaves RSA-2048
- 🔒 Cifrado de videos (XChaCha20-Poly1305)
- 🔓 Descifrado de videos
- 📝 Firma RSA-PSS (challenge-response)
- 🔐 PBKDF2 hashing

---

## 🛠️ Stack Tecnológico

### Criptografía

| Algoritmo | Uso | Especificación |
|-----------|-----|----------------|
| **RSA-2048** | Key wrapping | RSA-OAEP (SHA-256) |
| **RSA-PSS** | Signatures | RSA-PSS (SHA-256, salt: 32) |
| **XChaCha20-Poly1305** | Video encryption | 24-byte nonce, 32-byte key |
| **PBKDF2** | Password hashing | SHA-256, 100k iterations |

### Backend
- Node.js + Express
- SQLite (videos.db)
### Frontend
- libsodium-wrappers (XChaCha20-Poly1305)
- Web Crypto API (RSA, PBKDF2)
- HTML5 + TailwindCSS

---

## 📖 Flujos de Usuario

### 1. Registro

1. Usuario ingresa `username` y `password`
2. Frontend genera par de llaves RSA-2048
3. **Descarga automática** de `username_private.pem` (BYOK)
4. Hashea password con PBKDF2 (100k iterations)
5. Envía `{ username, passwordHash, publicKeyPem }` al servidor

### 2. Login (Challenge-Response)

**Paso 1 - Start:**
1. Usuario ingresa credenciales
2. Frontend hashea password (PBKDF2)
3. POST `/login/start` → Backend devuelve `nonce`

**Paso 2 - Finish:**
4. Usuario carga su `username_private.pem`
5. Frontend firma nonce con RSA-PSS
6. POST `/login/finish` → Backend verifica firma
7. Devuelve `token` UUID

### 3. Upload de Video

1. Usuario selecciona archivo `.mp4`
2. Frontend genera `VideoKey` (32 bytes random)
3. Cifra video con XChaCha20-Poly1305
4. Envuelve `VideoKey` con RSA-OAEP (llave pública del usuario)
5. Envía video cifrado + envelope al servidor

### 4. Reproducción

1. Usuario click en video
2. Carga su llave privada `.pem`
3. Frontend obtiene envelope del servidor
4. Desenvuelve `VideoKey` con RSA-OAEP
5. Descarga stream cifrado
6. Descifra con XChaCha20-Poly1305
7. Reproduce en `<video>` element

### 5. Compartir Video

1. Dueño selecciona usuario destino
2. Carga su llave privada
3. Frontend:
   - Desenvuelve `VideoKey` (con llave propia)
   - Re-envuelve con llave pública del target
   - Envía nuevo envelope al servidor
4. Target puede reproducir el video

### 6. Revocar Acceso

1. Dueño click "Espectadores" en video
2. Click "Revocar" junto a usuario
3. Servidor elimina envelope y permiso
4. Usuario revocado pierde acceso inmediatamente

---

## 📁 Estructura del Proyecto

```
app/
├── backend/
│   ├── server.js              # API REST Zero-Knowledge
│   ├── database.js            # SQLite schema (users, videos, envelopes)
│   ├── start-server.sh        # Script de inicio
│   ├── uploads/
│   │   ├── encrypted/         # Videos cifrados (.enc)
│   │   ├── temp/              # Archivos temporales
│   │   └── thumbnails/        # Miniaturas
│   └── package.json
├── frontend/
│   ├── index.html             # Dashboard principal
│   ├── login.html             # Registro y login
│   ├── app.js                 # Lógica de aplicación
│   ├── frontend.js            # ⭐ Módulo E2EE (core crypto)
│   ├── video.js               # Lógica de reproducción
│   └── config.js              # Configuración API
├── GUIA_USO.md               # 📘 Guía de usuario
├── COMPARTIR_REVOCAR.md      # 📗 Documentación técnica share/revoke
├── RESUMEN_COMPLETO.md       # 📕 Arquitectura completa
└── README.md                  # Este archivo
```

---

## 🔒 Seguridad

### Propiedades Garantizadas

✅ **Zero-Knowledge Server** - Backend nunca ve VideoKeys en texto plano  
✅ **Forward Secrecy** - Revocar elimina envelope; target no puede descifrar más  
✅ **BYOK** - Usuario debe subir llave privada para compartir  
✅ **No Residual Access** - Envelopes eliminados = acceso totalmente revocado  
✅ **Cryptographic Isolation** - Cada usuario tiene envelope único  

### ¿Qué está protegido?

1. **Nunca sale del cliente:**
   - Llaves privadas de usuarios (`.pem`)
   - VideoKeys en texto plano
   - Contraseñas en texto plano
2. **No se sube al repositorio:**
   - `uploads/` - Videos cifrados
   - `videos.db` - Base de datos
   - `.env` - Variables de entorno

3. **Protección automática:**
   - `.gitignore` configurado correctamente
   - Permisos de archivo restrictivos
   - Tokens UUID con sesiones en memoria

---

## 🧪 Testing

### Prueba Rápida del Sistema

```bash
# Terminal 1: Iniciar servidor
cd backend
./start-server.sh

# Terminal 2: Abrir navegador
open http://localhost:3000/
```

### Escenario de Prueba Completo

**Usuarios:** Alice (dueña) y Bob (espectador)

1. **Alice se registra**
   - Descarga `alice_private.pem`
   
2. **Bob se registra**
   - Descarga `bob_private.pem`

3. **Alice sube video**
   - Carga `alice_private.pem`
   - Selecciona `example.mp4`
   - Video se cifra client-side

4. **Alice comparte con Bob**
   - Tab "Modificar Videos" → Click "Compartir"
   - Selecciona "Bob", carga `alice_private.pem`
   - VideoKey se re-cifra para Bob

5. **Bob reproduce**
   - Ve video en su lista
   - Carga `bob_private.pem`
   - Video se descifra client-side

6. **Alice revoca acceso**
   - Click "Espectadores" → "Revocar" junto a Bob
   - Bob pierde acceso inmediatamente

**✅ Resultado esperado:** Todos los pasos funcionan sin errores

---

## 📚 Documentación Adicional

- **[GUIA_USO.md](GUIA_USO.md)** - Guía visual para usuarios finales
- **[COMPARTIR_REVOCAR.md](COMPARTIR_REVOCAR.md)** - Documentación técnica del sistema de permisos
- **[RESUMEN_COMPLETO.md](RESUMEN_COMPLETO.md)** - Arquitectura completa del sistema E2EE

---

## 🤝 Colaboración

### Para Desarrolladores

```bash
# 1. Clonar repositorio
git clone <url>
cd app

# 2. Instalar dependencias
cd backend
npm install

# 3. Iniciar servidor
./start-server.sh

# El servidor creará automáticamente:
# - Base de datos SQLite (videos.db)
# - Carpetas de uploads
# - Tablas necesarias
```

**⚠️ Importante:** Cada desarrollador tendrá su propia base de datos local. No compartas `videos.db` entre equipos.

---

## ⚙️ Configuración

### Variables de Entorno (Opcional)

```bash
# backend/.env (crear si es necesario)
PORT=3000
API_BASE_URL=http://localhost:3000
```

### Configuración Frontend

```javascript
// frontend/config.js
window.API_BASE_URL = 'http://localhost:3000';
```

---

## 🐛 Troubleshooting

### Error: "No se pudo obtener sobre del video"
**Solución:** Verifica que tienes permiso para acceder al video

### Error: "Error al compartir"
**Solución:** Asegúrate de cargar tu llave privada correcta (`.pem`)

### Error: libsodium no carga
**Solución:** Verifica conexión a internet (CDN) o usa versión local

### Base de datos bloqueada
**Solución:** Cierra el servidor y reinicia: `./start-server.sh`

---

## 📄 Licencia

Este proyecto es académico - Criptografía 2 - 7mo Semestre

---

## 👨‍💻 Autor

Proyecto desarrollado como demostración de arquitectura Zero-Trust E2EE

---

## 🎯 Roadmap Futuro

- [ ] Streaming progresivo (chunked decryption)
- [ ] Compartir múltiple (batch share)
- [ ] Notificaciones en tiempo real
- [ ] Audit log de comparticiones
- [ ] Permisos granulares (view-only vs re-share)
- [ ] Expiración automática de permisos
- [ ] Thumbnails cifrados
- [ ] 2FA con TOTP

---

**¡Gracias por usar CryptoStream!** 🎬🔒
- ✅ Expiración automática de tokens (1 hora)
- ✅ Middleware de verificación en todas las rutas protegidas

### 🎥 Gestión de Videos
- ✅ Subida de videos con cifrado automático
- ✅ Streaming seguro con descifrado en tiempo real
- ✅ Sistema de permisos por video
- ✅ Generación automática de thumbnails
- ✅ Edición de metadatos (título, descripción)

### 👥 Control de Acceso
- ✅ Sistema de permisos tipo "Google Docs"
- ✅ Solicitudes de acceso pendientes
- ✅ Gestión de espectadores
- ✅ Roles de usuario (uploader/viewer)

---

## 📝 Licencia

Este proyecto es parte de un trabajo académico. Consulta con el autor para más información.

---

**🎬 CryptoStream - Streaming Seguro con Criptografía Avanzada**

_Desarrollado con ❤️ y 🔐 por el equipo de CryptoStream_
