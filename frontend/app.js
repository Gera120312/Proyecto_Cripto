// Encapsulamos la inicialización de la app en una función para poder llamarla
// ya sea después de que libsodium se inicialice o como fallback si no está disponible.
function startApp() {
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
            function showSection(sectionId, push = true) {
                console.log('[debug] showSection called:', { sectionId, push, time: Date.now() });
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

                // Manejo del History API: pushState para que la navegación por atrás/adelante funcione entre pestañas
                try {
                    if (push) {
                        console.log('[debug] pushState ->', sectionId);
                        history.pushState({ section: sectionId }, '', '');
                        // Evitar que un popstate inmediato (algunos navegadores/desbordes) nos devuelva a otra pestaña
                        try { ignorePopstate = true; setTimeout(() => { ignorePopstate = false; }, 300); } catch (e) {}
                    }
                } catch (err) {
                    // Algunos navegadores en ciertos contextos pueden lanzar; no crítico
                    console.warn('history.pushState falló:', err);
                }

                // Persistir la sección activa para restaurarla en recargas
                try {
                    // Normalizar: 'watch' es el canonical para la vista de videos
                    const canonical = sectionId === 'videos' ? 'watch' : sectionId;
                    sessionStorage.setItem('activeSection', canonical);
                } catch (e) { /* no crítico */ }

                // No mostrar mensajes en el área de upload; usamos toasts emergentes en su lugar.
            }

            // Helper: derive a localStorage key scoped to the current user (by id or username)
            function getUserPendingKey() {
                try {
                    const token = localStorage.getItem('jwt');
                    if (!token) return 'pendingRequests_guest';
                    const payload = JSON.parse(atob(token.split('.')[1]));
                    const uid = payload && (payload.id || payload.username) ? (payload.id || payload.username) : 'guest';
                    return `pendingRequests_${uid}`;
                } catch (e) { return 'pendingRequests_guest'; }
            }

            // Ensure the per-user pendingRequests key exists in localStorage
            try {
                const key = getUserPendingKey();
                if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([]));
            } catch (e) { console.warn('initializing pendingRequests failed', e); }

            // Inject CSS rule to ensure cursor-default on card disables pointer on children
            try {
                if (!document.getElementById('video-card-cursor-style')) {
                    const style = document.createElement('style');
                    style.id = 'video-card-cursor-style';
                    // Only force default cursor on the card itself — allow children (buttons) to show pointer
                    style.innerHTML = `.video-card.cursor-default { cursor: default !important; }`;
                    document.head.appendChild(style);
                }
            } catch (e) { console.warn('could not inject styles', e); }

            // Los listeners de navegación antiguos se manejan más abajo con showTab/showSection
            // (evitamos duplicar handlers que pudieran causar inconsistencias al manipular history)
            document.getElementById('back-button').addEventListener('click', () => showSection('watch', true));

            // Bandera para ignorar un popstate inmediato tras pushState (evita volver a 'watch' en algunos casos)
            let ignorePopstate = false;

            // Verificar consistencia de sesión al mostrar la página (especialmente desde bfcache)
            window.addEventListener('pageshow', (event) => {
                const storedUser = localStorage.getItem('username');
                const usernameSpan = document.getElementById('user-display');
                
                // Si hay un usuario guardado pero no coincide con lo que se muestra, recargar
                if (storedUser && usernameSpan) {
                    const displayedText = usernameSpan.textContent || '';
                    if (!displayedText.includes(storedUser)) {
                        console.log('[Session] Usuario cambiado, recargando página...');
                        window.location.reload();
                    }
                }
                
                // Si no hay token, mandar al login
                if (!localStorage.getItem('jwt')) {
                    window.location.replace('login.html');
                }

                // Restaurar búsqueda si existe en history.state (para BFCache y navegación Back)
                // Esto cubre el caso donde DOMContentLoaded no se dispara (BFCache)
                if (history.state && history.state.searchQuery) {
                    console.log('[pageshow] Restaurando búsqueda desde history:', history.state.searchQuery);
                    if (searchInput) {
                        searchInput.value = history.state.searchQuery;
                        // Asegurar que estamos en la pestaña correcta
                        showTab('watch', true);
                        // Aplicar filtro
                        performSearch(history.state.searchQuery.toLowerCase());
                    }
                }
            });

            // Manejar cambios de historial (botones atrás/adelante del navegador)
            window.addEventListener('popstate', (event) => {
                console.log('[debug] popstate event:', { state: event.state, ignorePopstate, time: Date.now() });
                
                // Verificar si el usuario cambió (ej: logout -> login con otro user -> back)
                const storedUser = localStorage.getItem('username');
                const usernameSpan = document.getElementById('user-display');
                if (storedUser && usernameSpan) {
                    const displayedText = usernameSpan.textContent || '';
                    if (!displayedText.includes(storedUser)) {
                        console.log('[Session] Usuario cambiado en popstate, recargando...');
                        window.location.reload();
                        return;
                    }
                }

                if (ignorePopstate) {
                    console.log('[debug] popstate ignored');
                    ignorePopstate = false;
                    return;
                }

                // Si no hay token, redirigir al login (evita acceder a index con back/forward)
                if (!localStorage.getItem('jwt')) {
                    try { window.location.replace('login.html'); } catch (e) { window.location.href = 'login.html'; }
                    return;
                }

                // Manejar el estado del historial
                const state = event.state;
                if (state && state.section) {
                    const section = state.section;
                    
                    // Si hay una búsqueda guardada en el estado, aplicarla
                    if (state.searchQuery) {
                        if (searchInput) {
                            searchInput.value = state.searchQuery;
                        }
                        // Mostrar la sección y aplicar el filtro (skipReload = true para no borrar el filtro)
                        showTab('watch', true);
                        performSearch(state.searchQuery.toLowerCase());
                    } else {
                        // Limpiar cualquier búsqueda activa al navegar con el botón atrás
                        if (searchInput) {
                            searchInput.value = '';
                        }
                        
                        // Mostrar la sección sin pushState (push=false para no crear loop)
                        if (section === 'watch' || section === 'videos') {
                            showTab('watch');
                            // Mostrar todos los videos (quitar filtro)
                            document.querySelectorAll('.video-card').forEach(card => {
                                card.style.display = '';
                            });
                        } else if (section === 'upload') {
                            showTab('upload');
                        } else if (section === 'modify') {
                            showTab('modify');
                        } else if (section === 'requests') {
                            showTab('requests');
                        } else {
                            showTab('watch');
                        }
                    }
                } else {
                    // Si no hay estado, volver a la pestaña por defecto
                    showTab('watch');
                    if (searchInput) {
                        searchInput.value = '';
                    }
                    document.querySelectorAll('.video-card').forEach(card => {
                        card.style.display = '';
                    });
                }
            });

            // --- Referencias y lógica de pestañas (nueva) ---
            // Referencias a elementos del DOM
            const usernameSpan = document.getElementById('user-display');
            const logoutBtn = document.getElementById('logout-button');

            // Manejador de logout centralizado (remueve token y redirige)
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    try {
                        localStorage.removeItem('jwt');
                        localStorage.removeItem('username');
                        localStorage.removeItem('registrationMessage');
                    } catch (e) { /* ignore */ }
                    window.location.href = 'login.html';
                });
            }
            
            // Pestañas y Secciones
            const tabVideosBtn = document.getElementById('nav-watch');
            const tabUploadBtn = document.getElementById('nav-upload');
            const tabModifyBtn = document.getElementById('nav-modify'); // NUEVO
            const tabRequestsBtn = document.getElementById('nav-requests');

            const videosSection = document.getElementById('watch-section');
            const uploadSection = document.getElementById('upload-section');
            const modifySection = document.getElementById('modify-section'); // NUEVO
            const requestsSection = document.getElementById('requests-section');

            const videoListContainer = document.getElementById('video-list');
            const modifyVideosListContainer = document.getElementById('modify-videos-list'); // NUEVO
            const requestsListContainer = document.getElementById('requests-list');

            // Referencias del Reproductor (NUEVO)
            const videoPlayerContainer = document.getElementById('video-player-container');
            const secureVideoPlayer = document.getElementById('secure-video-player');
            const playingTitle = document.getElementById('playing-title');

            // Mostrar nombre de usuario (ya está presente en index.html pero aseguramos)
            const username = localStorage.getItem('username');
            if (username && usernameSpan) {
                // Mostrar el saludo completo para mantener consistencia con el inline script
                usernameSpan.textContent = 'Hola, ' + username;
            }

            // --- Navegación por Pestañas (ACTUALIZADO) ---
            function showTab(tabName, skipReload = false) {
                // Normalizar nombre: aceptar 'videos' o 'watch' y mapear a la sección real
                const canonical = (tabName === 'videos' ? 'watch' : tabName);

                // 1. Ocultar todas las secciones (usar la clase `active` que define index.html)
                if (videosSection) videosSection.classList.remove('active');
                if (uploadSection) uploadSection.classList.remove('active');
                if (modifySection) modifySection.classList.remove('active'); // NUEVO
                if (requestsSection) requestsSection.classList.remove('active');

                // 2. Desactivar estilos de todos los botones (volver al estilo inactivo)
                const inactiveButtonClasses = ['border-transparent', 'text-gray-400'];
                const activeButtonClasses = ['border-blue-500', 'text-white'];
                [tabVideosBtn, tabUploadBtn, tabModifyBtn, tabRequestsBtn].forEach(btn => {
                    if (!btn) return;
                    btn.classList.remove(...activeButtonClasses);
                    btn.classList.add(...inactiveButtonClasses);
                });

                // 3. Mostrar la sección y activar el botón correspondiente
                if (canonical === 'watch') {
                    if (videosSection) videosSection.classList.add('active');
                    if (tabVideosBtn) {
                        tabVideosBtn.classList.remove(...inactiveButtonClasses);
                        tabVideosBtn.classList.add(...activeButtonClasses);
                    }
                    // Solo recargar videos si no viene de una búsqueda
                    if (!skipReload) {
                        try { if (typeof loadVideos === 'function') loadVideos(); } catch (e) {}
                    }
                } else if (canonical === 'upload') {
                    if (uploadSection) uploadSection.classList.add('active');
                    if (tabUploadBtn) {
                        tabUploadBtn.classList.remove(...inactiveButtonClasses);
                        tabUploadBtn.classList.add(...activeButtonClasses);
                    }
                } else if (canonical === 'modify') {
                    if (modifySection) modifySection.classList.add('active');
                    if (tabModifyBtn) {
                        tabModifyBtn.classList.remove(...inactiveButtonClasses);
                        tabModifyBtn.classList.add(...activeButtonClasses);
                    }
                    try { if (typeof loadModifyVideos === 'function') loadModifyVideos(); } catch (e) {}
                } else if (canonical === 'requests') {
                    if (requestsSection) requestsSection.classList.add('active');
                    if (tabRequestsBtn) {
                        tabRequestsBtn.classList.remove(...inactiveButtonClasses);
                        tabRequestsBtn.classList.add(...activeButtonClasses);
                    }
                    try { if (typeof loadRequests === 'function') loadRequests(); } catch (e) {}
                }

                // Guardar la pestaña activa para restauración en recarga
                try { sessionStorage.setItem('activeSection', canonical); } catch (e) {}
            }

            // Event Listeners para las pestañas (ahora actualizan history para manejar back/forward)
            if (tabVideosBtn) tabVideosBtn.addEventListener('click', () => {
                showTab('watch');
                try { history.pushState({ section: 'watch' }, '', ''); } catch (e) {}
            });
            if (tabUploadBtn) tabUploadBtn.addEventListener('click', () => {
                showTab('upload');
                try { history.pushState({ section: 'upload' }, '', ''); } catch (e) {}
            });
            if (tabModifyBtn) tabModifyBtn.addEventListener('click', () => {
                showTab('modify');
                try { history.pushState({ section: 'modify' }, '', ''); } catch (e) {}
            });
            if (tabRequestsBtn) { // El botón puede estar oculto
                tabRequestsBtn.addEventListener('click', () => {
                    showTab('requests');
                    try { history.pushState({ section: 'requests' }, '', ''); } catch (e) {}
                });
            }

            // Mostrar la pestaña de videos por defecto
            // Restaurar la pestaña activa desde sessionStorage (si existe) para que las recargas mantengan la pestaña
            try {
                const saved = sessionStorage.getItem('activeSection');
                const toShow = saved || 'watch';
                showTab(toShow);
            } catch (e) {
                try { showSection('watch', false); } catch (err) {}
            }

            // 4. Lógica para el formulario de subida (envío real a /upload)
            const uploadForm = document.getElementById('upload-form');
            const uploadStatus = document.getElementById('upload-status');

            // File input UI helpers: show selected filename and a "Quitar" button
            let fileInputEl = document.getElementById('video-file');
            // Create container for filename + remove button and insert after the input
            let fileActionsContainer = document.createElement('div');
            fileActionsContainer.id = 'file-actions';
            fileActionsContainer.className = 'mt-2 flex items-center justify-between text-sm text-gray-300';
            if (fileInputEl && fileInputEl.parentNode) {
                fileInputEl.insertAdjacentElement('afterend', fileActionsContainer);
            }

            function createFileInputReplacement(oldInput) {
                const newInput = document.createElement('input');
                newInput.type = 'file';
                newInput.id = oldInput.id;
                newInput.name = oldInput.name;
                newInput.className = oldInput.className;
                // preserve required attribute if it existed
                if (oldInput.required) newInput.required = true;
                return newInput;
            }

            function clearFileInput() {
                try {
                    const old = document.getElementById('video-file');
                    const parent = old.parentNode;
                    const replacement = createFileInputReplacement(old);
                    parent.replaceChild(replacement, old);
                    fileInputEl = replacement;
                    fileInputEl.addEventListener('change', onFileChange);
                    updateFileActions();
                } catch (e) { console.warn('clearFileInput failed', e); }
            }

            function updateFileActions() {
                try {
                    const files = fileInputEl.files;
                    fileActionsContainer.innerHTML = '';
                    if (files && files.length > 0) {
                        const nameSpan = document.createElement('span');
                        nameSpan.textContent = files[0].name;
                        nameSpan.className = 'truncate mr-4';

                        const removeBtn = document.createElement('button');
                        removeBtn.type = 'button';
                        removeBtn.className = 'ml-3 bg-transparent hover:bg-gray-700 text-gray-300 hover:text-white rounded-full w-7 h-7 flex items-center justify-center';
                        removeBtn.setAttribute('aria-label', 'Quitar archivo');
                        removeBtn.innerHTML = '<span style="line-height:1; font-weight:700">✕</span>';
                        removeBtn.addEventListener('click', (e) => { e.preventDefault(); clearFileInput(); });

                        // Mostrar nombre y el pequeño botón 'x' a la derecha
                        const leftContainer = document.createElement('div');
                        leftContainer.className = 'flex items-center w-full';
                        nameSpan.style.flex = '1';
                        nameSpan.style.overflow = 'hidden';
                        nameSpan.style.textOverflow = 'ellipsis';
                        nameSpan.style.whiteSpace = 'nowrap';
                        leftContainer.appendChild(nameSpan);
                        leftContainer.appendChild(removeBtn);

                        fileActionsContainer.appendChild(leftContainer);
                    }
                } catch (e) { console.warn('updateFileActions failed', e); }
            }

            function onFileChange() { updateFileActions(); }
            if (fileInputEl) fileInputEl.addEventListener('change', onFileChange);
            uploadForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const title = document.getElementById('video-title').value.trim();
                const description = document.getElementById('video-description').value.trim();
                const fileInput = document.getElementById('video-file');
                const file = fileInput.files[0];

                if (!title || !file) {
                        showStatus(null, 'Debes proporcionar un título y un archivo.', 'red');
                    return;
                }

                // Construir FormData
                const formData = new FormData();
                formData.append('title', title);
                formData.append('description', description);
                formData.append('video', file);

                // Mostrar estado como toast emergente
                showStatus(null, 'Subiendo...', 'yellow');
                console.log('[debug] upload start', { title, fileName: file ? file.name : null, time: Date.now() });

                try {
                    const token = localStorage.getItem('jwt');

                    console.log('[debug] about to fetch /upload');
                    const res = await fetch('http://localhost:3000/upload', {
                        method: 'POST',
                        headers: {
                            // No establecer Content-Type: el navegador lo hará automáticamente para FormData
                            Authorization: token ? `Bearer ${token}` : ''
                        },
                        body: formData
                    });

                    console.log('[debug] fetch returned', { status: res.status, redirected: res.redirected, url: res.url });
                    const data = await res.json().catch(() => ({}));
                    console.log('[debug] response json', data);

                    if (res.ok) {
                        const successMsg = data.message || 'Video subido correctamente.';
                        console.log('[debug] upload succeeded:', successMsg, data);
                        // Mostrar confirmación emergente en la esquina (no usar el área de upload)
                        showStatus(null, successMsg, 'green');

                        // Mantener al usuario en la pestaña de subida sin añadir entrada al historial
                        showSection('upload', false);
                        try { history.replaceState({ section: 'upload' }, '', ''); } catch (e) {}

                        // Limpiar formulario
                        uploadForm.reset();
                        try { updateFileActions(); } catch (e) {}

                        // Refrescar la lista de videos en segundo plano para que la galería muestre el nuevo video
                        try { if (typeof loadVideos === 'function') loadVideos(); } catch (e) { console.warn('loadVideos fallo al refrescar:', e); }

                        // Opcional: añadir tarjeta al grid (si backend devuelve info)
                        if (data.video) {
                            const videoGrid = document.getElementById('video-list');
                            const card = document.createElement('div');
                            card.className = 'video-card bg-gray-800 rounded-lg shadow-lg overflow-hidden cursor-pointer';
                            card.setAttribute('data-video-id', data.video.id || 'new');
                            card.setAttribute('data-filename', data.video.filename || '');
                            card.setAttribute('data-title', data.video.title || '');
                            card.innerHTML = `\n<img src="https://placehold.co/600x400/1f2937/7dd3fc?text=${encodeURIComponent(data.video.title || 'Nuevo')}" class="w-full h-48 object-cover">\n<div class="p-4">\n<h3 class="font-bold text-lg">${data.video.title || 'Nuevo'}</h3>\n<p class="text-gray-400 text-sm">Subido por ti</p>\n</div>`;
                            videoGrid.prepend(card);
                        }

                    } else {
                        console.log('[debug] upload failed response', { status: res.status, data });
                        showStatus(null, data.error || 'Fallo al subir el video.', 'red');
                    }

                } catch (err) {
                    console.error('Error al subir:', err);
                    showStatus(null, 'Error de conexión al subir el video.', 'red');
                }
            });

            // Listeners para detectar si la página se recarga o se descarga
            window.addEventListener('beforeunload', (e) => {
                console.log('[debug] beforeunload fired', { time: Date.now() });
            });
            window.addEventListener('unload', (e) => {
                console.log('[debug] unload fired', { time: Date.now() });
            });

            // Función auxiliar para mostrar mensajes de estado (mantiene clases de tamaño/centrado)
            // Mostrar mensajes de estado usando toasts (emergentes) en lugar del área fija de upload
            function showStatus(elementIgnored, message, color) {
                try {
                    // map local color keys to toast types
                    const map = { red: 'error', green: 'success', yellow: 'warn', gray: 'info' };
                    const type = map[color] || 'info';
                    showToast(message, type);
                } catch (e) {
                    console.warn('showStatus fallback:', e);
                    showToast(message, 'info');
                }
            }

            // 5. Lógica para ver un video y cargar la lista desde el backend
            // NOTA: Los botones "Reproducir" ahora llaman directamente a playVideo()
            // Este listener de click en las tarjetas ya no es necesario pero lo dejamos como fallback
            const videoGrid = document.getElementById('video-list');
            if (videoGrid) {
                videoGrid.addEventListener('click', async (e) => {
                    const card = e.target.closest('.video-card');
                    if (!card) return;

                    // Si la tarjeta está marcada como pending o no tiene permiso, no permitir abrir el reproductor
                    if (card.getAttribute('data-pending') === '1' || card.getAttribute('data-has-access') !== '1') {
                        return;
                    }

                    // Si el click fue en un botón, dejar que el onclick del botón lo maneje
                    if (e.target.closest('button')) {
                        return;
                    }

                    // Fallback: si clickearon la tarjeta directamente (no el botón)
                    const videoId = card.getAttribute('data-video-id');
                    const filename = card.getAttribute('data-filename');
                    const title = card.getAttribute('data-title') || 'Video';

                    if (videoId && filename) {
                        try {
                            window.playVideo(Number(videoId), title, filename);
                        } catch (err) {
                            console.warn('playVideo fallback failed', err);
                        }
                    }
                });
            }            // Helpers para solicitudes pendientes en localStorage
            function getPendingRequests() {
                try {
                    const key = getUserPendingKey();
                    const raw = localStorage.getItem(key);
                    if (!raw) return [];
                    return JSON.parse(raw || '[]') || [];
                } catch (e) { return []; }
            }

            function setPendingRequests(list) {
                try {
                    const key = getUserPendingKey();
                    localStorage.setItem(key, JSON.stringify(list || []));
                } catch (e) { console.warn('setPendingRequests error', e); }
            }

            function addPendingRequest(id) {
                try {
                    const list = getPendingRequests();
                    if (!list.includes(id)) {
                        list.push(id);
                        setPendingRequests(list);
                    }
                } catch (e) { console.warn('addPendingRequest error', e); }
            }

            function removePendingRequest(id) {
                try {
                    const list = getPendingRequests();
                    const filtered = list.filter(x => x != id);
                    setPendingRequests(filtered);
                } catch (e) { console.warn('removePendingRequest error', e); }
            }

            // Sincronizar las solicitudes pendientes desde el backend al cargar la app
            async function syncPendingRequestsFromServer() {
                try {
                    const token = localStorage.getItem('jwt');
                    if (!token) return;
                    const res = await fetch('http://localhost:3000/requests/mine', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (!res.ok) return; // no forzamos nada si falla
                    const json = await res.json();
                    // json es un array de objetos { id, video_id, created_at }
                    const videoIds = Array.isArray(json) ? json.map(r => r.video_id) : [];
                    // Store pending requests under the current user's key
                    setPendingRequests(videoIds);
                } catch (err) {
                    console.warn('syncPendingRequestsFromServer failed', err);
                }
            }

            // Función para mostrar toasts en la esquina superior derecha
            function showToast(message, type = 'info') {
                try {
                    let container = document.getElementById('toast-container');
                    if (!container) {
                        container = document.createElement('div');
                        container.id = 'toast-container';
                        container.style.position = 'fixed';
                        container.style.top = '16px';
                        container.style.right = '16px';
                        container.style.zIndex = 9999;
                        container.style.display = 'flex';
                        container.style.flexDirection = 'column';
                        container.style.gap = '8px';
                        document.body.appendChild(container);
                    }

                    const toast = document.createElement('div');
                    toast.className = 'app-toast';
                    toast.style.minWidth = '220px';
                    toast.style.maxWidth = '360px';
                    toast.style.padding = '10px 14px';
                    toast.style.borderRadius = '8px';
                    toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.4)';
                    toast.style.color = '#fff';
                    toast.style.fontWeight = '600';
                    toast.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
                    toast.style.opacity = '1';

                    // Usar paleta del proyecto: azul -> morado para success, ámbar para warn, rojo para error
                    // Tonos más suaves / menos saturados
                    if (type === 'success') {
                        // Degradado de éxito menos brillante: tonos oscuros y sobrios
                        toast.style.background = 'linear-gradient(90deg, #0f172a 0%, #4338ca 100%)';
                        toast.style.color = '#f8fafc';
                    } else if (type === 'error') {
                        // Error: usar tono más oscuro y sobrio para combinar con el tema oscuro
                        toast.style.background = 'linear-gradient(90deg, #b91c1c 0%, #7f1d1d 100%)'; // red-700 -> red-800
                        toast.style.color = '#ffffff';
                        toast.style.border = '1px solid rgba(255,255,255,0.04)';
                    } else if (type === 'warn' || type === 'warning') {
                        // Advertencia: usar ámbar más cálido pero oscuro para buen contraste en fondo oscuro
                        toast.style.background = 'linear-gradient(90deg, #b45309 0%, #92400e 100%)'; // amber-700 -> amber-800
                        toast.style.color = '#111827';
                        toast.style.border = '1px solid rgba(0,0,0,0.2)';
                    } else {
                        // Mensajes informativos en gris oscuro (encaja con el fondo gris-900)
                        toast.style.background = 'linear-gradient(90deg, #0f172a 0%, #1f2937 100%)'; // slate-900 -> slate-800
                        toast.style.color = '#e6eef8';
                        toast.style.border = '1px solid rgba(255,255,255,0.03)';
                    }

                    // Construir contenido con texto y botón de cierre
                    const msgSpan = document.createElement('span');
                    msgSpan.style.flex = '1';
                    msgSpan.style.marginRight = '12px';
                    msgSpan.textContent = message;

                    const closeBtn = document.createElement('button');
                    closeBtn.innerText = '✕';
                    closeBtn.style.background = 'transparent';
                    closeBtn.style.border = 'none';
                    closeBtn.style.color = 'inherit';
                    closeBtn.style.fontSize = '14px';
                    closeBtn.style.cursor = 'pointer';
                    closeBtn.style.padding = '0';

                    closeBtn.addEventListener('click', () => {
                        try { toast.remove(); } catch (e) {}
                    });

                    toast.style.display = 'flex';
                    toast.style.alignItems = 'center';
                    toast.appendChild(msgSpan);
                    toast.appendChild(closeBtn);
                    container.appendChild(toast);

                    // Mostrar más tiempo (7s) y permitir cierre manual
                    setTimeout(() => {
                        toast.style.opacity = '0';
                        toast.style.transform = 'translateY(-8px)';
                        setTimeout(() => { try { toast.remove(); } catch (e) {} }, 220);
                    }, 7000);
                } catch (err) {
                    console.warn('showToast fallo:', err);
                }
            }

            // Función para solicitar acceso a un video (muestra mensaje en la tarjeta y un toast)
            // =============================================
            // LOGICA PARA GESTIONAR SOLICITUDES (CREADOR) (NUEVO)
            // =============================================
            async function loadRequests() {
                const token = localStorage.getItem('jwt');
                if (!token) return;

                if (requestsListContainer) requestsListContainer.innerHTML = '<p class="text-center text-gray-400">Cargando solicitudes...</p>';

                try {
                    const response = await fetch('http://localhost:3000/requests/managed', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!response.ok) throw new Error('Error al cargar solicitudes.');
                    const requests = await response.json();

                    if (!requestsListContainer) return;
                    requestsListContainer.innerHTML = '';

                    // Asegurar que la pestaña 'Solicitudes' siempre esté visible
                    if (tabRequestsBtn) {
                        tabRequestsBtn.classList.remove('hidden');
                    }

                    // Si no hay solicitudes, mostrar un mensaje dentro de la sección, pero
                    // no ocultar la pestaña (la pestaña debe permanecer permanente)
                    if (requests.length === 0) {
                        if (requestsListContainer) requestsListContainer.innerHTML = '<p class="text-center text-gray-400">No tienes solicitudes pendientes.</p>';
                        // seguir (no hacemos return) para que la pestaña permanezca
                    }

                    // Dibujar cada tarjeta de solicitud
                    requests.forEach(req => {
                        const requestCardHTML = `
                            <div class="bg-gray-800 p-4 rounded-lg shadow-md flex flex-col sm:flex-row items-center justify-between border border-gray-700">
                                <div class="mb-4 sm:mb-0 sm:mr-4">
                                    <p class="text-lg text-white">
                                        El usuario <span class="font-bold text-blue-400">${req.requester_name}</span>
                                        solicita acceso al video:
                                    </p>
                                    <p class="text-xl font-bold text-white mt-1">"${req.video_title}"</p>
                                    <p class="text-sm text-gray-500 mt-2">Fecha: ${new Date(req.created_at).toLocaleDateString()}</p>
                                </div>
                                <div class="flex space-x-3">
                                    <button onclick="handleRequest(${req.request_id}, 'approved')"
                                            class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded transition-colors flex items-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style="display:inline-block;vertical-align:middle;margin-right:6px;">
                                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                                        </svg>
                                        Aprobar
                                    </button>
                                    <button onclick="handleRequest(${req.request_id}, 'rejected')"
                                            class="bg-indigo-400 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded transition-colors flex items-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style="display:inline-block;vertical-align:middle;margin-right:6px;">
                                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 011.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                                        </svg>
                                        Rechazar
                                    </button>
                                </div>
                            </div>
                        `;
                        requestsListContainer.insertAdjacentHTML('beforeend', requestCardHTML);
                    });

                } catch (error) {
                    console.error("Error:", error);
                    if (requestsListContainer) requestsListContainer.innerHTML = `<p class="text-center text-red-400">Error: ${error.message}</p>`;
                }
            }

            // =============================================
            // LOGICA PARA MODIFICAR VIDEOS (NUEVO)
            // =============================================
            async function loadModifyVideos() {
                const token = localStorage.getItem('jwt');
                if (!token) return;

                if (modifyVideosListContainer) modifyVideosListContainer.innerHTML = '<p class="text-center text-gray-400 col-span-full">Cargando tus videos...</p>';

                try {
                    const response = await fetch('http://localhost:3000/videos', {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!response.ok) throw new Error('Error al cargar videos.');
                    const json = await response.json();
                    const videosList = Array.isArray(json) ? json : (json.videos || []);

                    // Filtrar solo los videos del usuario actual
                    const currentUsername = localStorage.getItem('username') || null;
                    const myVideos = videosList.filter(video => video.uploader === currentUsername);

                    if (!modifyVideosListContainer) return;
                    modifyVideosListContainer.innerHTML = '';

                    if (myVideos.length === 0) {
                        modifyVideosListContainer.innerHTML = '<p class="text-center text-gray-400 col-span-full">No tienes videos para modificar.</p>';
                        return;
                    }

                    // Dibujar cada tarjeta de video con opciones de edición
                    myVideos.forEach(video => {
                        const videoCard = document.createElement('div');
                        videoCard.className = 'bg-gray-800 rounded-lg shadow-lg overflow-hidden';
                        
                        // Crear imagen de thumbnail
                        const token = localStorage.getItem('jwt');
                        const thumbnailUrl = `http://localhost:3000/thumbnail/${video.id}?token=${encodeURIComponent(token)}`;
                        const placeholderUrl = `https://placehold.co/600x400/1f2937/7dd3fc?text=${encodeURIComponent(video.title)}`;
                        
                        // Escapar el título y descripción para evitar problemas con comillas
                        const safeTitle = (video.title || '').replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
                        const safeDescription = (video.description || '').replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
                        
                        videoCard.innerHTML = `
                            <img src="${thumbnailUrl}" 
                                 onerror="this.src='${placeholderUrl}'"
                                 class="w-full h-48 object-cover" alt="${video.title}">
                            <div class="p-4">
                                <h3 class="font-bold text-lg text-white mb-2">${video.title}</h3>
                                <p class="text-gray-400 text-sm mb-4">${video.description || 'Sin descripción'}</p>
                                <div class="grid grid-cols-2 gap-2 mb-2">
                                    <button onclick="editVideo(${video.id}, '${safeTitle}', '${safeDescription}')" 
                                            class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition">
                                        Editar
                                    </button>
                                    <button onclick="deleteVideo(${video.id}, '${safeTitle}')" 
                                            class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded transition">
                                        Eliminar
                                    </button>
                                </div>
                                <button onclick="manageViewers(${video.id}, '${safeTitle}')" 
                                        class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition">
                                    Espectadores
                                </button>
                            </div>
                        `;
                        modifyVideosListContainer.appendChild(videoCard);
                    });

                } catch (error) {
                    console.error("Error:", error);
                    if (modifyVideosListContainer) modifyVideosListContainer.innerHTML = `<p class="text-center text-red-400 col-span-full">Error: ${error.message}</p>`;
                }
            }

            // Función global para editar video
            window.editVideo = async (videoId, currentTitle, currentDescription) => {
                // Crear modal para editar
                const overlay = document.createElement('div');
                overlay.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
                overlay.innerHTML = `
                    <div class="bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4">
                        <h3 class="text-2xl font-bold text-white mb-4">Editar Video</h3>
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-300 mb-2">Título</label>
                            <input type="text" id="edit-title" value="${currentTitle}" 
                                   class="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg">
                        </div>
                        <div class="mb-4">
                            <label class="block text-sm font-medium text-gray-300 mb-2">Descripción</label>
                            <textarea id="edit-description" rows="4" 
                                      class="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg">${currentDescription}</textarea>
                        </div>
                        <div class="flex gap-3">
                            <button id="save-edit" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition">
                                Guardar
                            </button>
                            <button id="cancel-edit" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition">
                                Cancelar
                            </button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);

                // Event listeners para el modal
                document.getElementById('cancel-edit').addEventListener('click', () => overlay.remove());
                document.getElementById('save-edit').addEventListener('click', async () => {
                    const newTitle = document.getElementById('edit-title').value.trim();
                    const newDescription = document.getElementById('edit-description').value.trim();
                    
                    if (!newTitle) {
                        showToast('El título no puede estar vacío', 'error');
                        return;
                    }

                    try {
                        const token = localStorage.getItem('jwt');
                        const response = await fetch(`http://localhost:3000/videos/${videoId}`, {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ title: newTitle, description: newDescription })
                        });

                        if (!response.ok) {
                            const data = await response.json().catch(() => ({}));
                            throw new Error(data.error || 'Error al actualizar el video');
                        }

                        showToast('Video actualizado exitosamente', 'success');
                        overlay.remove();
                        loadModifyVideos(); // Recargar la lista
                    } catch (error) {
                        showToast(`Error: ${error.message}`, 'error');
                    }
                });
            };

            // Función global para eliminar video
            window.deleteVideo = async (videoId, videoTitle) => {
                const confirmed = await showConfirm(`¿Estás seguro de que quieres eliminar el video "${videoTitle}"? Esta acción no se puede deshacer.`, {
                    acceptText: 'Eliminar',
                    cancelText: 'Cancelar'
                });

                if (!confirmed) return;

                try {
                    const token = localStorage.getItem('jwt');
                    const response = await fetch(`http://localhost:3000/videos/${videoId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Error al eliminar el video');
                    }

                    showToast('Video eliminado exitosamente', 'success');
                    loadModifyVideos(); // Recargar la lista
                    loadVideos(); // También recargar la lista principal
                } catch (error) {
                    showToast(`Error: ${error.message}`, 'error');
                }
            };

            // Función global para gestionar espectadores de un video
            window.manageViewers = async (videoId, videoTitle) => {
                try {
                    const token = localStorage.getItem('jwt');
                    
                    // Obtener lista de espectadores (usuarios con permiso)
                    const response = await fetch(`http://localhost:3000/videos/${videoId}/viewers`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!response.ok) {
                        throw new Error('Error al cargar espectadores');
                    }

                    const viewers = await response.json();

                    // Crear modal con lista de espectadores
                    const overlay = document.createElement('div');
                    overlay.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
                    
                    // Escapar el título para uso seguro en HTML y JavaScript
                    const safeTitleForHTML = videoTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    const safeTitleForJS = videoTitle.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"');
                    
                    const viewersList = viewers.length > 0 
                        ? viewers.map(viewer => {
                            const safeUsername = viewer.username.replace(/'/g, "\\\\'").replace(/"/g, '\\\\"');
                            return `
                            <div class="flex items-center justify-between p-3 bg-gray-700 rounded-lg mb-2">
                                <div class="flex items-center">
                                    <div class="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center mr-3">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    </div>
                                    <span class="text-white font-semibold">${viewer.username}</span>
                                </div>
                                <button onclick="removeViewer(${videoId}, ${viewer.user_id}, '${safeUsername}', '${safeTitleForJS}')" 
                                        class="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded transition text-sm">
                                    Quitar
                                </button>
                            </div>
                        `;}).join('')
                        : '<p class="text-gray-400 text-center py-4">No hay espectadores para este video</p>';

                    overlay.innerHTML = `
                        <div class="bg-gray-800 rounded-lg p-6 max-w-lg w-full mx-4 max-h-96 overflow-y-auto">
                            <h3 class="text-2xl font-bold text-white mb-4">Espectadores de "${safeTitleForHTML}"</h3>
                            <div class="mb-4">
                                ${viewersList}
                            </div>
                            <button id="close-viewers" class="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition">
                                Cerrar
                            </button>
                        </div>
                    `;
                    document.body.appendChild(overlay);

                    document.getElementById('close-viewers').addEventListener('click', () => overlay.remove());

                } catch (error) {
                    console.error('Error en manageViewers:', error);
                    showToast(`Error: ${error.message}`, 'error');
                }
            };

            // Función global para quitar un espectador
            window.removeViewer = async (videoId, userId, username, videoTitle) => {
                const confirmed = await showConfirm(`¿Quitar acceso a ${username}?`, {
                    acceptText: 'Quitar',
                    cancelText: 'Cancelar'
                });

                if (!confirmed) return;

                try {
                    const token = localStorage.getItem('jwt');
                    const response = await fetch(`http://localhost:3000/videos/${videoId}/viewers/${userId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || 'Error al quitar espectador');
                    }

                    showToast(`Acceso eliminado para ${username}`, 'success');
                    
                    // Cerrar el modal actual
                    const overlay = document.querySelector('.fixed.inset-0');
                    if (overlay) overlay.remove();
                    
                    // Reabrir el modal actualizado
                    setTimeout(() => manageViewers(videoId, videoTitle), 300);

                } catch (error) {
                    showToast(`Error: ${error.message}`, 'error');
                }
            };

            // Llamar a loadRequests al iniciar para ver si hay que mostrar la pestaña
            if (localStorage.getItem('jwt')) {
                try { loadRequests(); } catch (e) {}
            }
            
            // =============================================
            // SISTEMA DE NOTIFICACIONES CON CAMPANITA
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
            
            // Función global para ir a la pestaña de solicitudes
            window.goToRequestsTab = function() {
                console.log('[goToRequestsTab] Ejecutando, dropdown actual:', window.notificationDropdown);
                if (window.notificationDropdown && window.notificationDropdown.parentElement) {
                    console.log('[goToRequestsTab] Removiendo dropdown');
                    window.notificationDropdown.remove();
                    window.notificationDropdown = null;
                }
                const tabRequestsBtn = document.getElementById('nav-requests');
                if (tabRequestsBtn) {
                    tabRequestsBtn.click();
                }
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

            // Confirm modal (in-page) that returns a Promise<boolean>
            function showConfirm(message, { acceptText = 'Aceptar', cancelText = 'Cancelar' } = {}) {
                return new Promise((resolve) => {
                    try {
                        // Overlay
                        const overlay = document.createElement('div');
                        overlay.style.position = 'fixed';
                        overlay.style.left = 0;
                        overlay.style.top = 0;
                        overlay.style.right = 0;
                        overlay.style.bottom = 0;
                        overlay.style.background = 'rgba(2,6,23,0.6)';
                        overlay.style.zIndex = 10000;
                        overlay.style.display = 'flex';
                        overlay.style.alignItems = 'center';
                        overlay.style.justifyContent = 'center';

                        // Dialog
                        const dlg = document.createElement('div');
                        dlg.style.background = '#0f172a';
                        dlg.style.color = '#e6eef8';
                        dlg.style.padding = '18px';
                        dlg.style.borderRadius = '12px';
                        dlg.style.boxShadow = '0 10px 30px rgba(2,6,23,0.7)';
                        dlg.style.maxWidth = '520px';
                        dlg.style.width = '92%';
                        dlg.style.fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

                        const title = document.createElement('div');
                        title.style.fontSize = '16px';
                        title.style.marginBottom = '8px';
                        title.textContent = message;

                        const actions = document.createElement('div');
                        actions.style.display = 'flex';
                        actions.style.justifyContent = 'flex-end';
                        actions.style.gap = '10px';
                        actions.style.marginTop = '14px';

                        const btnCancel = document.createElement('button');
                        btnCancel.textContent = cancelText;
                        btnCancel.style.background = 'transparent';
                        btnCancel.style.color = '#cbd5e1';
                        btnCancel.style.border = '1px solid rgba(255,255,255,0.06)';
                        btnCancel.style.padding = '8px 12px';
                        btnCancel.style.borderRadius = '8px';
                        btnCancel.style.cursor = 'pointer';

                        const btnAccept = document.createElement('button');
                        btnAccept.textContent = acceptText;
                        btnAccept.style.background = '#7c3aed';
                        btnAccept.style.color = '#fff';
                        btnAccept.style.border = 'none';
                        btnAccept.style.padding = '8px 12px';
                        btnAccept.style.borderRadius = '8px';
                        btnAccept.style.cursor = 'pointer';

                        actions.appendChild(btnCancel);
                        actions.appendChild(btnAccept);

                        dlg.appendChild(title);
                        dlg.appendChild(actions);
                        overlay.appendChild(dlg);
                        document.body.appendChild(overlay);

                        const cleanup = () => { try { overlay.remove(); } catch (e) {}; };

                        btnCancel.addEventListener('click', () => { cleanup(); resolve(false); });
                        btnAccept.addEventListener('click', () => { cleanup(); resolve(true); });

                        // close on Esc
                        const onKey = (ev) => {
                            if (ev.key === 'Escape') { cleanup(); resolve(false); document.removeEventListener('keydown', onKey); }
                        };
                        document.addEventListener('keydown', onKey);
                    } catch (e) { resolve(false); }
                });
            }

            // Función global para aprobar o rechazar solicitudes (usa modal en-page)
            window.handleRequest = async (requestId, action) => {
                const token = localStorage.getItem('jwt');
                if (!token) return;

                const actionText = action === 'approved' ? 'aprobar' : 'rechazar';
                const ok = await showConfirm(`¿Estás seguro de que quieres ${actionText} esta solicitud?`, { acceptText: 'Aceptar', cancelText: 'Cancelar' });
                if (!ok) return;

                try {
                    const response = await fetch(`http://localhost:3000/requests/${requestId}`, {
                        method: 'PUT',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ status: action })
                    });

                    if (!response.ok) {
                        const data = await response.json().catch(() => ({}));
                        throw new Error(data.error || `Error al ${actionText} la solicitud.`);
                    }

                    // Recargar la lista de solicitudes para que desaparezca la que acabamos de gestionar
                    try { loadRequests(); } catch (e) {}
                    
                    // Actualizar el badge de notificaciones
                    try { if (typeof updateNotificationBadge === 'function') updateNotificationBadge(); } catch (e) {}

                } catch (error) {
                    // Mostrar error en un toast en vez de alert
                    showToast(`Error: ${error.message}`, 'error');
                }
            };

            // Función para solicitar acceso a un video (muestra mensaje en la tarjeta y un toast)
            window.requestAccess = async (videoId, videoTitle, uploader) => {
                const token = localStorage.getItem('jwt');
                if (!token) return;

                // Localizar la tarjeta y el botón de ese video
                const card = document.querySelector(`.video-card[data-video-id="${videoId}"]`);
                const actionButton = card ? card.querySelector('button') : null;

                // Mostrar feedback inmediato en el botón
                if (actionButton) {
                    actionButton.disabled = true;
                    actionButton.classList.add('opacity-70', 'cursor-not-allowed');
                    actionButton.textContent = 'Enviando...';
                }

                try {
                    const response = await fetch('http://localhost:3000/requests', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ video_id: videoId })
                    });

                    const data = await response.json().catch(() => ({}));

                    if (response.ok) {
                        // Guardar en pendingRequests para que loadVideos muestre badge persistentemente
                        try { addPendingRequest(videoId); } catch (e) { console.warn('no pudo guardar pending request', e); }

                        // Reemplazar el botón por un badge gris no clickable (inmediato)
                        if (actionButton && actionButton.parentElement) {
                            const badge = document.createElement('div');
                            badge.className = 'mt-4 w-full bg-gray-600 text-white font-bold py-2 px-4 rounded text-center cursor-default';
                            badge.textContent = 'Solicitud enviada';
                            badge.onclick = (ev) => ev.stopPropagation();
                            actionButton.replaceWith(badge);
                            try {
                                // marcar tarjeta como pending y ajustar cursor para evitar clicks
                                if (card) {
                                    card.setAttribute('data-pending', '1');
                                    card.classList.remove('cursor-pointer');
                                    card.classList.add('cursor-default');
                                }
                            } catch (e) { console.warn('no se pudo marcar tarjeta como pending', e); }
                        }

                        // Mostrar toast superior con el nombre del uploader
                        const targetName = uploader || 'el autor';
                        showToast(`Solicitud enviada a ${targetName}`, 'success');

                        // Refrescar la lista de videos para actualizar el botón y mostrar el badge
                        try { if (typeof loadVideos === 'function') loadVideos(); } catch (e) { console.warn('loadVideos fallo al refrescar:', e); }

                    } else if (response.status === 409) {
                        // Ya existe una solicitud en el backend: marcar pending y mostrar badge (sin toast)
                        try { addPendingRequest(videoId); } catch (e) { console.warn('no pudo guardar pending request', e); }
                        if (actionButton && actionButton.parentElement) {
                            const badge = document.createElement('div');
                            badge.className = 'mt-4 w-full bg-gray-600 text-white font-bold py-2 px-4 rounded text-center cursor-default';
                            badge.textContent = 'Solicitud enviada';
                            badge.onclick = (ev) => ev.stopPropagation();
                            actionButton.replaceWith(badge);
                            try {
                                if (card) {
                                    card.setAttribute('data-pending', '1');
                                    card.classList.remove('cursor-pointer');
                                    card.classList.add('cursor-default');
                                }
                            } catch (e) { console.warn('no se pudo marcar tarjeta como pending', e); }
                        }
                    } else {
                        throw new Error(data.error || 'Error al solicitar acceso.');
                    }

                } catch (err) {
                    console.error('requestAccess error:', err);
                    if (actionButton) {
                        actionButton.disabled = false;
                        actionButton.classList.remove('opacity-70', 'cursor-not-allowed');
                        actionButton.textContent = 'Solicitar Acceso';
                    }
                    showToast('Error al enviar la solicitud', 'error');
                }
            };

            // =============================================
            // LÓGICA DEL REPRODUCTOR SEGURO (EN PROCESO)
            // =============================================

            // Variable global para guardar la referencia al controlador de abortar fetch
            let currentPlaybackController = null;
            // MediaSource activo para reproducir blobs descifrados
            let activeMediaSource = null;

            // =============================================
            // LÓGICA DEL REPRODUCTOR SEGURO (FINAL)
            // =============================================

            // Controladores globales para poder detener la reproducción
            let activeMediaSourceLocal = null;

            // Función auxiliar para cerrar el reproductor
            window.closeVideo = () => {
                if (secureVideoPlayer) {
                    secureVideoPlayer.pause();
                    // Liberar memoria del MediaSource anterior
                    if (secureVideoPlayer.src) {
                        try { URL.revokeObjectURL(secureVideoPlayer.src); } catch(e) {}
                        secureVideoPlayer.removeAttribute('src');
                    }
                    secureVideoPlayer.load(); // Resetear el player
                }
                if (currentPlaybackController) {
                    try { currentPlaybackController.abort(); } catch(e) {}
                    currentPlaybackController = null;
                }
                if (activeMediaSource && activeMediaSource.readyState === 'open') {
                    try { activeMediaSource.endOfStream(); } catch(e) {}
                }
                if (videoPlayerContainer) videoPlayerContainer.classList.add('hidden');
                console.log("[Reproductor] Cerrado y limpiado.");
            };


            // La función principal que inicia todo el proceso
            // VERSIÓN SIMPLIFICADA: usa el endpoint /play/:videoId del servidor que descifra por ti
            window.playVideo = async (videoId, videoTitle, encryptedFilename) => {
                console.log(`[Reproductor] Abriendo nueva página para: "${videoTitle}"`);
                const token = localStorage.getItem('jwt') || localStorage.getItem('jwtToken');
                if (!token) { alert("Debes iniciar sesión."); return; }

                // Guardar el estado actual del dashboard antes de navegar
                const currentSearchQuery = searchInput ? searchInput.value : null;
                const currentSection = sessionStorage.getItem('activeSection') || 'watch';
                
                // Si hay una búsqueda activa, guardarla en el estado actual antes de navegar
                if (currentSearchQuery && currentSearchQuery.trim() !== '') {
                    try {
                        history.replaceState({ 
                            section: currentSection, 
                            searchQuery: currentSearchQuery 
                        }, '', '');
                    } catch (e) {
                        console.warn('No se pudo guardar el estado de búsqueda:', e);
                    }
                }

                // Guardar detalles del video en localStorage para la nueva página
                localStorage.setItem('currentVideo', JSON.stringify({
                    id: videoId,
                    title: videoTitle,
                    filename: encryptedFilename,
                    token: token
                }));

                // Abrir la nueva página
                window.location.href = 'video.html';
            };

            // Cargar lista de videos desde el backend y poblar el grid
            async function loadVideos() {
                try {
                    const token = localStorage.getItem('jwt');
                    const res = await fetch('http://localhost:3000/videos', {
                        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                    });
                    if (!res.ok) {
                        // Manejo más explícito de errores: si no está autorizado, redirigir al login
                        if (res.status === 401 || res.status === 403) {
                            showStatus(null, 'Sesión inválida. Por favor inicia sesión de nuevo.', 'error');
                            // limpiar token y redirigir al login
                            localStorage.removeItem('jwt');
                            setTimeout(() => { window.location.href = 'login.html'; }, 900);
                            return;
                        }
                        // Otro error del servidor: mostrar mensaje y dejar el grid vacío
                        showStatus(null, 'No se pudo cargar la lista de videos. Intenta de nuevo.', 'error');
                        console.error('Error al obtener /videos:', res.status, res.statusText);
                        return;
                    }
                    const json = await res.json();
                    const grid = document.getElementById('video-list');
                    const noVideosEl = document.getElementById('no-videos');
                    grid.innerHTML = '';
                    if (noVideosEl) noVideosEl.classList.add('hidden');
                    // Obtener el id del usuario logueado desde el JWT para comparar por uploader_id
                    let currentUserId = null;
                    try {
                        const token = localStorage.getItem('jwt');
                        if (token) {
                            const payload = JSON.parse(atob(token.split('.')[1]));
                            currentUserId = payload && payload.id ? payload.id : null;
                        }
                    } catch (err) {
                        currentUserId = null;
                    }

                    const videosList = Array.isArray(json) ? json : (json.videos || []);
                    videosList.forEach(video => {
                        const card = document.createElement('div');
                        card.setAttribute('data-video-id', video.id);
                        card.setAttribute('data-filename', video.filename || '');
                        card.setAttribute('data-title', video.title || '');
                        // decidir si la tarjeta es clickeable
                        const pending = getPendingRequests();
                        let isPending = pending.some(id => id == video.id);
                        const hasAccess = (video.has_access === 1 || video.has_access === '1' || video.has_access === true);
                        // Si el backend indica que ahora tienes acceso, limpiar la solicitud pendiente local
                        if (hasAccess && isPending) {
                            try { removePendingRequest(video.id); } catch (e) { console.warn('could not remove pending request', e); }
                            isPending = false;
                        }
                        const clickable = hasAccess && !isPending;
                        const cursorClass = clickable ? 'cursor-pointer' : 'cursor-default';
                        card.className = `video-card bg-gray-800 rounded-lg shadow-lg overflow-hidden ${cursorClass}`;
                        // exponer si el usuario tiene acceso (para el handler global de click)
                        card.setAttribute('data-has-access', hasAccess ? '1' : '0');

                        // Determinar si el video fue subido por el usuario actual (comparando username)
                        const currentUsername = localStorage.getItem('username') || null;
                        const isMine = currentUsername && video.uploader && currentUsername === video.uploader;
                        const uploaderLabel = isMine ? 'ti' : (video.uploader || 'desconocido');
                        
                        // Agregar el uploader limpio después de definirlo
                        card.setAttribute('data-uploader', uploaderLabel);

                        // URL del thumbnail real con manejo de errores
                        const token = localStorage.getItem('jwt');
                        const videoTitleEncoded = encodeURIComponent(video.title || 'Video');
                        const placeholderUrl = `https://placehold.co/600x400/1f2937/7dd3fc?text=${videoTitleEncoded}`;
                        let thumbnailUrl = placeholderUrl;
                        
                        if (hasAccess && token) {
                            try {
                                thumbnailUrl = `http://localhost:3000/thumbnail/${video.id}?token=${encodeURIComponent(token)}&t=${Date.now()}`;
                            } catch (e) {
                                console.warn('Error generando URL de thumbnail:', e);
                                thumbnailUrl = placeholderUrl;
                            }
                        }

                        // --- NUEVA LÓGICA PARA DECIDIR EL BOTÓN ---
                        let buttonHTML;
                        if (hasAccess) {
                            // CASO A: TIENE PERMISO.
                                const safeTitle = (video.title || '').replace(/'/g, "\\'");
                                const safeFilename = (video.filename || '').replace(/'/g, "\\'");
                                buttonHTML = `
                                        <button class="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none flex items-center justify-center transition-colors duration-300 cursor-pointer"
                                            onclick="playVideo(${video.id}, '${safeTitle}', '${safeFilename}')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                                        </svg>
                                        Reproducir
                                    </button>
                                `;
                        } else {
                            // CASO B: NO TIENE PERMISO. Mostrar botón activo para solicitar acceso
                            const safeTitleReq = (video.title || '').replace(/'/g, "\\'");
                            const safeUploader = (video.uploader || '').replace(/'/g, "\\'");
                            if (isPending) {
                                // Badge gris no clickable (evita abrir reproductor)
                                buttonHTML = `
                                    <div onclick="event.stopPropagation()" class="mt-4 w-full bg-gray-600 text-white font-bold py-2 px-4 rounded text-center cursor-default">Solicitud enviada</div>
                                `;
                            } else {
                                buttonHTML = `
                                        <button class="mt-4 w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded focus:outline-none flex items-center justify-center transition-colors duration-300 cursor-pointer"
                                            onclick="event.stopPropagation(); requestAccess(${video.id}, '${safeTitleReq}', '${safeUploader}')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                            <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
                                        </svg>
                                        Solicitar Acceso
                                    </button>
                                `;
                            }
                        }
                        // -------------------------------------------

                        const videoCardStr = `
                            <img src="${thumbnailUrl}" 
                                 onerror="this.onerror=null; this.src='${placeholderUrl}'"
                                 class="w-full h-48 object-cover" 
                                 alt="${video.title}">
                            <div class="p-4">
                                <h3 class="font-bold text-lg">${video.title}</h3>
                                <p class="text-gray-400 text-sm">${isMine ? 'Subido por ti' : 'Subido por ' + uploaderLabel}</p>
                                ${buttonHTML}
                            </div>`;
                        card.innerHTML = videoCardStr;
                        // Marcar tarjeta como pending si corresponde para evitar clicks que abran el reproductor
                        if (isPending) {
                            card.setAttribute('data-pending', '1');
                            card.classList.remove('cursor-pointer');
                            card.classList.add('cursor-default');
                        } else {
                            card.removeAttribute('data-pending');
                        }

                        // Los botones "Reproducir" ya llaman a playVideo() directamente (via onclick en buttonHTML)
                        // No necesitamos listener adicional en la tarjeta

                        grid.appendChild(card);
                    });
                    
                    // Mostrar mensaje si no hay videos
                    if (videosList.length === 0) {
                        if (noVideosEl) noVideosEl.classList.remove('hidden');
                    } else {
                        if (noVideosEl) noVideosEl.classList.add('hidden');
                    }
                } catch (err) {
                    console.error('Error cargando videos:', err);
                }
            }

            // Restaurar la pestaña activa desde sessionStorage (si existe) y sincronizar solicitudes pendientes
            try {
                const saved = sessionStorage.getItem('activeSection');
                const toShow = saved || 'watch';
                showTab(toShow);
            } catch (e) {
                try { showSection('watch', false); } catch (err) {}
            }

            try {
                // sincronizar desde backend y luego cargar la lista
                syncPendingRequestsFromServer().finally(async () => { 
                    // Verificar si hay búsqueda pendiente (prioridad: history.state > sessionStorage)
                    let savedSearch = null;
                    let fromHistory = false;

                    if (history.state && history.state.searchQuery) {
                        savedSearch = history.state.searchQuery;
                        fromHistory = true;
                        console.log('[Search] Recuperando búsqueda desde history.state:', savedSearch);
                    } else {
                        savedSearch = sessionStorage.getItem('searchQuery');
                        if (savedSearch) {
                            console.log('[Search] Recuperando búsqueda desde sessionStorage:', savedSearch);
                        }
                    }
                    
                    // Si hay búsqueda pendiente, ocultar el grid temporalmente
                    const grid = document.getElementById('video-list');
                    if (savedSearch && grid) {
                        grid.style.visibility = 'hidden';
                    }
                    
                    await loadVideos();
                    
                    // Aplicar búsqueda guardada después de cargar videos
                    if (savedSearch && searchInput) {
                        if (!fromHistory) {
                            sessionStorage.removeItem('searchQuery');
                        }
                        
                        // Aplicar inmediatamente sin setTimeout para evitar parpadeos o condiciones de carrera
                        // Cambiar a la pestaña "Ver Videos" y aplicar búsqueda
                        const watchSection = document.getElementById('watch-section');
                        if (watchSection && !watchSection.classList.contains('active')) {
                            showTab('watch', true); // true = no recargar videos
                            // Solo guardar en historial si vino de sessionStorage (nueva navegación)
                            if (!fromHistory) {
                                try { history.pushState({ section: 'watch', searchQuery: savedSearch }, '', ''); } catch (e) {}
                            }
                        }
                        
                        // Asegurar que el input tenga el valor correcto
                        searchInput.value = savedSearch;
                        performSearch(savedSearch.toLowerCase());
                        
                        // Mostrar el grid después de aplicar el filtro
                        if (grid) {
                            grid.style.visibility = 'visible';
                        }
                    }
                });
            } catch (e) { 
                // Fallback: Verificar si hay búsqueda pendiente (prioridad: history.state > sessionStorage)
                let savedSearch = null;
                let fromHistory = false;

                if (history.state && history.state.searchQuery) {
                    savedSearch = history.state.searchQuery;
                    fromHistory = true;
                } else {
                    savedSearch = sessionStorage.getItem('searchQuery');
                }

                const grid = document.getElementById('video-list');
                
                // Si hay búsqueda pendiente, ocultar el grid temporalmente
                if (savedSearch && grid) {
                    grid.style.visibility = 'hidden';
                }
                
                loadVideos();
                
                // También aplicar búsqueda en caso de error
                if (savedSearch && searchInput) {
                    console.log('[Search] Aplicando búsqueda guardada (fallback):', savedSearch);
                    if (!fromHistory) {
                        sessionStorage.removeItem('searchQuery');
                    }
                    
                    setTimeout(() => {
                        const watchSection = document.getElementById('watch-section');
                        if (watchSection && !watchSection.classList.contains('active')) {
                            showTab('watch', true);
                            if (!fromHistory) {
                                try { history.pushState({ section: 'watch', searchQuery: savedSearch }, '', ''); } catch (e) {}
                            }
                        }
                        performSearch(savedSearch.toLowerCase());
                        
                        // Mostrar el grid después de aplicar el filtro
                        if (grid) {
                            grid.style.visibility = 'visible';
                        }
                    }, 50);
                }
            }

            // Fallback: asegurar que el saludo del usuario permanezca visible
            try {
                setTimeout(() => {
                    const storedUser = localStorage.getItem('username');
                    if (storedUser && usernameSpan && (!usernameSpan.textContent || usernameSpan.textContent.trim() === '')) {
                        usernameSpan.textContent = 'Hola, ' + storedUser;
                    }
                }, 250);
            } catch (e) { /* no crítico */ }

            // Search functionality with suggestions and Enter to search
            const searchInput = document.getElementById('search-input');
            let suggestionsContainer = null;
            let selectedSuggestionIndex = -1; // Para trackear la sugerencia seleccionada
            
            if (searchInput) {
                // Create suggestions dropdown
                suggestionsContainer = document.createElement('div');
                suggestionsContainer.id = 'search-suggestions';
                suggestionsContainer.className = 'absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-lg max-h-80 overflow-y-auto hidden z-50';
                searchInput.parentElement.appendChild(suggestionsContainer);
                searchInput.parentElement.classList.add('relative');
                
                // Show suggestions as user types
                searchInput.addEventListener('input', (e) => {
                    const query = e.target.value.toLowerCase().trim();
                    selectedSuggestionIndex = -1; // Resetear selección
                    
                    if (query === '') {
                        suggestionsContainer.innerHTML = '';
                        suggestionsContainer.classList.add('hidden');
                        return;
                    }
                    
                    const videoCards = document.querySelectorAll('.video-card');
                    const matches = [];
                    
                    videoCards.forEach(card => {
                        const title = card.getAttribute('data-title') || '';
                        const uploader = card.getAttribute('data-uploader') || '';
                        
                        if (title.toLowerCase().includes(query) || uploader.toLowerCase().includes(query)) {
                            matches.push({ title, uploader, card });
                        }
                    });
                    
                    // Show suggestions
                    if (matches.length > 0) {
                        suggestionsContainer.innerHTML = matches.slice(0, 5).map(match => `
                            <div class="px-4 py-2 hover:bg-gray-700 cursor-pointer border-b border-gray-700 last:border-b-0" data-title="${match.title.replace(/"/g, '&quot;')}">
                                <div class="font-semibold text-white">${match.title}</div>
                                <div class="text-sm text-gray-400">${match.uploader}</div>
                            </div>
                        `).join('');
                        suggestionsContainer.classList.remove('hidden');
                        
                        // Add click handlers to suggestions
                        suggestionsContainer.querySelectorAll('[data-title]').forEach(suggestion => {
                            suggestion.addEventListener('click', () => {
                                const title = suggestion.getAttribute('data-title');
                                // Cambiar a la pestaña de Ver Videos si no estamos ahí
                                const watchSection = document.getElementById('watch-section');
                                if (watchSection && !watchSection.classList.contains('active')) {
                                    // Aplicar la búsqueda ANTES de cambiar de pestaña
                                    performSearch(title);
                                    showTab('watch', true); // true = no recargar videos
                                    try { history.pushState({ section: 'watch', searchQuery: title }, '', ''); } catch (e) {}
                                    searchInput.value = ''; // Limpiar después de buscar
                                } else {
                                    performSearch(title);
                                    try { history.replaceState({ section: 'watch', searchQuery: title }, '', ''); } catch (e) {}
                                    searchInput.value = ''; // Limpiar después de buscar
                                }
                                suggestionsContainer.classList.add('hidden');
                            });
                        });
                    } else {
                        suggestionsContainer.innerHTML = '<div class="px-4 py-2 text-gray-400 text-center">No se encontraron resultados</div>';
                        suggestionsContainer.classList.remove('hidden');
                    }
                });
                
                // Filter videos when Enter is pressed
                searchInput.addEventListener('keydown', (e) => {
                    const suggestions = suggestionsContainer.querySelectorAll('[data-title]');
                    
                    // Navegación con flechas
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (suggestions.length > 0) {
                            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, suggestions.length - 1);
                            updateSelectedSuggestion(suggestions);
                        }
                        return;
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (suggestions.length > 0) {
                            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
                            updateSelectedSuggestion(suggestions);
                        }
                        return;
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        
                        // Si hay una sugerencia seleccionada, usarla
                        if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
                            const selectedTitle = suggestions[selectedSuggestionIndex].getAttribute('data-title');
                            const watchSection = document.getElementById('watch-section');
                            if (watchSection && !watchSection.classList.contains('active')) {
                                performSearch(selectedTitle);
                                showTab('watch', true);
                                try { history.pushState({ section: 'watch', searchQuery: selectedTitle }, '', ''); } catch (e) {}
                                searchInput.value = '';
                            } else {
                                performSearch(selectedTitle);
                                try { history.replaceState({ section: 'watch', searchQuery: selectedTitle }, '', ''); } catch (e) {}
                                searchInput.value = '';
                            }
                            suggestionsContainer.classList.add('hidden');
                            selectedSuggestionIndex = -1;
                            return;
                        }
                        
                        // Si no, buscar lo que está escrito
                        const query = searchInput.value.toLowerCase().trim();
                        // Cambiar a la pestaña de Ver Videos si no estamos ahí
                        const watchSection = document.getElementById('watch-section');
                        if (watchSection && !watchSection.classList.contains('active')) {
                            // Aplicar la búsqueda ANTES de cambiar de pestaña
                            performSearch(query);
                            showTab('watch', true); // true = no recargar videos
                            try { history.pushState({ section: 'watch', searchQuery: query }, '', ''); } catch (e) {}
                            searchInput.value = ''; // Limpiar el campo de búsqueda
                        } else {
                            performSearch(query);
                            try { history.replaceState({ section: 'watch', searchQuery: query }, '', ''); } catch (e) {}
                            searchInput.value = ''; // Limpiar el campo de búsqueda
                        }
                        suggestionsContainer.classList.add('hidden');
                    }
                });
                
                // Hide suggestions when clicking outside
                document.addEventListener('click', (e) => {
                    if (!searchInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
                        suggestionsContainer.classList.add('hidden');
                    }
                });
                
                // Función helper para resaltar la sugerencia seleccionada
                function updateSelectedSuggestion(suggestions) {
                    suggestions.forEach((suggestion, index) => {
                        if (index === selectedSuggestionIndex) {
                            suggestion.classList.add('bg-gray-700');
                            suggestion.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        } else {
                            suggestion.classList.remove('bg-gray-700');
                        }
                    });
                }
            }
            
            // Function to perform the actual search filtering
            function performSearch(query) {
                if (!query) {
                    // Show all videos if query is empty
                    document.querySelectorAll('.video-card').forEach(card => {
                        card.style.display = '';
                    });
                    return;
                }
                
                const videoCards = document.querySelectorAll('.video-card');
                let hasResults = false;
                
                videoCards.forEach(card => {
                    const title = (card.getAttribute('data-title') || '').toLowerCase();
                    const uploader = (card.getAttribute('data-uploader') || '').toLowerCase();
                    
                    if (title.includes(query) || uploader.includes(query)) {
                        card.style.display = '';
                        hasResults = true;
                    } else {
                        card.style.display = 'none';
                    }
                });
                
                // Mostrar mensaje si no hay resultados
                const noVideosEl = document.getElementById('no-videos');
                if (noVideosEl) {
                    if (!hasResults) {
                        noVideosEl.textContent = 'No se encontraron videos que coincidan con tu búsqueda.';
                        noVideosEl.classList.remove('hidden');
                    } else {
                        noVideosEl.classList.add('hidden');
                    }
                }
            }

            // Robust fallback: observe changes to the user-display element or its parent
            try {
                const ensureUserDisplay = () => {
                    const stored = localStorage.getItem('username');
                    const el = document.getElementById('user-display');
                    const fixed = document.getElementById('user-greeting-fixed');

                    // Helper to test whether element is visible
                    const isVisible = (node) => {
                        if (!node) return false;
                        try {
                            const cs = window.getComputedStyle(node);
                            return cs && cs.display !== 'none' && cs.visibility !== 'hidden' && node.offsetParent !== null;
                        } catch (e) { return true; }
                    };

                    const elHasText = el && el.textContent && el.textContent.trim() !== '';
                    const elVisible = isVisible(el);

                    // If original element exists and is visible with text, prefer it and hide the fixed fallback
                    if (el && elHasText && elVisible) {
                        if (fixed) fixed.classList.add('hidden');
                        return;
                    }

                    // Otherwise try to populate the original element (if present)
                    if (el && stored) {
                        el.textContent = 'Hola, ' + stored;
                        // if after writing it's visible, hide fallback
                        if (isVisible(el)) {
                            if (fixed) fixed.classList.add('hidden');
                            return;
                        }
                    }

                    // Fallback: show the fixed greeting element only when original is missing/hidden
                    if (fixed && stored) {
                        fixed.textContent = 'Hola, ' + stored;
                        fixed.classList.remove('hidden');
                    }
                };

                // initial ensure
                ensureUserDisplay();

                // Observe the element itself for text/child changes
                const attachObserverToEl = (el) => {
                    try {
                        const mo = new MutationObserver(() => {
                            ensureUserDisplay();
                        });
                        mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
                        return mo;
                    } catch (e) { return null; }
                };

                let currentEl = document.getElementById('user-display');
                let observer = null;
                if (currentEl) observer = attachObserverToEl(currentEl);

                // Also observe the parent in case the node is replaced entirely
                const parent = currentEl ? currentEl.parentNode : document.querySelector('nav .container') || document.body;
                if (parent) {
                    const parentMo = new MutationObserver((mutations) => {
                        for (const m of mutations) {
                            if (m.type === 'childList') {
                                // re-acquire the element if replaced
                                const el = document.getElementById('user-display');
                                if (el && el !== currentEl) {
                                    currentEl = el;
                                    ensureUserDisplay();
                                    if (observer) try { observer.disconnect(); } catch (e) {}
                                    observer = attachObserverToEl(currentEl);
                                }
                            }
                        }
                    });
                    parentMo.observe(parent, { childList: true, subtree: false });
                }
            } catch (e) { /* no crítico */ }
        }
    }); // Fin de DOMContentLoaded
} // Fin de startApp()

// Intentar inicializar esperándo a libsodium; si no existe, arrancar de todos modos.
if (typeof sodium !== 'undefined' && sodium && sodium.ready && typeof sodium.ready.then === 'function') {
    sodium.ready.then(() => {
        console.log("[Libsodium] Librería criptográfica cargada e inicializada en el navegador.");
        startApp();
    }).catch((err) => {
        console.warn('[Libsodium] sodium.ready falló:', err);
        startApp();
    });
} else {
    console.warn('[Libsodium] libsodium no disponible; arrancando app sin esperar WASM.');
    startApp();
}