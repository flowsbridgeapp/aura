import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9/+esm';

// КОНФИГУРАЦИЯ
const SUPABASE_URL = 'https://nkgcsipcxwxhkyyvddet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.warn('Предупреждение: Supabase не настроен.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: {
        params: {
            eventsPerSecond: 10
        }
    }
});

// Состояние
const state = {
    username: '',
    roomId: null,
    peerId: uuidv4(),
    localStream: null,
    peers: new Map(),
    isTyping: false,
    typingTimeout: null,
    mediaDevices: { hasVideo: false, hasAudio: false, videoEnabled: false, audioEnabled: false },
    channelJoined: false // Флаг готовности канала
};

// DOM
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
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    closeSettings: document.getElementById('close-settings'),
    videoToggle: document.getElementById('video-toggle'),
    audioToggle: document.getElementById('audio-toggle'),
    videoLabel: document.getElementById('video-label'),
    audioLabel: document.getElementById('audio-label')
};

let signalingChannel = null;

// Инициализация
async function init() {
    setupEventListeners();
    await checkMediaDevices();
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('room')) {
        elements.roomIdInput.value = urlParams.get('room');
    }
}

async function checkMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.mediaDevices.hasVideo = devices.some(d => d.kind === 'videoinput');
        state.mediaDevices.hasAudio = devices.some(d => d.kind === 'audioinput');
        updateSettingsUI();
    } catch (e) {
        state.mediaDevices.hasVideo = false;
        state.mediaDevices.hasAudio = false;
        updateSettingsUI();
    }
}

function updateSettingsUI() {
    elements.videoToggle.checked = state.mediaDevices.videoEnabled;
    elements.audioToggle.checked = state.mediaDevices.audioEnabled;
    elements.videoToggle.disabled = !state.mediaDevices.hasVideo;
    elements.audioToggle.disabled = !state.mediaDevices.hasAudio;
    
    elements.videoLabel.textContent = state.mediaDevices.hasVideo 
        ? (state.mediaDevices.videoEnabled ? "Камера вкл" : "Камера выкл") 
        : "Камера не найдена";
    elements.audioLabel.textContent = state.mediaDevices.hasAudio 
        ? (state.mediaDevices.audioEnabled ? "Микрфон вкл" : "Микрофон выкл") 
        : "Микрофон не найден";
}

async function handleMediaToggle(type) {
    const isEnabled = type === 'video' ? elements.videoToggle.checked : elements.audioToggle.checked;
    const hasDevice = type === 'video' ? state.mediaDevices.hasVideo : state.mediaDevices.hasAudio;
    if (!hasDevice) return;

    if (isEnabled) {
        try {
            const constraints = { video: type === 'video', audio: type === 'audio' };
            if (!state.localStream) {
                state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                addLocalVideo();
            } else {
                const newStream = await navigator.mediaDevices.getUserMedia(constraints);
                const track = newStream.getTracks()[0];
                state.localStream.addTrack(track);
                // Обновляем пиры
                state.peers.forEach(({ conn }) => {
                    const sender = conn.getSenders().find(s => s.track && s.track.kind === track.kind);
                    if (sender) sender.replaceTrack(track);
                    else conn.addTrack(track, state.localStream);
                });
                if (type === 'video' && !document.getElementById('local-video-container')) addLocalVideo();
            }
            if (type === 'video') state.mediaDevices.videoEnabled = true;
            if (type === 'audio') state.mediaDevices.audioEnabled = true;
        } catch (err) {
            console.error(err);
            if (type === 'video') { elements.videoToggle.checked = false; state.mediaDevices.videoEnabled = false; }
            else { elements.audioToggle.checked = false; state.mediaDevices.audioEnabled = false; }
            alert('Нет доступа к устройству');
        }
    } else {
        if (state.localStream) {
            const kind = type === 'video' ? 'video' : 'audio';
            state.localStream.getTracks().filter(t => t.kind === kind).forEach(track => {
                track.stop();
                state.localStream.removeTrack(track);
                state.peers.forEach(({ conn }) => {
                    const sender = conn.getSenders().find(s => s.track && s.track.kind === kind);
                    if (sender) conn.removeTrack(sender);
                });
            });
            if (type === 'video') {
                state.mediaDevices.videoEnabled = false;
                const el = document.getElementById('local-video-container');
                if (el) el.remove();
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
    elements.messageInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); handleTyping(); });
    
    elements.toggleChat.addEventListener('click', () => elements.chatPanel.classList.add('open'));
    elements.closeChat.addEventListener('click', () => elements.chatPanel.classList.remove('open'));
    elements.settingsBtn.addEventListener('click', () => { elements.settingsModal.classList.remove('hidden'); updateSettingsUI(); });
    elements.closeSettings.addEventListener('click', () => elements.settingsModal.classList.add('hidden'));
    elements.videoToggle.addEventListener('change', () => handleMediaToggle('video'));
    elements.audioToggle.addEventListener('change', () => handleMediaToggle('audio'));
}

async function handleJoin() {
    const username = elements.usernameInput.value.trim();
    if (!username) return alert('Введите имя');
    
    let roomId = elements.roomIdInput.value.trim();
    if (!roomId) {
        roomId = uuidv4().split('-')[0];
        window.history.pushState({}, '', window.location.pathname + '?room=' + roomId);
    }

    state.username = username;
    state.roomId = roomId;
    
    elements.roomDisplay.textContent = `Room: ${roomId}`;
    elements.loginModal.classList.add('hidden');
    elements.statusText.textContent = 'Подключение...';
    
    // Загружаем историю сообщений ПЕРЕД подключением к каналу
    await loadMessageHistory();
    
    // Подключаемся к каналу
    connectToChannel();
}

