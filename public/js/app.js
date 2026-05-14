// ============================================================
// app.js — Polling 2s, diff DOM, editRoles unifié
// ============================================================

const AVATARS = [
  '🧑','👩','👨','🧔','👱','👴','👵','🧒',
  '🦸','🦹','🧙','🧝','🧛','👻','🤖','👾',
  '🐱','🐶','🦊','🐸','🐼','🐧','🦉','🦋',
  '🍎','🍕','🎮','💀','👁️','🌙','⚡','🔥'
];

function getOrCreateId() {
  let id = localStorage.getItem('_pid');
  if (!id) {
    id = 'p_' + Math.random().toString(36).substring(2, 12);
    localStorage.setItem('_pid', id);
  }
  return id;
}

const S = {
  playerId:         getOrCreateId(),
  myName:           null,
  myAvatar:         '🧑',
  roomCode:         null,
  hostId:           null,
  phase:            'lobby',
  players:          [],
  messages:         [],
  config:           { impostorCount: 1, timer: 60, customRoles: [], specialImpCount: 0, specialCrewCount: 0 },
  myRole:           null,
  myCustomRole:     null,
  myDesc:           null,
  hasVoted:         false,
  pollTimer:        null,
  clientTimer:      null,
  timerMax:         60,
  timerValue:       0,
  lastMsgCount:     0,
  avatarTarget:     null,
  _prevPlayersHash: null,
  _prevRolesHash:   null,
  _prevPhase:       null,
};

Object.defineProperty(S, 'editRoles', {
  get() { return this.config.customRoles; },
  set(v) { this.config.customRoles = v; }
});

