// ============================================
// LDR SPICY GAME - Pick & Play Mode
// ============================================

let socket = null;
let gameState = null;
let playerId = null;
let roomId = null;
let playerName = '';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const board = document.getElementById('board');
const roomIdDisplay = document.getElementById('room-id');
const turnNameDisplay = document.getElementById('turn-name');
const usedSquaresDisplay = document.getElementById('used-squares');
const totalSquaresDisplay = document.getElementById('total-squares');
const squareDetailsContent = document.getElementById('square-details-content');
const squareNumberDisplay = document.getElementById('square-number');
const skipBtn = document.getElementById('skip-btn');
const historyList = document.getElementById('history-list');
const historyCount = document.getElementById('history-count');
const statusInfo = document.getElementById('status-info');

// ============================================
// GAME FUNCTIONS
// ============================================

function createGame() {
    const name = document.getElementById('create-name').value.trim();
    if (!name) {
        showToast('Please enter your name');
        return;
    }
    if (name.length > 20) {
        showToast('Name must be 20 characters or less');
        return;
    }

    playerName = name;
    const apiUrl = `/api/create-game/${encodeURIComponent(name)}`;

    showToast('⏳ Creating game...');

    fetch(apiUrl)
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                showToast('Error: ' + data.error);
                return;
            }
            playerId = data.playerId;
            roomId = data.roomId;
            initializeSocket();
            showGameScreen();
            addHistory(`🎮 Game created! Share room code: ${roomId}`);
            showToast(`✅ Game created! Room: ${roomId}`);
            statusInfo.textContent = '⏳ Waiting for partner to join...';
        })
        .catch(err => {
            showToast('❌ Error creating game: ' + err.message);
        });
}

function joinGame() {
    const name = document.getElementById('join-name').value.trim();
    const room = document.getElementById('join-room').value.trim().toUpperCase();

    if (!name) {
        showToast('Please enter your name');
        return;
    }
    if (!room || room.length !== 6) {
        showToast('Please enter a valid 6-character room code');
        return;
    }

    playerName = name;
    roomId = room;

    showToast('⏳ Joining game...');

    fetch(`/api/join-game/${room}/${encodeURIComponent(name)}`)
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                showToast('Error: ' + data.error);
                return;
            }
            playerId = data.playerId;
            initializeSocket();
            showGameScreen();
            addHistory(`🔗 Joined game: ${roomId}`);
            showToast(`✅ Joined room: ${roomId}`);
            statusInfo.textContent = '⏳ Waiting for game to start...';
        })
        .catch(err => {
            showToast('❌ Error joining game: ' + err.message);
        });
}

// ============================================
// SOCKET.IO CONNECTION
// ============================================

function initializeSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    // Get the current host
    const host = window.location.host;
    const protocol = window.location.protocol;

    // Connect with proper configuration
    socket = io({
        transports: ['polling', 'websocket'],
        upgrade: true,
        rememberUpgrade: true,
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 60000,
        autoConnect: true,
        forceNew: true,
        path: '/socket.io'
    });

    socket.on('connect', () => {
        console.log('✅ Connected to server!');
        showToast('✅ Connected to server!');
        // Re-join room if we have roomId and playerId
        if (roomId && playerId) {
            socket.emit('join-room', { roomId, playerId });
        }
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error);
        showToast('⏳ Reconnecting...');
    });

    socket.on('disconnect', (reason) => {
        console.log('🔌 Disconnected:', reason);
        if (reason === 'io server disconnect') {
            socket.connect();
        }
        showToast('⚠️ Disconnected. Reconnecting...');
    });

    socket.on('reconnect', () => {
        console.log('🔄 Reconnected!');
        showToast('✅ Reconnected!');
        if (roomId && playerId) {
            socket.emit('join-room', { roomId, playerId });
        }
    });
}

// ============================================
// UI UPDATES
// ============================================

function showGameScreen() {
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'block';
    roomIdDisplay.textContent = roomId;
    totalSquaresDisplay.textContent = '36';
}

function updateUI() {
    if (!gameState) return;

    const players = gameState.players || {};
    const playerIds = Object.keys(players);

    playerIds.forEach((id, index) => {
        const player = players[id];
        const card = document.getElementById(`player${index + 1}-card`);
        if (card && player) {
            card.querySelector('.player-name').textContent = player.name || 'Player';
            card.querySelector('.player-squares').textContent = `📦 Picked: ${player.squaresPicked || 0}`;
            card.querySelector('.player-dares').textContent = `✅ Dares: ${player.completedDares?.length || 0}`;
            const avatar = card.querySelector('.player-avatar');
            if (avatar) avatar.textContent = id === playerId ? '🔴' : '🔵';
            card.classList.toggle('current-turn', id === gameState.currentTurn);
        }
    });

    turnNameDisplay.textContent = gameState.currentTurnName || 'Waiting...';
    usedSquaresDisplay.textContent = gameState.usedSquares?.length || 0;

    const statusMap = {
        'WAITING': '⏳ Waiting for players...',
        'PLAYING': '🎯 Pick a square!',
        'FINISHED': '🏆 Game Finished!'
    };
    statusInfo.textContent = statusMap[gameState.status] || gameState.status;

    const isFinished = gameState.status === 'FINISHED';
    skipBtn.disabled = isFinished || !gameState.currentDare;
}

