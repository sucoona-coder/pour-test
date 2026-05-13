// lib/store.js — Stockage en mémoire partagé
// Fonctionne parfaitement avec Vercel dev local.
// En production Vercel, les rooms persistent ~30min (durée de vie des fonctions).

const store = global._store || (global._store = { rooms: {} });

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 8).toUpperCase(); }
  while (store.rooms[code]);
  return code;
}

function getRoom(code)       { return store.rooms[code] || null; }
function setRoom(code, room) { store.rooms[code] = room; }
function deleteRoom(code)    { delete store.rooms[code]; }
function allRooms()          { return store.rooms; }

module.exports = { generateCode, getRoom, setRoom, deleteRoom, allRooms };
