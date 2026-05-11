import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { v4 as uuidv4 } from 'https://cdn.jsdelivr.net/npm/uuid@9/+esm';

// КОНФИГУРАЦИЯ
const SUPABASE_URL = 'https://nkgcsipcxwxhkyyvddet.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bKnk2aDCxZnw5Bqvhgf7ow_Wyg_m1NL';

if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
    console.error('❌ ОШИБКА: Supabase не настроен! Замените URL и KEY в main.js');
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
    mediaDevices: {
        hasVideo: false,
        hasAudio: false,
        videoEnabled: false,
        audioEnabled: false
    },
    signalingChannel: null,
    unreadCount: 0,
    isChatViewActive: true,
    
    // Улучшенное состояние канала
    isChannelReady: false,
    channelStatus: 'disconnected', // disconnected, connecting, connected, error
    messageQueue: [], // Очередь исходящих сообщений
    reconnectAttempts: 0,
    maxReconnectAttempts: 5
};

// DOM Элементы
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
    
    // Настройки
    settingsBtn: document.getElementById('settings-btn'),
    closeSettings: document.getElementById('close-settings'),
    videoToggle: document.getElementById('video-toggle'),
    audioToggle: document.getElementById('audio-toggle'),
    videoLabel: document.getElementById('video-label'),
    audioLabel: document.getElementById('audio-label'),
    
    // Навигация
    chatBadge: document.getElementById('chat-badge')
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
    
    console.log('🚀 Aura Messenger запущен. Версия: Stable-Queue');
}

// Проверка устройств
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
    updateToggleState(elements.videoToggle, state.mediaDevices.videoEnabled, !state.mediaDevices.hasVideo);
    updateToggleState(elements.audioToggle, state.mediaDevices.audioEnabled, !state.mediaDevices.hasAudio);

    elements.videoLabel.textContent = state.mediaDevices.hasVideo 
        ? (state.mediaDevices.videoEnabled ? "Камера включена" : "Камера выключена") 
        : "Камера не найдена";
        
    elements.audioLabel.textContent = state.mediaDevices.hasAudio 
        ? (state.mediaDevices.audioEnabled ? "Микрофон включен" : "Микрофон выключен") 
        : "Микрофон не найден";
}

function updateToggleState(el, isChecked, isDisabled) {
    if (isChecked) el.classList.add('checked');
    else el.classList.remove('checked');
    
    if (isDisabled) el.classList.add('disabled');
    else el.classList.remove('disabled');
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
                        if (sender) sender.replaceTrack(track);
                        else conn.addTrack(track, state.localStream);
                    });
                });

                if (type === 'video' && !document.getElementById('local-video-container')) {
                    addLocalVideo();
                }
            }
        } catch (err) {
            console.error(`Ошибка включения ${type}:`, err);
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
                const localContainer = document.getElementById('local-video-container');
                if (localContainer) localContainer.remove();
            }
        }
    }
}

function setupEventListeners() {
    elements.joinBtn.addEventListener('click', handleJoin);
    elements.leaveBtn.addEventListener('click', handleLeave);
    elements.sendBtn.addEventListener('click', sendMessage);
    
    elements.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendMessage();
            handleTyping();
        } else {
            handleTyping();
        }
    });

    elements.settingsBtn.addEventListener('click', () => {
        elements.settingsModal.classList.remove('hidden');
        updateSettingsUI();
    });
    elements.closeSettings.addEventListener('click', () => elements.settingsModal.classList.add('hidden'));
    
    elements.videoToggle.addEventListener('click', () => handleMediaToggle('video'));
    elements.audioToggle.addEventListener('click', () => handleMediaToggle('audio'));

    document.addEventListener('viewChanged', (e) => {
        state.isChatViewActive = (e.detail.viewId === 'chat-view');
        if (state.isChatViewActive) {
            state.unreadCount = 0;
            updateChatBadge();
        }
    });

    // Первичное подключение
    subscribeToChannel();
}

function updateConnectionStatus(status, text) {
    state.channelStatus = status;
    elements.statusText.textContent = text;
    
    if (status === 'connected') {
        elements.statusText.style.color = 'var(--success)';
    } else if (status === 'error' || status === 'disconnected') {
        elements.statusText.style.color = 'var(--danger)';
    } else {
        elements.statusText.style.color = 'var(--text-secondary)';
    }
}

function subscribeToChannel() {
    // Если уже есть канал, закрываем его перед созданием нового
    if (state.signalingChannel) {
        supabase.removeChannel(state.signalingChannel);
        state.signalingChannel = null;
    }

    updateConnectionStatus('connecting', 'Подключение...');
    console.log('📡 Попытка подключения к каналу...');

    state.signalingChannel = supabase.channel('public:signaling');
    const channel = state.signalingChannel;

    // Presence
    channel.on('presence', { event: 'sync' }, () => {
        const onlineUsers = channel.presenceState();
        const count = Object.keys(onlineUsers).length;
        elements.participantsNumber.textContent = count > 0 ? count : 1;
        elements.participantsCount.classList.add('active');
    });

    // Обработчики событий
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
            console.log('📩 Входящее сообщение:', payload.content);
            
            if (payload.room_id !== state.roomId) return;
            if (payload.sender === state.username) return; 
            
            renderMessage(payload.sender, payload.content, false);
            
            if (!state.isChatViewActive) {
                state.unreadCount++;
                updateChatBadge();
            }
        })
        .subscribe(async (status) => {
            console.log('📡 Статус подписки:', status);
            
            if (status === 'SUBSCRIBED') {
                state.isChannelReady = true;
                state.reconnectAttempts = 0;
                updateConnectionStatus('connected', 'Онлайн');
                
                // Отправка очереди
                if (state.messageQueue.length > 0) {
                    console.log(`🚀 Отправка ${state.messageQueue.length} сообщений из очереди`);
                    // Небольшая задержка для стабильности
                    setTimeout(() => {
                        state.messageQueue.forEach(msg => sendRawMessage(msg));
                        state.messageQueue = [];
                    }, 500);
                }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                state.isChannelReady = false;
                updateConnectionStatus('error', 'Сбой связи');
                handleReconnect();
            }
        });
}

