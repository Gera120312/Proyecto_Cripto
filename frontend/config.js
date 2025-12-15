// Configuración centralizada de la API
// Cambia esta URL cuando uses Ngrok o cualquier otro servicio
// Detectar automáticamente el backend según el origen actual (soporta ngrok TLS y local)
const API_URL = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : (process && process.env && process.env.API_URL) || 'http://localhost:3000';

// Exportar para uso en otros archivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_URL };
}
