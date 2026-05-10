import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9/+esm';

// КОНФИГУРАЦИЯ
const SUPABASE_URL = 'https://nkgcsipcxwxhkyyvddet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.warn('Предупреждение: Supabase не настроен. Замените URL и KEY в main.js');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Состояние приложения
const state = {
    username: '',
    roomId: null,
    peerId: uuidv4(),
    localStream: null,
    peers: new Map(),
    isTyping: false,
    typingTimeout: null,
    presenceInterval: null,
    mediaDevices: {
        hasVideo: false,
        hasAudio: false,
        videoEnabled: false,
        audioEnabled: false
    },
    connectionErrors: 0
};

// DOM Элементы
const elements = {
    loginModal: document.getElementById('login-modal'),
    joinBtn: document.getElementById('join-btn'),
    leaveBtn: document.getElementById('leave-btn'),
    usernameInput: document.getElementById('username'),
    roomIdInput: document.getElementById('room-id'),
    videoGrid: document.getElementById('video-grid'),
    messages: document.getElementById('messages'),
    messageInput: document.getElementById('message-input'),
    sendBtn: document.getElementById('send-btn'),
    statusText: document.getElementById('connection-status'),
    roomDisplay: document.getElementById('room-display'),
    participantsCount: document.getElementById('participants-count'),
    participantsNumber: document.querySelector('#participants-count span'),
    typingIndicator: document.getElementById('typing-indicator'),
    toggleChat: document.getElementById('toggle-chat'),
    chatPanel: document.getElementById('chat-panel'),
    closeChat: document.getElementById('close-chat'),
    
    // Новые элементы для настроек
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    videoToggle: document.getElementById('video-toggle'),
    audioToggle: document.getElementById('audio-toggle'),
    videoLabel: document.getElementById('video-label'),
    audioLabel: document.getElementById('audio-label')
};

// Инициализация
async function init() {
    setupEventListeners();
    await checkMediaDevices();
    
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        elements.roomIdInput.value = roomParam;
    }
}

// Проверка доступности устройств (без запроса прав!)
async function checkMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        const videoInputs = devices.filter(d => d.kind === 'videoinput');
        const audioInputs = devices.filter(d => d.kind === 'audioinput');

        state.mediaDevices.hasVideo = videoInputs.length > 0;
        state.mediaDevices.hasAudio = audioInputs.length > 0;

        updateSettingsUI();
    } catch (err) {
        console.warn('Не удалось перечислить устройства:', err);
        state.mediaDevices.hasVideo = false;
        state.mediaDevices.hasAudio = false;
        updateSettingsUI();
    }
}

function updateSettingsUI() {
    // Обновление состояния переключателей
    elements.videoToggle.checked = state.mediaDevices.videoEnabled;
    elements.audioToggle.checked = state.mediaDevices.audioEnabled;

    // Блокировка, если устройства нет
    elements.videoToggle.disabled = !state.mediaDevices.hasVideo;
    elements.audioToggle.disabled = !state.mediaDevices.hasAudio;

    // Текст подсказки
    elements.videoLabel.textContent = state.mediaDevices.hasVideo 
        ? (state.mediaDevices.videoEnabled ? "Камера включена" : "Камера выключена") 
        : "Камера не найдена";
        
    elements.audioLabel.textContent = state.mediaDevices.hasAudio 
        ? (state.mediaDevices.audioEnabled ? "Микрофон включен" : "Микрофон выключен") 
        : "Микрофон не найден";
}

async function handleMediaToggle(type) {
    const isEnabled = type === 'video' ? elements.videoToggle.checked : elements.audioToggle.checked;
    const hasDevice = type === 'video' ? state.mediaDevices.hasVideo : state.mediaDevices.hasAudio;

    if (!hasDevice) return;

    if (isEnabled) {
        // Включение
        try {
            const constraints = {
                video: type === 'video' ? true : false,
                audio: type === 'audio' ? true : false
            };
            
            // Если уже есть стрим, добавляем трек, иначе создаем новый
            if (!state.localStream) {
                state.localStream = await navigator.mediaDevices.getUserMedia({
                    video: type === 'video',
                    audio: type === 'audio'
                });
                addLocalVideo();
            } else {
                const newStream = await navigator.mediaDevices.getUserMedia(constraints);
                const newTrack = newStream.getTracks()[0];
                state.localStream.addTrack(newTrack);
                
                // Обновляем треки в существующих соединениях
                state.localStream.getTracks().forEach(track => {
                    state.peers.forEach(({ conn }) => {
                        const sender = conn.getSenders().find(s => s.track && s.track.kind === track.kind);
                        if (sender) {
                            sender.replaceTrack(track);
                        } else {
                            conn.addTrack(track, state.localStream);
                        }
                    });
                });

                // Перерисовка локального видео если добавилось видео
                if (type === 'video' && !document.getElementById('local-video-container')) {
                    addLocalVideo();
                }
            }
            
            if (type === 'video') state.mediaDevices.videoEnabled = true;
            if (type === 'audio') state.mediaDevices.audioEnabled = true;

        } catch (err) {
            console.error(`Ошибка включения ${type}:`, err);
            // Откат переключателя
            if (type === 'video') {
                elements.videoToggle.checked = false;
                state.mediaDevices.videoEnabled = false;
            } else {
                elements.audioToggle.checked = false;
                state.mediaDevices.audioEnabled = false;
            }
            alert(`Не удалось получить доступ к ${type === 'video' ? 'камере' : 'микрофону'}. Проверьте разрешения браузера.`);
        }
    } else {
        // Выключение
        if (state.localStream) {
            const kind = type === 'video' ? 'video' : 'audio';
            const tracks = state.localStream.getTracks().filter(t => t.kind === kind);
            
            tracks.forEach(track => {
                track.stop();
                state.localStream.removeTrack(track);
                
                // Уведомляем пиры об удалении трека
                state.peers.forEach(({ conn }) => {
                    const sender = conn.getSenders().find(s => s.track && s.track.kind === kind);
                    if (sender) {
                        conn.removeTrack(sender);
                    }
                });
            });

            if (type === 'video') {
                state.mediaDevices.videoEnabled = false;
                const localContainer = document.getElementById('local-video-container');
                if (localContainer) localContainer.remove();
            }
            if (type === 'audio') state.mediaDevices.audioEnabled = false;
        }
    }
    updateSettingsUI();
}

