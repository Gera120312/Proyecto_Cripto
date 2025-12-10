// Configuración centralizada de la API
// Cambia esta URL cuando uses Ngrok o cualquier otro servicio
const API_URL = 'https://semigovernmentally-trichromatic-stephnie.ngrok-free.dev';

// Exportar para uso en otros archivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_URL };
}
