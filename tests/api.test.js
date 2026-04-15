const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const API_KEY = 'wi_test_suite_key';
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
      API_KEYS: `${API_KEY}:free`,
      RESEND_API_KEY: ''
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

test('GET /health returns service status', async () => {
  const { response, body } = await jsonRequest('/health');

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptime, 'number');
  assert.ok(body.timestamp);
});

test('GET / returns JSON for API clients', async () => {
  const { response, body } = await jsonRequest('/', {
    headers: { Accept: 'application/json' }
  });

  assert.equal(response.status, 200);
  assert.equal(body.name, 'WebIntel API');
  assert.equal(body.endpoints.preview.path, '/v1/preview?url={url}');
  assert.equal(body.endpoints.screenshot.path, '/v1/screenshot?url={url}');
});

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

test('GET /v1/preview accepts query api_key and reaches route validation', async () => {
  const { response, body } = await jsonRequest(`/v1/preview?api_key=${API_KEY}`);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
});

test('GET /v1/screenshot requires url even with valid query api_key', async () => {
  const { response, body } = await jsonRequest(`/v1/screenshot?api_key=${API_KEY}`);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'missing_url');
});

test('POST /api/signup creates key and blocks duplicate email', async () => {
  const createAttempt = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      tier: 'free'
    })
  });

  assert.equal(createAttempt.response.status, 201);
  assert.equal(createAttempt.body.success, true);
  assert.equal(createAttempt.body.data.tier, 'free');
  assert.ok(createAttempt.body.data.apiKey.startsWith('wi_free_'));

  const duplicateAttempt = await jsonRequest('/api/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: TEST_EMAIL,
      tier: 'free'
    })
  });

  assert.equal(duplicateAttempt.response.status, 409);
  assert.equal(duplicateAttempt.body.error, 'email_exists');
});
