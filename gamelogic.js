const fs = require('fs');
const path = require('path');

class SpicyLDRGame {
 constructor(roomId, player1Id, player1Name) {
  this.roomId = roomId;
  this.players = {
   [player1Id]: {
    id: player1Id,
    name: player1Name,
    position: 0,
    completedDares: [],
    skippedDares: [],
    isReady: false,
    isConnected: true,
    squaresPicked: 0
   }
  };
  this.currentTurn = player1Id;
  this.status = 'WAITING';
  this.currentDare = null;
  this.currentDarePlayer = null;
  this.currentDareSquare = null;
  this.gameHistory = [];
  this.dares = this.loadDares();
  this.board = this.generateRandomBoard();
  this.roundNumber = 0;
  this.startTime = Date.now();
  this.totalSquares = 36;
  this.usedSquares = new Set();
 }

 loadDares() {
  try {
   const daresFile = path.join(__dirname, 'dares.json');
   const data = fs.readFileSync(daresFile, 'utf8');
   const parsed = JSON.parse(data);
   return parsed.dares || [];
  } catch (error) {
   console.error('Error loading dares:', error);
   return [];
  }
 }

 generateRandomBoard() {
  const dares = [...this.dares];
  for (let i = dares.length - 1; i > 0; i--) {
   const j = Math.floor(Math.random() * (i + 1));
   [dares[i], dares[j]] = [dares[j], dares[i]];
  }

  const board = {};
  for (let i = 1; i <= 36; i++) {
   const dareIndex = (i - 1) % dares.length;
   board[i] = {
    dareId: dares[dareIndex].id
   };
  }
  return board;
 }

 addPlayer(playerId, playerName) {
  if (!this.players[playerId] && Object.keys(this.players).length < 2) {
   this.players[playerId] = {
    id: playerId,
    name: playerName,
    position: 0,
    completedDares: [],
    skippedDares: [],
    isReady: false,
    isConnected: true,
    squaresPicked: 0
   };
   return true;
  }
  return false;
 }

 setPlayerReady(playerId) {
  if (this.players[playerId]) {
   this.players[playerId].isReady = true;
   return true;
  }
  return false;
 }

 selectSquare(playerId, squareIndex) {
  console.log(`📍 Player ${playerId} selecting square ${squareIndex}`);
  console.log(`Current status: ${this.status}, used squares: ${Array.from(this.usedSquares)}`);

  if (this.status === 'FINISHED') {
   return { error: 'Game is finished' };
  }

  if (this.currentTurn !== playerId) {
   return { error: 'Not your turn' };
  }

  if (this.status !== 'PLAYING') {
   return { error: 'Game not started yet' };
  }

  if (this.usedSquares.has(squareIndex)) {
   return { error: 'This square has already been used!' };
  }

  const player = this.players[playerId];
  const squareData = this.board[(squareIndex + 1).toString()];

  console.log(`Square data for index ${squareIndex + 1}:`, squareData);

  if (!squareData) {
   return { error: 'Invalid square' };
  }

  const dare = this.dares.find(d => d.id === squareData.dareId);

  if (!dare) {
   return { error: 'No dare found for this square' };
  }

  this.usedSquares.add(squareIndex);
  player.squaresPicked = (player.squaresPicked || 0) + 1;
  player.completedDares.push(dare.id);

  // Store the current dare with ALL details
  this.currentDare = {
   id: dare.id,
   text: dare.text
  };
  this.currentDarePlayer = playerId;
  this.currentDareSquare = squareIndex;

  this.roundNumber++;

  this.gameHistory.push({
   type: 'PICK',
   playerId: playerId,
   playerName: player.name,
   square: squareIndex + 1,
   dare: dare.text,
   dareId: dare.id,
   timestamp: Date.now()
  });

  const remaining = this.totalSquares - this.usedSquares.size;
  const gameOver = this.usedSquares.size >= this.totalSquares;

  if (!gameOver) {
   const playerIds = Object.keys(this.players);
   const currentIndex = playerIds.indexOf(this.currentTurn);
   this.currentTurn = playerIds[(currentIndex + 1) % playerIds.length];
   console.log(`Turn switched to ${this.players[this.currentTurn].name}`);
  } else {
   this.status = 'FINISHED';
  }

  return {
   dare: this.currentDare,
   squareIndex,
   playerId: playerId,
   playerName: player.name,
   remaining,
   gameOver,
   nextTurn: this.currentTurn,
   message: gameOver ? 'All squares used!' : `It's ${this.players[this.currentTurn].name}'s turn`
  };
 }

 getGameState() {
  return {
   roomId: this.roomId,
   players: this.players,
   currentTurn: this.currentTurn,
   currentTurnName: this.players[this.currentTurn]?.name || 'Unknown',
   status: this.status,
   currentDare: this.currentDare,
   currentDarePlayer: this.currentDarePlayer,
   currentDareSquare: this.currentDareSquare,
   roundNumber: this.roundNumber,
   board: this.board,
   usedSquares: Array.from(this.usedSquares),
   totalSquares: this.totalSquares,
   remainingSquares: this.totalSquares - this.usedSquares.size,
   gameHistory: this.gameHistory.slice(-10),
   isFinished: this.status === 'FINISHED',
   playerCount: Object.keys(this.players).length
  };
 }
}

module.exports = SpicyLDRGame;