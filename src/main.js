import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9/+esm';

// КОНФИГУРАЦИЯ
const SUPABASE_URL = 'https://nkgcsipcxwxhkyyvddet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.error('❌ ОШИБКА: Supabase не настроен!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    signalingChannel: null,
    unreadCount: 0,
    isChatViewActive: true,
    isChannelReady: false,
    channelStatus: 'disconnected',
    messageQueue: [],
    reconnectAttempts: 0,
    lastMessageTime: 0,
    audioContext: null // Для звуков
};

// DOM
const elements = {
    loginModal: document.getElementById('login-modal'),
    settingsModal: document.getElementById('settings-modal'),
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
    settingsBtn: document.getElementById('settings-btn'),
    closeSettings: document.getElementById('close-settings'),
    videoToggle: document.getElementById('video-toggle'),
    audioToggle: document.getElementById('audio-toggle'),
    videoLabel: document.getElementById('video-label'),
    audioLabel: document.getElementById('audio-label'),
    chatBadge: document.getElementById('chat-badge')
};

// --- Инициализация ---
async function init() {
    setupEventListeners();
    await checkMediaDevices();
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('room')) elements.roomIdInput.value = urlParams.get('room');
    
    console.log('🚀 Aura Messenger v3.0 (Secure + UX)');
}

// --- Медиа устройства ---
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
    updateToggleState(elements.videoToggle, state.mediaDevices.videoEnabled, !state.mediaDevices.hasVideo);
    updateToggleState(elements.audioToggle, state.mediaDevices.audioEnabled, !state.mediaDevices.hasAudio);
    elements.videoLabel.textContent = state.mediaDevices.hasVideo ? (state.mediaDevices.videoEnabled ? "Камера включена" : "Камера выключена") : "Камера не найдена";
    elements.audioLabel.textContent = state.mediaDevices.hasAudio ? (state.mediaDevices.audioEnabled ? "Микрофон включен" : "Микрофон выключен") : "Микрофон не найден";
}

function updateToggleState(el, isChecked, isDisabled) {
    el.classList.toggle('checked', isChecked);
    el.classList.toggle('disabled', isDisabled);
}

async function handleMediaToggle(type) {
    const hasDevice = type === 'video' ? state.mediaDevices.hasVideo : state.mediaDevices.hasAudio;
    if (!hasDevice) return;
    
    const newState = !(type === 'video' ? state.mediaDevices.videoEnabled : state.mediaDevices.audioEnabled);
    if (type === 'video') state.mediaDevices.videoEnabled = newState;
    else state.mediaDevices.audioEnabled = newState;
    updateSettingsUI();

    if (newState) {
        try {
            const constraints = { video: type === 'video', audio: type === 'audio' };
            if (!state.localStream) {
                state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                addLocalVideo();
            } else {
                const newStream = await navigator.mediaDevices.getUserMedia(constraints);
                const newTrack = newStream.getTracks()[0];
                state.localStream.addTrack(newTrack);
                state.peers.forEach(({ conn }) => {
                    state.localStream.getTracks().forEach(track => {
                        const sender = conn.getSenders().find(s => s.track && s.track.kind === track.kind);
                        sender ? sender.replaceTrack(track) : conn.addTrack(track, state.localStream);
                    });
                });
                if (type === 'video' && !document.getElementById('local-video-container')) addLocalVideo();
            }
        } catch (err) {
            alert(`Нет доступа к ${type === 'video' ? 'камере' : 'микрофону'}`);
            if (type === 'video') state.mediaDevices.videoEnabled = false;
            else state.mediaDevices.audioEnabled = false;
            updateSettingsUI();
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
                const el = document.getElementById('local-video-container');
                if (el) el.remove();
            }
        }
    }
}

// --- События ---
function setupEventListeners() {
    elements.joinBtn.addEventListener('click', handleJoin);
    elements.leaveBtn.addEventListener('click', handleLeave);
    elements.sendBtn.addEventListener('click', sendMessage);
    
    elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(); handleTyping(); }
        else handleTyping();
    });

    elements.settingsBtn.addEventListener('click', () => { elements.settingsModal.classList.remove('hidden'); updateSettingsUI(); });
    elements.closeSettings.addEventListener('click', () => elements.settingsModal.classList.add('hidden'));
    elements.videoToggle.addEventListener('click', () => handleMediaToggle('video'));
    elements.audioToggle.addEventListener('click', () => handleMediaToggle('audio'));

    document.addEventListener('viewChanged', (e) => {
        state.isChatViewActive = (e.detail.viewId === 'chat-view');
        if (state.isChatViewActive) { state.unreadCount = 0; updateChatBadge(); }
    });

    subscribeToChannel();
}