// ============================================
// BOARD RENDERER - No Icons, All Identical
// ============================================

function renderBoard() {
    const squareCount = 36;
    board.innerHTML = '';

    const usedSquares = new Set(gameState?.usedSquares || []);
    const isMyTurn = gameState?.currentTurn === playerId;
    const isPlaying = gameState?.status === 'PLAYING';
    const isFinished = gameState?.status === 'FINISHED';
    const canSelect = isMyTurn && isPlaying && !isFinished;

    console.log(`🎯 Rendering board: canSelect=${canSelect}, isMyTurn=${isMyTurn}, isPlaying=${isPlaying}, used=${usedSquares.size}`);

    for (let i = 0; i < squareCount; i++) {
        const square = document.createElement('div');
        square.className = 'square';
        square.dataset.index = i;

        const isUsed = usedSquares.has(i);
        if (isUsed) {
            square.classList.add('used');
        }

        // Only show the square number - no icons, no categories
        const number = document.createElement('span');
        number.className = 'square-number';
        number.textContent = i + 1;
        square.appendChild(number);

        // Mysterious question mark for unused squares
        if (!isUsed) {
            const mystery = document.createElement('span');
            mystery.className = 'mystery-icon';
            mystery.textContent = '❓';
            square.appendChild(mystery);
        }

        if (!isUsed) {
            square.style.cursor = canSelect ? 'pointer' : 'not-allowed';
            if (canSelect) {
                square.classList.remove('disabled');
                square.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const index = parseInt(this.dataset.index);
                    console.log(`🖱️ Clicked square ${index + 1}`);
                    selectSquare(index);
                });
            } else {
                square.classList.add('disabled');
            }
        } else {
            square.style.cursor = 'default';
        }

        board.appendChild(square);
    }
}

// ============================================
// SQUARE DETAILS DISPLAY
// ============================================

function displaySquareDetails(squareIndex, dare, playerName) {
    squareNumberDisplay.textContent = `#${squareIndex + 1}`;

    squareDetailsContent.innerHTML = `
        <div class="dare-display">
            <div class="dare-text">${dare.text}</div>
            <div class="dare-player">👤 Selected by: ${playerName}</div>
        </div>
    `;

    skipBtn.disabled = false;
    gameState.currentDare = dare;
}

// ============================================
// GAME ACTIONS
// ============================================

function selectSquare(index) {
    if (!socket || !socket.connected) {
        showToast('❌ Not connected to server');
        return;
    }

    console.log(`📍 Sending select-square for index ${index}`);
    socket.emit('select-square', { squareIndex: index });
}

function skipDare() {
    if (socket && socket.connected) {
        socket.emit('skip-dare');
        skipBtn.disabled = true;
        showToast('⏭️ Skipping dare...');
    }
}

// ============================================
// HELPERS
// ============================================

function addHistory(message) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const time = new Date().toLocaleTimeString();
    item.innerHTML = `<span class="time">${time}</span>${message}`;
    historyList.prepend(item);

    while (historyList.children.length > 100) {
        historyList.removeChild(historyList.lastChild);
    }

    const historyItems = document.querySelectorAll('.history-item');
    historyCount.textContent = `${historyItems.length} events`;
}

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.9);
        color: #fff;
        padding: 12px 24px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.1);
        font-size: 0.95rem;
        z-index: 9999;
        animation: fadeIn 0.3s ease-out;
        max-width: 90%;
        text-align: center;
        backdrop-filter: blur(10px);
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && loginScreen.style.display !== 'none') {
        if (document.activeElement === document.getElementById('create-name')) {
            createGame();
        } else if (document.activeElement === document.getElementById('join-name') ||
            document.activeElement === document.getElementById('join-room')) {
            joinGame();
        }
    }
});

(function autoJoinFromURL() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const name = params.get('name');

    if (room && name) {
        document.getElementById('join-name').value = name;
        document.getElementById('join-room').value = room;
        setTimeout(joinGame, 500);
    }
})();

console.log('🔥 LDR Spicy Game - Pick & Play Mode loaded!');
console.log('❤️ Have fun and be safe!');
console.log('🎯 Click any square to reveal a dare!');