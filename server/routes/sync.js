const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');
const syncBus = require('../syncBus');

// GET /api/sync/stream - Server-Sent Events (SSE) live sync stream
router.get('/stream', (req, res) => {
  let token = req.query.token;

  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token for live sync stream.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Set headers for persistent Server-Sent Events stream
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    syncBus.addClient(decoded.id, res);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token for live sync stream.' });
  }
});

module.exports = router;
