import { joinRoom } from 'trystero/supabase';

// --- ДАННЫЕ SUPABASE (только здесь) ---
const SUPABASE_URL = 'https://dlvlruldmaomehvcdofx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsdmxydWxkbWFvbWVodmNkb2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzQyMDAsImV4cCI6MjA5MDA1MDIwMH0.pwEQNa_yVGAg2SsQn92qyeZlCqF__303eoFxKkNvufA';

// --- Элементы DOM ---
const roomIdInput = document.getElementById('roomIdInput');
const peerNameInput = document.getElementById('peerNameInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const connectionStatus = document.getElementById('connectionStatus');
const peersListDiv = document.getElementById('peersList');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const fileInput = document.getElementById('fileInput');
const sendFileBtn = document.getElementById('sendFileBtn');
const fileProgress = document.getElementById('fileProgress');
const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');
const startVideoBtn = document.getElementById('startVideoBtn');
const stopVideoBtn = document.getElementById('stopVideoBtn');

// --- PWA установка ---
let deferredPrompt;
const installPrompt = document.getElementById('installPrompt');
const installBtn = document.getElementById('installBtn');

// --- Состояние приложения ---
let room = null;
const peers = new Set();
let localStream = null;
const peerVideos = new Map();
const peerNameMap = new Map();

// --- Инициализация имени ---
peerNameInput.value = 'User_' + Math.random().toString(36).substring(2, 6);

// --- UI функции ---
function updateUIAfterJoin() {
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    messageInput.disabled = false;
    sendMsgBtn.disabled = false;
    fileInput.disabled = false;
    sendFileBtn.disabled = false;
    startVideoBtn.disabled = false;
    connectionStatus.innerHTML = '🟢 В сети (Supabase)';
}

function updateUIAfterLeave() {
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    messageInput.disabled = true;
    sendMsgBtn.disabled = true;
    fileInput.disabled = true;
    sendFileBtn.disabled = true;
    startVideoBtn.disabled = true;
    stopVideoBtn.disabled = true;
    connectionStatus.innerHTML = '🔴 Не в сети';
    peersListDiv.innerHTML = '👥 Пиры: нет';
    
    peers.clear();
    remoteVideos.innerHTML = '';
    peerVideos.clear();
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        localStream = null;
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installPrompt.style.display = 'block';
    
    installBtn.addEventListener('click', async () => {
        installPrompt.style.display = 'none';
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Пользователь ${outcome} установку`);
        deferredPrompt = null;
    });
});

function addMessage(text, peerId, isOwn = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    msgDiv.classList.add(isOwn ? 'own' : 'other');
    
    const name = isOwn ? 'Вы' : (peerNameMap.get(peerId) || (peerId ? peerId.substring(0, 6) : '?'));
    msgDiv.innerHTML = `<strong>${name}:</strong> ${text} <small>${new Date().toLocaleTimeString()}</small>`;
    
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// --- ПРИСОЕДИНЕНИЕ К КОМНАТЕ ---
joinBtn.addEventListener('click', async () => {
    const roomName = roomIdInput.value.trim() || 'default-room';
    const myName = peerNameInput.value.trim() || 'Аноним';
    
    try {
        const supabaseConfig = { 
            appId: SUPABASE_URL,
            supabaseKey: SUPABASE_ANON_KEY,
            rtcConfig: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            }
        
        };  
        
        console.log('Подключение к Supabase:', SUPABASE_URL);
        room = joinRoom(supabaseConfig, roomName);

        // --- ДИАГНОСТИКА ---
        setTimeout(() => {
            console.log('=== ДИАГНОСТИКА ===');
            console.log('Room создана, имя:', roomName);
            console.log('Текущие пиры:', Array.from(peers));
            console.log('Карта имён:', peerNameMap);
        }, 2000);
        
        // --- Обработчики комнаты ---
        room.onPeerJoin(peerId => {
            console.log('Peer joined:', peerId);
            peers.add(peerId);
            peersListDiv.innerHTML = `👥 Пиры: ${Array.from(peers).map(id => peerNameMap.get(id) || id.substring(0,6)).join(', ') || 'только вы'}`;
            addMessage(`👋 Пользователь ${peerId.substring(0,6)} присоединился`, null);
            sendName(myName, peerId);
        });
        
        room.onPeerLeave(peerId => {
            console.log('Peer left:', peerId);
            peers.delete(peerId);
            peerNameMap.delete(peerId);
            peersListDiv.innerHTML = `👥 Пиры: ${Array.from(peers).map(id => peerNameMap.get(id) || id.substring(0,6)).join(', ') || 'только вы'}`;
            addMessage(`👋 Пользователь ${peerId.substring(0,6)} покинул чат`, null);
            
            const videoWrapper = peerVideos.get(peerId);
            if (videoWrapper) {
                videoWrapper.remove();
                peerVideos.delete(peerId);
            }
        });
        
        // --- Действия (Actions) ---
        const [sendMessage, getMessage] = room.makeAction('chat');
        getMessage((data, peerId) => {
            addMessage(data.text, peerId, false);
        });
        window.sendMessage = sendMessage;
        
        const [sendName, getName] = room.makeAction('name');
        getName((name, peerId) => {
            console.log(`Получено имя от ${peerId}: ${name}`);
            peerNameMap.set(peerId, name);
            peersListDiv.innerHTML = `👥 Пиры: ${Array.from(peers).map(id => peerNameMap.get(id) || id.substring(0,6)).join(', ') || 'только вы'}`;
        });
        window.sendName = sendName;
        
        // --- ОТПРАВЛЯЕМ ИМЯ ВСЕМ СРАЗУ (важное дополнение!) ---
        setTimeout(() => {
            console.log('Отправляем имя всем пирам:', myName);
            sendName(myName);
        }, 1000);
        
        const [sendFile, getFile, onFileProgress] = room.makeAction('file');
        getFile((data, peerId, metadata) => {
            const blob = new Blob([data], { type: metadata.type });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = metadata.name || 'file';
            link.textContent = `Скачать файл от ${peerNameMap.get(peerId) || peerId.substring(0,6)}: ${metadata.name}`;
            link.style.display = 'block';
            link.style.margin = '5px 0';
            messagesDiv.appendChild(link);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        });
        
        onFileProgress((percent, peerId, metadata) => {
            fileProgress.style.display = 'block';
            fileProgress.innerHTML = `📥 Загрузка ${metadata?.name || 'файла'} от ${peerNameMap.get(peerId) || peerId.substring(0,6)}: ${Math.round(percent * 100)}%`;
            if (percent >= 1) setTimeout(() => fileProgress.style.display = 'none', 2000);
        });
        window.sendFile = sendFile;
        
        // --- Видео ---
        room.onPeerStream((stream, peerId) => {
            console.log('Получен видеопоток от', peerId);
            if (!peerVideos.has(peerId)) {
                const wrapper = document.createElement('div');
                wrapper.className = 'video-wrapper';
                const video = document.createElement('video');
                video.autoplay = true;
                video.playsinline = true;
                const nameSpan = document.createElement('span');
                wrapper.appendChild(video);
                wrapper.appendChild(nameSpan);
                remoteVideos.appendChild(wrapper);
                peerVideos.set(peerId, { wrapper, video, nameSpan });
            }
            const { video, nameSpan } = peerVideos.get(peerId);
            video.srcObject = stream;
            nameSpan.textContent = peerNameMap.get(peerId) || peerId.substring(0,6);
        });
        
        updateUIAfterJoin();
        addMessage(`Вы присоединились к комнате "${roomName}"`, null, true);
        
    } catch (err) {
        console.error('Ошибка подключения:', err);
        alert('Не удалось подключиться: ' + err.message);
    }
});

// --- Остальные обработчики (без изменений, они рабочие) ---
leaveBtn.addEventListener('click', () => {
    if (room) {
        room.leave();
        room = null;
    }
    updateUIAfterLeave();
});

sendMsgBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (!text || !room) return;
    if (window.sendMessage) {
        window.sendMessage({ text });
        addMessage(text, null, true);
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMsgBtn.click();
});

sendFileBtn.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file || !room || !window.sendFile) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const arrayBuffer = e.target.result;
        window.sendFile(arrayBuffer, null, { 
            name: file.name, 
            type: file.type || 'application/octet-stream',
            size: file.size
        });
        addMessage(`📎 Вы отправили файл: ${file.name}`, null, true);
        fileInput.value = '';
        fileProgress.style.display = 'block';
        fileProgress.innerHTML = `📤 Отправка файла...`;
        setTimeout(() => fileProgress.style.display = 'none', 1500);
    };
    reader.readAsArrayBuffer(file);
});

startVideoBtn.addEventListener('click', async () => {
    if (!room) {
        alert('Сначала присоединитесь к комнате');
        return;
    }
    
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Ваш браузер не поддерживает доступ к камере/микрофону');
            return;
        }
        
        const constraints = {
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
            audio: { echoCancellation: true, noiseSuppression: true }
        };
        
        console.log('Запрашиваем доступ к медиа...');
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Доступ получен, треки:', localStream.getTracks());
        
        localVideo.srcObject = localStream;
        await localVideo.play();
        
        room.addStream(localStream);
        
        startVideoBtn.disabled = true;
        stopVideoBtn.disabled = false;
        console.log('Трансляция запущена');
        
    } catch (err) {
        console.error('Ошибка доступа к камере/микрофону:', err);
        if (err.name === 'NotAllowedError') {
            alert('Доступ к камере/микрофону запрещён. Разрешите доступ в настройках браузера.');
        } else if (err.name === 'NotFoundError') {
            alert('На устройстве не найдена камера или микрофон');
        } else {
            alert(`Не удалось получить доступ: ${err.message}`);
        }
    }
});

stopVideoBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        localStream = null;
    }
    alert('Трансляция остановлена');
    startVideoBtn.disabled = false;
    stopVideoBtn.disabled = true;
});

updateUIAfterLeave();