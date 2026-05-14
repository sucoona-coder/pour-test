// lib/roomView.js — Vue publique de la room (partagée entre room.js et stream.js)

function publicPlayer(p, room, myId) {
  const showRole = p.id === myId || room.phase === 'result';
  return {
    id:          p.id,
    name:        p.name,
    avatar:      p.avatar,
    isAlive:     p.isAlive,
    hasVoted:    p.hasVoted,
    isHost:      p.id === room.hostId,
    role:        showRole ? p.role        : null,
    customRole:  showRole ? p.customRole  : null,
    description: showRole ? p.description : null,
    votedBy:     Object.values(room.votes || {}).filter(v => v === p.id).length
  };
}

function roomView(room, myId) {
  return {
    code:     room.code,
    hostId:   room.hostId,
    phase:    room.phase,
    config:   room.config,
    winner:   room.winner || null,
    round:    room.round,
    timerEnd: room.timerEnd || null,
    players:  Object.values(room.players).map(p => publicPlayer(p, room, myId)),
    messages: room.messages || [],
    votes:    room.phase === 'vote' ? room.votes : {}
  };
}

module.exports = { roomView, publicPlayer };
