// script.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dlvlruldmaomehvcdofx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsdmxydWxkbWFvbWVodmNkb2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzQyMDAsImV4cCI6MjA5MDA1MDIwMH0.pwEQNa_yVGAg2SsQn92qyeZlCqF__303eoFxKkNvufA';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentChannel = null;
let myPeerId = 'user-' + Math.random().toString(36).substring(2, 11);
let myName = 'User_' + Math.random().toString(36).substring(2, 6);
let localStream = null;
const peerConnections = new Map(); // peerId → RTCPeerConnection

// DOM элементы
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
const startVideoBtn = document.getElementById('startVideoBtn');
const stopVideoBtn = document.getElementById('stopVideoBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');

peerNameInput.value = myName;

// ====================== UI FUNCTIONS ======================
function addMessage(text, isOwn = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message p-4 rounded-2xl max-w-[85%] ${isOwn ? 'message-own ml-auto' : 'message-other'}`;
    
    const name = isOwn ? 'Вы' : 'Пользователь';
    msgDiv.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
            <span class="font-semibold">${name}</span>
            <span class="text-xs opacity-60">${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div>${text}</div>
    `;
    
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // Плавная анимация появления сообщения
    gsap.from(msgDiv, { 
        opacity: 0, 
        y: 20, 
        duration: 0.5, 
        ease: "power2.out" 
    });
}

function updateUIAfterJoin() {
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    messageInput.disabled = false;
    sendMsgBtn.disabled = false;
    fileInput.disabled = false;
    sendFileBtn.disabled = false;
    startVideoBtn.disabled = false;

    connectionStatus.innerHTML = `
        <span class="inline-block w-3 h-3 bg-emerald-400 rounded-full animate-pulse mr-2"></span>
        ПОДКЛЮЧЕНО
    `;
    connectionStatus.className = "flex items-center text-emerald-400 font-medium";
    
    addMessage('✅ Вы успешно присоединились к комнате', true);
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

    connectionStatus.innerHTML = `
        <span class="inline-block w-3 h-3 bg-red-500 rounded-full mr-2"></span>
        ОТКЛЮЧЕНО
    `;
    connectionStatus.className = "flex items-center text-red-400 font-medium";
}

function updatePeersList(state) {
    const count = Object.keys(state || {}).length;
    peersListDiv.textContent = `👥 ${count} в комнате`;
}

// ====================== ICE CONFIG ======================
const iceConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
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
    ],
    iceCandidatePoolSize: 10
};

// ====================== WEBRTC HELPERS ======================
async function createPeerConnection(peerId) {
    if (peerConnections.has(peerId)) return peerConnections.get(peerId);

    const pc = new RTCPeerConnection(iceConfig);
    peerConnections.set(peerId, pc);

    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
        let wrapper = document.querySelector(`[data-peer="${peerId}"]`);
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'glass rounded-3xl p-3';
            wrapper.dataset.peer = peerId;
            
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            video.className = "w-full aspect-video object-cover rounded-2xl";
            
            const label = document.createElement('div');
            label.className = "text-center text-xs mt-2 text-cyan-300";
            label.textContent = peerId.slice(0, 8);
            
            wrapper.appendChild(video);
            wrapper.appendChild(label);
            remoteVideos.appendChild(wrapper);
        }
        wrapper.querySelector('video').srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
        if (event.candidate && currentChannel) {
            currentChannel.send({
                type: 'broadcast',
                event: 'webrtc',
                payload: {
                    type: 'ice-candidate',
                    candidate: event.candidate,
                    from: myPeerId,
                    to: peerId
                }
            });
        }
    };

    return pc;
}

