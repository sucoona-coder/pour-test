// lib/store.js — Stockage en mémoire avec TTL automatique (2h d'inactivité)
//
// ⚠️  En production Vercel multi-instance, les rooms ne sont pas partagées
//     entre instances. Pour la production, remplace par Vercel KV / Upstash Redis :
//
//     import { kv } from '@vercel/kv';
//     await kv.set(code, room, { ex: 7200 });   // TTL 2h natif
//     const room = await kv.get(code);
//
//     Le reste du code (room.js, stream.js) n'a pas besoin de changer.

const TTL_MS = 2 * 60 * 60 * 1000;   // 2 heures

const store = global._store || (global._store = { rooms: {} });

// Nettoyage automatique toutes les 15 minutes
if (!global._storeCleaner) {
  global._storeCleaner = setInterval(() => {
    const now = Date.now();
    for (const code of Object.keys(store.rooms)) {
      const room = store.rooms[code];
      if (room._lastActivity && now - room._lastActivity > TTL_MS) {
        delete store.rooms[code];
      }
    }
  }, 15 * 60 * 1000);
  // Empêche ce timer de bloquer la sortie du process en dev
  if (global._storeCleaner.unref) global._storeCleaner.unref();
}

function generateCode() {
  let code;
  do { code = Math.random().toString(36).substring(2, 8).toUpperCase(); }
  while (store.rooms[code]);
  return code;
}

function getRoom(code) {
  return store.rooms[code] || null;
}

function setRoom(code, room) {
  room._lastActivity = Date.now();   // met à jour le timestamp à chaque write
  store.rooms[code]  = room;
}

function deleteRoom(code) {
  delete store.rooms[code];
}

function allRooms() {
  return store.rooms;
}

module.exports = { generateCode, getRoom, setRoom, deleteRoom, allRooms };
