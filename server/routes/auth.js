const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { sendOtpEmail } = require('../mailer');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

// In-memory brute-force protection maps
const otpAttempts = new Map(); // email -> { count, lastAttempt }
const loginAttempts = new Map(); // identifier -> { count, lockedUntil }

// Helper to sign JWT (30-day session)
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// GET /api/auth/config - Provide public client configurations to frontend
router.get('/config', (req, res) => {
  let sUrl = (process.env.SUPABASE_URL || '').trim();
  if (sUrl && !sUrl.startsWith('http://') && !sUrl.startsWith('https://')) {
    sUrl = 'https://' + sUrl;
  }
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    supabaseUrl: sUrl,
    supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim()
  });
});

// Helper to validate strict 5-rule password policy
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least 1 capital letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least 1 small letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least 1 number (0-9).' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`§±]/.test(password)) {
    return { valid: false, error: 'Password must contain at least 1 special character (!@#$%^&*...).' };
  }
  return { valid: true };
}

// POST /api/auth/send-otp - Step 1: Validate username & email, create OTP, and dispatch email
router.post('/send-otp', async (req, res) => {
  try {
    const { username, email } = req.body;

    if (!username || !username.trim() || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Check if username already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);
    if (existingUser) {
      return res.status(400).json({ error: 'This username is already taken. Please choose another.' });
    }

    // Check if email already registered
    const existingEmail = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(cleanEmail);
    if (existingEmail) {
      return res.status(400).json({ 
        error: 'An account with this email already exists. Please log in.',
        code: 'EMAIL_ALREADY_REGISTERED'
      });
    }

    // Rate limit check: Allow sending at most once per 30 seconds
    const recentOtp = db.prepare(`
      SELECT created_at FROM email_otps 
      WHERE email = ? AND expires_at > ? 
      ORDER BY id DESC LIMIT 1
    `).get(cleanEmail, Date.now());

    if (recentOtp) {
      const createdTime = new Date(recentOtp.created_at).getTime();
      const elapsedSeconds = (Date.now() - createdTime) / 1000;
      if (elapsedSeconds < 30) {
        return res.status(429).json({ 
          error: `Please wait ${Math.ceil(30 - elapsedSeconds)} seconds before requesting a new OTP.` 
        });
      }
    }

    // Generate secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Save OTP
    db.prepare('INSERT INTO email_otps (email, otp, expires_at) VALUES (?, ?, ?)')
      .run(cleanEmail, otp, expiresAt);

    // Send email via Nodemailer
    const mailResult = await sendOtpEmail(cleanEmail, otp);

    if (!mailResult.success) {
      return res.status(500).json({ error: mailResult.error || 'Failed to dispatch verification email.' });
    }

    // In production or when email is delivered, NEVER return devOtp in JSON
    const isProd = process.env.NODE_ENV === 'production';
    const showDevOtp = !isProd && mailResult.devMode;

    return res.json({
      success: true,
      message: mailResult.devMode 
        ? 'Verification code generated! (Dev mode: check server console)'
        : `Verification code sent to ${cleanEmail}!`,
      devMode: showDevOtp,
      devOtp: showDevOtp ? otp : undefined
    });
  } catch (err) {
    console.error('Error in /send-otp:', err);
    res.status(500).json({ error: 'Failed to process OTP request. Please try again.' });
  }
});