function setupEventListeners() {
    elements.joinBtn.addEventListener('click', handleJoin);
    elements.leaveBtn.addEventListener('click', handleLeave);
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
        handleTyping();
    });
    
    elements.toggleChat.addEventListener('click', () => elements.chatPanel.classList.add('open'));
    elements.closeChat.addEventListener('click', () => elements.chatPanel.classList.remove('open'));

    // Настройки
    elements.settingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.remove('hidden');
        updateSettingsUI(); // Обновить статус при открытии
    });
    elements.closeSettings.addEventListener('click', () => elements.settingsModal.classList.add('hidden'));
    
    elements.videoToggle.addEventListener('change', () => handleMediaToggle('video'));
    elements.audioToggle.addEventListener('change', () => handleMediaToggle('audio'));

    subscribeToChannel();
}

function subscribeToChannel() {
    const channel = supabase.channel('public:signaling');

    channel
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
            if (payload.target !== state.peerId || payload.room !== state.roomId) return;
            await handleOffer(payload);
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
            if (payload.target !== state.peerId) return;
            await handleAnswer(payload);
        })
        .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
            if (payload.target !== state.peerId) return;
            await handleIceCandidate(payload);
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload.room !== state.roomId || payload.sender === state.username) return;
            showTypingIndicator(payload.sender);
        })
        .on('broadcast', { event: 'chat-message' }, ({ payload }) => {
            if (payload.room !== state.roomId) return;
            renderMessage(payload.sender, payload.text, false);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                elements.statusText.textContent = 'Онлайн';
                elements.statusText.style.color = 'var(--success)';
            }
        });
}

async function handleJoin() {
    const username = elements.usernameInput.value.trim();
    let roomId = elements.roomIdInput.value.trim();

    if (!username) return alert('Введите имя');

    state.username = username;
    
    if (!roomId) {
        roomId = uuidv4().split('-')[0];
        const newUrl = window.location.pathname + '?room=' + roomId;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }

    state.roomId = roomId;
    elements.roomDisplay.textContent = `Room: ${roomId}`;
    elements.loginModal.classList.add('hidden');
    
    updateParticipantCount();
    startPresenceLoop();
}

function startPresenceLoop() {
    if (state.presenceInterval) clearInterval(state.presenceInterval);
    
    state.connectionErrors = 0;
    
    // Первый вызов сразу
    sendPresence();

    // Интервал 15 секунд
    state.presenceInterval = setInterval(() => {
        sendPresence();
    }, 15000);
}

async function sendPresence() {
    if (!state.roomId || !state.username) return;

    try {
        const { error } = await supabase.from('presence').upsert(
            {
                peer_id: state.peerId,
                room_id: state.roomId,
                username: state.username,
                updated_at: new Date().toISOString()
            },
            { onConflict: 'peer_id,room_id' }
        );

        if (error) throw error;
        
        // Сброс счетчика ошибок при успехе
        state.connectionErrors = 0;
        
        // Поиск пиров только если успешно обновились
        findPeers();
        
    } catch (error) {
        console.warn('Ошибка обновления статуса (попытка игнорирована):', error.message);
        state.connectionErrors++;
        
        // Если много ошибок подряд - останавливаем цикл, чтобы не спамить
        if (state.connectionErrors > 5) {
            console.error('Слишком много ошибок сети. Остановка обновления статуса.');
            clearInterval(state.presenceInterval);
            elements.statusText.textContent = 'Нет связи';
            elements.statusText.style.color = 'var(--danger)';
        }
    }
}

