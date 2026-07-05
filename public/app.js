// ============================================
// LDR SPICY GAME - HTTP Polling Version
// ============================================

let gameState = null;
let playerId = null;
let roomId = null;
let playerName = '';
let pollingActive = false;
let pollingTimeout = null;
let lastStateHash = '';
let pollCount = 0;

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
            showGameScreen();
            addHistory(`🎮 Game created! Share room code: ${roomId}`);
            showToast(`✅ Game created! Room: ${roomId}`);
            statusInfo.textContent = '⏳ Waiting for partner to join...';
            startPolling();
            fetchGameState();
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
            if (data.gameState) {
                gameState = data.gameState;
                lastStateHash = JSON.stringify(gameState);
                renderBoard();
                updateUI();
            }
            showGameScreen();
            addHistory(`🔗 Joined game: ${roomId}`);
            showToast(`✅ Joined room: ${roomId}`);
            statusInfo.textContent = '⏳ Waiting for game to start...';
            startPolling();
            fetchGameState();
        })
        .catch(err => {
            showToast('❌ Error joining game: ' + err.message);
        });
}

// ============================================
// HTTP POLLING
// ============================================

function startPolling() {
    if (pollingActive) return;
    pollingActive = true;
    pollCount = 0;
    pollForUpdates();
}

function stopPolling() {
    pollingActive = false;
    if (pollingTimeout) {
        clearTimeout(pollingTimeout);
        pollingTimeout = null;
    }
}

function pollForUpdates() {
    if (!pollingActive || !roomId || !playerId) {
        console.log('⏹️ Polling stopped');
        return;
    }

    pollCount++;

    let url = `/api/poll?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;
    if (lastStateHash) {
        url += `&lastState=${encodeURIComponent(lastStateHash)}`;
    }
    url += `&_=${Date.now()}`;

    console.log(`📡 Poll #${pollCount}`);

    fetch(url, {
        signal: AbortSignal.timeout(35000)
    })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (!data.success) {
                console.warn('Poll error:', data.error);
                setTimeout(pollForUpdates, 1000);
                return;
            }

            if (data.gameState) {
                const newHash = JSON.stringify(data.gameState);
                if (newHash !== lastStateHash || data.hasChanges) {
                    lastStateHash = newHash;
                    gameState = data.gameState;
                    renderBoard();
                    updateUI();
                    console.log('📊 Game state updated via poll');
                }
            }

            setTimeout(pollForUpdates, 100);
        })
        .catch(err => {
            if (err.name === 'AbortError') {
                console.log('⏱️ Poll timeout, retrying...');
                setTimeout(pollForUpdates, 100);
            } else {
                console.error('❌ Poll error:', err);
                setTimeout(pollForUpdates, 2000);
                if (pollCount > 5) {
                    showToast('⚠️ Connection issue, retrying...');
                }
            }
        });
}

