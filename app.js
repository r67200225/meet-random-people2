const $ = (id) => document.getElementById(id);
const localV = $('local'), remoteV = $('remote'), statusEl = $('status');
const logEl = $('log'), msgIn = $('msg'), sendBtn = $('send');
const nextBtn = $('next'), reportBtn = $('report');

let socket, pc, localStream, iceServers = [], started = false, connected = false;

// ---------- age gate ----------
$('agree').onchange = (e) => ($('enter').disabled = !e.target.checked);
$('enter').onclick = () => { localStorage.setItem('ok18', '1'); $('gate').style.display = 'none'; };
if (localStorage.getItem('ok18') === '1') $('gate').style.display = 'none';

// ---------- helpers ----------
const setStatus = (t) => { statusEl.textContent = t; statusEl.classList.toggle('hide', !t); };
function addMsg(text, cls) {
  const d = document.createElement('div');
  d.className = 'm ' + cls; d.textContent = text;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
}
function setChatEnabled(on) { msgIn.disabled = sendBtn.disabled = reportBtn.disabled = !on; }

function cleanup() {
  connected = false;
  if (pc) { pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = null; pc.close(); pc = null; }
  remoteV.srcObject = null;
  setChatEnabled(false);
}

function createPC() {
  pc = new RTCPeerConnection({ iceServers });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.ontrack = (e) => { remoteV.srcObject = e.streams[0]; setStatus(''); };
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('signal', { candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (pc && (pc.connectionState === 'failed')) { addMsg('Connection failed. Finding next…', 'sys'); next(); }
  };
}

// ---------- main flow ----------
async function begin() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
  } catch (e) {
    setStatus('Camera/microphone permission is required.'); return;
  }
  localV.srcObject = localStream;
  iceServers = (await (await fetch('/config')).json()).iceServers;
  initSocket();
  started = true;
  nextBtn.textContent = 'Next';
  socket.emit('find');
  setStatus('Looking for someone…');
}

function initSocket() {
  socket = io();
  socket.on('online', (n) => ($('online').textContent = '● ' + n + ' online'));
  socket.on('waiting', () => { cleanup(); setStatus('Looking for someone…'); });

  socket.on('matched', async ({ initiator }) => {
    cleanup(); logEl.innerHTML = '';
    connected = true; setChatEnabled(true);
    addMsg('You are connected. Say hi!', 'sys');
    setStatus('Connecting…');
    createPC();
    if (initiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { description: pc.localDescription });
    }
  });

  socket.on('signal', async (data) => {
    if (!pc) return;
    try {
      if (data.description) {
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { description: pc.localDescription });
        }
      } else if (data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (e) { console.warn(e); }
  });

  socket.on('chat', (m) => addMsg(m, 'them'));
  socket.on('partner-left', () => {
    cleanup(); addMsg('Stranger disconnected.', 'sys');
    setStatus('Stranger left. Finding someone new…');
    socket.emit('find');
  });
  socket.on('reported', () => addMsg('Report sent. Thank you.', 'sys'));
  socket.on('banned', () => {
    cleanup(); setStatus('You have been temporarily banned for violating the rules.');
    socket.disconnect();
  });
}

function next() {
  if (!started) return begin();
  cleanup(); logEl.innerHTML = '';
  setStatus('Looking for someone…');
  socket.emit('next');
}

// ---------- UI events ----------
nextBtn.onclick = next;
reportBtn.onclick = () => { if (connected && confirm('Report this user and move on?')) { cleanup(); setStatus('Looking for someone…'); socket.emit('report'); } };
function send() {
  const t = msgIn.value.trim();
  if (!t || !connected) return;
  socket.emit('chat', t); addMsg(t, 'me'); msgIn.value = '';
}
sendBtn.onclick = send;
msgIn.onkeydown = (e) => { if (e.key === 'Enter') send(); };

$('mute').onclick = (e) => {
  if (!localStream) return;
  const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled;
  e.target.textContent = t.enabled ? 'Mute' : 'Unmute';
};
$('cam').onclick = (e) => {
  if (!localStream) return;
  const t = localStream.getVideoTracks()[0]; t.enabled = !t.enabled;
  e.target.textContent = t.enabled ? 'Camera off' : 'Camera on';
};
