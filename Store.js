// lib/store.js
// Stockage en mémoire global (partagé entre les fonctions serverless via le module cache)
// Note : sur Vercel, les fonctions peuvent être sur des instances différentes.
// Pour la prod, remplacer par KV (Vercel KV / Upstash Redis).
// En dev local avec `vercel dev`, tout tourne sur une seule instance → parfait.

const store = global._gameStore || (global._gameStore = {
  rooms: {}
});

// ── Helpers rooms ────────────────────────────────────────────

function getRoom(code) {
  return store.rooms[code] || null;
}

function setRoom(code, room) {
  store.rooms[code] = room;
}

function deleteRoom(code) {
  delete store.rooms[code];
}

function generateCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (store.rooms[code]);
  return code;
}

module.exports = { getRoom, setRoom, deleteRoom, generateCode };
