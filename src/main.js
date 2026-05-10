import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9/+esm';

// Конфигурация (Замените на ваши данные из Supabase)
const SUPABASE_URL = 'https://nkgcsipcxwxhkyyvddet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    alert('Пожалуйста, настройте SUPABASE_URL и SUPABASE_KEY в src/main.js');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Состояние приложения
const state = {
    username: '',
    roomId: null,
    peerId: uuidv4(),
    localStream: null,
    peers: new Map(), // peerId -> { conn, video, channel }
    pendingCandidates: new Map(), // peerId -> array of candidates
    isTyping: false,
    typingTimeout: null
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
    closeChat: document.getElementById('close-chat')
};

// Инициализация
async function init() {
    setupEventListeners();
    
    // Проверка параметров URL для входа в комнату
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        elements.roomIdInput.value = roomParam;
    }

    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        addLocalVideo();
    } catch (err) {
        console.error('Ошибка доступа к медиа:', err);
        alert('Не удалось получить доступ к камере/микрофону');
    }
}

function setupEventListeners() {
    elements.joinBtn.addEventListener('click', handleJoin);
    elements.leaveBtn.addEventListener('click', handleLeave);
    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
        handleTyping();
    });
    
    // Мобильный чат
    elements.toggleChat.addEventListener('click', () => {
        elements.chatPanel.classList.add('open');
    });
    elements.closeChat.addEventListener('click', () => {
        elements.chatPanel.classList.remove('open');
    });

    // Подписка на события Supabase
    subscribeToChannel();
}

function subscribeToChannel() {
    // Канал сигнализации
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
        roomId = uuidv4().split('-')[0]; // Короткий ID
        // Обновляем URL без перезагрузки
        const newUrl = window.location.pathname + '?room=' + roomId;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }

    state.roomId = roomId;
    elements.roomDisplay.textContent = `Room: ${roomId}`;
    elements.loginModal.classList.add('hidden');
    
    updateParticipantCount();

    // Отправляем уведомление о присутствии (упрощенно через чат или отдельное событие)
    // В реальном приложении лучше иметь таблицу presence
    broadcastPresence();
}

function broadcastPresence() {
    // Периодическая отправка "я тут" для обнаружения пиров
    setInterval(async () => {
        if (!state.roomId || !state.username) return;
        
        const { error } = await supabase.from('presence').upsert(
            {
                peer_id: state.peerId,
                room_id: state.roomId,
                username: state.username,
                updated_at: new Date().toISOString()
            },
            { 
                onConflict: 'peer_id,room_id' // Указываем, по каким полям проверять уникальность
            }
        );
        
        if (error) console.error('Ошибка обновления presence:', error);
    }, 5000);
    
    // Поиск существующих пиров
    findPeers();
}

async function findPeers() {
    // Запрос к таблице presence для поиска других пользователей в комнате
    const { data, error } = await supabase
        .from('presence')
        .select('peer_id, username')
        .eq('room_id', state.roomId)
        .neq('peer_id', state.peerId)
        .gt('updated_at', new Date(Date.now() - 10000).toISOString()); // Активны последние 10 сек

    if (error) return console.error(error);

    data.forEach(peer => {
        if (!state.peers.has(peer.peer_id)) {
            createPeerConnection(peer.peer_id, true); // Initiator
        }
    });
}

function addLocalVideo() {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'local-video-container';
    
    const video = document.createElement('video');
    video.srcObject = state.localStream;
    video.autoplay = true;
    video.muted = true; // Mute local to prevent feedback
    
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
        // Добавьте TURN серверы для продакшена
    };

    const conn = new RTCPeerConnection(config);
    
    // Добавляем треки
    state.localStream.getTracks().forEach(track => {
        conn.addTrack(track, state.localStream);
    });

    // Обработка входящих треков
    conn.ontrack = (event) => {
        addRemoteVideo(peerId, event.streams[0]);
    };

    // ICE Candidates
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

    // Ждем сбора ICE кандидатов перед отправкой (упрощенно)
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
            console.error('Ошибка добавления кандидата:', e);
            // Буферизация если соединение еще не готово
            if (!state.pendingCandidates.has(payload.sender)) {
                state.pendingCandidates.set(payload.sender, []);
            }
            state.pendingCandidates.get(payload.sender).push(payload.candidate);
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
    const count = state.peers.size + 1; // +1 для себя
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

// Чат и Индикаторы
function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.roomId) return;

    renderMessage(state.username, text, true);
    elements.messageInput.value = '';
    
    // Отправка через Supabase Realtime
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

    // Отправка события только если не отправляли недавно
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

    // Сброс таймера
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