// POST /api/auth/verify-otp - Step 2: Verify OTP and grant a temporary verificationToken
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, username, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = (username || '').trim();
    const cleanOtp = otp.toString().trim();

    // Brute-force protection: Max 5 failed attempts per email within 10 minutes
    const attemptRecord = otpAttempts.get(cleanEmail) || { count: 0, lastAttempt: Date.now() };
    if (attemptRecord.count >= 5) {
      if (Date.now() - attemptRecord.lastAttempt < 10 * 60 * 1000) {
        return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
      }
      otpAttempts.delete(cleanEmail);
    }

    // Verify OTP
    const validOtp = db.prepare(`
      SELECT id FROM email_otps 
      WHERE email = ? AND otp = ? AND expires_at > ? 
      ORDER BY id DESC LIMIT 1
    `).get(cleanEmail, cleanOtp, Date.now());

    if (!validOtp) {
      attemptRecord.count += 1;
      attemptRecord.lastAttempt = Date.now();
      otpAttempts.set(cleanEmail, attemptRecord);

      if (attemptRecord.count >= 5) {
        db.prepare('DELETE FROM email_otps WHERE email = ?').run(cleanEmail);
        return res.status(429).json({ error: 'Maximum attempts exceeded. This verification code has expired. Please request a new one.' });
      }

      return res.status(400).json({ error: `Invalid or expired verification code. (${5 - attemptRecord.count} attempt(s) remaining)` });
    }

    // Reset attempt counter on success
    otpAttempts.delete(cleanEmail);

    // Generate temporary verification token (valid for 15 minutes)
    const verificationToken = jwt.sign(
      { email: cleanEmail, username: cleanUsername, purpose: 'email_verified' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    return res.json({
      success: true,
      message: 'Email verified successfully! Now set your account password.',
      verificationToken,
      email: cleanEmail,
      username: cleanUsername
    });
  } catch (err) {
    console.error('Error in /verify-otp:', err);
    res.status(500).json({ error: 'Failed to verify code. Please try again.' });
  }
});

