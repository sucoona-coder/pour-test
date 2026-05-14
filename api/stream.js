// api/stream.js — SSE endpoint
// GET /api/stream?code=XXX&playerId=YYY
// Envoie l'état de la room toutes les 1.5s tant que le client est connecté.
// Beaucoup plus léger que le polling HTTP car la connexion reste ouverte.
//
// Note : en production Vercel, les fonctions serverless ont une durée max de
// 30s (hobby) ou 60s (pro). Au-delà, le client se reconnecte automatiquement
// grâce au comportement natif de EventSource.

const { getRoom } = require('../lib/store');
const { roomView } = require('../lib/roomView');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const { code, playerId } = req.query;
  if (!code || !playerId) return res.status(400).end();

  // Headers SSE
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // désactive le buffering nginx

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Envoie l'état initial immédiatement
  const initial = getRoom(code);
  if (!initial) {
    send({ error: 'Room introuvable.' });
    return res.end();
  }
  send(roomView(initial, playerId));

  // Puis toutes les 1.5s
  const interval = setInterval(() => {
    const room = getRoom(code);
    if (!room) {
      clearInterval(interval);
      return res.end();
    }
    send(roomView(room, playerId));
  }, 1500);

  // Nettoyage quand le client se déconnecte
  req.on('close', () => clearInterval(interval));
};
