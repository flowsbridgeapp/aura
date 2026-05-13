import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// КОНФИГУРАЦИЯ
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL === 'your_supabase_url_here') {
    console.warn('⚠️ Supabase не настроен. Создайте файл .env и укажите VITE_SUPABASE_URL и VITE_SUPABASE_KEY.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Утилиты
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}

function getInitials(name) {
    return name.substring(0, 2).toUpperCase();
}

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
    messageQueue: [],
    isChannelReady: false,
    audioContext: null,
    userColor: '' // Цвет текущего пользователя
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

// --- AUDIO ---
function initAudio() {
    if (!state.audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) state.audioContext = new AudioContext();
    }
    if (state.audioContext && state.audioContext.state === 'suspended') state.audioContext.resume();
}

function playNotificationSound() {
    if (!state.audioContext) return;
    const osc = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, state.audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, state.audioContext.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, state.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audioContext.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(state.audioContext.destination);
    osc.start();
    osc.stop(state.audioContext.currentTime + 0.3);
}

// --- INIT ---
async function init() {
    setupEventListeners();
    await checkMediaDevices();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('room')) elements.roomIdInput.value = urlParams.get('room');
    console.log('🚀 Aura Messenger v3.2 (Secure + UX)');
}

async function checkMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.mediaDevices.hasVideo = devices.filter(d => d.kind === 'videoinput').length > 0;
        state.mediaDevices.hasAudio = devices.filter(d => d.kind === 'audioinput').length > 0;
        updateSettingsUI();
    } catch (err) {
        state.mediaDevices.hasVideo = false;
        state.mediaDevices.hasAudio = false;
        updateSettingsUI();
    }
}

function updateSettingsUI() {
    updateToggleState(elements.videoToggle, state.mediaDevices.videoEnabled, !state.mediaDevices.hasVideo);
    updateToggleState(elements.audioToggle, state.mediaDevices.audioEnabled, !state.mediaDevices.hasAudio);
    elements.videoLabel.textContent = state.mediaDevices.hasVideo 
        ? (state.mediaDevices.videoEnabled ? "Камера включена" : "Камера выключена") : "Камера не найдена";
    elements.audioLabel.textContent = state.mediaDevices.hasAudio 
        ? (state.mediaDevices.audioEnabled ? "Микрофон включен" : "Микрофон выключен") : "Микрофон не найден";
}

function updateToggleState(el, isChecked, isDisabled) {
    if (isChecked) el.classList.add('checked'); else el.classList.remove('checked');
    if (isDisabled) el.classList.add('disabled'); else el.classList.remove('disabled');
}