async function findPeers() {
    const tenSecondsAgo = new Date(Date.now() - 10000).toISOString();
    
    const { data, error } = await supabase
        .from('presence')
        .select('peer_id, username')
        .eq('room_id', state.roomId)
        .neq('peer_id', state.peerId)
        .gt('updated_at', tenSecondsAgo);

    if (error) return;

    data.forEach(peer => {
        if (!state.peers.has(peer.peer_id)) {
            createPeerConnection(peer.peer_id, true);
        }
    });
}

function addLocalVideo() {
    if (document.getElementById('local-video-container')) return;
    if (!state.localStream) return;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'local-video-container';
    
    const video = document.createElement('video');
    video.srcObject = state.localStream;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `${state.username} (Вы)`;

    container.appendChild(video);
    container.appendChild(label);
    elements.videoGrid.appendChild(container);
}

function createPeerConnection(peerId, isInitiator) {
    const config = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    const conn = new RTCPeerConnection(config);
    
    // Добавляем текущие треки
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            conn.addTrack(track, state.localStream);
        });
    }

    conn.ontrack = (event) => {
        addRemoteVideo(peerId, event.streams[0]);
    };

    conn.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({
                type: 'ice-candidate',
                target: peerId,
                candidate: event.candidate,
                room: state.roomId
            });
        }
    };

    conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'connected') {
            updateParticipantCount();
        } else if (conn.connectionState === 'disconnected' || conn.connectionState === 'failed') {
            removePeer(peerId);
        }
    };

    state.peers.set(peerId, { conn });

    if (isInitiator) {
        createOffer(peerId);
    }

    return conn;
}

async function createOffer(peerId) {
    const conn = state.peers.get(peerId).conn;
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);

    setTimeout(async () => {
        sendSignal({
            type: 'offer',
            target: peerId,
            offer: conn.localDescription,
            sender: state.peerId,
            room: state.roomId
        });
    }, 500);
}

async function handleOffer(payload) {
    let peerData = state.peers.get(payload.sender);
    if (!peerData) {
        const conn = createPeerConnection(payload.sender, false);
        peerData = { conn };
        state.peers.set(payload.sender, peerData);
    }

    const conn = peerData.conn;
    await conn.setRemoteDescription(new RTCSessionDescription(payload.offer));
    
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);

    setTimeout(async () => {
        sendSignal({
            type: 'answer',
            target: payload.sender,
            answer: conn.localDescription,
            room: state.roomId
        });
    }, 500);
}

async function handleAnswer(payload) {
    const conn = state.peers.get(payload.sender)?.conn;
    if (conn) {
        await conn.setRemoteDescription(new RTCSessionDescription(payload.answer));
    }
}

async function handleIceCandidate(payload) {
    const conn = state.peers.get(payload.sender)?.conn;
    if (conn) {
        try {
            if (payload.candidate) {
                await conn.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
        } catch (e) {
            console.error('Ошибка кандидата:', e);
        }
    }
}

function addRemoteVideo(peerId, stream) {
    if (document.getElementById(`video-${peerId}`)) return;

    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${peerId}`;

    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = 'Участник';

    container.appendChild(video);
    container.appendChild(label);
    elements.videoGrid.appendChild(container);
    
    updateParticipantCount();
}

function removePeer(peerId) {
    const peerData = state.peers.get(peerId);
    if (peerData) {
        peerData.conn.close();
        state.peers.delete(peerId);
        
        const videoEl = document.getElementById(`video-${peerId}`);
        if (videoEl) videoEl.remove();
        
        updateParticipantCount();
    }
}

function updateParticipantCount() {
    const count = state.peers.size + 1;
    elements.participantsNumber.textContent = count;
    elements.participantsCount.classList.add('active');
}

function sendSignal(data) {
    supabase.channel(`public:signaling`).send({
        type: 'broadcast',
        event: data.type,
        payload: data
    });
}

function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.roomId) return;

    renderMessage(state.username, text, true);
    elements.messageInput.value = '';
    
    supabase.channel(`public:signaling`).send({
        type: 'broadcast',
        event: 'chat-message',
        payload: {
            room: state.roomId,
            sender: state.username,
            text: text,
            timestamp: new Date().toISOString()
        }
    });
}

function renderMessage(user, text, isOwn) {
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    div.innerHTML = `
        <div class="message-meta">
            <span>${user}</span>
            <span>${time}</span>
        </div>
        <div class="message-body">${escapeHtml(text)}</div>
    `;
    
    elements.messages.appendChild(div);
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

function handleTyping() {
    if (!state.roomId) return;

    if (!state.isTyping) {
        state.isTyping = true;
        supabase.channel(`public:signaling`).send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                room: state.roomId,
                sender: state.username
            }
        });
    }

    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => {
        state.isTyping = false;
        elements.typingIndicator.textContent = '';
    }, 2000);
}

function showTypingIndicator(username) {
    elements.typingIndicator.textContent = `${username} печатает...`;
    
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => {
        elements.typingIndicator.textContent = '';
    }, 3000);
}

function handleLeave() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        window.location.reload();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Запуск
init();
