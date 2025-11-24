document.addEventListener('DOMContentLoaded', () => {
    const videoPlayer = document.getElementById('video-player');
    const videoTitle = document.getElementById('video-title');
    const videoAuthor = document.getElementById('video-author');
    const videoDescription = document.getElementById('video-description');
    const recommendedVideos = document.getElementById('recommended-videos');

    // Retrieve video details from localStorage
    const videoDetails = JSON.parse(localStorage.getItem('currentVideo'));
    if (!videoDetails) {
        alert('No se encontraron detalles del video.');
        window.location.href = 'index.html';
        return;
    }

    // Set video player source and details
    const { id, title, filename, token } = videoDetails;
    
    // Guardar el estado inicial del video en el historial (solo si no existe ya)
    if (!history.state || history.state.videoId !== id) {
        history.replaceState({ videoId: id, videoTitle: title, videoFilename: filename }, '', 'video.html');
    }
    
    videoPlayer.src = `http://localhost:3000/play/${id}?token=${encodeURIComponent(token)}`;
    videoTitle.textContent = title;

    // Fetch full video details including author and description
    fetch(`http://localhost:3000/videos/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(response => {
            if (!response.ok) throw new Error('Error fetching video details');
            return response.json();
        })
        .then(video => {
            videoAuthor.innerHTML = `Por: <span class="font-semibold text-white">${video.uploader || 'Desconocido'}</span>`;
            videoDescription.textContent = video.description || 'Sin descripción disponible.';
        })
        .catch(error => {
            console.error('Error fetching video details:', error);
            videoAuthor.innerHTML = `Por: <span class="font-semibold text-white">Desconocido</span>`;
            videoDescription.textContent = 'No se pudo cargar la descripción.';
        });

    // Load videos the user has access to
    fetch('http://localhost:3000/videos', {
        headers: { 'Authorization': `Bearer ${token}` }
    })
        .then(response => {
            if (!response.ok) throw new Error('Error fetching videos');
            return response.json();
        })
        .then(videos => {
            recommendedVideos.innerHTML = '';
            
            // Filter to only show videos the user has access to, excluding current video
            const accessibleVideos = videos.filter(v => v.has_access && v.id !== parseInt(id));
            
            if (accessibleVideos.length === 0) {
                recommendedVideos.innerHTML = '<li class="text-gray-400 text-sm">No hay más videos disponibles</li>';
                return;
            }

            accessibleVideos.forEach(video => {
                const li = document.createElement('li');
                const token = localStorage.getItem('jwt') || localStorage.getItem('jwtToken');
                const thumbnailUrl = `http://localhost:3000/thumbnail/${video.id}?token=${encodeURIComponent(token)}&t=${Date.now()}`;
                const placeholderUrl = `https://placehold.co/320x180/1f2937/7dd3fc?text=${encodeURIComponent(video.title)}`;
                
                li.innerHTML = `
                    <a href="#" onclick="event.preventDefault(); window.playVideo(${video.id}, '${video.title.replace(/'/g, "\\'")}', '${video.filename}'); return false;" 
                        class="block bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors overflow-hidden">
                        <img src="${thumbnailUrl}" onerror="this.onerror=null; this.src='${placeholderUrl}'" alt="${video.title}" class="w-full h-40 object-cover">
                        <div class="p-3">
                            <h4 class="font-semibold text-white text-sm mb-1 line-clamp-2">${video.title}</h4>
                            <p class="text-xs text-gray-400">Por: ${video.uploader}</p>
                        </div>
                    </a>
                `;
                recommendedVideos.appendChild(li);
            });
        })
        .catch(error => {
            console.error('Error fetching videos:', error);
            recommendedVideos.innerHTML = '<li class="text-gray-400 text-sm">Error al cargar videos</li>';
        });

    // Make playVideo available globally for onclick handlers
    window.playVideo = (videoId, videoTitle, encryptedFilename) => {
        const token = localStorage.getItem('jwt') || localStorage.getItem('jwtToken');
        if (!token) { alert("Debes iniciar sesión."); return; }

        localStorage.setItem('currentVideo', JSON.stringify({
            id: videoId,
            title: videoTitle,
            filename: encryptedFilename,
            token: token
        }));

        // Agregar nueva entrada al historial en lugar de recargar
        history.pushState({ videoId, videoTitle, videoFilename: encryptedFilename }, '', 'video.html');
        
        // Recargar el contenido del video sin recargar la página completa
        loadVideoContent(videoId, videoTitle, encryptedFilename, token);
    };
    
    // Función para cargar el contenido del video sin recargar la página
    function loadVideoContent(videoId, newVideoTitle, encryptedFilename, token) {
        // Actualizar el reproductor
        videoPlayer.src = `http://localhost:3000/play/${videoId}?token=${encodeURIComponent(token)}`;
        videoTitle.textContent = newVideoTitle;
        
        // Cargar detalles del video
        fetch(`http://localhost:3000/videos/${videoId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(response => {
                if (!response.ok) throw new Error('Error fetching video details');
                return response.json();
            })
            .then(video => {
                videoAuthor.innerHTML = `Por: <span class="font-semibold text-white">${video.uploader || 'Desconocido'}</span>`;
                videoDescription.textContent = video.description || 'Sin descripción disponible.';
            })
            .catch(error => {
                console.error('Error fetching video details:', error);
                videoAuthor.innerHTML = `Por: <span class="font-semibold text-white">Desconocido</span>`;
                videoDescription.textContent = 'No se pudo cargar la descripción.';
            });
    }
    
    // Manejar el botón "Atrás" del navegador
    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.videoId) {
            // Restaurar el video desde el historial
            const { videoId, videoTitle, videoFilename } = event.state;
            const token = localStorage.getItem('jwt') || localStorage.getItem('jwtToken');
            
            if (!token) {
                window.location.href = 'index.html';
                return;
            }
            
            // Actualizar localStorage para mantener consistencia
            localStorage.setItem('currentVideo', JSON.stringify({
                id: videoId,
                title: videoTitle,
                filename: videoFilename,
                token: token
            }));
            
            // Cargar el video anterior
            loadVideoContent(videoId, videoTitle, videoFilename, token);
        } else {
            // Si no hay estado de video, volver al dashboard
            window.location.href = 'index.html';
        }
    });

    // =============================================
    // SISTEMA DE NOTIFICACIONES (Copiado de app.js)
    // =============================================
    window.notificationDropdown = null;
    
    // Función para cargar y actualizar el contador de notificaciones
    async function updateNotificationBadge() {
        const token = localStorage.getItem('jwt');
        if (!token) return;
        
        try {
            const response = await fetch('http://localhost:3000/requests/managed', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) return;
            const requests = await response.json();
            
            const badge = document.getElementById('notification-badge');
            if (badge && requests.length > 0) {
                badge.textContent = requests.length;
                badge.classList.remove('hidden');
            } else if (badge) {
                badge.classList.add('hidden');
            }
            
            return requests;
        } catch (error) {
            console.error('Error al cargar notificaciones:', error);
            return [];
        }
    }
    
    // Crear dropdown de notificaciones
    function createNotificationDropdown() {
        if (window.notificationDropdown) {
            window.notificationDropdown.remove();
        }
        
        window.notificationDropdown = document.createElement('div');
        window.notificationDropdown.id = 'notification-dropdown';
        window.notificationDropdown.className = 'absolute top-full right-0 mt-2 w-96 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto';
        window.notificationDropdown.innerHTML = '<div class="p-4 text-center text-gray-400">Cargando notificaciones...</div>';
        
        const bell = document.getElementById('notification-bell');
        if (bell) {
            bell.style.position = 'relative';
            bell.appendChild(window.notificationDropdown);
        }
        
        return window.notificationDropdown;
    }
    
    // Mostrar notificaciones en el dropdown
    async function showNotifications() {
        const dropdown = createNotificationDropdown();
        const requests = await updateNotificationBadge();
        
        if (!requests || requests.length === 0) {
            dropdown.innerHTML = `
                <div class="p-6 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto text-gray-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p class="text-gray-400">No tienes solicitudes pendientes</p>
                </div>
            `;
            return;
        }
        
        dropdown.innerHTML = `
            <div class="p-4 border-b border-gray-700">
                <h3 class="font-bold text-white text-lg">Solicitudes Pendientes</h3>
                <p class="text-sm text-gray-400">Tienes ${requests.length} ${requests.length === 1 ? 'solicitud nueva' : 'solicitudes nuevas'}</p>
            </div>
            <div class="divide-y divide-gray-700">
                ${requests.map(req => `
                    <div class="p-4 hover:bg-gray-700 transition cursor-pointer" onclick="event.stopPropagation(); goToRequestsTab();">
                        <div class="flex items-start">
                            <div class="flex-shrink-0">
                                <div class="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                </div>
                            </div>
                            <div class="ml-3 flex-1">
                                <p class="text-sm text-white">
                                    <span class="font-bold text-blue-400">${req.requester_name}</span> solicita acceso
                                </p>
                                <p class="text-sm font-semibold text-white mt-1">${req.video_title}</p>
                                <p class="text-xs text-gray-400 mt-1">${new Date(req.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="p-3 border-t border-gray-700 text-center">
                <button onclick="event.stopPropagation(); goToRequestsTab();" class="text-indigo-400 hover:text-indigo-300 text-sm font-semibold">Ver todas las solicitudes</button>
            </div>
        `;
    }
    
    // Función global para ir a la pestaña de solicitudes (redirige a index.html)
    window.goToRequestsTab = function() {
        if (window.notificationDropdown) {
            window.notificationDropdown.remove();
            window.notificationDropdown = null;
        }
        sessionStorage.setItem('activeSection', 'requests');
        window.location.href = 'index.html';
    };
    
    // Event listener para la campanita
    const bellIcon = document.getElementById('notification-bell');
    if (bellIcon) {
        bellIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.notificationDropdown && window.notificationDropdown.parentElement) {
                window.notificationDropdown.remove();
                window.notificationDropdown = null;
            } else {
                showNotifications();
            }
        });
    }
    
    // Cerrar dropdown al hacer click fuera
    document.addEventListener('click', (e) => {
        if (window.notificationDropdown && !window.notificationDropdown.contains(e.target) && !bellIcon?.contains(e.target)) {
            window.notificationDropdown.remove();
            window.notificationDropdown = null;
        }
    });
    
    // Actualizar el badge cada 30 segundos
    if (localStorage.getItem('jwt')) {
        updateNotificationBadge();
        setInterval(updateNotificationBadge, 30000);
    }
});