function handleReconnect() {
    if (state.reconnectAttempts >= state.maxReconnectAttempts) {
        console.error('❌ Превышено количество попыток переподключения');
        updateConnectionStatus('error', 'Нет связи');
        return;
    }

    state.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 10000); // Экспоненциальная задержка
    
    console.log(`⏳ Переподключение через ${delay}мс (попытка ${state.reconnectAttempts})`);
    
    setTimeout(() => {
        if (state.roomId) { // Переподключаем только если пользователь в комнате
            subscribeToChannel();
        }
    }, delay);
}

function sendRawMessage(payload) {
    if (!state.signalingChannel) return;
    
    state.signalingChannel.send({
        type: 'broadcast',
        event: 'chat-message',
        payload: payload
    }).then(status => {
        if (status === 'ok') {
            console.log('✅ Сообщение доставлено:', payload.content);
        } else {
            console.warn('⚠️ Статус отправки:', status);
            // Если ошибка, возвращаем в очередь
            if (!state.messageQueue.includes(payload)) {
                state.messageQueue.push(payload);
            }
        }
    }).catch(err => {
        console.error('Ошибка сети при отправке:', err);
        if (!state.messageQueue.includes(payload)) {
            state.messageQueue.push(payload);
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
    
    if (!roomId) {
        roomId = uuidv4().split('-')[0];
        const newUrl = window.location.pathname + '?room=' + roomId;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }

    state.roomId = roomId;
    elements.roomDisplay.textContent = `Room: ${roomId}`;
    elements.loginModal.classList.add('hidden');
    
    console.log(`👤 Пользователь ${username} вошел в комнату ${roomId}`);
}

async function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !state.roomId || !state.username) return;

    // Рисуем у себя мгновенно
    renderMessage(state.username, text, true);
    elements.messageInput.value = '';

    const messagePayload = {
        room_id: state.roomId,
        sender: state.username,
        content: text,
        created_at: new Date().toISOString()
    };

    if (state.isChannelReady) {
        sendRawMessage(messagePayload);
    } else {
        console.warn('⏳ Канал недоступен. Сообщение в очереди.');
        state.messageQueue.push(messagePayload);
        // Пробуем форсировать переподключение если канал мертв
        if (state.channelStatus !== 'connecting') {
            handleReconnect();
        }
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

    conn.ontrack = (event) => addRemoteVideo(peerId, event.streams[0]);

    conn.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: 'ice-candidate', target: peerId, candidate: event.candidate, room: state.roomId });
        }
    };

    conn.onconnectionstatechange = () => {
        if (conn.connectionState === 'connected') updateParticipantCount();
        else if (conn.connectionState === 'disconnected' || conn.connectionState === 'failed') removePeer(peerId);
    };

    state.peers.set(peerId, { conn });
    if (isInitiator) createOffer(peerId);
    return conn;
}

async function createOffer(peerId) {
    const conn = state.peers.get(peerId).conn;
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    setTimeout(async () => {
        sendSignal({ type: 'offer', target: peerId, offer: conn.localDescription, sender: state.peerId, room: state.roomId });
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
        sendSignal({ type: 'answer', target: payload.sender, answer: conn.localDescription, room: state.roomId });
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
        catch (e) { console.error('Ошибка кандидата:', e); }
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
    const count = Math.max(state.peers.size + 1, parseInt(elements.participantsNumber.textContent) || 1);
    elements.participantsNumber.textContent = count;
    elements.participantsCount.classList.add('active');
}

function sendSignal(data) {
    if (state.signalingChannel && state.isChannelReady) {
        state.signalingChannel.send({ type: 'broadcast', event: data.type, payload: data });
    }
}

function renderMessage(user, text, isOwn) {
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
        <div class="message-meta"><span>${user}</span><span>${time}</span></div>
        <div class="message-body">${escapeHtml(text)}</div>
    `;
    elements.messages.appendChild(div);
    elements.messages.scrollTop = elements.messages.scrollHeight;
}

function handleTyping() {
    if (!state.roomId || !state.isChannelReady) return;
    if (!state.isTyping) {
        state.isTyping = true;
        if (state.signalingChannel) {
            state.signalingChannel.send({
                type: 'broadcast', event: 'typing',
                payload: { room: state.roomId, sender: state.username }
            });
        }
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
    state.typingTimeout = setTimeout(() => { elements.typingIndicator.textContent = ''; }, 3000);
}

function handleLeave() {
    if (confirm('Вы уверены, что хотите выйти?')) window.location.reload();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

init();