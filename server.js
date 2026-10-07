const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize Database
require('./server/db');

const authRoutes = require('./server/routes/auth');
const taskRoutes = require('./server/routes/tasks');
const historyRoutes = require('./server/routes/history');
const syncRoutes = require('./server/routes/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin, credentials: true } : {}));

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '1mb' }));

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Lightweight In-Memory DoS / API Rate Limiting (150 requests/min per IP)
const ipRequestMap = new Map();
app.use('/api', (req, res, next) => {
  if (req.path === '/sync/stream') return next(); // Exclude long-running SSE streams

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 150;

  const entry = ipRequestMap.get(ip) || { count: 0, resetTime: now + windowMs };
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + windowMs;
  } else {
    entry.count++;
  }
  ipRequestMap.set(ip, entry);

  if (entry.count > maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
});

// Periodic cleanup of stale rate-limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRequestMap.entries()) {
    if (now > entry.resetTime) ipRequestMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/sync', syncRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'ProTrackR Production Server',
    database: 'SQLite (WAL Mode)',
    smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_USER !== 'your_gmail_or_smtp_username@gmail.com'),
    googleConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here')
  });
});

// Fallback to index.html for any frontend navigation (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(54));
  console.log(`  🚀 PROTRACKR PRODUCTION SERVER ACTIVE`);
  console.log(`  🌐 URL: http://localhost:${PORT}`);
  console.log(`  💾 Database: SQLite (protrackr.db with WAL mode)`);
  console.log(`  ✉️  Email OTP: ${process.env.SMTP_USER ? 'SMTP Configured' : 'Dev Mode (Logged to console)'}`);
  console.log(`  🔐 Google Sign-In: ${process.env.GOOGLE_CLIENT_ID ? 'Configured' : 'GIS Ready (add GOOGLE_CLIENT_ID in .env)'}`);
  console.log('='.repeat(54) + '\n');
});