async function handleWebRTCSignal(payload) {
    const { type, from, to, offer, answer, candidate } = payload;
    if (to && to !== myPeerId) return;

    let pc = peerConnections.get(from);
    if (!pc) pc = await createPeerConnection(from);

    try {
        if (type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            currentChannel.send({
                type: 'broadcast',
                event: 'webrtc',
                payload: { type: 'answer', answer: pc.localDescription, from: myPeerId, to: from }
            });
        } 
        else if (type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } 
        else if (type === 'ice-candidate' && candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (err) {
        console.error('WebRTC signal error:', err);
    }
}

// ====================== JOIN ROOM ======================
joinBtn.addEventListener('click', async () => {
    const roomName = roomIdInput.value.trim() || 'test-room';
    myName = peerNameInput.value.trim() || myName;

    if (currentChannel) currentChannel.unsubscribe();

    currentChannel = supabase.channel(roomName, {
        config: { presence: { key: myPeerId } }
    });

    currentChannel.on('presence', { event: 'sync' }, () => {
        updatePeersList(currentChannel.presenceState());
    });

    currentChannel.on('presence', { event: 'join' }, ({ newPresences }) => {
        newPresences.forEach(p => {
            addMessage(`👋 ${p.name || 'Пользователь'} присоединился`);
        });
    });

    currentChannel.on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload.peerId !== myPeerId) addMessage(payload.text);
    });

    currentChannel.on('broadcast', { event: 'file' }, ({ payload }) => {
        const blob = new Blob([payload.data], { type: payload.type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = payload.name;
        a.textContent = `📎 Скачать: ${payload.name}`;
        a.style.display = 'block';
        a.className = "text-cyan-400 hover:text-cyan-300 mt-2";
        messagesDiv.appendChild(a);
    });

    currentChannel.on('broadcast', { event: 'webrtc' }, ({ payload }) => {
        handleWebRTCSignal(payload);
    });

    await currentChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            currentChannel.track({ peerId: myPeerId, name: myName });
            updateUIAfterJoin();
        }
    });
});

// ====================== SEND MESSAGE ======================
sendMsgBtn.addEventListener('click', async () => {
    const text = messageInput.value.trim();
    if (!text || !currentChannel) return;

    await currentChannel.send({
        type: 'broadcast',
        event: 'chat',
        payload: { text, peerId: myPeerId }
    });

    addMessage(text, true);
    messageInput.value = '';
});

// ====================== SEND FILE ======================
sendFileBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file || !currentChannel) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        await currentChannel.send({
            type: 'broadcast',
            event: 'file',
            payload: {
                data: e.target.result,
                name: file.name,
                type: file.type || 'application/octet-stream'
            }
        });
        addMessage(`📎 Вы отправили файл: ${file.name}`, true);
    };
    reader.readAsArrayBuffer(file);
    fileInput.value = '';
});

// ====================== VIDEO CALL ======================
startVideoBtn.addEventListener('click', async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
        });
        localVideo.srcObject = localStream;

        const state = currentChannel.presenceState();
        for (const peerId in state) {
            if (peerId === myPeerId) continue;
            const pc = await createPeerConnection(peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            currentChannel.send({
                type: 'broadcast',
                event: 'webrtc',
                payload: { type: 'offer', offer: pc.localDescription, from: myPeerId, to: peerId }
            });
        }

        startVideoBtn.disabled = true;
        stopVideoBtn.disabled = false;
        addMessage('🎥 Видеозвонок запущен', true);
    } catch (err) {
        console.error(err);
        addMessage('❌ Не удалось получить доступ к камере/микрофону', true);
    }
});

stopVideoBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
    }
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    remoteVideos.innerHTML = '';
    startVideoBtn.disabled = false;
    stopVideoBtn.disabled = true;
    addMessage('⏹️ Видеозвонок остановлен', true);
});

// ====================== LEAVE ======================
leaveBtn.addEventListener('click', () => {
    if (currentChannel) currentChannel.unsubscribe();
    currentChannel = null;
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    updateUIAfterLeave();
});

// Инициализация
updateUIAfterLeave();
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMsgBtn.click();
});