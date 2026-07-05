const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const SpicyLDRGame = require('../gamelogic');

const app = express();

app.use(cors({
 origin: "*",
 methods: ["GET", "POST", "OPTIONS"],
 credentials: true
}));

app.use(express.json());

// Serve static files
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Load dares
const daresPath = path.join(__dirname, '../dares.json');
let dares = [];

try {
 const data = fs.readFileSync(daresPath, 'utf8');
 const parsed = JSON.parse(data);
 dares = parsed.dares || [];
 console.log(`✅ Loaded ${dares.length} dares`);
} catch (error) {
 console.error('Error loading dares:', error);
}

const games = {};
const gamePolling = {};

// ============================================
// API ROUTES
// ============================================

app.get('/api/health', (req, res) => {
 res.json({
  status: 'OK',
  games: Object.keys(games).length,
  timestamp: Date.now()
 });
});

app.get('/api/create-game/:playerName', (req, res) => {
 try {
  const roomId = uuidv4().substring(0, 6).toUpperCase();
  const playerId = uuidv4();
  const playerName = decodeURIComponent(req.params.playerName);

  const game = new SpicyLDRGame(roomId, playerId, playerName);
  games[roomId] = game;
  gamePolling[roomId] = { lastPoll: Date.now(), clients: {}, pendingResponses: {} };

  console.log(`✅ Game created: ${roomId} by ${playerName}`);

  res.json({
   success: true,
   roomId,
   playerId,
   playerName
  });
 } catch (error) {
  console.error('Error creating game:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

app.get('/api/join-game/:roomId/:playerName', (req, res) => {
 try {
  const roomId = req.params.roomId.toUpperCase();
  const playerName = decodeURIComponent(req.params.playerName);

  const game = games[roomId];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  if (Object.keys(game.players).length >= 2) {
   return res.status(400).json({ success: false, error: 'Game is full' });
  }

  const playerId = uuidv4();
  const success = game.addPlayer(playerId, playerName);

  if (!success) {
   return res.status(400).json({ success: false, error: 'Could not add player' });
  }

  console.log(`✅ Player ${playerName} joined room ${roomId}`);

  const playerIds = Object.keys(game.players);
  if (playerIds.length === 2) {
   playerIds.forEach(id => {
    game.setPlayerReady(id);
   });
   game.status = 'PLAYING';
   game.currentTurn = playerIds[0];
   console.log(`🎯 Game ${roomId} is now PLAYING!`);
  }

  res.json({
   success: true,
   roomId,
   playerId,
   playerName,
   gameState: game.getGameState()
  });
 } catch (error) {
  console.error('Error joining game:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// POLL endpoint - LONG POLLING
app.get('/api/poll', (req, res) => {
 try {
  const roomId = req.query.roomId?.toUpperCase();
  const playerId = req.query.playerId;
  const lastState = req.query.lastState || '';

  if (!roomId || !playerId) {
   return res.status(400).json({ success: false, error: 'Missing roomId or playerId' });
  }

  const game = games[roomId];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const player = game.players[playerId];
  if (!player) {
   return res.status(404).json({ success: false, error: 'Player not found' });
  }

  player.isConnected = true;

  if (!gamePolling[roomId]) {
   gamePolling[roomId] = { lastPoll: Date.now(), clients: {}, pendingResponses: {} };
  }
  gamePolling[roomId].clients[playerId] = Date.now();
  gamePolling[roomId].lastPoll = Date.now();

  const currentState = game.getGameState();
  const stateHash = JSON.stringify(currentState);

  console.log(`📡 Poll from ${player.name}, currentDare:`, currentState.currentDare?.text || 'none');

  // If state hasn't changed, hold the connection
  if (stateHash === lastState) {
   const timeout = setTimeout(() => {
    res.json({
     success: true,
     gameState: currentState,
     hasChanges: false,
     timestamp: Date.now()
    });
   }, 30000);

   gamePolling[roomId].pendingResponses[playerId] = { res, timeout };
   return;
  }

  // State changed - send the full state with currentDare
  console.log(`📤 Sending updated state to ${player.name}, dare:`, currentState.currentDare?.text);

  res.json({
   success: true,
   gameState: currentState,
   hasChanges: true,
   timestamp: Date.now()
  });

 } catch (error) {
  console.error('Error polling game:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Get game state
app.get('/api/state', (req, res) => {
 try {
  const roomId = req.query.roomId?.toUpperCase();
  const playerId = req.query.playerId;

  if (!roomId || !playerId) {
   return res.status(400).json({ success: false, error: 'Missing roomId or playerId' });
  }

  const game = games[roomId];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const player = game.players[playerId];
  if (!player) {
   return res.status(404).json({ success: false, error: 'Player not found' });
  }

  player.isConnected = true;

  const gameState = game.getGameState();
  console.log(`📊 State requested by ${player.name}, currentDare:`, gameState.currentDare?.text || 'none');

  res.json({
   success: true,
   gameState: gameState
  });

 } catch (error) {
  console.error('Error getting state:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Select square - BROADCAST to ALL players
app.post('/api/select-square', (req, res) => {
 try {
  const { roomId, playerId, squareIndex } = req.body;
  const room = roomId.toUpperCase();

  console.log(`🎯 Select square: room=${room}, player=${playerId}, square=${squareIndex}`);

  const game = games[room];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const result = game.selectSquare(playerId, squareIndex);

  if (result.error) {
   return res.status(400).json({ success: false, error: result.error });
  }

  // Get the updated game state (includes currentDare)
  const gameState = game.getGameState();

  console.log(`📤 Square selected! Dare:`, gameState.currentDare?.text || 'NONE');

  // BROADCAST to ALL pending polls - this is the key!
  if (gamePolling[room] && gamePolling[room].pendingResponses) {
   const pending = gamePolling[room].pendingResponses;
   const pendingCount = Object.keys(pending).length;
   console.log(`📤 Broadcasting to ${pendingCount} pending polls`);

   Object.keys(pending).forEach(pid => {
    const { res: pendingRes, timeout } = pending[pid];
    if (pendingRes && !pendingRes.headersSent) {
     clearTimeout(timeout);
     console.log(`📤 Sending to player ${pid}`);
     pendingRes.json({
      success: true,
      gameState: gameState,
      hasChanges: true,
      timestamp: Date.now()
     });
    }
    delete pending[pid];
   });
  }

  const gameOver = game.usedSquares.size >= game.totalSquares;
  if (gameOver) {
   game.status = 'FINISHED';
  }

  // Send response to the player who selected
  res.json({
   success: true,
   result: {
    squareIndex: result.squareIndex,
    dare: result.dare,
    playerId: result.playerId,
    playerName: result.playerName,
    remaining: result.remaining
   },
   gameState: gameState,
   gameOver
  });

 } catch (error) {
  console.error('Error selecting square:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

app.post('/api/skip-dare', (req, res) => {
 try {
  const { roomId, playerId } = req.body;
  const room = roomId.toUpperCase();

  const game = games[room];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const player = game.players[playerId];
  if (game.currentDare) {
   player.skippedDares.push(game.currentDare.id);
  }

  const playerIds = Object.keys(game.players);
  const currentIndex = playerIds.indexOf(game.currentTurn);
  game.currentTurn = playerIds[(currentIndex + 1) % playerIds.length];
  game.currentDare = null;
  game.currentDarePlayer = null;
  game.currentDareSquare = null;

  const gameState = game.getGameState();

  if (gamePolling[room] && gamePolling[room].pendingResponses) {
   const pending = gamePolling[room].pendingResponses;
   Object.keys(pending).forEach(pid => {
    const { res: pendingRes, timeout } = pending[pid];
    if (pendingRes && !pendingRes.headersSent) {
     clearTimeout(timeout);
     pendingRes.json({
      success: true,
      gameState: gameState,
      hasChanges: true,
      timestamp: Date.now()
     });
    }
    delete pending[pid];
   });
  }

  res.json({
   success: true,
   gameState: gameState
  });

 } catch (error) {
  console.error('Error skipping dare:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Serve HTML for root
app.get('/', (req, res) => {
 res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Cleanup
setInterval(() => {
 const now = Date.now();
 Object.keys(gamePolling).forEach(roomId => {
  const polling = gamePolling[roomId];
  if (polling && (now - polling.lastPoll) > 300000) {
   if (polling.pendingResponses) {
    Object.keys(polling.pendingResponses).forEach(pid => {
     const { res, timeout } = polling.pendingResponses[pid];
     if (res && !res.headersSent) {
      clearTimeout(timeout);
      res.status(408).json({ success: false, error: 'Timeout' });
     }
     delete polling.pendingResponses[pid];
    });
   }
   delete gamePolling[roomId];
  }
 });
}, 300000);

module.exports = app;