async function loadMessageHistory() {
    elements.messages.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Загрузка истории...</div>';
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', state.roomId)
        .order('created_at', { ascending: true })
        .limit(50);
    
    if (!error && data) {
        elements.messages.innerHTML = '';
        data.forEach(msg => renderMessage(msg.sender, msg.content, false, msg.created_at));
    } else {
        elements.messages.innerHTML = '';
    }
}

function connectToChannel() {
    if (signalingChannel) {
        supabase.removeChannel(signalingChannel);
    }

    signalingChannel = supabase.channel(`public:signaling-${state.roomId}`);

    signalingChannel
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
            if (payload.target !== state.peerId) return;
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
            if (payload.sender === state.username) return;
            showTypingIndicator(payload.sender);
        })
        .on('broadcast', { event: 'chat-message' }, ({ payload }) => {
            // Игнорируем свои сообщения из канала (они уже добавлены локально)
            if (payload.sender === state.username) return; 
            renderMessage(payload.sender, payload.text, false, payload.timestamp);
        })
        .subscribe(status => {
            if (status === 'SUBSCRIBED') {
                state.channelJoined = true;
                elements.statusText.textContent = 'Онлайн';
                elements.statusText.style.color = 'var(--success)';
                updateParticipantCount(); // Просто обновим счетчик (1 человек)
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                elements.statusText.textContent = 'Ошибка соединения';
                elements.statusText.style.color = 'var(--danger)';
                state.channelJoined = false;
                // Пробуем переподключиться через 5 сек
                setTimeout(connectToChannel, 5000);
            }
        });
}

function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.roomId) return;

    // 1. Отображаем у себя сразу
    renderMessage(state.username, text, true);
    elements.messageInput.value = '';

    // 2. Сохраняем в БД (история)
    supabase.from('messages').insert({
        room_id: state.roomId,
        sender: state.username,
        content: text,
        created_at: new Date().toISOString()
    }).then(({ error }) => {
        if (error) console.error('Ошибка сохранения в БД:', error);
    });

    // 3. Отправляем в Realtime (если канал готов)
    if (state.channelJoined && signalingChannel) {
        signalingChannel.send({
            type: 'broadcast',
            event: 'chat-message',
            payload: {
                room: state.roomId,
                sender: state.username,
                text: text,
                timestamp: new Date().toISOString()
            }
        });
    } else {
        console.warn('Канал не готов, сообщение сохранено в БД, но может не прийти мгновенно');
    }
}

function renderMessage(user, text, isOwn, timestamp) {
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : ''}`;
    
    let timeStr = '';
    if (timestamp) {
        const date = new Date(timestamp);
        timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    div.innerHTML = `
        <div class="message-meta">
            <span>${user}</span>
            <span>${timeStr}</span>
        </div>
        <div class="message-body">${escapeHtml(text)}</div>
    `;
    
    elements.messages.appendChild(div);
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

function handleTyping() {
    if (!state.roomId || !state.channelJoined) return;
    if (state.isTyping) return;

    state.isTyping = true;
    signalingChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { room: state.roomId, sender: state.username }
    });

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

// --- WebRTC Логика (без изменений, кроме удаления presence) ---

function addLocalVideo() {
    if (document.getElementById('local-video-container') || !state.localStream) return;
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
    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const conn = new RTCPeerConnection(config);
    
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => conn.addTrack(track, state.localStream));
    }

    conn.ontrack = (e) => addRemoteVideo(peerId, e.streams[0]);
    
    conn.onicecandidate = (e) => {
        if (e.candidate && state.channelJoined) {
            signalingChannel.send({
                type: 'broadcast',
                event: 'ice-candidate',
                target: peerId,
                candidate: e.candidate,
                room: state.roomId
            });
        }
    };

    conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'connected') updateParticipantCount();
        if (conn.connectionState === 'disconnected' || conn.connectionState === 'failed') removePeer(peerId);
    };

    state.peers.set(peerId, { conn });
    if (isInitiator) createOffer(peerId);
    return conn;
}

async function createOffer(peerId) {
    const conn = state.peers.get(peerId).conn;
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    setTimeout(() => {
        if (state.channelJoined) {
            signalingChannel.send({
                type: 'broadcast',
                event: 'offer',
                target: peerId,
                offer: conn.localDescription,
                sender: state.peerId,
                room: state.roomId
            });
        }
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
    setTimeout(() => {
        if (state.channelJoined) {
            signalingChannel.send({
                type: 'broadcast',
                event: 'answer',
                target: payload.sender,
                answer: conn.localDescription,
                room: state.roomId
            });
        }
    }, 500);
}

async function handleAnswer(payload) {
    const conn = state.peers.get(payload.sender)?.conn;
    if (conn) await conn.setRemoteDescription(new RTCSessionDescription(payload.answer));
}

async function handleIceCandidate(payload) {
    const conn = state.peers.get(payload.sender)?.conn;
    if (conn && payload.candidate) {
        try { await conn.addIceCandidate(new RTCIceCandidate(payload.candidate)); } 
        catch (e) { console.error('ICE error', e); }
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
    const p = state.peers.get(peerId);
    if (p) {
        p.conn.close();
        state.peers.delete(peerId);
        const el = document.getElementById(`video-${peerId}`);
        if (el) el.remove();
        updateParticipantCount();
    }
}

function updateParticipantCount() {
    const count = state.peers.size + 1;
    elements.participantsNumber.textContent = count;
    elements.participantsCount.classList.add('active');
}

function handleLeave() {
    if (confirm('Выйти?')) window.location.reload();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

init();
