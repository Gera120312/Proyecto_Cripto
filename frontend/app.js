document.addEventListener('DOMContentLoaded', () => {

    // --- LÓGICA PARA LA PÁGINA PRINCIPAL (index.html) ---
    const mainPage = document.getElementById('watch-section');
    if (mainPage) {
        
        // 1. Verificar si el token existe
        const token = localStorage.getItem('jwt');
        if (!token) {
            window.location.href = 'login.html'; // Si no hay token, fuera.
            return;
        }

        // 2. El mensaje de bienvenida ya está en index.html, no lo sobrescribamos aquí

        // 3. Lógica para cambiar entre pestañas (Ver/Subir)
        const sections = {
            watch: document.getElementById('watch-section'),
            upload: document.getElementById('upload-section'),
            player: document.getElementById('player-section')
        };
        const navButtons = {
            watch: document.getElementById('nav-watch'),
            upload: document.getElementById('nav-upload')
        };
        function showSection(sectionId) {
            // Ocultar todas las secciones
            Object.values(sections).forEach(section => section.classList.remove('active'));
            
            // Desactivar todos los botones (mostrar border transparente y texto gris)
            Object.values(navButtons).forEach(button => {
                button.classList.remove('border-blue-500', 'text-white');
                button.classList.add('border-transparent', 'text-gray-400');
            });
            
            // Mostrar la sección correspondiente
            if (sections[sectionId]) {
                sections[sectionId].classList.add('active');
            }
            
            // Activar el botón correspondiente (solo si existe en navButtons)
            if (navButtons[sectionId]) {
                navButtons[sectionId].classList.remove('border-transparent', 'text-gray-400');
                navButtons[sectionId].classList.add('border-blue-500', 'text-white');
            }
        }
        navButtons.watch.addEventListener('click', () => showSection('watch'));
        navButtons.upload.addEventListener('click', () => showSection('upload'));
        document.getElementById('back-button').addEventListener('click', () => showSection('watch'));


        // 4. Lógica para el formulario de subida (Tu Tarea Semana 3/4)
        const uploadForm = document.getElementById('upload-form');
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            // ...
            // --- SIMULACIÓN DE SUBIDA (Actualizada) ---
            // Aquí llamarás al endpoint /upload
            // El backend recibirá el video, generará una clave ChaCha20,
            // lo cifrará con ChaCha20-Poly1305 y lo guardará.
            console.log("Simulando subida para cifrado con ChaCha20 en el backend...");
            // ...
            // --- FIN DE LA SIMULACIÓN ---
        });

        // 5. Lógica para ver un video (Tu Tarea Semana 4)
        const videoGrid = document.getElementById('video-grid');
        videoGrid.addEventListener('click', async (e) => {
            // ...
            // --- SIMULACIÓN DE OBTENCIÓN DE CLAVE Y VIDEO (Actualizada) ---
            // 1. Mostrar la sección del reproductor
            showSection('player');
            
            // 2. Aquí llamarías a /get-key (usando el token ECDSA)
            // const key = await fetch('/get-key?id=' + videoId, { headers: {'Authorization': `Bearer ${token}`} });
            console.log("Clave ChaCha20 simulada recibida."); // <-- Comentario actualizado

            // 3. Aquí llamarías a /video-stream (usando el token ECDSA)
            // const encryptedVideo = await fetch('/video-stream?id=' + videoId, { headers: {'Authorization': `Bearer ${token}`} });
            console.log("Stream de video cifrado (ChaCha20) simulado recibido."); // <-- Comentario actualizado
            
            // 4. Aquí descifrarías el video (Tarea Semana 4)
            // const decryptedVideoBlob = await decryptVideo(encryptedVideo, key);
            console.log("Simulando descifrado ChaCha20-Poly1305 en el cliente...");
            
            // 5. Como simulación, solo cargamos el video de prueba
            const videoPlayer = document.getElementById('video-player');
            videoPlayer.src = 'test.mp4';
            videoPlayer.load();
            videoPlayer.play();
            // --- FIN DE LA SIMULACIÓN ---
        });
        
        showSection('watch');
    }
});