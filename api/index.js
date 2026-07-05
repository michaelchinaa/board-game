const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const SpicyLDRGame = require('../gamelogic');

const app = express();

app.use(cors({
 origin: "*",
 methods: ["GET", "POST"],
 credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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

// Store games in memory
const games = {};
const gamePolling = {}; // Track last poll time per game

// Health check
app.get('/api/health', (req, res) => {
 res.json({
  status: 'OK',
  games: Object.keys(games).length,
  timestamp: Date.now()
 });
});

// Create game
app.get('/api/create-game/:playerName', (req, res) => {
 try {
  const roomId = uuidv4().substring(0, 6).toUpperCase();
  const playerId = uuidv4();
  const playerName = decodeURIComponent(req.params.playerName);

  const game = new SpicyLDRGame(roomId, playerId, playerName);
  games[roomId] = game;
  gamePolling[roomId] = { lastPoll: Date.now(), clients: {} };

  console.log(`✅ Game created: ${roomId} by ${playerName}`);

  res.json({
   success: true,
   roomId,
   playerId,
   playerName,
   message: `Game created! Share room code: ${roomId}`
  });
 } catch (error) {
  console.error('Error creating game:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Join game
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

  // Check if both players are ready
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
   gameState: game.getGameState(),
   message: `Joined game: ${roomId}`
  });
 } catch (error) {
  console.error('Error joining game:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Poll for game state (LONG POLLING)
app.get('/api/poll/:roomId/:playerId', (req, res) => {
 try {
  const roomId = req.params.roomId.toUpperCase();
  const playerId = req.params.playerId;
  const lastState = req.query.lastState || '0';

  const game = games[roomId];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const player = game.players[playerId];
  if (!player) {
   return res.status(404).json({ success: false, error: 'Player not found' });
  }

  // Mark player as connected
  player.isConnected = true;

  // Update polling tracking
  if (!gamePolling[roomId]) {
   gamePolling[roomId] = { lastPoll: Date.now(), clients: {} };
  }
  gamePolling[roomId].clients[playerId] = Date.now();
  gamePolling[roomId].lastPoll = Date.now();

  // Get current game state
  const currentState = game.getGameState();
  const stateHash = JSON.stringify(currentState);

  // If state hasn't changed, hold the connection (long polling)
  if (stateHash === lastState) {
   // Wait up to 30 seconds for changes
   const timeout = setTimeout(() => {
    // Send current state (no changes)
    res.json({
     success: true,
     gameState: currentState,
     hasChanges: false,
     timestamp: Date.now()
    });
   }, 30000);

   // Store the response object for later
   if (!gamePolling[roomId].pendingResponses) {
    gamePolling[roomId].pendingResponses = {};
   }
   gamePolling[roomId].pendingResponses[playerId] = { res, timeout };

   return;
  }

  // State changed, send immediately
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

// Select square
app.post('/api/select-square/:roomId', (req, res) => {
 try {
  const roomId = req.params.roomId.toUpperCase();
  const { playerId, squareIndex } = req.body;

  const game = games[roomId];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const result = game.selectSquare(playerId, squareIndex);

  if (result.error) {
   return res.status(400).json({ success: false, error: result.error });
  }

  // Resolve any pending polls for this room
  if (gamePolling[roomId] && gamePolling[roomId].pendingResponses) {
   const pending = gamePolling[roomId].pendingResponses;
   Object.keys(pending).forEach(pid => {
    const { res: pendingRes, timeout } = pending[pid];
    if (pendingRes && !pendingRes.headersSent) {
     clearTimeout(timeout);
     pendingRes.json({
      success: true,
      gameState: game.getGameState(),
      hasChanges: true,
      timestamp: Date.now()
     });
    }
    delete pending[pid];
   });
  }

  // Check if game is over
  const gameOver = game.usedSquares.size >= game.totalSquares;
  if (gameOver) {
   game.status = 'FINISHED';
  }

  res.json({
   success: true,
   result,
   gameState: game.getGameState(),
   gameOver
  });

 } catch (error) {
  console.error('Error selecting square:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Skip dare
app.post('/api/skip-dare/:roomId', (req, res) => {
 try {
  const roomId = req.params.roomId.toUpperCase();
  const { playerId } = req.body;

  const game = games[roomId];
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

  // Resolve any pending polls
  if (gamePolling[roomId] && gamePolling[roomId].pendingResponses) {
   const pending = gamePolling[roomId].pendingResponses;
   Object.keys(pending).forEach(pid => {
    const { res: pendingRes, timeout } = pending[pid];
    if (pendingRes && !pendingRes.headersSent) {
     clearTimeout(timeout);
     pendingRes.json({
      success: true,
      gameState: game.getGameState(),
      hasChanges: true,
      timestamp: Date.now()
     });
    }
    delete pending[pid];
   });
  }

  res.json({
   success: true,
   gameState: game.getGameState()
  });

 } catch (error) {
  console.error('Error skipping dare:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Get game state (fallback)
app.get('/api/state/:roomId/:playerId', (req, res) => {
 try {
  const roomId = req.params.roomId.toUpperCase();
  const playerId = req.params.playerId;

  const game = games[roomId];
  if (!game) {
   return res.status(404).json({ success: false, error: 'Game not found' });
  }

  const player = game.players[playerId];
  if (!player) {
   return res.status(404).json({ success: false, error: 'Player not found' });
  }

  player.isConnected = true;

  res.json({
   success: true,
   gameState: game.getGameState()
  });

 } catch (error) {
  console.error('Error getting state:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Cleanup inactive games (runs every 5 minutes)
setInterval(() => {
 const now = Date.now();
 Object.keys(gamePolling).forEach(roomId => {
  const polling = gamePolling[roomId];
  if (polling && (now - polling.lastPoll) > 300000) { // 5 minutes
   // Clean up pending responses
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