/**
 * Tier-aware Rate Limiting
 * 
 * Free tier:  100 requests / day
 * Paid tier:  5,000 requests / day
 * 
 * Uses in-memory store. For production with multiple
 * instances, swap to Redis via rate-limit-redis.
 */

const rateLimit = require('express-rate-limit');

const WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS) || 86400000; // 24h
const FREE_LIMIT = parseInt(process.env.FREE_TIER_LIMIT) || 100;
const PAID_LIMIT = parseInt(process.env.PAID_TIER_LIMIT) || 5000;

const limiter = rateLimit({
  windowMs: WINDOW_MS,
  max: (req) => {
    return req.tier === 'paid' ? PAID_LIMIT : FREE_LIMIT;
  },
  keyGenerator: (req) => {
    // Rate limit per API key, not per IP
    return req.apiKey || req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    const limit = req.tier === 'paid' ? PAID_LIMIT : FREE_LIMIT;
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: `You've hit your ${req.tier} tier limit of ${limit} requests/day.`,
      upgrade: req.tier === 'free'
        ? 'Upgrade to paid at https://webintel-api.com/pricing for 5,000 requests/day.'
        : 'Contact us for enterprise limits at hello@webintel-api.com',
      retryAfter
    });
  }
});

module.exports = { limiter };