// POST /api/auth/register-complete - Step 3: Set password after email verification & create account
router.post('/register-complete', async (req, res) => {
  try {
    const { verificationToken, password } = req.body;

    if (!verificationToken || !password) {
      return res.status(400).json({ error: 'Verification token and password are required.' });
    }

    // Verify verificationToken
    let decoded;
    try {
      decoded = jwt.verify(verificationToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Verification session expired. Please verify your email again.' });
    }

    if (decoded.purpose !== 'email_verified' || !decoded.email) {
      return res.status(400).json({ error: 'Invalid email verification token.' });
    }

    const cleanEmail = decoded.email.toLowerCase();
    const cleanUsername = (decoded.username || cleanEmail.split('@')[0]).trim();

    // Strict 5-rule password validation
    const pwdCheck = validatePassword(password);
    if (!pwdCheck.valid) {
      return res.status(400).json({ error: pwdCheck.error });
    }

    // Check again for collisions
    const checkUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)')
      .get(cleanUsername, cleanEmail);
    if (checkUser) {
      return res.status(400).json({ error: 'User or email already registered. Please log in.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user into SQLite database
    const insertResult = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `).run(cleanUsername, cleanEmail, passwordHash);

    const userId = insertResult.lastInsertRowid;

    // Remove used OTPs
    db.prepare('DELETE FROM email_otps WHERE email = ?').run(cleanEmail);

    const userObj = {
      id: userId,
      username: cleanUsername,
      email: cleanEmail
    };

    const token = generateToken(userObj);

    return res.status(201).json({
      success: true,
      token,
      user: userObj
    });
  } catch (err) {
    console.error('Error in /register-complete:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/register-verify - Legacy / backward-compatible direct registration
router.post('/register-verify', async (req, res) => {
  try {
    const { username, email, password, otp } = req.body;

    if (!username || !email || !password || !otp) {
      return res.status(400).json({ error: 'Missing required fields (username, email, password, otp).' });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    // Strict password policy check
    const pwdCheck = validatePassword(password);
    if (!pwdCheck.valid) {
      return res.status(400).json({ error: pwdCheck.error });
    }

    // Verify OTP
    const validOtp = db.prepare(`
      SELECT id FROM email_otps 
      WHERE email = ? AND otp = ? AND expires_at > ? 
      ORDER BY id DESC LIMIT 1
    `).get(cleanEmail, cleanOtp, Date.now());

    if (!validOtp) {
      return res.status(400).json({ error: 'Invalid or expired verification code. Please request a new one.' });
    }

    // Check again for collisions
    const checkUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)').get(cleanUsername, cleanEmail);
    if (checkUser) {
      return res.status(400).json({ error: 'User or email already registered.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user into SQLite database
    const insertResult = db.prepare(`
      INSERT INTO users (username, email, password_hash)
      VALUES (?, ?, ?)
    `).run(cleanUsername, cleanEmail, passwordHash);

    const userId = insertResult.lastInsertRowid;

    // Remove used OTPs
    db.prepare('DELETE FROM email_otps WHERE email = ?').run(cleanEmail);

    const userObj = {
      id: userId,
      username: cleanUsername,
      email: cleanEmail
    };

    const token = generateToken(userObj);

    return res.status(201).json({
      success: true,
      token,
      user: userObj
    });
  } catch (err) {
    console.error('Error in /register-verify:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login - Standard username/email and password login
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Please enter your username/email and password.' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    // Brute-force protection: check for active lockout
    const lockInfo = loginAttempts.get(cleanIdentifier);
    if (lockInfo && lockInfo.lockedUntil && Date.now() < lockInfo.lockedUntil) {
      const waitMins = Math.ceil((lockInfo.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many failed login attempts. Please try again in ${waitMins} minute(s).` });
    }

    // Lookup user by username OR email
    const user = db.prepare(`
      SELECT * FROM users 
      WHERE LOWER(username) = ? OR LOWER(email) = ?
    `).get(cleanIdentifier, cleanIdentifier);

    if (!user) {
      return res.status(404).json({ 
        code: 'USER_NOT_FOUND',
        error: 'Account not found. Create one'
      });
    }

    if (!user.password_hash) {
      return res.status(400).json({ 
        error: 'This account was created via Google Sign-In. Please click "Sign in with Google" below.' 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const current = loginAttempts.get(cleanIdentifier) || { count: 0 };
      current.count += 1;
      if (current.count >= 5) {
        current.lockedUntil = Date.now() + 15 * 60 * 1000; // 15-minute lockout
        loginAttempts.set(cleanIdentifier, current);
        return res.status(429).json({ error: 'Too many failed login attempts. Account temporarily locked for 15 minutes.' });
      }
      loginAttempts.set(cleanIdentifier, current);
      return res.status(401).json({ error: `Incorrect password. (${5 - current.count} attempt(s) remaining)` });
    }

    // Reset failed login attempts on success
    loginAttempts.delete(cleanIdentifier);

    const userObj = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url
    };

    const token = generateToken(userObj);

    return res.json({
      success: true,
      token,
      user: userObj
    });
  } catch (err) {
    console.error('Error in /login:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/google - Google Identity Services Sign-In (Direct login, strictly verified)
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential token is missing.' });
    }

    let payload = null;

    // Test environment only: allow mock token for automated test suite
    if (process.env.NODE_ENV === 'test') {
      try {
        const decoded = jwt.decode(credential);
        if (decoded && decoded.email) {
          payload = decoded;
        }
      } catch (e) {}
    }

    if (!payload) {
      if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id_here') {
        return res.status(503).json({ error: 'Google Sign-In is not configured on this server.' });
      }

      // Strict cryptographic verification with google-auth-library
      try {
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        console.error('Google ID token verification failed:', verifyErr.message);
        return res.status(401).json({ error: 'Google authentication failed: Invalid or expired token.' });
      }
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Invalid Google credential payload.' });
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();
    const name = payload.name || payload.given_name || email.split('@')[0];
    const picture = payload.picture || null;

    // 1. Check if user with this google_id already exists
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

    if (!user) {
      // 2. Check if user with this email exists
      user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);

      if (user) {
        // Link Google ID & avatar to existing user
        db.prepare(`
          UPDATE users 
          SET google_id = ?, avatar_url = COALESCE(avatar_url, ?)
          WHERE id = ?
        `).run(googleId, picture, user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      } else {
        // 3. Create brand new user
        // Generate clean unique username
        let baseUsername = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || email.split('@')[0];
        let finalUsername = baseUsername;
        let counter = 1;
        while (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(finalUsername)) {
          finalUsername = `${baseUsername}${counter++}`;
        }

        const insert = db.prepare(`
          INSERT INTO users (username, email, google_id, avatar_url)
          VALUES (?, ?, ?, ?)
        `).run(finalUsername, email, googleId, picture);

        user = {
          id: insert.lastInsertRowid,
          username: finalUsername,
          email: email,
          avatar_url: picture
        };
      }
    }

    const userObj = {
      id: user.id,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url
    };

    const token = generateToken(userObj);

    // Direct entry: returns token and user, no OTP required!
    return res.json({
      success: true,
      token,
      user: userObj
    });
  } catch (err) {
    console.error('Error in /google auth:', err);
    res.status(500).json({ error: 'Google sign-in failed: ' + err.message });
  }
});

// GET /api/auth/me - Verify session and fetch current user profile
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, email, avatar_url, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({ user });
});

module.exports = router;