async function handleMediaToggle(type) {
    const isActive = type === 'video' ? state.mediaDevices.videoEnabled : state.mediaDevices.audioEnabled;
    const hasDevice = type === 'video' ? state.mediaDevices.hasVideo : state.mediaDevices.hasAudio;
    if (!hasDevice) return;

    const newState = !isActive;
    if (type === 'video') state.mediaDevices.videoEnabled = newState;
    if (type === 'audio') state.mediaDevices.audioEnabled = newState;
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
                state.localStream.getTracks().forEach(track => {
                    state.peers.forEach(({ conn }) => {
                        const sender = conn.getSenders().find(s => s.track && s.track.kind === track.kind);
                        if (sender) sender.replaceTrack(track); else conn.addTrack(track, state.localStream);
                    });
                });
                if (type === 'video' && !document.getElementById('local-video-container')) addLocalVideo();
            }
        } catch (err) {
            console.error(`Ошибка ${type}:`, err);
            if (type === 'video') state.mediaDevices.videoEnabled = false;
            if (type === 'audio') state.mediaDevices.audioEnabled = false;
            updateSettingsUI();
            alert(`Нет доступа к ${type === 'video' ? 'камере' : 'микрофону'}.`);
        }
    } else {
        if (state.localStream) {
            const kind = type === 'video' ? 'video' : 'audio';
            const tracks = state.localStream.getTracks().filter(t => t.kind === kind);
            tracks.forEach(track => {
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

function setupEventListeners() {
    elements.joinBtn.addEventListener('click', handleJoin);
    elements.leaveBtn.addEventListener('click', handleLeave);
    elements.sendBtn.addEventListener('click', sendMessage);
    
    document.addEventListener('click', initAudio, { once: true });
    document.addEventListener('keydown', initAudio, { once: true });

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

function subscribeToChannel() {
    if (state.signalingChannel) return;
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
            playNotificationSound();
            if (!state.isChatViewActive) { state.unreadCount++; updateChatBadge(); }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                state.isChannelReady = true;
                elements.statusText.textContent = 'Онлайн';
                elements.statusText.style.color = 'var(--success)';
                channel.track({ user: state.username, id: state.peerId });
                if (state.messageQueue.length > 0) {
                    setTimeout(() => {
                        state.messageQueue.forEach(msg => sendRawMessage(msg));
                        state.messageQueue = [];
                    }, 500);
                }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                state.isChannelReady = false;
                elements.statusText.textContent = 'Сбой...';
                elements.statusText.style.color = 'var(--danger)';
            }
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

async function handleJoin() {
    const username = elements.usernameInput.value.trim();
    let roomId = elements.roomIdInput.value.trim();
    if (!username) return alert('Введите имя');

    state.username = username;
    state.userColor = stringToColor(username); // Генерируем цвет
    
    if (!roomId) {
        roomId = uuidv4().split('-')[0];
        const newUrl = window.location.pathname + '?room=' + roomId;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }

    state.roomId = roomId;
    elements.roomDisplay.textContent = `Room: ${roomId}`;
    elements.loginModal.classList.add('hidden');
}

function sendRawMessage(payload) {
    if (!state.signalingChannel) return;
    state.signalingChannel.send({ type: 'broadcast', event: 'chat-message', payload }).then(s => {
        if (s !== 'ok') console.warn('Send status:', s);
    });
}

async function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.roomId || !state.username) return;

    renderMessage(state.username, text, true);
    elements.messageInput.value = '';

    const payload = {
        room_id: state.roomId,
        sender: state.username,
        content: text,
        created_at: new Date().toISOString()
    };

    if (state.isChannelReady) sendRawMessage(payload);
    else {
        console.warn('⏳ Queue');
        state.messageQueue.push(payload);
    }
    state.isTyping = false;
    elements.typingIndicator.textContent = '';
    elements.messageInput.focus();
}

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
    container.appendChild(video); container.appendChild(label);
    elements.videoGrid.appendChild(container);
}

// WebRTC Functions (PeerConnection, Offer, Answer, ICE)
function createPeerConnection(peerId, isInitiator) {
    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    const conn = new RTCPeerConnection(config);
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
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    setTimeout(() => sendSignal({ type: 'offer', target: peerId, offer: conn.localDescription, sender: state.peerId, room: state.roomId }), 500);
}

async function handleOffer(payload) {
    let peerData = state.peers.get(payload.sender);
    if (!peerData) { const conn = createPeerConnection(payload.sender, false); peerData = { conn }; state.peers.set(payload.sender, peerData); }
    const conn = peerData.conn;
    await conn.setRemoteDescription(new RTCSessionDescription(payload.offer));
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
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
    container.appendChild(video); container.appendChild(label);
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
    elements.participantsCount.classList.add('active');
}

function sendSignal(data) {
    if (state.signalingChannel && state.isChannelReady) state.signalingChannel.send({ type: 'broadcast', event: data.type, payload: data });
}

function renderMessage(user, text, isOwn) {
    // Очистка старых сообщений (DOM оптимизация)
    if (elements.messages.children.length > 50) elements.messages.firstElementChild.remove();

    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    div.title = 'Нажмите, чтобы скопировать';
    div.style.animation = 'slideIn 0.3s ease-out';

    // Аватарка для чужих сообщений
    let avatarHtml = '';
    if (!isOwn) {
        const color = stringToColor(user);
        avatarHtml = `<div class="message-avatar" style="background:${color}">${getInitials(user)}</div>`;
    }

    div.innerHTML = `
        <div class="message-header" style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            ${avatarHtml}
            <span style="font-weight:bold; font-size:0.85rem;">${escapeHtml(user)}</span>
        </div>
        <div class="message-body" style="word-break:break-word;">${escapeHtml(text)}</div>
        <div class="message-meta" style="font-size:0.7rem; opacity:0.7; margin-top:4px; text-align:right;">
            ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
        </div>
    `;

    div.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
            const orig = div.style.transform;
            div.style.transform = 'scale(0.98)';
            setTimeout(() => div.style.transform = orig, 150);
        });
    });

    elements.messages.appendChild(div);
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

function handleTyping() {
    if (!state.roomId || !state.isChannelReady) return;
    if (!state.isTyping) {
        state.isTyping = true;
        if (state.signalingChannel) state.signalingChannel.send({ type: 'broadcast', event: 'typing', payload: { room: state.roomId, sender: state.username } });
    }
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => { state.isTyping = false; elements.typingIndicator.textContent = ''; }, 2000);
}

function showTypingIndicator(username) {
    elements.typingIndicator.textContent = `${username} печатает...`;
    clearTimeout(state.typingTimeout);
    state.typingTimeout = setTimeout(() => { elements.typingIndicator.textContent = ''; }, 3000);
}

function handleLeave() { if (confirm('Выйти?')) window.location.reload(); }
function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

init();