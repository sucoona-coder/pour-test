// api/room.js
const { generateCode, getRoom, setRoom, deleteRoom } = require('../lib/store');
const { roomView } = require('../lib/roomView');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function checkWin(room) {
  const alive     = Object.values(room.players).filter(p => p.isAlive);
  const impostors = alive.filter(p => p.role === 'impostor');
  const crewmates = alive.filter(p => p.role === 'crewmate');
  if (impostors.length === 0)               return 'crewmates';
  if (impostors.length >= crewmates.length) return 'impostors';
  return null;
}

function defaultConfig() {
  return { impostorCount: 1, timer: 60, customRoles: [], specialImpCount: 0, specialCrewCount: 0 };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — état de la room ─────────────────────────────────
  if (req.method === 'GET') {
    const { code, playerId } = req.query;
    // favicon & autres ressources statiques
    if (!code) return res.status(404).end();
    const room = getRoom(code);
    if (!room) return res.status(404).json({ error: 'Room introuvable.' });
    return res.status(200).json(roomView(room, playerId));
  }

  if (req.method !== 'POST') return res.status(405).end();

  const body   = req.body || {};
  const action = req.query.action || body.action;

  // ── CREATE ────────────────────────────────────────────────
  if (action === 'create') {
    const { playerName, avatar, playerId } = body;
    if (!playerName || !playerId) return res.status(400).json({ error: 'Champs manquants.' });

    const code = generateCode();
    const room = {
      code,
      hostId:   playerId,
      phase:    'lobby',
      round:    0,
      winner:   null,
      config:   defaultConfig(),
      players: {
        [playerId]: {
          id:          playerId,
          name:        playerName.trim().substring(0, 20),
          avatar:      avatar || '🧑',
          role:        null,
          customRole:  null,
          description: null,
          isAlive:     true,
          hasVoted:    false
        }
      },
      votes:    {},
      messages: []
    };

    setRoom(code, room);
    return res.status(200).json({ code, room: roomView(room, playerId) });
  }

  // ── JOIN ──────────────────────────────────────────────────
  if (action === 'join') {
    const { roomCode, playerName, avatar, playerId } = body;
    const code = (roomCode || '').toUpperCase().trim();
    const room = getRoom(code);

    if (!room)                                  return res.status(404).json({ error: 'Room introuvable.' });
    if (room.phase !== 'lobby')                 return res.status(400).json({ error: 'Partie déjà en cours.' });
    if (Object.keys(room.players).length >= 15) return res.status(400).json({ error: 'Room pleine (max 15).' });

    if (!room.players[playerId]) {
      room.players[playerId] = {
        id:          playerId,
        name:        (playerName || '').trim().substring(0, 20),
        avatar:      avatar || '🧑',
        role:        null,
        customRole:  null,
        description: null,
        isAlive:     true,
        hasVoted:    false
      };
      room.messages.push({ type: 'system', text: `${room.players[playerId].name} a rejoint !`, ts: Date.now() });
      setRoom(code, room);
    }

    return res.status(200).json({ code, room: roomView(room, playerId) });
  }

  // ── CONFIG ────────────────────────────────────────────────
  if (action === 'config') {
    const { roomCode, playerId, impostorCount, timer, customRoles, specialImpCount, specialCrewCount } = body;
    const room = getRoom(roomCode);
    if (!room)                    return res.status(404).json({ error: 'Room introuvable.' });
    if (room.hostId !== playerId) return res.status(403).json({ error: 'Pas l\'hôte.' });
    if (room.phase !== 'lobby')   return res.status(400).json({ error: 'Partie en cours.' });

    const maxImp = Math.max(1, Math.floor(Object.keys(room.players).length / 2));
    room.config.impostorCount = Math.max(1, Math.min(parseInt(impostorCount) || 1, maxImp));
    room.config.timer         = Math.max(10, Math.min(parseInt(timer) || 60, 300));

    // Sauvegarde les rôles — garde même les rôles sans nom (en cours de frappe)
    if (Array.isArray(customRoles)) {
      room.config.customRoles = customRoles
        .slice(0, 20)
        .map(r => ({
          name:        (r.name || '').substring(0, 30),
          description: (r.description || '').substring(0, 120),
          type:        r.type === 'impostor' ? 'impostor' : 'crewmate'
        }));
      // Ne filtre PAS sur name.trim() pour ne pas supprimer les rôles vides en cours d'édition
    }

    // specialCounts — clampés au nb de rôles du type correspondant
    const impRoles  = room.config.customRoles.filter(r => r.type === 'impostor').length;
    const crewRoles = room.config.customRoles.filter(r => r.type === 'crewmate').length;
    room.config.specialImpCount  = Math.min(Math.max(0, parseInt(specialImpCount)  || 0), impRoles);
    room.config.specialCrewCount = Math.min(Math.max(0, parseInt(specialCrewCount) || 0), crewRoles);

    setRoom(roomCode, room);
    return res.status(200).json({ ok: true, config: room.config });
  }

  // ── START ─────────────────────────────────────────────────
  if (action === 'start') {
    const { roomCode, playerId } = body;
    const room = getRoom(roomCode);
    if (!room)                    return res.status(404).json({ error: 'Room introuvable.' });
    if (room.hostId !== playerId) return res.status(403).json({ error: 'Pas l\'hôte.' });
    if (Object.keys(room.players).length < 2) return res.status(400).json({ error: 'Il faut au moins 2 joueurs.' });

    room.round++;
    room.phase    = 'discussion';
    room.votes    = {};
    room.winner   = null;
    room.messages = [];

    const ids = shuffle(Object.keys(room.players));
    const { impostorCount, customRoles, specialImpCount, specialCrewCount } = room.config;

    // Rôles valides (avec nom)
    const impostorRoles = (customRoles || []).filter(r => r.type === 'impostor' && r.name.trim());
    const crewmateRoles = (customRoles || []).filter(r => r.type === 'crewmate' && r.name.trim());

    // Combien de rôles spéciaux distribuer
    const nSpecialImp  = Math.min(specialImpCount  || 0, impostorRoles.length, impostorCount);
    const nSpecialCrew = Math.min(specialCrewCount || 0, crewmateRoles.length, ids.length - impostorCount);

    let ii = 0, ci = 0;

    ids.forEach((id, idx) => {
      const p     = room.players[id];
      const isImp = idx < impostorCount;
      p.role     = isImp ? 'impostor' : 'crewmate';
      p.isAlive  = true;
      p.hasVoted = false;

      if (isImp) {
        // Distribue un rôle spécial si encore disponible, sinon rôle générique
        if (impostorRoles.length > 0 && ii < nSpecialImp) {
          p.customRole  = impostorRoles[ii % impostorRoles.length].name;
          p.description = impostorRoles[ii % impostorRoles.length].description;
        } else {
          p.customRole  = 'Imposteur';
          p.description = '🔪 Élimine les équipiers sans te faire repérer.';
        }
        ii++;
      } else {
        if (crewmateRoles.length > 0 && ci < nSpecialCrew) {
          p.customRole  = crewmateRoles[ci % crewmateRoles.length].name;
          p.description = crewmateRoles[ci % crewmateRoles.length].description;
        } else {
          p.customRole  = 'Équipier';
          p.description = '🔍 Trouve et vote contre l\'imposteur.';
        }
        ci++;
      }
    });

    room.timerEnd = Date.now() + room.config.timer * 1000;
    setRoom(roomCode, room);
    return res.status(200).json({ ok: true, room: roomView(room, playerId) });
  }

  // ── VOTE PHASE ────────────────────────────────────────────
  if (action === 'vote-phase') {
    const { roomCode, playerId } = body;
    const room = getRoom(roomCode);
    if (!room)                    return res.status(404).json({ error: 'Room introuvable.' });
    if (room.hostId !== playerId) return res.status(403).json({ error: 'Pas l\'hôte.' });

    room.phase    = 'vote';
    room.votes    = {};
    room.timerEnd = Date.now() + 30000;
    Object.values(room.players).forEach(p => { p.hasVoted = false; });
    setRoom(roomCode, room);
    return res.status(200).json({ ok: true });
  }

  // ── CAST VOTE ─────────────────────────────────────────────
  if (action === 'vote') {
    const { roomCode, playerId, targetId } = body;
    const room = getRoom(roomCode);
    if (!room)                 return res.status(404).json({ error: 'Room introuvable.' });
    if (room.phase !== 'vote') return res.status(400).json({ error: 'Pas en phase vote.' });

    const voter  = room.players[playerId];
    const target = room.players[targetId];
    if (!voter?.isAlive || voter.hasVoted) return res.status(400).json({ error: 'Vote invalide.' });
    if (!target?.isAlive)                  return res.status(400).json({ error: 'Cible invalide.' });

    room.votes[playerId] = targetId;
    voter.hasVoted       = true;

    const alive    = Object.values(room.players).filter(p => p.isAlive);
    const allVoted = alive.every(p => p.hasVoted);
    let eliminated = null;
    let tie        = false;

    if (allVoted) {
      const counts = {};
      alive.forEach(p => { counts[p.id] = 0; });
      Object.values(room.votes).forEach(tid => { if (counts[tid] !== undefined) counts[tid]++; });

      let max = 0;
      for (const [id, count] of Object.entries(counts)) {
        if (count > max)                   { max = count; eliminated = id; tie = false; }
        else if (count === max && max > 0) { tie = true; }
      }

      if (!tie && eliminated) {
        room.players[eliminated].isAlive = false;
        room.messages.push({ type: 'system', text: `${room.players[eliminated].name} a été éliminé (${room.players[eliminated].customRole})`, ts: Date.now() });
      } else {
        room.messages.push({ type: 'system', text: 'Égalité — personne n\'est éliminé.', ts: Date.now() });
      }

      const winner = checkWin(room);
      if (winner) {
        room.phase  = 'result';
        room.winner = winner;
      } else {
        room.phase    = 'discussion';
        room.votes    = {};
        room.timerEnd = Date.now() + room.config.timer * 1000;
        Object.values(room.players).forEach(p => { p.hasVoted = false; });
      }
    }

    setRoom(roomCode, room);
    return res.status(200).json({
      ok: true,
      allVoted,
      tie,
      eliminated: eliminated ? {
        id:         eliminated,
        name:       room.players[eliminated]?.name,
        customRole: room.players[eliminated]?.customRole,
        role:       room.players[eliminated]?.role
      } : null,
      room: roomView(room, playerId)
    });
  }

  // ── CHAT ──────────────────────────────────────────────────
  if (action === 'chat') {
    const { roomCode, playerId, text } = body;
    const room = getRoom(roomCode);
    if (!room) return res.status(404).json({ error: 'Room introuvable.' });

    const player = room.players[playerId];
    if (!player) return res.status(403).json({ error: 'Joueur inconnu.' });

    room.messages.push({
      type:         'player',
      id:           Date.now() + Math.random(),
      senderId:     playerId,
      senderName:   player.name,
      senderAvatar: player.avatar,
      isAlive:      player.isAlive,
      text:         (text || '').trim().substring(0, 200),
      ts:           Date.now()
    });

    if (room.messages.length > 100) room.messages = room.messages.slice(-100);
    setRoom(roomCode, room);
    return res.status(200).json({ ok: true });
  }

  // ── LEAVE ─────────────────────────────────────────────────
  if (action === 'leave') {
    const { roomCode, playerId } = body;
    const room = getRoom(roomCode);
    if (!room) return res.status(200).json({ ok: true });

    const name = room.players[playerId]?.name || 'Inconnu';
    delete room.players[playerId];

    if (Object.keys(room.players).length === 0) {
      deleteRoom(roomCode);
      return res.status(200).json({ ok: true });
    }

    if (room.hostId === playerId) room.hostId = Object.keys(room.players)[0];
    room.messages.push({ type: 'system', text: `${name} a quitté.`, ts: Date.now() });
    setRoom(roomCode, room);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Action inconnue.' });
};
