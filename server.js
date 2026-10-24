const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const BAN_MS = 24 * 60 * 60 * 1000;     // ban length
const REPORTS_TO_BAN = 3;               // unique reporters before auto-ban

// STUN is free; for real-world reliability you MUST add a TURN server (see README).
// Example: ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
let ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
if (process.env.ICE_SERVERS) {
  try { ICE = JSON.parse(process.env.ICE_SERVERS); } catch (e) { console.error('Bad ICE_SERVERS JSON'); }
}

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20000 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/config', (req, res) => res.json({ iceServers: ICE }));
app.get('/health', (req, res) => res.send('ok'));

const waiting = [];                 // sockets waiting for a partner
const bans = new Map();             // ip -> expiry timestamp
const reports = new Map();          // ip -> Set of reporter ips

const getIp = (s) =>
  (s.handshake.headers['x-forwarded-for'] || s.handshake.address || '').split(',')[0].trim();

const isBanned = (ip) => {
  const t = bans.get(ip);
  if (!t) return false;
  if (Date.now() > t) { bans.delete(ip); return false; }
  return true;
};
app.get('/', (req, res) =>{
  res.sendFile(path.join(__dirname, 'index.html'));
  
});
// route file
app.get('/', (res, req) =>{
  res.send('Server is running ')
})

const removeFromQueue = (s) => {
  const i = waiting.indexOf(s);
  if (i !== -1) waiting.splice(i, 1);
};

const broadcastCount = () => io.emit('online', io.engine.clientsCount);

function leavePartner(s, notify = true) {
  const p = s.partner;
  if (p) {
    s.partner = null;
    if (p.partner === s) {
      p.partner = null;
      if (notify) p.emit('partner-left');
    }
  }
}

function findMatch(s) {
  removeFromQueue(s);
  leavePartner(s);
  if (isBanned(s.ip)) { s.emit('banned'); return; }

  while (waiting.length) {
    const other = waiting.shift();
    if (other === s || !other.connected || (process.env.BLOCK_SAME_IP === '1' && other.ip === s.ip)) {
      if (other !== s && other.connected) waiting.push(other); // keep same-IP users queued
      if (waiting.length && waiting.every(w => w.ip === s.ip)) break;
      continue;
    }
    s.partner = other;
    other.partner = s;
    s.emit('matched', { initiator: true });
    other.emit('matched', { initiator: false });
    return;
  }
  waiting.push(s);
  s.emit('waiting');
}

io.on('connection', (socket) => {
  socket.ip = getIp(socket);
  socket.partner = null;
  socket.msgCount = 0;
  broadcastCount();

  const limiter = setInterval(() => { socket.msgCount = 0; }, 5000);

  socket.on('find', () => findMatch(socket));

  socket.on('next', () => {
    leavePartner(socket);
    findMatch(socket);
  });

  socket.on('signal', (data) => {
    if (socket.partner && data && typeof data === 'object') socket.partner.emit('signal', data);
  });

  socket.on('chat', (msg) => {
    if (!socket.partner || typeof msg !== 'string') return;
    if (++socket.msgCount > 15) return;                 // rate limit
    socket.partner.emit('chat', msg.slice(0, 500));
  });

  socket.on('report', () => {
    const p = socket.partner;
    if (!p) return;
    const set = reports.get(p.ip) || new Set();
    set.add(socket.ip);
    reports.set(p.ip, set);
    console.log(`REPORT against ${p.ip} (${set.size})`);
    if (set.size >= REPORTS_TO_BAN) {
      bans.set(p.ip, Date.now() + BAN_MS);
      reports.delete(p.ip);
      p.emit('banned');
      leavePartner(p, false);
      p.disconnect(true);
    }
    socket.emit('reported');
    leavePartner(socket);
    findMatch(socket);
  });

  socket.on('disconnect', () => {
    clearInterval(limiter);
    removeFromQueue(socket);
    leavePartner(socket);
    broadcastCount();
  });
});

server.listen(PORT, () => console.log(`Video chat running on port ${PORT}`));
