const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const {
  findUserById,
  getKeysForUser,
  createApiKey,
  revokeApiKey,
  getSubscriptionForUser,
} = require('../db');

const router = express.Router();

const JWT_SECRET = () => process.env.JWT_SECRET || 'change-me-in-production';

function requireSession(req, res, next) {
  const token = req.cookies?.wi_session;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not signed in.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET());
    req.sessionUser = { id: payload.userId, email: payload.email };
    next();
  } catch {
    res.clearCookie('wi_session', { path: '/' });
    res.status(401).json({ success: false, message: 'Session expired.' });
  }
}

router.use(requireSession);

// -------------------------------------------------------
// GET /api/dashboard  — full dashboard data
// -------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { id, email } = req.sessionUser;
    const user = await findUserById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const keys = await getKeysForUser(id);
    const subscription = await getSubscriptionForUser(id);

    const tier = subscription?.status === 'active' ? 'paid' : 'free';

    res.json({
      success: true,
      data: {
        email,
        tier,
        keys: keys.map(k => ({
          id: k.id,
          key: k.key,
          tier: k.tier,
          active: k.active,
          createdAt: k.created_at,
        })),
        subscription: subscription ? {
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          priceId: subscription.stripe_price_id,
        } : null,
        hasStripeAccount: !!user.stripe_customer_id,
      },
    });
  } catch (err) {
    console.error('[dashboard] Error:', err.message);
    res.status(500).json({ success: false, message: 'Could not load dashboard.' });
  }
});

// -------------------------------------------------------
// POST /api/dashboard/keys  — generate a new API key
// -------------------------------------------------------
router.post('/keys', async (req, res) => {
  try {
    const { id } = req.sessionUser;
    const subscription = await getSubscriptionForUser(id);
    const tier = subscription?.status === 'active' ? 'paid' : 'free';

    const existingKeys = await getKeysForUser(id);
    const activeKeys = existingKeys.filter(k => k.active);
    const maxKeys = tier === 'paid' ? 5 : 2;

    if (activeKeys.length >= maxKeys) {
      return res.status(400).json({
        success: false,
        message: `You can have up to ${maxKeys} active keys on the ${tier} plan.`,
      });
    }

    const prefix = tier === 'paid' ? 'wi_live_' : 'wi_free_';
    const apiKey = prefix + uuidv4().replace(/-/g, '');
    const key = await createApiKey(id, apiKey, tier);

    res.status(201).json({
      success: true,
      data: { id: key.id, key: key.key, tier: key.tier, createdAt: key.created_at },
    });
  } catch (err) {
    console.error('[dashboard] Key creation error:', err.message);
    res.status(500).json({ success: false, message: 'Could not create key.' });
  }
});

// -------------------------------------------------------
// DELETE /api/dashboard/keys/:id  — revoke an API key
// -------------------------------------------------------
router.delete('/keys/:keyId', async (req, res) => {
  try {
    const revoked = await revokeApiKey(parseInt(req.params.keyId, 10), req.sessionUser.id);
    if (!revoked) {
      return res.status(404).json({ success: false, message: 'Key not found or already revoked.' });
    }
    res.json({ success: true, message: 'Key revoked.' });
  } catch (err) {
    console.error('[dashboard] Key revoke error:', err.message);
    res.status(500).json({ success: false, message: 'Could not revoke key.' });
  }
});

module.exports = router;