// --- Канал и Сеть ---
function updateConnectionStatus(status, text) {
    state.channelStatus = status;
    elements.statusText.textContent = text;
    elements.statusText.style.color = status === 'connected' ? 'var(--success)' : (status === 'error' ? 'var(--danger)' : 'var(--text-secondary)');
}

function playNotificationSound() {
    // Простой синтезированный звук "дзинь"
    if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = state.audioContext;
    if (ctx.state === 'suspended') ctx.resume();
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
}

function subscribeToChannel() {
    if (state.signalingChannel) {
        console.log('🧹 Очистка старого канала...');
        supabase.removeChannel(state.signalingChannel);
        state.signalingChannel = null;
    }

    updateConnectionStatus('connecting', 'Подключение...');
    state.signalingChannel = supabase.channel('public:signaling');
    const channel = state.signalingChannel;

    channel.on('presence', { event: 'sync' }, () => {
        const count = Object.keys(channel.presenceState()).length;
        elements.participantsNumber.textContent = count > 0 ? count : 1;
        elements.participantsCount.classList.add('active');
    });

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
            if (payload.room_id !== state.roomId) return;
            if (payload.sender === state.username) return; 
            
            renderMessage(payload.sender, payload.content, false);
            
            // Звук и уведомления
            if (!state.isChatViewActive) {
                state.unreadCount++;
                updateChatBadge();
                playNotificationSound();
            } else {
                // Тихий звук даже в чате для приятного фидбека (опционально, можно убрать)
                // playNotificationSound(); 
            }
        })
        .subscribe(async (status) => {
            console.log('📡 Статус:', status);
            if (status === 'SUBSCRIBED') {
                state.isChannelReady = true;
                state.reconnectAttempts = 0;
                updateConnectionStatus('connected', 'Онлайн');
                if (state.messageQueue.length > 0) {
                    setTimeout(() => {
                        state.messageQueue.forEach(msg => sendRawMessage(msg));
                        state.messageQueue = [];
                    }, 500);
                }
            } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
                state.isChannelReady = false;
                updateConnectionStatus('error', 'Сбой связи');
                handleReconnect();
            }
        });
}

function handleReconnect() {
    if (state.reconnectAttempts >= 5) {
        console.error('❌ Лимит попыток исчерпан');
        updateConnectionStatus('error', 'Нет связи');
        return;
    }
    state.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 15000);
    console.log(`⏳ Переподключение через ${delay}мс`);
    setTimeout(() => { if (state.roomId) subscribeToChannel(); }, delay);
}

function sendRawMessage(payload) {
    if (!state.signalingChannel) return;
    state.signalingChannel.send({ type: 'broadcast', event: 'chat-message', payload }).then(status => {
        if (status !== 'ok') console.warn('⚠️ Статус:', status);
    });
}

function updateChatBadge() {
    if (state.unreadCount > 0) {
        elements.chatBadge.textContent = state.unreadCount > 9 ? '9+' : state.unreadCount;
        elements.chatBadge.classList.add('visible');
    } else {
        elements.chatBadge.classList.remove('visible');
    }
}

// --- Логика чата ---
async function handleJoin() {
    const username = elements.usernameInput.value.trim();
    if (!username) return alert('Введите имя');
    
    let roomId = elements.roomIdInput.value.trim() || uuidv4().split('-')[0];
    state.username = username;
    state.roomId = roomId;
    
    elements.roomDisplay.textContent = `Room: ${roomId}`;
    elements.loginModal.classList.add('hidden');
    
    const newUrl = window.location.pathname + '?room=' + roomId;
    window.history.pushState({ path: newUrl }, '', newUrl);
}

async function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.roomId) return;

    // Защита от спама (не чаще 1 раза в 2 сек одинаковый текст)
    const now = Date.now();
    if (now - state.lastMessageTime < 2000 && text === state.lastMessageText) {
        return; 
    }
    state.lastMessageTime = now;
    state.lastMessageText = text;

    renderMessage(state.username, text, true);
    elements.messageInput.value = '';

    const payload = { room_id: state.roomId, sender: state.username, content: text, created_at: new Date().toISOString() };

    if (state.isChannelReady) sendRawMessage(payload);
    else {
        console.warn('⏳ В очереди');
        state.messageQueue.push(payload);
        if (state.channelStatus !== 'connecting') handleReconnect();
    }

    state.isTyping = false;
    elements.typingIndicator.textContent = '';
    elements.messageInput.focus();
}

