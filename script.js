import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// КОНФИГУРАЦИЯ
// Вставьте свои данные из панели управления Supabase
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co'; 
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CHANNEL_NAME = 'public:chat';
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// Элементы DOM
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const usernameInput = document.getElementById('username');
const statusSpan = document.getElementById('connection-status');
const videoGrid = document.getElementById('video-grid');
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const typingIndicator = document.getElementById('typing-indicator');

// Состояние
let localStream;
let peers = new Map(); // peerId -> { pc, dataChannel, videoElement }
let username = localStorage.getItem('p2p_username') || '';

// Инициализация
function init() {
    if (username) usernameInput.value = username;
    
    usernameInput.addEventListener('change', (e) => {
        username = e.target.value.trim();
        localStorage.setItem('p2p_username', username);
    });

    connectToSupabase();
    setupMedia();
    setupEventListeners();
}

// Подключение к Supabase Realtime
async function connectToSupabase() {
    updateStatus('Подключение...', 'connecting');

    const channel = supabase.channel(CHANNEL_NAME);

    channel
        .on('system', { event: '*' }, payload => {
            // Обработка системных событий (подключения/отключения пользователей)
            if (payload.payload.type === 'user_added') {
                // Логика приглашения нового пира (упрощено)
            }
        })
        .on('broadcast', { event: 'offer' }, async ({ payload }) => {
            await handleOffer(payload);
        })
        .on('broadcast', { event: 'answer' }, async ({ payload }) => {
            await handleAnswer(payload);
        })
        .on('broadcast', { event: 'ice-candidate' }, async ({ payload }) => {
            await handleIceCandidate(payload);
        })
        .on('broadcast', { event: 'chat-message', filter: `room=${getRoomId()}` }, ({ payload }) => {
            renderMessage(payload.data);
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                updateStatus('Онлайн', 'connected');
                broadcastPresence();
            } else if (status === 'CHANNEL_ERROR') {
                updateStatus('Ошибка соединения', 'error');
                setTimeout(connectToSupabase, 3000); // Авто-переподключение
            }
        });
}

function broadcastPresence() {
    supabase.channel(CHANNEL_NAME).send({
        type: 'broadcast',
        event: 'presence',
        payload: { id: supabase.auth.session()?.user?.id || 'anon', username }
    });
}

// WebRTC Логика
async function setupMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = createVideoElement(localStream, true);
        videoGrid.appendChild(localVideo);
    } catch (err) {
        console.error('Ошибка доступа к медиа:', err);
        alert('Не удалось получить доступ к камере/микрофону');
    }
}

function createPeerConnection(remoteId) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        const existing = document.querySelector(`video[data-peer-id="${remoteId}"]`);
        if (!existing && event.streams[0]) {
            const video = createVideoElement(event.streams[0], false, remoteId);
            videoGrid.appendChild(video);
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            supabase.channel(CHANNEL_NAME).send({
                type: 'broadcast',
                event: 'ice-candidate',
                payload: { candidate: event.candidate, target: remoteId, from: supabase.auth.session()?.user?.id }
            });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            console.warn('Соединение с пиром потеряно:', remoteId);
            removePeer(remoteId);
            // Можно добавить уведомление пользователю
        }
    };

    return pc;
}

// Обработчики сигналов
async function handleOffer({ offer, from }) {
    const pc = createPeerConnection(from);
    peers.set(from, { pc });

    const dataChannel = pc.createDataChannel('chat');
    setupDataChannel(dataChannel, from);

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    supabase.channel(CHANNEL_NAME).send({
        type: 'broadcast',
        event: 'answer',
        payload: { answer, target: from, from: supabase.auth.session()?.user?.id }
    });
}

async function handleAnswer({ answer, from }) {
    const peer = peers.get(from);
    if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
}

async function handleIceCandidate({ candidate, from }) {
    const peer = peers.get(from);
    if (peer) {
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('Ошибка добавления ICE кандидата', e);
        }
    }
}

function removePeer(peerId) {
    const peer = peers.get(peerId);
    if (peer) {
        peer.pc.close();
        peers.delete(peerId);
        const video = document.querySelector(`video[data-peer-id="${peerId}"]`);
        if (video) video.remove();
    }
}

// Data Channel для чата (альтернатива Supabase для скорости, но Supabase надежнее для истории)
function setupDataChannel(dc, peerId) {
    dc.onopen = () => console.log('DC open with', peerId);
    dc.onmessage = (e) => {
        // Если используете DC для чата, парсите здесь
        // Для надежности в этом проекте основной чат идет через Supabase
    };
}

// Чат и Файлы
function setupEventListeners() {
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const messageData = {
        id: Date.now(),
        user: username || 'Аноним',
        text: text,
        timestamp: new Date().toISOString(),
        type: 'text'
    };

    // Отправка через Supabase Realtime Broadcast
    supabase.channel(CHANNEL_NAME).send({
        type: 'broadcast',
        event: 'chat-message',
        payload: { room: getRoomId(), data: messageData }
    });

    renderMessage(messageData);
    messageInput.value = '';
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
        alert(`Файл слишком большой! Максимальный размер: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        fileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const messageData = {
            id: Date.now(),
            user: username || 'Аноним',
            file: event.target.result, // Base64
            fileName: file.name,
            fileType: file.type,
            timestamp: new Date().toISOString(),
            type: 'file'
        };

        supabase.channel(CHANNEL_NAME).send({
            type: 'broadcast',
            event: 'chat-message',
            payload: { room: getRoomId(), data: messageData }
        });
        
        renderMessage(messageData);
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
}

// Рендеринг с защитой от XSS
function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = `message ${msg.user === (username || 'Аноним') ? 'own' : 'other'}`;
    
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = `${msg.user} • ${new Date(msg.timestamp).toLocaleTimeString()}`;
    
    const content = document.createElement('div');
    content.className = 'message-content';

    if (msg.type === 'file') {
        const link = document.createElement('a');
        link.href = msg.file;
        link.download = msg.fileName;
        link.textContent = `📎 Скачать файл: ${escapeHtml(msg.fileName)}`;
        link.className = 'file-link';
        content.appendChild(link);
    } else {
        // Безопасная вставка текста
        content.textContent = escapeHtml(msg.text);
    }

    div.appendChild(header);
    div.appendChild(content);
    messagesContainer.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Утилиты
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createVideoElement(stream, isLocal, peerId = null) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    if (peerId) video.dataset.peerId = peerId;
    return video;
}

function updateStatus(text, className) {
    statusSpan.textContent = text;
    statusSpan.className = `status ${className}`;
}

function getRoomId() {
    // Простая логика комнат, можно усложнить
    return 'global-room'; 
}

// Запуск
init();
