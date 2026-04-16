const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connStr = process.env.DATABASE_URL || '';
    const isLocalDb = connStr.includes('localhost') || connStr.includes('127.0.0.1');
    pool = new Pool({
      connectionString: connStr,
      ssl: isLocalDb ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function initDB() {
  const client = getPool();

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      stripe_customer_id TEXT UNIQUE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id            SERIAL PRIMARY KEY,
      user_id       INT REFERENCES users(id) ON DELETE CASCADE,
      key           TEXT UNIQUE NOT NULL,
      tier          TEXT NOT NULL DEFAULT 'free',
      active        BOOLEAN DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id                      SERIAL PRIMARY KEY,
      user_id                 INT REFERENCES users(id) ON DELETE CASCADE,
      stripe_subscription_id  TEXT UNIQUE,
      stripe_price_id         TEXT,
      status                  TEXT DEFAULT 'active',
      current_period_end      TIMESTAMPTZ,
      created_at              TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
  `);

  console.log('[db] Tables ready');
}

// --- User helpers ---

async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser(email, stripeCustomerId = null) {
  const { rows } = await query(
    'INSERT INTO users (email, stripe_customer_id) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, users.stripe_customer_id) RETURNING *',
    [email, stripeCustomerId]
  );
  return rows[0];
}

async function updateUserStripeId(userId, stripeCustomerId) {
  await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [stripeCustomerId, userId]);
}

// --- API Key helpers ---

async function findKeyByValue(key) {
  const { rows } = await query(
    'SELECT ak.*, u.email FROM api_keys ak JOIN users u ON u.id = ak.user_id WHERE ak.key = $1 AND ak.active = true',
    [key]
  );
  return rows[0] || null;
}

async function getKeysForUser(userId) {
  const { rows } = await query(
    'SELECT id, key, tier, active, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

async function createApiKey(userId, key, tier = 'free') {
  const { rows } = await query(
    'INSERT INTO api_keys (user_id, key, tier) VALUES ($1, $2, $3) RETURNING *',
    [userId, key, tier]
  );
  return rows[0];
}

async function revokeApiKey(keyId, userId) {
  const { rowCount } = await query(
    'UPDATE api_keys SET active = false WHERE id = $1 AND user_id = $2',
    [keyId, userId]
  );
  return rowCount > 0;
}

async function upgradeUserKeys(userId, tier) {
  await query('UPDATE api_keys SET tier = $1 WHERE user_id = $2 AND active = true', [tier, userId]);
}

// --- Subscription helpers ---

async function upsertSubscription(userId, stripeSubId, stripePriceId, status, periodEnd) {
  const { rows } = await query(
    `INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_price_id, status, current_period_end)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (stripe_subscription_id)
     DO UPDATE SET status = $4, current_period_end = $5, stripe_price_id = $3
     RETURNING *`,
    [userId, stripeSubId, stripePriceId, status, periodEnd]
  );
  return rows[0];
}

async function getSubscriptionForUser(userId) {
  const { rows } = await query(
    'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

module.exports = {
  getPool,
  query,
  initDB,
  findUserByEmail,
  findUserById,
  createUser,
  updateUserStripeId,
  findKeyByValue,
  getKeysForUser,
  createApiKey,
  revokeApiKey,
  upgradeUserKeys,
  upsertSubscription,
  getSubscriptionForUser,
};
