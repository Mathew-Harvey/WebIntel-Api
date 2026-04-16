const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const API_KEY = 'wi_test_suite_key';
const PAID_KEY = 'wi_test_paid_key';
const TEST_EMAIL = 'test-suite-user@example.com';

let serverProcess;
let serverLogs = '';
let baseUrl;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(url, timeoutMs = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch (_) {
      // Server not ready yet.
    }
    await sleep(150);
  }

  throw new Error(`Server did not become ready in ${timeoutMs}ms.\nLogs:\n${serverLogs}`);
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test.before(async () => {
  const port = 3300 + Math.floor(Math.random() * 400);
  baseUrl = `http://localhost:${port}`;

  serverProcess = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DATABASE_URL: '',
      API_KEYS: `${API_KEY}:free,${PAID_KEY}:paid`,
      RESEND_API_KEY: '',
      ALLOWED_ORIGINS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });
  serverProcess.stderr.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });

  await waitForServerReady(baseUrl);
});

test.after(async () => {
  if (!serverProcess || serverProcess.killed) return;

  const exited = new Promise((resolve) => {
    serverProcess.once('exit', resolve);
  });

  serverProcess.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
});

// -------------------------------------------------------
// Health
// -------------------------------------------------------

test('GET /health returns service status', async () => {
  const { response, body } = await jsonRequest('/health');

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptime, 'number');
  assert.ok(body.timestamp);
});

// -------------------------------------------------------
// Root route
// -------------------------------------------------------

test('GET / returns JSON for API clients', async () => {
  const { response, body } = await jsonRequest('/', {
    headers: { Accept: 'application/json' }
  });

  assert.equal(response.status, 200);
  assert.equal(body.name, 'WebIntel API');
  assert.equal(body.version, '1.0.0');
  assert.equal(body.endpoints.preview.path, '/v1/preview?url={url}');
  assert.equal(body.endpoints.screenshot.path, '/v1/screenshot?url={url}');
  assert.ok(body.auth);
  assert.ok(body.docs);
});

test('GET / returns HTML for browser clients', async () => {
  const { response, body } = await jsonRequest('/', {
    headers: { Accept: 'text/html' }
  });

  assert.equal(response.status, 200);
  assert.ok(typeof body === 'string');
  assert.ok(body.includes('<!DOCTYPE html>') || body.includes('<html'));
});

// -------------------------------------------------------
// 404 handler
// -------------------------------------------------------

test('GET /nonexistent returns 404 with JSON body', async () => {
  const { response, body } = await jsonRequest('/nonexistent', {
    headers: { Accept: 'application/json' }
  });

  assert.equal(response.status, 404);
  assert.equal(body.error, 'not_found');
  assert.ok(body.message.includes('/nonexistent'));
});

// -------------------------------------------------------
// Authentication middleware
// -------------------------------------------------------

test('GET /v1/preview rejects requests without API key', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=https://example.com');

  assert.equal(response.status, 401);
  assert.equal(body.error, 'missing_api_key');
});

test('GET /v1/preview rejects invalid API keys', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=https://example.com', {
    headers: { 'x-api-key': 'wi_invalid_key' }
  });

  assert.equal(response.status, 403);
  assert.equal(body.error, 'invalid_api_key');
});

test('GET /v1/screenshot rejects requests without API key', async () => {
  const { response, body } = await jsonRequest('/v1/screenshot?url=https://example.com');

  assert.equal(response.status, 401);
  assert.equal(body.error, 'missing_api_key');
});

test('accepts API key via x-api-key header', async () => {
  const { response, body } = await jsonRequest('/v1/preview', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
});

test('accepts API key via query parameter', async () => {
  const { response, body } = await jsonRequest(`/v1/preview?api_key=${API_KEY}`);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
});

// -------------------------------------------------------
// Preview route validation
// -------------------------------------------------------

test('GET /v1/preview returns 400 when url is missing', async () => {
  const { response, body } = await jsonRequest('/v1/preview', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
  assert.ok(body.example);
});

test('GET /v1/preview returns 400 for invalid URL', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=not-a-url', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.ok(body.error);
});

test('GET /v1/preview rejects localhost URLs', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=http://localhost:8080/test', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'blocked_url');
});

test('GET /v1/preview rejects private network URLs', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=http://192.168.1.1/', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.ok(body.error === 'blocked_url' || body.error === 'dns_failed');
});

test('GET /v1/preview rejects ftp protocol', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=ftp://example.com/file', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_url');
});

// -------------------------------------------------------
// Screenshot route validation
// -------------------------------------------------------

test('GET /v1/screenshot returns 400 when url is missing', async () => {
  const { response, body } = await jsonRequest('/v1/screenshot', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
  assert.ok(body.example);
});

test('GET /v1/screenshot requires url even with valid query api_key', async () => {
  const { response, body } = await jsonRequest(`/v1/screenshot?api_key=${API_KEY}`);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
});

test('GET /v1/screenshot rejects localhost URLs', async () => {
  const { response, body } = await jsonRequest('/v1/screenshot?url=http://localhost/', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'blocked_url');
});

// -------------------------------------------------------
// Signup
// -------------------------------------------------------

test('POST /api/signup rejects missing email', async () => {
  const { response, body } = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_email');
});

test('POST /api/signup rejects invalid email', async () => {
  const { response, body } = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'notanemail' })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_email');
});

test('POST /api/signup creates free key successfully', async () => {
  const { response, body } = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, tier: 'free' })
  });

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.data.tier, 'free');
  assert.ok(body.data.apiKey.startsWith('wi_free_'));
  assert.ok(body.data.rateLimit);
  assert.ok(body.data.message.includes(TEST_EMAIL));
});

