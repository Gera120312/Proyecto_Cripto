// Configuración centralizada de la API
// Cambia esta URL cuando uses Ngrok o cualquier otro servicio
// IMPORTANTE: Esta URL debe apuntar al backend (puerto 3000)
// El backend ya sirve los archivos estáticos del frontend
const API_URL = 'https://semigovernmentally-trichromatic-stephnie.ngrok-free.dev';

// Exportar para uso en el navegador
if (typeof window !== 'undefined') {
    window.API_BASE_URL = API_URL;
}

// Exportar para uso en otros archivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_URL };
}
