const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { findUserByEmail, createUser, createApiKey, getKeysForUser } = require('../db');
const { API_KEYS } = require('../middleware/auth');
const { sendWelcomeEmail } = require('../services/email');

const router = express.Router();

router.post('/', async (req, res) => {
  const { email, tier } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      success: false,
      error: 'invalid_email',
      message: 'A valid email address is required.'
    });
  }

  const keyTier = tier === 'paid' ? 'paid' : 'free';
  const prefix = keyTier === 'free' ? 'wi_free_' : 'wi_live_';
  const apiKey = prefix + uuidv4().replace(/-/g, '');

  const tierLimits = keyTier === 'free'
    ? (process.env.FREE_TIER_LIMIT || '100') + ' requests/day'
    : (process.env.PAID_TIER_LIMIT || '5,000') + ' requests/day';

  // Use database if available, otherwise in-memory
  if (process.env.DATABASE_URL) {
    try {
      let user = await findUserByEmail(email);
      if (user) {
        const existingKeys = await getKeysForUser(user.id);
        if (existingKeys.some(k => k.active)) {
          return res.status(409).json({
            success: false,
            error: 'email_exists',
            message: 'An API key already exists for this email. Check your inbox or sign in to your dashboard.'
          });
        }
      } else {
        user = await createUser(email);
      }
      await createApiKey(user.id, apiKey, keyTier);
    } catch (err) {
      console.error('[signup] DB error:', err.message);
      return res.status(500).json({ success: false, message: 'Could not create account.' });
    }
  } else {
    for (const [, data] of API_KEYS) {
      if (data.owner === email) {
        return res.status(409).json({
          success: false,
          error: 'email_exists',
          message: 'An API key already exists for this email. Check your inbox or contact support.'
        });
      }
    }
    API_KEYS.set(apiKey, {
      tier: keyTier,
      owner: email,
      createdAt: new Date().toISOString()
    });
  }

  try {
    await sendWelcomeEmail(email, apiKey);
  } catch (emailErr) {
    console.error('[signup] Email send failed:', emailErr.message);
  }

  res.status(201).json({
    success: true,
    data: {
      apiKey,
      tier: keyTier,
      rateLimit: tierLimits,
      message: `API key created and sent to ${email}`
    }
  });
});

module.exports = router;
