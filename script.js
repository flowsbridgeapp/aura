<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// === ТВОИ ДАННЫЕ SUPABASE ===
const SUPABASE_URL = 'https://dlvlruldmaomehvcdofx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsdmxydWxkbWFvbWVodmNkb2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0NzQyMDAsImV4cCI6MjA5MDA1MDIwMH0.pwEQNa_yVGAg2SsQn92qyeZlCqF__303eoFxKkNvufA';   // ← вставь сюда свой реальный anon public ключ

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentChannel = null;
let myPeerId = 'user-' + Math.random().toString(36).substring(2, 11);
let myName = 'User_' + Math.random().toString(36).substring(2, 6);

// === DOM элементы ===
const roomIdInput = document.getElementById('roomIdInput');
const peerNameInput = document.getElementById('peerNameInput');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const connectionStatus = document.getElementById('connectionStatus');
const peersListDiv = document.getElementById('peersList');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const startVideoBtn = document.getElementById('startVideoBtn');
const stopVideoBtn = document.getElementById('stopVideoBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideos = document.getElementById('remoteVideos');

// Инициализация имени
peerNameInput.value = myName;

// === Основные UI функции ===
function addMessage(text, peerId = null, isOwn = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isOwn ? 'own' : 'other'}`;
    
    const name = isOwn ? 'Вы' : (peerId ? peerId.substring(0, 8) : 'Система');
    msgDiv.innerHTML = `<strong>${name}:</strong> ${text} <small>${new Date().toLocaleTimeString()}</small>`;
    
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updatePeersList() {
    // Пока просто показываем, что мы в комнате (пока Presence не работает полностью)
    peersListDiv.innerHTML = `👥 В комнате: ${myName} (и другие)`;
}

function updateUIAfterJoin() {
    joinBtn.disabled = true;
    leaveBtn.disabled = false;
    messageInput.disabled = false;
    sendMsgBtn.disabled = false;
    startVideoBtn.disabled = false;
    connectionStatus.innerHTML = '🟢 Подключено к комнате';
    connectionStatus.style.color = 'lime';
    addMessage('✅ Вы успешно присоединились к комнате', null, true);
}

function updateUIAfterLeave() {
    joinBtn.disabled = false;
    leaveBtn.disabled = true;
    messageInput.disabled = true;
    sendMsgBtn.disabled = true;
    startVideoBtn.disabled = true;
    stopVideoBtn.disabled = true;
    connectionStatus.innerHTML = '🔴 Отключено';
    connectionStatus.style.color = 'red';
    messagesDiv.innerHTML = '';
    remoteVideos.innerHTML = '';
}

// === Присоединение к комнате ===
joinBtn.addEventListener('click', async () => {
    const roomName = roomIdInput.value.trim() || 'test-room';
    myName = peerNameInput.value.trim() || myName;

    if (currentChannel) {
        currentChannel.unsubscribe();
    }

    console.log(`Попытка подключения к комнате: ${roomName}`);

    currentChannel = supabase.channel(roomName, {
        config: { presence: { key: myPeerId } }
    });

    // Presence events
    currentChannel.on('presence', { event: 'sync' }, () => {
        console.log('Presence sync:', currentChannel.presenceState());
        updatePeersList();
    });

    currentChannel.on('presence', { event: 'join' }, ({ newPresences }) => {
        console.log('New peer joined:', newPresences);
        newPresences.forEach(p => {
            addMessage(`👋 ${p.name || 'Пользователь'} присоединился`, null);
        });
    });

    // Broadcast для чата
    currentChannel.on('broadcast', { event: 'chat' }, ({ payload }) => {
        if (payload.peerId !== myPeerId) {
            addMessage(payload.text, payload.peerId, false);
        }
    });

    // Подписка
    const status = await currentChannel.subscribe(async (subStatus, err) => {
        console.log('Subscribe status:', subStatus);
        if (err) console.error('Subscribe error:', err);

        if (subStatus === 'SUBSCRIBED') {
            console.log('✅ Успешно подключены к Supabase Realtime');

            await currentChannel.track({
                peerId: myPeerId,
                name: myName
            });

            updateUIAfterJoin();
        } else if (subStatus === 'CHANNEL_ERROR' || subStatus === 'TIMED_OUT') {
            addMessage('❌ Ошибка подключения к комнате. Проверьте консоль.', null, true);
        }
    });
});

// Отправка сообщения
sendMsgBtn.addEventListener('click', async () => {
    const text = messageInput.value.trim();
    if (!text || !currentChannel) return;

    await currentChannel.send({
        type: 'broadcast',
        event: 'chat',
        payload: { text, peerId: myPeerId }
    });

    addMessage(text, null, true);
    messageInput.value = '';
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMsgBtn.click();
});

// Выход из комнаты
leaveBtn.addEventListener('click', () => {
    if (currentChannel) {
        currentChannel.unsubscribe();
        currentChannel = null;
    }
    updateUIAfterLeave();
});

// Инициализация при загрузке
updateUIAfterLeave();
</script>
