/**
 * API Key Authentication Middleware
 * 
 * Checks keys in this order:
 *   1. PostgreSQL (if DATABASE_URL is set)
 *   2. In-memory fallback (from API_KEYS env var)
 * 
 * Expects header: x-api-key: wi_xxxxx
 */

const { findKeyByValue } = require('../db');

const API_KEYS = new Map();

/**
 * Load keys from env for fallback / local dev without a database.
 * Format: "key:tier,key:tier" or plain "key,key" (defaults to paid).
 */
function loadKeys() {
  const entries = (process.env.API_KEYS || '').split(',').filter(Boolean);
  entries.forEach(entry => {
    const [key, tier] = entry.trim().split(':');
    API_KEYS.set(key, {
      tier: tier === 'free' ? 'free' : 'paid',
      owner: 'env',
      createdAt: new Date().toISOString()
    });
  });
  console.log(`[auth] Loaded ${API_KEYS.size} env API keys`);
}

async function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      error: 'missing_api_key',
      message: 'Include your API key via the x-api-key header.',
      docs: 'https://webintel.dev/docs'
    });
  }

  // Try database first
  if (process.env.DATABASE_URL) {
    try {
      const keyData = await findKeyByValue(apiKey);
      if (keyData) {
        req.apiKey = apiKey;
        req.tier = keyData.tier;
        req.keyOwner = keyData.email;
        return next();
      }
    } catch (err) {
      console.error('[auth] DB lookup failed, falling back to env:', err.message);
    }
  }

  // Fallback to in-memory
  const envKey = API_KEYS.get(apiKey);
  if (envKey) {
    req.apiKey = apiKey;
    req.tier = envKey.tier;
    req.keyOwner = envKey.owner;
    return next();
  }

  res.status(403).json({
    error: 'invalid_api_key',
    message: 'API key not recognised. Check your key or sign up at https://webintel.dev'
  });
}

module.exports = { authenticate, loadKeys, API_KEYS };
