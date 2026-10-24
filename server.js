const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Game config ---
const ROUNDS = 10;        // first to 10 correct wins
const QUESTION_TIME = 15; // seconds per question

// --- State ---
const queue = [];         // waiting players: [socket]
const rooms = {};         // roomId -> room state

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeQuestion() {
  const ops = ['+', '-', '*', '/'];
  const op = ops[rand(0, 3)];
  let a, b, answer;
  if (op === '+') { a = rand(1, 50); b = rand(1, 50); answer = a + b; }
  else if (op === '-') { a = rand(10, 50); b = rand(1, a); answer = a - b; }
  else if (op === '*') { a = rand(2, 12); b = rand(2, 12); answer = a * b; }
  else { b = rand(1, 12); answer = rand(1, 12); a = b * answer; }
  const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  return { text: `${a} ${symbols[op]} ${b} = ?`, answer };
}

function startRoom(s1, s2) {
  const roomId = `room_${Date.now()}`;
  const question = makeQuestion();

  rooms[roomId] = {
    players: [
      { socket: s1, name: s1.playerName, score: 0 },
      { socket: s2, name: s2.playerName, score: 0 }
    ],
    question,
    answered: new Set(),
    timer: null,
    round: 1
  };

  s1.roomId = roomId;
  s2.roomId = roomId;
  s1.join(roomId);
  s2.join(roomId);

  const payload = {
    roomId,
    opponent: s2.playerName,
    question: question.text,
    round: 1,
    rounds: ROUNDS,
    timeLimit: QUESTION_TIME
  };
  s1.emit('game_start', { ...payload, opponent: s2.playerName });
  s2.emit('game_start', { ...payload, opponent: s1.playerName });

  startTimer(roomId);
}

function startTimer(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    // Time's up — no one answered, move to next question
    if (!rooms[roomId]) return;
    io.to(roomId).emit('question_timeout', { correctAnswer: room.question.answer });
    setTimeout(() => nextQuestion(roomId), 1500);
  }, QUESTION_TIME * 1000);
}

function nextQuestion(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Check win condition
  for (const p of room.players) {
    if (p.score >= ROUNDS) {
      endGame(roomId, p);
      return;
    }
  }

  room.question = makeQuestion();
  room.answered.clear();
  room.round++;

  io.to(roomId).emit('next_question', {
    question: room.question.text,
    round: room.round,
    scores: room.players.map(p => ({ name: p.name, score: p.score })),
    timeLimit: QUESTION_TIME
  });

  startTimer(roomId);
}

function endGame(roomId, winner) {
  const room = rooms[roomId];
  if (!room) return;
  clearTimeout(room.timer);
  io.to(roomId).emit('game_over', {
    winner: winner.name,
    scores: room.players.map(p => ({ name: p.name, score: p.score }))
  });
  // Clean up
  for (const p of room.players) {
    p.socket.leave(roomId);
    p.socket.roomId = null;
  }
  delete rooms[roomId];
}

// --- Socket events ---
io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  socket.on('join_queue', ({ name }) => {
    socket.playerName = name || 'Player';

    // If already in a room, ignore
    if (socket.roomId) return;

    // Remove any prior entry in queue
    const idx = queue.indexOf(socket);
    if (idx !== -1) queue.splice(idx, 1);

    queue.push(socket);
    socket.emit('queued', { position: queue.length });

    // Pair up if 2+ waiting
    if (queue.length >= 2) {
      const s1 = queue.shift();
      const s2 = queue.shift();
      startRoom(s1, s2);
    }
  });

  socket.on('submit_answer', ({ answer }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;
    if (room.answered.has(socket.id)) return; // already answered this round

    room.answered.add(socket.id);
    const correct = parseInt(answer, 10) === room.question.answer;

    if (correct) {
      const player = room.players.find(p => p.socket === socket);
      if (player) player.score++;
      clearTimeout(room.timer);

      io.to(roomId).emit('round_result', {
        correct: true,
        scorer: socket.playerName,
        correctAnswer: room.question.answer,
        scores: room.players.map(p => ({ name: p.name, score: p.score }))
      });

      setTimeout(() => nextQuestion(roomId), 1500);
    } else {
      socket.emit('wrong_answer', { correctAnswer: null }); // don't reveal yet
    }
  });

  socket.on('leave_queue', () => {
    const idx = queue.indexOf(socket);
    if (idx !== -1) queue.splice(idx, 1);
  });

  socket.on('disconnect', () => {
    // Remove from queue
    const idx = queue.indexOf(socket);
    if (idx !== -1) queue.splice(idx, 1);

    // Notify room opponent
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      clearTimeout(room.timer);
      io.to(roomId).emit('opponent_disconnected');
      for (const p of room.players) {
        p.socket.leave(roomId);
        p.socket.roomId = null;
      }
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
