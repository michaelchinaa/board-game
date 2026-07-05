const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const SpicyLDRGame = require('../gamelogic');

const app = express();
const server = createServer(app);

// Configure Socket.IO for Vercel
const io = new Server(server, {
 cors: {
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
 },
 transports: ['polling'],
 allowEIO3: true,
 pingTimeout: 60000,
 pingInterval: 25000,
 cookie: false,
 path: '/socket.io',
 // Add these for better compatibility
 allowUpgrades: false,
 upgrade: false
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/api/health', (req, res) => {
 res.json({
  status: 'OK',
  games: Object.keys(games).length,
  connections: Object.keys(playerSessions).length
 });
});

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
const playerSessions = {};

// API Routes
app.get('/api/create-game/:playerName', (req, res) => {
 try {
  const roomId = uuidv4().substring(0, 6).toUpperCase();
  const playerId = uuidv4();
  const playerName = decodeURIComponent(req.params.playerName);

  const game = new SpicyLDRGame(roomId, playerId, playerName);
  games[roomId] = game;

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

  res.json({
   success: true,
   roomId,
   playerId,
   playerName,
   message: `Joined game: ${roomId}`
  });
 } catch (error) {
  console.error('Error joining game:', error);
  res.status(500).json({ success: false, error: error.message });
 }
});

// Socket.IO Events
io.on('connection', (socket) => {
 console.log(`🔌 Client connected: ${socket.id}`);

 socket.emit('connected', {
  message: 'Connected to server!',
  socketId: socket.id
 });

 socket.on('join-room', ({ roomId, playerId }) => {
  const room = roomId.toUpperCase();
  const game = games[room];

  console.log(`📥 Join room request: ${room} from ${playerId}`);

  if (!game) {
   socket.emit('error', 'Game not found');
   return;
  }

  const player = game.players[playerId];
  if (!player) {
   socket.emit('error', 'Player not found');
   return;
  }

  socket.join(room);
  socket.data.roomId = room;
  socket.data.playerId = playerId;
  playerSessions[socket.id] = { roomId: room, playerId };

  player.isConnected = true;

  console.log(`✅ ${player.name} joined room ${room}`);

  socket.emit('game-state', game.getGameState());
  io.to(room).emit('game-state', game.getGameState());

  socket.to(room).emit('player-joined', {
   playerId,
   playerName: player.name,
   message: `${player.name} has joined!`
  });

  const playerIds = Object.keys(game.players);
  if (playerIds.length === 2) {
   console.log(`🎮 Room ${room} has both players!`);

   playerIds.forEach(id => {
    game.setPlayerReady(id);
   });

   game.status = 'PLAYING';
   game.currentTurn = playerIds[0];

   console.log(`🎯 Game ${room} is now PLAYING! First turn: ${game.players[playerIds[0]].name}`);

   io.to(room).emit('game-state', game.getGameState());
   io.to(room).emit('game-ready', {
    message: 'Both players are ready! Click any square to start! 🎉'
   });
  }
 });

 socket.on('select-square', ({ squareIndex }) => {
  const { roomId, playerId } = socket.data;
  const game = games[roomId];

  if (!game) {
   socket.emit('error', 'Game not found');
   return;
  }

  console.log(`📍 ${game.players[playerId]?.name} selected square ${squareIndex + 1}`);

  const result = game.selectSquare(playerId, squareIndex);

  if (result.error) {
   socket.emit('error', result.error);
   return;
  }

  io.to(roomId).emit('game-state', game.getGameState());
  io.to(roomId).emit('square-selected', {
   playerId,
   playerName: game.players[playerId].name,
   squareIndex,
   dare: result.dare,
   remaining: result.remaining
  });

  if (result.gameOver) {
   io.to(roomId).emit('game-finished', {
    message: 'All squares have been used! Game Over! 🎉'
   });
  }
 });

 socket.on('skip-dare', () => {
  const { roomId, playerId } = socket.data;
  const game = games[roomId];

  if (!game) {
   socket.emit('error', 'Game not found');
   return;
  }

  const player = game.players[playerId];
  if (game.currentDare) {
   player.skippedDares.push(game.currentDare.id);
  }

  const playerIds = Object.keys(game.players);
  const currentIndex = playerIds.indexOf(game.currentTurn);
  game.currentTurn = playerIds[(currentIndex + 1) % playerIds.length];
  game.currentDare = null;

  io.to(roomId).emit('game-state', game.getGameState());
  io.to(roomId).emit('dare-skipped', {
   playerId,
   playerName: player.name,
   message: `${player.name} skipped the dare!`
  });
 });

 socket.on('disconnect', () => {
  console.log(`🔌 Client disconnected: ${socket.id}`);

  if (playerSessions[socket.id]) {
   const { roomId, playerId } = playerSessions[socket.id];
   const game = games[roomId];

   if (game && game.players[playerId]) {
    game.players[playerId].isConnected = false;

    io.to(roomId).emit('player-disconnected', {
     playerId,
     playerName: game.players[playerId].name,
     message: `${game.players[playerId].name} has disconnected`
    });

    io.to(roomId).emit('game-state', game.getGameState());
   }

   delete playerSessions[socket.id];
  }
 });
});

// Export for Vercel
module.exports = server;