// ─── API ──────────────────────────────────────────────────────
async function api(action, body = {}) {
  const r = await fetch(`/api/room?action=${action}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...body, action })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}

async function getRoomHttp() {
  const r = await fetch(`/api/room?code=${S.roomCode}&playerId=${S.playerId}`);
  if (!r.ok) return null;
  return r.json();
}

// ─── Polling ──────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  S.pollTimer = setInterval(async () => {
    if (!S.roomCode) return;
    try {
      const room = await getRoomHttp();
      if (room) applyRoomState(room);
    } catch(_) {}
  }, 2000);
}

function stopPolling() {
  if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
}

// ─── Hash ─────────────────────────────────────────────────────
function hashPlayers(players) {
  return players.map(p =>
    `${p.id}:${p.name}:${p.avatar}:${p.isAlive}:${p.hasVoted}:${p.votedBy}:${p.isHost}`
  ).join('|');
}

// ─── Application de l'état serveur ────────────────────────────
function applyRoomState(room) {
  const prevPhase = S.phase;
  S.hostId = room.hostId;
  S.phase  = room.phase;

  // Ne pas écraser customRoles / specialCounts si l'hôte est en train d'éditer
  const rolesFocused = document.getElementById('roles-list')?.contains(document.activeElement);
  S.config = rolesFocused
    ? { ...room.config, customRoles: S.config.customRoles, specialImpCount: S.config.specialImpCount, specialCrewCount: S.config.specialCrewCount }
    : room.config;

  S.players = room.players;

  const me = room.players.find(p => p.id === S.playerId);
  if (me?.role && !S.myRole) {
    S.myRole       = me.role;
    S.myCustomRole = me.customRole;
    S.myDesc       = me.description;
    showRoleOverlay(me.role, me.customRole, me.description);
  }

  if (room.messages.length > S.lastMsgCount) {
    room.messages.slice(S.lastMsgCount).forEach(appendChatMsg);
    S.lastMsgCount = room.messages.length;
  }

  if (prevPhase !== room.phase) handlePhaseChange(room.phase, room);

  if (room.phase === 'lobby') {
    renderLobby();
  } else if (room.phase === 'discussion' || room.phase === 'vote') {
    renderGamePlayersIfChanged();
    if (S._prevPhase !== room.phase) {
      updatePhaseBadge(room.phase);
      S._prevPhase = room.phase;
    }
    if (room.timerEnd) syncTimer(room.timerEnd, room.phase);
  } else if (room.phase === 'result' && prevPhase !== 'result') {
    showResultScreen(room.winner, room.players, room.hostId);
  }
}

function handlePhaseChange(newPhase, room) {
  if (newPhase === 'discussion') {
    showScreen('game');
    S.hasVoted = false;
    S._prevPlayersHash = null;
    updatePhaseBadge('discussion');
    clearChat();
    S.lastMsgCount = 0;
    updateMyRoleCard();
  } else if (newPhase === 'vote') {
    S.hasVoted = false;
    S._prevPlayersHash = null;
    updatePhaseBadge('vote');
  } else if (newPhase === 'result') {
    stopClientTimer();
  }
}

// ─── Timer ────────────────────────────────────────────────────
function syncTimer(timerEnd, phase) {
  const remaining = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
  const max = phase === 'vote' ? 30 : S.config.timer;
  if (Math.abs(S.timerValue - remaining) > 3 || S.clientTimer === null) {
    startClientTimer(remaining, max);
  }
}
function startClientTimer(seconds, max) {
  stopClientTimer();
  S.timerMax   = max || seconds;
  S.timerValue = seconds;
  updateTimerUI(seconds, S.timerMax);
  S.clientTimer = setInterval(() => {
    S.timerValue = Math.max(0, S.timerValue - 1);
    updateTimerUI(S.timerValue, S.timerMax);
    if (S.timerValue <= 0) stopClientTimer();
  }, 1000);
}
function stopClientTimer() {
  if (S.clientTimer) { clearInterval(S.clientTimer); S.clientTimer = null; }
  S.timerValue = 0;
}
function updateTimerUI(val, max) {
  document.getElementById('timer-display').textContent = val;
  const c = document.getElementById('timer-circle');
  if (!c) return;
  c.style.strokeDashoffset = 94.2 * (1 - Math.max(0, val) / max);
  const urgent = val <= 10 && val > 0;
  c.style.stroke = urgent ? 'var(--gold)' : 'var(--accent)';
  document.getElementById('timer-display').style.color = urgent ? 'var(--gold)' : 'var(--accent)';
}

// ─── Lobby ────────────────────────────────────────────────────
function renderLobby() {
  const isHost = S.playerId === S.hostId;
  document.getElementById('host-panel').classList.toggle('hidden', !isHost);
  document.getElementById('waiting-panel').classList.toggle('hidden', isHost);
  document.getElementById('host-game-controls').classList.toggle('hidden', !isHost);

  const countEl = document.getElementById('player-count');
  if (countEl.textContent !== String(S.players.length))
    countEl.textContent = String(S.players.length);

  if (isHost) {
    const impEl   = document.getElementById('imp-val');
    const timerEl = document.getElementById('timer-val');
    if (impEl.textContent   !== String(S.config.impostorCount)) impEl.textContent   = String(S.config.impostorCount);
    if (timerEl.textContent !== String(S.config.timer))         timerEl.textContent = String(S.config.timer);

    // Mise à jour steppers rôles spéciaux
    const sImpEl  = document.getElementById('srole-imp-val');
    const sCrewEl = document.getElementById('srole-crew-val');
    const sImp    = String(S.config.specialImpCount  ?? 0);
    const sCrew   = String(S.config.specialCrewCount ?? 0);
    if (sImpEl.textContent  !== sImp)  sImpEl.textContent  = sImp;
    if (sCrewEl.textContent !== sCrew) sCrewEl.textContent = sCrew;

    renderRolesList();
  }

  const newHash = hashPlayers(S.players) + (isHost ? ':host' : '');
  if (newHash === S._prevPlayersHash) return;
  S._prevPlayersHash = newHash;

  const grid   = document.getElementById('players-grid');
  const newIds = new Set(S.players.map(p => p.id));
  [...grid.children].forEach(el => { if (!newIds.has(el.dataset.pid)) el.remove(); });

  S.players.forEach(p => {
    let el = grid.querySelector(`[data-pid="${p.id}"]`);
    const newClass = `player-card${p.isHost ? ' is-host' : ''}`;
    const html = `
      <span class="p-avatar">${p.avatar}</span>
      <div class="p-info">
        <div class="p-name">${esc(p.name)}${p.id === S.playerId ? ' <span style="color:var(--cyan);font-size:.65rem">(toi)</span>' : ''}</div>
        ${p.isHost ? '<div class="p-badge">👑 Hôte</div>' : ''}
      </div>`;
    if (!el) {
      el = document.createElement('div');
      el.dataset.pid = p.id;
      el.className   = newClass;
      el.innerHTML   = html;
      grid.appendChild(el);
    } else {
      if (el.className !== newClass) el.className = newClass;
      const trimmed = el.innerHTML.replace(/\s+/g, ' ').trim();
      if (trimmed !== html.replace(/\s+/g, ' ').trim()) el.innerHTML = html;
    }
  });
}

// ─── Éditeur de rôles ─────────────────────────────────────────
function renderRolesList() {
  const newHash = JSON.stringify(S.editRoles);
  if (newHash === S._prevRolesHash) return;
  S._prevRolesHash = newHash;

  const list = document.getElementById('roles-list');
  if (list && list.contains(document.activeElement)) return;

  list.innerHTML = '';
  S.editRoles.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = `role-item ${r.type === 'impostor' ? 'imp' : 'crew'}`;
    el.innerHTML = `
      <button class="btn-del" onclick="deleteRole(${i})">✕</button>
      <div class="role-item-top">
        <input type="text" placeholder="Nom du rôle" value="${esc(r.name)}"
          oninput="S.config.customRoles[${i}].name=this.value"
          onblur="onRoleBlur()" maxlength="30"/>
        <div class="role-toggle">
          <button class="rtbtn ${r.type === 'crewmate' ? 'ac' : ''}"
            onclick="setRoleType(${i},'crewmate')">Équipier</button>
          <button class="rtbtn ${r.type === 'impostor' ? 'ai' : ''}"
            onclick="setRoleType(${i},'impostor')">Imposteur</button>
        </div>
      </div>
      <div class="role-item-desc">
        <input type="text" placeholder="Description"
          value="${esc(r.description)}"
          oninput="S.config.customRoles[${i}].description=this.value"
          onblur="onRoleBlur()" maxlength="120"/>
      </div>`;
    list.appendChild(el);
  });
}

function onRoleBlur() {
  S._prevRolesHash = null;
  saveConfig();
}
function addRole() {
  S.config.customRoles.push({ name: '', description: '', type: 'crewmate' });
  S._prevRolesHash = null;
  renderRolesList();
}
function deleteRole(i) {
  S.config.customRoles.splice(i, 1);
  S._prevRolesHash = null;
  // Recalcule les max pour éviter des valeurs hors-limite
  const maxImp  = S.config.customRoles.filter(r => r.type === 'impostor').length;
  const maxCrew = S.config.customRoles.filter(r => r.type === 'crewmate').length;
  if (S.config.specialImpCount  > maxImp)  S.config.specialImpCount  = maxImp;
  if (S.config.specialCrewCount > maxCrew) S.config.specialCrewCount = maxCrew;
  renderRolesList();
  saveConfig();
}
function setRoleType(i, type) {
  S.config.customRoles[i].type = type;
  S._prevRolesHash = null;
  renderRolesList();
  saveConfig();
}

async function saveConfig() {
  try {
    await api('config', {
      roomCode:         S.roomCode,
      playerId:         S.playerId,
      impostorCount:    S.config.impostorCount,
      timer:            S.config.timer,
      customRoles:      S.config.customRoles,
      specialImpCount:  S.config.specialImpCount  ?? 0,
      specialCrewCount: S.config.specialCrewCount ?? 0
    });
  } catch(_) {}
}

// ─── Joueurs en jeu ───────────────────────────────────────────
function renderGamePlayersIfChanged() {
  const newHash = hashPlayers(S.players) + ':' + S.phase + ':' + S.hasVoted;
  if (newHash === S._prevPlayersHash) return;
  S._prevPlayersHash = newHash;
  renderGamePlayers();
}

function renderGamePlayers() {
  const list = document.getElementById('game-players');
  if (!list) return;
  const isVote  = S.phase === 'vote';
  const me      = S.players.find(p => p.id === S.playerId);
  const meAlive = me?.isAlive;
  const newIds  = new Set(S.players.map(p => p.id));

  [...list.children].forEach(el => { if (!newIds.has(el.dataset.pid)) el.remove(); });

  S.players.forEach(p => {
    const canVote = isVote && meAlive && p.isAlive && p.id !== S.playerId && !S.hasVoted;
    let el = list.querySelector(`[data-pid="${p.id}"]`);
    const classes = ['gp-item',
      !p.isAlive ? 'dead' : '',
      canVote    ? 'vote-target' : '',
      p.hasVoted && isVote ? 'voted' : ''
    ].filter(Boolean).join(' ');

    const html = `
      <span class="gp-avatar">${p.avatar}</span>
      <span class="gp-name">${esc(p.name)}</span>
      ${p.id === S.playerId ? '<span class="gp-you">MOI</span>' : ''}
      ${!p.isAlive ? '<span class="gp-dead">💀</span>' : ''}
      ${isVote && p.votedBy > 0 ? `<span class="gp-votes">${p.votedBy}✗</span>` : ''}`;

    if (!el) {
      el = document.createElement('div');
      el.dataset.pid = p.id;
      el.className   = classes;
      el.innerHTML   = html;
      list.appendChild(el);
    } else {
      if (el.className !== classes) el.className = classes;
      const trimmed = el.innerHTML.replace(/\s+/g, ' ').trim();
      if (trimmed !== html.replace(/\s+/g, ' ').trim()) el.innerHTML = html;
    }
    el.onclick = canVote ? () => doVote(p.id) : null;
  });
}

function updatePhaseBadge(phase) {
  const b = document.getElementById('phase-badge');
  b.textContent = phase === 'vote' ? 'Vote' : 'Discussion';
  b.className   = `phase-badge${phase === 'vote' ? ' vote' : ''}`;
  const hc = document.getElementById('host-game-controls');
  if (S.playerId === S.hostId) hc.classList.toggle('hidden', phase !== 'discussion');
}

function updateMyRoleCard() {
  const card = document.getElementById('my-role-card');
  if (!S.myRole) return;
  card.classList.remove('hidden', 'imp', 'crew');
  card.classList.add(S.myRole === 'impostor' ? 'imp' : 'crew');
  document.getElementById('my-role-name').textContent = S.myCustomRole || S.myRole;
  document.getElementById('my-role-desc').textContent = S.myDesc || '';
}

// ─── Overlay rôle ─────────────────────────────────────────────
function showRoleOverlay(role, customRole, description) {
  const card = document.getElementById('role-reveal-card');
  document.getElementById('reveal-name').textContent = customRole || role;
  document.getElementById('reveal-desc').textContent = description || (
    role === 'impostor'
      ? '🔪 Élimine les équipiers sans te faire repérer.'
      : '🔍 Trouve et vote contre l\'imposteur.'
  );
  card.className = `role-reveal-card ${role === 'impostor' ? 'imp' : 'crew'}`;
  document.getElementById('overlay-role').classList.remove('hidden');
}

// ─── Vote ─────────────────────────────────────────────────────
async function doVote(targetId) {
  if (S.hasVoted) return;
  S.hasVoted = true;
  document.querySelectorAll('.vote-target').forEach(e => e.classList.remove('vote-target'));
  try {
    const res = await api('vote', { roomCode: S.roomCode, playerId: S.playerId, targetId });
    showToast('Vote enregistré !', 'ok');
    if (res.allVoted) showVoteResult(res.tie, res.eliminated);
    if (res.room) applyRoomState(res.room);
  } catch(e) {
    S.hasVoted = false;
    showToast(e.message, '');
  }
}

function showVoteResult(tie, eliminated) {
  const body = document.getElementById('vote-result-body');
  if (tie || !eliminated) {
    body.innerHTML = '<p class="vtie">🤝 Égalité — personne n\'est éliminé !</p>';
  } else {
    const p = S.players.find(x => x.id === eliminated.id);
    body.innerHTML = `
      <div style="font-size:2.5rem">${p?.avatar || '👤'}</div>
      <div class="velim-name">${esc(eliminated.name)}</div>
      <div class="velim-role">était : ${esc(eliminated.customRole)}</div>
      <div class="velim-role" style="opacity:.6;margin-top:4px">
        ${eliminated.role === 'impostor' ? '🔴 C\'était un IMPOSTEUR !' : '🔵 Ce n\'était pas l\'imposteur.'}
      </div>`;
  }
  document.getElementById('overlay-vote').classList.remove('hidden');
}

// ─── Résultat final ───────────────────────────────────────────
function showResultScreen(winner, players, hostId) {
  S.hostId = hostId;
  stopPolling();
  stopClientTimer();
  document.getElementById('result-emoji').textContent = winner === 'crewmates' ? '🎉' : '🔪';
  const title = document.getElementById('result-title');
  title.textContent = winner === 'crewmates' ? 'Victoire !' : 'Défaite !';
  title.className   = `result-title ${winner === 'crewmates' ? 'crew' : 'imp'}`;
  document.getElementById('result-sub').textContent = winner === 'crewmates'
    ? 'Les équipiers ont éliminé tous les imposteurs !'
    : 'Les imposteurs ont semé la discorde !';

  const container = document.getElementById('result-players');
  container.innerHTML = '';
  players.forEach(p => {
    const el = document.createElement('div');
    el.className = `rp-card ${p.role || 'crew'}${!p.isAlive ? ' dead' : ''}`;
    el.innerHTML = `
      <span class="rp-av">${p.avatar}</span>
      <span class="rp-name">${esc(p.name)}</span>
      <span class="rp-role">${esc(p.customRole || p.role || '?')}</span>
      ${!p.isAlive ? '<span style="font-size:.75rem">💀</span>' : ''}`;
    container.appendChild(el);
  });

  document.getElementById('btn-restart').classList.toggle('hidden', S.playerId !== hostId);
  showScreen('result');
}

// ─── Chat ─────────────────────────────────────────────────────
function appendChatMsg(msg) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const el = document.createElement('div');
  if (msg.type === 'system') {
    el.className = 'cmsg sys';
    el.innerHTML = `<div class="mbubble">${esc(msg.text)}</div>`;
  } else {
    const isMe = msg.senderId === S.playerId;
    el.className = `cmsg${isMe ? ' mine' : ''}${!msg.isAlive ? ' ghost' : ''}`;
    el.innerHTML = `
      ${!isMe ? `<span class="mavatar">${msg.senderAvatar || '🧑'}</span>` : ''}
      <div class="mcontent">
        ${!isMe ? `<span class="msender">${esc(msg.senderName)}</span>` : ''}
        <div class="mbubble">${esc(msg.text)}</div>
      </div>`;
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function clearChat() {
  const box = document.getElementById('chat-messages');
  if (box) box.innerHTML = '';
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  try { await api('chat', { roomCode: S.roomCode, playerId: S.playerId, text }); } catch(_) {}
}

// ─── Avatar picker ────────────────────────────────────────────
function openAvatarModal(target) {
  S.avatarTarget = target;
  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = '';
  AVATARS.forEach(emoji => {
    const btn = document.createElement('div');
    btn.className = `avatar-option${emoji === S.myAvatar ? ' selected' : ''}`;
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      S.myAvatar = emoji;
      document.getElementById(`avatar-${target}`).textContent = emoji;
      grid.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('avatar-modal').classList.add('hidden');
    });
    grid.appendChild(btn);
  });
  document.getElementById('avatar-modal').classList.remove('hidden');
}

// ─── Utilitaires UI ───────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className   = `toast ${type}`;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function getInput(id) {
  const v = document.getElementById(id).value.trim();
  if (!v)           { showToast('Entre un pseudo !'); return null; }
  if (v.length < 2) { showToast('Pseudo trop court (min 2 car.)'); return null; }
  return v;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// ─── Actions principales ──────────────────────────────────────
async function createRoom() {
  const name = getInput('input-name-create');
  if (!name) return;
  S.myName = name;
  try {
    const data = await api('create', { playerName: name, avatar: S.myAvatar, playerId: S.playerId });
    initRoom(data);
  } catch(e) { showToast(e.message); }
}

async function joinRoom() {
  const name = getInput('input-name-join');
  if (!name) return;
  const code = document.getElementById('input-room-code').value.trim().toUpperCase();
  if (!code || code.length < 4) return showToast('Entre un code valide !');
  S.myName = name;
  try {
    const data = await api('join', { roomCode: code, playerName: name, avatar: S.myAvatar, playerId: S.playerId });
    initRoom(data);
  } catch(e) { showToast(e.message); }
}

function initRoom(data) {
  S.roomCode         = data.code;
  S.hostId           = data.room.hostId;
  S.players          = data.room.players;
  S.config           = data.room.config;
  // S'assure que les champs existent
  S.config.specialImpCount  = S.config.specialImpCount  ?? 0;
  S.config.specialCrewCount = S.config.specialCrewCount ?? 0;
  S._prevPlayersHash = null;
  S._prevRolesHash   = null;
  document.getElementById('lobby-code').textContent = data.code;
  showScreen('lobby');
  renderLobby();
  startPolling();
}

async function startGame() {
  S.myRole = null; S.myCustomRole = null; S.myDesc = null;
  S.hasVoted = false; S.lastMsgCount = 0;
  S._prevPlayersHash = null;
  try {
    const data = await api('start', { roomCode: S.roomCode, playerId: S.playerId });
    applyRoomState(data.room);
  } catch(e) { showToast(e.message); }
}

async function leaveRoom() {
  if (!confirm('Quitter la room ?')) return;
  try { await api('leave', { roomCode: S.roomCode, playerId: S.playerId }); } catch(_) {}
  location.reload();
}

// ─── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  document.getElementById('btn-create').addEventListener('click', createRoom);
  document.getElementById('btn-join').addEventListener('click', joinRoom);
  document.getElementById('input-name-create').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
  document.getElementById('input-name-join').addEventListener('keydown',   e => { if (e.key === 'Enter') joinRoom(); });
  document.getElementById('input-room-code').addEventListener('keydown',   e => { if (e.key === 'Enter') joinRoom(); });
  document.getElementById('avatar-create').addEventListener('click', () => openAvatarModal('create'));
  document.getElementById('avatar-join').addEventListener('click',   () => openAvatarModal('join'));
  document.getElementById('avatar-close').addEventListener('click',  () => {
    document.getElementById('avatar-modal').classList.add('hidden');
  });

  document.getElementById('btn-leave').addEventListener('click', leaveRoom);
  document.getElementById('btn-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(S.roomCode || '').then(() => showToast('Code copié !', 'ok'));
  });
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-add-role').addEventListener('click', addRole);

  // ── Steppers imposteurs / timer ────────────────────────────
  document.getElementById('imp-minus').addEventListener('click', () => {
    if (S.config.impostorCount > 1) {
      S.config.impostorCount--;
      document.getElementById('imp-val').textContent = S.config.impostorCount;
      saveConfig();
    }
  });
  document.getElementById('imp-plus').addEventListener('click', () => {
    const max = Math.max(1, Math.floor(S.players.length / 2));
    if (S.config.impostorCount < max) {
      S.config.impostorCount++;
      document.getElementById('imp-val').textContent = S.config.impostorCount;
      saveConfig();
    }
  });
  document.getElementById('timer-minus').addEventListener('click', () => {
    if (S.config.timer > 10) {
      S.config.timer = Math.max(10, S.config.timer - 10);
      document.getElementById('timer-val').textContent = S.config.timer;
      saveConfig();
    }
  });
  document.getElementById('timer-plus').addEventListener('click', () => {
    if (S.config.timer < 300) {
      S.config.timer = Math.min(300, S.config.timer + 10);
      document.getElementById('timer-val').textContent = S.config.timer;
      saveConfig();
    }
  });

  // ── Steppers rôles spéciaux imposteurs (min 0, max = nb rôles imp définis) ──
  document.getElementById('srole-imp-minus').addEventListener('click', () => {
    const cur = S.config.specialImpCount ?? 0;
    if (cur > 0) {
      S.config.specialImpCount = cur - 1;
      document.getElementById('srole-imp-val').textContent = S.config.specialImpCount;
      saveConfig();
    }
  });
  document.getElementById('srole-imp-plus').addEventListener('click', () => {
    const cur = S.config.specialImpCount ?? 0;
    const max = S.config.customRoles.filter(r => r.type === 'impostor').length;
    if (cur < max) {
      S.config.specialImpCount = cur + 1;
      document.getElementById('srole-imp-val').textContent = S.config.specialImpCount;
      saveConfig();
    } else {
      showToast('Ajoute d\'abord des rôles imposteurs !');
    }
  });

  // ── Steppers rôles spéciaux équipiers (min 0, max = nb rôles crew définis) ──
  document.getElementById('srole-crew-minus').addEventListener('click', () => {
    const cur = S.config.specialCrewCount ?? 0;
    if (cur > 0) {
      S.config.specialCrewCount = cur - 1;
      document.getElementById('srole-crew-val').textContent = S.config.specialCrewCount;
      saveConfig();
    }
  });
  document.getElementById('srole-crew-plus').addEventListener('click', () => {
    const cur = S.config.specialCrewCount ?? 0;
    const max = S.config.customRoles.filter(r => r.type === 'crewmate').length;
    if (cur < max) {
      S.config.specialCrewCount = cur + 1;
      document.getElementById('srole-crew-val').textContent = S.config.specialCrewCount;
      saveConfig();
    } else {
      showToast('Ajoute d\'abord des rôles équipiers !');
    }
  });

  // ── Jeu ───────────────────────────────────────────────────
  document.getElementById('btn-vote-phase').addEventListener('click', async () => {
    try { await api('vote-phase', { roomCode: S.roomCode, playerId: S.playerId }); }
    catch(e) { showToast(e.message); }
  });
  document.getElementById('btn-chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  document.getElementById('btn-close-role').addEventListener('click', () => {
    document.getElementById('overlay-role').classList.add('hidden');
    showScreen('game');
    updateMyRoleCard();
    renderGamePlayers();
    updatePhaseBadge(S.phase);
  });

  document.getElementById('btn-close-vote').addEventListener('click', () => {
    document.getElementById('overlay-vote').classList.add('hidden');
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    showScreen('lobby');
    S.phase = 'lobby';
    startPolling();
    startGame();
  });
  document.getElementById('btn-home').addEventListener('click', () => location.reload());

  window.addEventListener('beforeunload', () => {
    if (S.roomCode) {
      navigator.sendBeacon('/api/room?action=leave',
        JSON.stringify({ roomCode: S.roomCode, playerId: S.playerId, action: 'leave' })
      );
    }
  });
});