function fetchGameState() {
    if (!roomId || !playerId) return;

    fetch(`/api/state?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                gameState = data.gameState;
                lastStateHash = JSON.stringify(gameState);
                renderBoard();
                updateUI();
            }
        })
        .catch(err => {
            console.error('Error fetching state:', err);
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
// BOARD RENDERER
// ============================================

function renderBoard() {
    const squareCount = 36;
    board.innerHTML = '';

    const usedSquares = new Set(gameState?.usedSquares || []);
    const isMyTurn = gameState?.currentTurn === playerId;
    const isPlaying = gameState?.status === 'PLAYING';
    const isFinished = gameState?.status === 'FINISHED';
    const canSelect = isMyTurn && isPlaying && !isFinished;

    console.log(`🎯 Rendering board: canSelect=${canSelect}, isMyTurn=${isMyTurn}, isPlaying=${isPlaying}`);

    for (let i = 0; i < squareCount; i++) {
        const square = document.createElement('div');
        square.className = 'square';
        square.dataset.index = i;

        const isUsed = usedSquares.has(i);
        if (isUsed) {
            square.classList.add('used');
        }

        const number = document.createElement('span');
        number.className = 'square-number';
        number.textContent = i + 1;
        square.appendChild(number);

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
// SQUARE DETAILS - FIXED
// ============================================

function displaySquareDetails(squareIndex, dare, playerName) {
    console.log('📋 Displaying square details:', { squareIndex, dare, playerName });

    if (!dare) {
        console.error('❌ No dare data provided!');
        squareDetailsContent.innerHTML = `
      <div class="empty-state">
        <div class="big-icon">❌</div>
        <p>Error: No dare data</p>
      </div>
    `;
        return;
    }

    squareNumberDisplay.textContent = `#${squareIndex + 1}`;

    squareDetailsContent.innerHTML = `
    <div class="dare-display">
      <div class="dare-text">${dare.text || 'No text available'}</div>
      <div class="dare-player">👤 Selected by: ${playerName || 'Unknown'}</div>
    </div>
  `;

    skipBtn.disabled = false;
    if (gameState) {
        gameState.currentDare = dare;
    }
}

// ============================================
// GAME ACTIONS - FIXED
// ============================================

function selectSquare(index) {
    if (!roomId || !playerId) {
        showToast('❌ Not connected to game');
        return;
    }

    console.log(`📍 Selecting square ${index + 1}`);

    const isMyTurn = gameState?.currentTurn === playerId;
    const isPlaying = gameState?.status === 'PLAYING';

    if (!isMyTurn || !isPlaying) {
        showToast('⏳ Not your turn!');
        return;
    }

    // Check if square is already used
    if (gameState?.usedSquares?.includes(index)) {
        showToast('❌ This square is already used!');
        return;
    }

    const squareElements = document.querySelectorAll('.square');
    squareElements.forEach(el => {
        el.style.pointerEvents = 'none';
    });

    showToast('⏳ Selecting square...');

    fetch('/api/select-square', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ roomId, playerId, squareIndex: index })
    })
        .then(res => res.json())
        .then(data => {
            console.log('📥 Select square response:', data);

            squareElements.forEach(el => {
                el.style.pointerEvents = '';
            });

            if (!data.success) {
                showToast('❌ ' + data.error);
                return;
            }

            // Update game state
            if (data.gameState) {
                gameState = data.gameState;
                lastStateHash = JSON.stringify(gameState);
                renderBoard();
                updateUI();
            }

            // Display the dare details
            if (data.result && data.result.dare) {
                console.log('🎯 Displaying dare:', data.result.dare);
                displaySquareDetails(
                    data.result.squareIndex || index,
                    data.result.dare,
                    gameState?.players?.[playerId]?.name || playerName
                );
                addHistory(`📍 ${playerName} picked square ${(data.result.squareIndex || index) + 1}`);
                showToast(`✅ Square ${(data.result.squareIndex || index) + 1} selected!`);
            } else {
                console.error('❌ No dare in response:', data);
                showToast('❌ Error: No dare data received');
            }

            if (data.gameOver) {
                showToast('🏆 Game Over! All squares used!');
                statusInfo.textContent = '🏆 Game Finished! Great job! 🎉';
                skipBtn.disabled = true;
            }
        })
        .catch(err => {
            console.error('❌ Select square error:', err);
            squareElements.forEach(el => {
                el.style.pointerEvents = '';
            });
            showToast('❌ Error: ' + err.message);
        });
}

function skipDare() {
    if (!roomId || !playerId) {
        showToast('❌ Not connected to game');
        return;
    }

    fetch('/api/skip-dare', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ roomId, playerId })
    })
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                showToast('❌ ' + data.error);
                return;
            }

            if (data.gameState) {
                gameState = data.gameState;
                lastStateHash = JSON.stringify(gameState);
                renderBoard();
                updateUI();
            }

            skipBtn.disabled = true;
            showToast('⏭️ Skipping dare...');

            squareDetailsContent.innerHTML = `
        <div class="empty-state">
          <div class="big-icon">⏭️</div>
          <p>Dare was skipped</p>
          <p class="sub-text">Click a new square</p>
        </div>
      `;
            squareNumberDisplay.textContent = '—';
        })
        .catch(err => {
            showToast('❌ Error: ' + err.message);
        });
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

window.addEventListener('beforeunload', () => {
    stopPolling();
});

console.log('🔥 LDR Spicy Game - HTTP Polling Mode loaded!');
console.log('❤️ Have fun and be safe!');
console.log('🎯 Click any square to reveal a dare!');