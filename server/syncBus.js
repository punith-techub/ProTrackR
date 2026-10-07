// In-memory Pub/Sub event bus for Real-Time Multi-Device Synchronization via SSE

const clients = new Map(); // userId -> Set of express res streams

function addClient(userId, res) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  const userClients = clients.get(userId);
  userClients.add(res);

  // Send initial connection handshake
  res.write(`data: ${JSON.stringify({ event: 'CONNECTED', timestamp: Date.now() })}\n\n`);

  // Clean up when client disconnects
  res.on('close', () => {
    userClients.delete(res);
    if (userClients.size === 0) {
      clients.delete(userId);
    }
  });
}

function broadcast(userId, event, payload, excludeRes = null) {
  const userClients = clients.get(userId);
  if (!userClients || userClients.size === 0) return;

  const message = `data: ${JSON.stringify({ event, payload, timestamp: Date.now() })}\n\n`;

  for (const clientRes of userClients) {
    if (clientRes !== excludeRes) {
      try {
        clientRes.write(message);
      } catch (err) {
        console.error('Failed to write SSE event to client:', err);
        userClients.delete(clientRes);
      }
    }
  }
}

// 25-second keepalive ping to prevent proxy/browser timeout
setInterval(() => {
  for (const [userId, userClients] of clients.entries()) {
    for (const res of userClients) {
      try {
        res.write(':keepalive\n\n');
      } catch (err) {
        userClients.delete(res);
      }
    }
    if (userClients.size === 0) {
      clients.delete(userId);
    }
  }
}, 25000);

module.exports = {
  addClient,
  broadcast
};