test('POST /api/signup blocks duplicate email', async () => {
  const { response, body } = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, tier: 'free' })
  });

  assert.equal(response.status, 409);
  assert.equal(body.error, 'email_exists');
});

test('POST /api/signup defaults to free tier when tier is omitted', async () => {
  const { response, body } = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'notier@example.com' })
  });

  assert.equal(response.status, 201);
  assert.equal(body.data.tier, 'free');
  assert.ok(body.data.apiKey.startsWith('wi_free_'));
});

// -------------------------------------------------------
// Auth routes (no DB — limited testing)
// -------------------------------------------------------

test('POST /api/auth/magic-link rejects missing email', async () => {
  const { response, body } = await jsonRequest('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

test('POST /api/auth/magic-link rejects invalid email', async () => {
  const { response, body } = await jsonRequest('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'bad' })
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

test('GET /api/auth/verify rejects missing token', async () => {
  const { response, body } = await jsonRequest('/api/auth/verify');

  assert.equal(response.status, 400);
  assert.ok(typeof body === 'string');
  assert.ok(body.includes('Missing token'));
});

test('GET /api/auth/verify rejects invalid token', async () => {
  const { response, body } = await jsonRequest('/api/auth/verify?token=invalid.jwt.token');

  assert.equal(response.status, 400);
  assert.ok(typeof body === 'string');
  assert.ok(body.includes('Sign-in failed') || body.includes('Invalid'));
});

test('POST /api/auth/logout clears session', async () => {
  const { response, body } = await jsonRequest('/api/auth/logout', {
    method: 'POST'
  });

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  const setCookie = response.headers.get('set-cookie') || '';
  assert.ok(setCookie.includes('wi_session'));
});

test('GET /api/auth/me rejects unauthenticated request', async () => {
  const { response, body } = await jsonRequest('/api/auth/me');

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.ok(body.message.includes('Not signed in'));
});

// -------------------------------------------------------
// Dashboard routes (require session — should reject without cookie)
// -------------------------------------------------------

test('GET /api/dashboard rejects unauthenticated request', async () => {
  const { response, body } = await jsonRequest('/api/dashboard');

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
  assert.ok(body.message.includes('Not signed in'));
});

test('POST /api/dashboard/keys rejects unauthenticated request', async () => {
  const { response, body } = await jsonRequest('/api/dashboard/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
});

test('DELETE /api/dashboard/keys/1 rejects unauthenticated request', async () => {
  const { response, body } = await jsonRequest('/api/dashboard/keys/1', {
    method: 'DELETE',
  });

  assert.equal(response.status, 401);
  assert.equal(body.success, false);
});

// -------------------------------------------------------
// Billing routes (no Stripe configured — should handle gracefully)
// -------------------------------------------------------

test('POST /api/billing/checkout rejects missing email', async () => {
  const { response, body } = await jsonRequest('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

test('POST /api/billing/checkout rejects invalid email', async () => {
  const { response, body } = await jsonRequest('/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nope' })
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

test('POST /api/billing/portal rejects missing email', async () => {
  const { response, body } = await jsonRequest('/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
});

// -------------------------------------------------------
// Rate limit headers
// -------------------------------------------------------

test('Protected routes include rate limit headers', async () => {
  const { response } = await jsonRequest('/v1/preview', {
    headers: { 'x-api-key': API_KEY }
  });

  assert.ok(response.headers.has('ratelimit-limit'));
  assert.ok(response.headers.has('ratelimit-remaining'));
  assert.ok(response.headers.has('ratelimit-reset'));
});

test('Free tier gets lower rate limit than paid tier', async () => {
  const freeResp = await jsonRequest('/v1/preview', {
    headers: { 'x-api-key': API_KEY }
  });
  const paidResp = await jsonRequest('/v1/preview', {
    headers: { 'x-api-key': PAID_KEY }
  });

  const freeLimit = parseInt(freeResp.response.headers.get('ratelimit-limit'));
  const paidLimit = parseInt(paidResp.response.headers.get('ratelimit-limit'));
  assert.ok(paidLimit > freeLimit, `Paid limit (${paidLimit}) should exceed free limit (${freeLimit})`);
});

// -------------------------------------------------------
// CORS headers
// -------------------------------------------------------

test('Response includes CORS headers', async () => {
  const { response } = await jsonRequest('/health', {
    headers: { Origin: 'http://localhost:5500' }
  });

  assert.ok(response.headers.has('access-control-allow-origin'));
});

// -------------------------------------------------------
// Security headers (Helmet)
// -------------------------------------------------------

test('Response includes security headers from Helmet', async () => {
  const { response } = await jsonRequest('/health');

  assert.ok(response.headers.has('x-content-type-options'));
  assert.ok(response.headers.has('x-frame-options'));
});

// -------------------------------------------------------
// Preview success (integration — requires network, skip if fails)
// -------------------------------------------------------

test('GET /v1/preview returns preview data for a valid URL', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=https://example.com', {
    headers: { 'x-api-key': API_KEY }
  });

  if (response.status === 502 || response.status === 504) {
    // Network may not be available in CI; treat as skip
    return;
  }

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.data);
  assert.ok(body.data.url);
  assert.equal(typeof body.data.responseTime, 'number');
});

test('Preview response includes expected metadata fields', async () => {
  const { response, body } = await jsonRequest('/v1/preview?url=https://example.com', {
    headers: { 'x-api-key': API_KEY }
  });

  if (response.status !== 200) return;

  const data = body.data;
  const expectedFields = ['url', 'title', 'description', 'image', 'favicon', 'siteName', 'type', 'responseTime'];
  for (const field of expectedFields) {
    assert.ok(field in data, `Missing field: ${field}`);
  }
});
