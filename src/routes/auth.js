const express = require('express');
const jwt = require('jsonwebtoken');
const { findUserByEmail, createUser } = require('../db');
const { sendMagicLinkEmail } = require('../services/email');

const router = express.Router();

const JWT_SECRET = () => process.env.JWT_SECRET || 'change-me-in-production';
const APP_URL = () => process.env.APP_URL || 'https://webintel.dev';

// -------------------------------------------------------
// POST /api/auth/magic-link  — send a sign-in email
// -------------------------------------------------------
router.post('/magic-link', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ success: false, message: 'Valid email required.' });
  }

  try {
    const token = jwt.sign({ email, purpose: 'magic-link' }, JWT_SECRET(), { expiresIn: '15m' });
    await sendMagicLinkEmail(email, token);
    res.json({ success: true, message: 'Check your email for a sign-in link.' });
  } catch (err) {
    console.error('[auth] Magic link error:', err.message);
    res.status(500).json({ success: false, message: 'Could not send sign-in email.' });
  }
});

// -------------------------------------------------------
// GET /api/auth/verify?token=xxx  — verify magic link, set session cookie
// -------------------------------------------------------
router.get('/verify', async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(errorPage('Missing token'));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET());
    if (payload.purpose !== 'magic-link') throw new Error('Invalid token purpose');

    const email = payload.email;
    let user = await findUserByEmail(email);
    if (!user) {
      user = await createUser(email);
    }

    const sessionToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET(),
      { expiresIn: '30d' }
    );

    res.cookie('wi_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.redirect('/dashboard.html');
  } catch (err) {
    console.error('[auth] Verify error:', err.message);
    const msg = err.name === 'TokenExpiredError'
      ? 'This link has expired. Please request a new one.'
      : 'Invalid or expired link.';
    res.status(400).send(errorPage(msg));
  }
});

// -------------------------------------------------------
// POST /api/auth/logout
// -------------------------------------------------------
router.post('/logout', (req, res) => {
  res.clearCookie('wi_session', { path: '/' });
  res.json({ success: true });
});

// -------------------------------------------------------
// GET /api/auth/me  — get current user from session cookie
// -------------------------------------------------------
router.get('/me', (req, res) => {
  const token = req.cookies?.wi_session;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not signed in.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET());
    res.json({ success: true, user: { id: payload.userId, email: payload.email } });
  } catch {
    res.clearCookie('wi_session', { path: '/' });
    res.status(401).json({ success: false, message: 'Session expired.' });
  }
});

function errorPage(message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>WebIntel — Sign In Error</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0f;color:#e4e4ef}
  .card{text-align:center;max-width:400px;padding:48px 32px;background:#12121a;border:1px solid rgba(148,148,168,0.12);border-radius:16px}
  h1{font-size:20px;margin-bottom:12px}
  p{color:#9494a8;margin-bottom:24px;line-height:1.6}
  a{color:#22d3ee;text-decoration:none;font-weight:600}
  a:hover{text-decoration:underline}
</style></head>
<body><div class="card">
  <h1>Sign-in failed</h1>
  <p>${message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}</p>
  <a href="/">Back to WebIntel</a>
</div></body></html>`;
}

module.exports = router;