function renderMessage(user, text, isOwn) {
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    
    // Копирование по клику
    div.title = "Нажмите, чтобы скопировать";
    div.style.cursor = "pointer";
    div.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
            showToast("Сообщение скопировано");
        });
    });

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
        <div class="message-meta">
            <span>${user}</span>
            <span>${time} ${isOwn ? '✓' : ''}</span>
        </div>
        <div class="message-body">${escapeHtml(text)}</div>
    `;
    elements.messages.appendChild(div);
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

// Всплывающее уведомление
function showToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.8); color: white; padding: 8px 16px;
        border-radius: 20px; font-size: 0.9rem; z-index: 1000;
        animation: slideIn 0.3s ease-out; pointer-events: none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

function handleTyping() {
    if (!state.roomId || !state.isChannelReady || !state.signalingChannel) return;
    if (!state.isTyping) {
        state.isTyping = true;
        state.signalingChannel.send({ type: 'broadcast', event: 'typing', payload: { room: state.roomId, sender: state.username } });
    }
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => { state.isTyping = false; elements.typingIndicator.textContent = ''; }, 2000);
}

function showTypingIndicator(username) {
    elements.typingIndicator.textContent = `${username} печатает...`;
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => { elements.typingIndicator.textContent = ''; }, 3000);
}

function handleLeave() {
    if (confirm('Выйти?')) window.location.reload();
}

// --- Видео (WebRTC) ---
function addLocalVideo() {
    if (document.getElementById('local-video-container') || !state.localStream) return;
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = 'local-video-container';
    const video = document.createElement('video');
    video.srcObject = state.localStream;
    video.autoplay = true; video.muted = true; video.playsInline = true;
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `${state.username} (Вы)`;
    container.append(video, label);
    elements.videoGrid.appendChild(container);
}

function createPeerConnection(peerId, isInitiator) {
    const conn = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (state.localStream) state.localStream.getTracks().forEach(track => conn.addTrack(track, state.localStream));
    
    conn.ontrack = (e) => addRemoteVideo(peerId, e.streams[0]);
    conn.onicecandidate = (e) => { if (e.candidate) sendSignal({ type: 'ice-candidate', target: peerId, candidate: e.candidate, room: state.roomId }); };
    conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'connected') updateParticipantCount();
        else if (['disconnected', 'failed'].includes(conn.connectionState)) removePeer(peerId);
    };

    state.peers.set(peerId, { conn });
    if (isInitiator) createOffer(peerId);
    return conn;
}

async function createOffer(peerId) {
    const conn = state.peers.get(peerId).conn;
    await conn.setLocalDescription(await conn.createOffer());
    setTimeout(() => sendSignal({ type: 'offer', target: peerId, offer: conn.localDescription, sender: state.peerId, room: state.roomId }), 500);
}

async function handleOffer(payload) {
    let peerData = state.peers.get(payload.sender);
    if (!peerData) { const conn = createPeerConnection(payload.sender, false); peerData = { conn }; state.peers.set(payload.sender, peerData); }
    const conn = peerData.conn;
    await conn.setRemoteDescription(new RTCSessionDescription(payload.offer));
    await conn.setLocalDescription(await conn.createAnswer());
    setTimeout(() => sendSignal({ type: 'answer', target: payload.sender, answer: conn.localDescription, room: state.roomId }), 500);
}

async function handleAnswer(payload) {
    const conn = state.peers.get(payload.sender)?.conn;
    if (conn) await conn.setRemoteDescription(new RTCSessionDescription(payload.answer));
}

async function handleIceCandidate(payload) {
    const conn = state.peers.get(payload.sender)?.conn;
    if (conn && payload.candidate) try { await conn.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch(e){}
}

function addRemoteVideo(peerId, stream) {
    if (document.getElementById(`video-${peerId}`)) return;
    const container = document.createElement('div');
    container.className = 'video-container'; container.id = `video-${peerId}`;
    const video = document.createElement('video');
    video.srcObject = stream; video.autoplay = true; video.playsInline = true;
    const label = document.createElement('div');
    label.className = 'video-label'; label.textContent = 'Участник';
    container.append(video, label);
    elements.videoGrid.appendChild(container);
    updateParticipantCount();
}

function removePeer(peerId) {
    const p = state.peers.get(peerId);
    if (p) { p.conn.close(); state.peers.delete(peerId); const el = document.getElementById(`video-${peerId}`); if(el) el.remove(); updateParticipantCount(); }
}

function updateParticipantCount() {
    const count = Math.max(state.peers.size + 1, parseInt(elements.participantsNumber.textContent) || 1);
    elements.participantsNumber.textContent = count;
}

function sendSignal(data) {
    if (state.signalingChannel && state.isChannelReady) state.signalingChannel.send({ type: 'broadcast', event: data.type, payload: data });
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

init();