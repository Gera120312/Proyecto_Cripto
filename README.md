# 🎬 CryptoStream — Sistema de Streaming Seguro con Cifrado

**CryptoStream** es una plataforma de streaming de video que utiliza cifrado de extremo a extremo y autenticación robusta mediante criptografía asimétrica ECDSA.

---

## 🚀 Inicio Rápido

### 1️⃣ Clonar el Repositorio

```bash
git clone <url-del-repo>
cd app
```

### 2️⃣ Instalar Dependencias

```bash
cd backend
npm install
```

### 3️⃣ Iniciar el Servidor

```bash
./start-server.sh
```

El script verificará e iniciará el servidor automáticamente. Las claves ECDSA se generarán automáticamente en la primera ejecución.

### 4️⃣ Acceder a la Aplicación

Abre tu navegador en: **http://localhost:3000**

---

## 🔐 Sistema de Autenticación

### Criptografía Asimétrica ECDSA

CryptoStream utiliza **ECDSA (Elliptic Curve Digital Signature Algorithm)** para firmar y verificar tokens JWT, proporcionando seguridad superior a las claves simétricas tradicionales.

#### ¿Cómo Funciona?

- **Clave PRIVADA** (`keys/private.pem`): Usada SOLO para FIRMAR tokens JWT durante el login
- **Clave PÚBLICA** (`keys/public.pem`): Usada para VERIFICAR la autenticidad de los tokens

**Analogía:** 
- La clave privada es como tu mano y bolígrafo (solo tú puedes firmar)
- La clave pública es como una copia de tu firma en tu INE (otros pueden verificar, pero no pueden firmarla)

#### Generación Automática de Claves

Al ejecutar `./start-server.sh`, el sistema:

1. ✅ Verifica si las claves ya existen en `backend/keys/`
2. 📦 Si no existen, las genera automáticamente usando el algoritmo ECDSA con curva P-256
3. 🔒 Almacena las claves de forma segura con permisos restringidos

**No necesitas hacer nada manualmente.** El sistema está listo para usar.

#### Regenerar Claves Manualmente

Si necesitas regenerar las claves por alguna razón:

```bash
cd backend
node generate-keys.js
```

**⚠️ Importante:** Regenerar las claves invalidará todos los tokens JWT existentes. Los usuarios deberán hacer login nuevamente.

---

## 📁 Estructura del Proyecto

```
app/
├── backend/
│   ├── server.js              # Servidor principal con endpoints
│   ├── database.js            # Configuración de SQLite
│   ├── cryptoService.js       # Servicios de cifrado de video
│   ├── generate-keys.js       # Script de generación de claves ECDSA
│   ├── start-server.sh        # Script de inicio automático
│   ├── keys/                  # 🔐 Claves ECDSA (generadas automáticamente)
│   │   ├── private.pem        # Clave PRIVADA (NO compartir)
│   │   └── public.pem         # Clave PÚBLICA
│   ├── uploads/
│   │   ├── encrypted/         # Videos cifrados
│   │   ├── temp/              # Archivos temporales
│   │   └── thumbnails/        # Miniaturas generadas
│   └── package.json
├── frontend/
│   ├── index.html             # Página principal
│   ├── login.html             # Página de login
│   ├── video.html             # Reproductor de video
│   └── app.js                 # Lógica del frontend
└── README.md                  # Este archivo
```

---

## 🔒 Seguridad

### Claves y Secretos

- ✅ Las claves ECDSA se generan **automáticamente** en la primera ejecución
- ✅ Se almacenan en `backend/keys/` (excluido de Git mediante `.gitignore`)
- ✅ La clave privada **NUNCA** debe salir del servidor
- ✅ Sistema de permisos apropiados configurado automáticamente

### ¿Qué está protegido?

1. **No se sube al repositorio:**
   - `keys/` - Claves ECDSA
   - `*.pem` - Archivos de claves
   - `uploads/` - Videos subidos
   - `.env` - Variables de entorno

2. **Protección automática:**
   - `.gitignore` configurado correctamente
   - Permisos de archivo restrictivos
   - Tokens JWT con expiración de 1 hora

### Mejores Prácticas

✅ **Hacer:**
- Mantener las claves dentro del servidor
- Usar el script `start-server.sh` para iniciar
- Hacer backup seguro de `keys/private.pem`
- Revisar logs regularmente

❌ **No Hacer:**
- Subir `keys/` a Git
- Compartir `private.pem` con nadie
- Usar las mismas claves en múltiples proyectos
- Loggear las claves en consola

---

## 👥 Colaboración

### Para Colaboradores

Cada colaborador debe:

1. **Clonar el repositorio:**
   ```bash
   git clone <url-del-repo>
   cd app/backend
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Iniciar el servidor:**
   ```bash
   ./start-server.sh
   ```

Las claves se generarán automáticamente en tu máquina local. **No compartas tu `keys/private.pem` con nadie.**

### Flujo de Trabajo Seguro

```
Desarrollador A                Desarrollador B
    │                              │
    ├─ Clona repo                  ├─ Clona repo
    ├─ npm install                 ├─ npm install
    ├─ ./start-server.sh           ├─ ./start-server.sh
    │  (genera claves A)           │  (genera claves B)
    ├─ Trabaja con claves A        ├─ Trabaja con claves B
    └─ NO sube keys/ a Git         └─ NO sube keys/ a Git
```

Cada desarrollador tiene **sus propias claves** que son diferentes entre sí. Esto es **intencional** y **seguro**.

---

## 🛠️ Configuración Avanzada

### Variables de Entorno (Opcional)

Si deseas usar variables de entorno en lugar de archivos:

1. Crea un archivo `.env` en `backend/`:
   ```env
   PORT=3000
   # Otras configuraciones...
   ```

2. El archivo `.env` está excluido de Git automáticamente.

### Configuración de Puerto

Por defecto, el servidor corre en el puerto **3000**. Para cambiarlo:

```javascript
// En backend/server.js, línea 16
const PORT = 3000; // Cambia a tu puerto preferido
```

---

## 📖 Documentación Adicional

- **[SECURITY.md](backend/SECURITY.md)** - Guía completa del sistema de autenticación ECDSA
- **[Comentarios en server.js](backend/server.js)** - Documentación detallada del código

---

## 🧪 Verificación del Sistema

### Probar el Login

```bash
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123"}'
```

### Inspeccionar Token JWT

Copia el token recibido y pégalo en [jwt.io](https://jwt.io). Deberías ver:

```json
{
  "alg": "ES256",
  "typ": "JWT"
}
```

El algoritmo `ES256` confirma que estás usando ECDSA correctamente.

---

## 🆘 Solución de Problemas

### Error: "Cannot find module 'keys/private.pem'"

**Solución:** Ejecuta `node generate-keys.js` desde el directorio `backend/`:

```bash
cd backend
node generate-keys.js
```

### Error: "EACCES: permission denied"

**Solución:** Verifica los permisos del script:

```bash
chmod +x backend/start-server.sh
```

### Tokens no válidos después de reiniciar

**Causa:** Si regeneraste las claves, todos los tokens antiguos son inválidos.

**Solución:** Los usuarios deben hacer login nuevamente.

---

## 📞 Contacto y Soporte

Si tienes problemas:

1. Revisa la [documentación de seguridad](backend/SECURITY.md)
2. Verifica los comentarios en `server.js`
3. Abre un **issue** en el repositorio

---

## 🎓 Características Principales

### ✨ Autenticación
- ✅ Registro de usuarios con hash bcrypt
- ✅ Login con tokens JWT firmados con ECDSA
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
