const test = require('node:test');
const assert = require('node:assert/strict');

const { validateUrl } = require('../src/utils/validateUrl');

test('validateUrl accepts valid http URL', async () => {
  const result = await validateUrl('http://example.com');
  assert.equal(result.hostname, 'example.com');
  assert.equal(result.protocol, 'http:');
});

test('validateUrl accepts valid https URL', async () => {
  const result = await validateUrl('https://example.com/path?q=1');
  assert.equal(result.hostname, 'example.com');
  assert.equal(result.protocol, 'https:');
});

test('validateUrl rejects ftp protocol', async () => {
  await assert.rejects(
    () => validateUrl('ftp://example.com'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'invalid_url');
      return true;
    }
  );
});

test('validateUrl rejects data protocol', async () => {
  await assert.rejects(
    () => validateUrl('data:text/html,<h1>hi</h1>'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'invalid_url');
      return true;
    }
  );
});

test('validateUrl rejects javascript protocol', async () => {
  await assert.rejects(
    () => validateUrl('javascript:alert(1)'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'invalid_url');
      return true;
    }
  );
});

test('validateUrl rejects invalid URL format', async () => {
  await assert.rejects(
    () => validateUrl('not-a-url'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'invalid_url');
      return true;
    }
  );
});

test('validateUrl rejects empty string', async () => {
  await assert.rejects(
    () => validateUrl(''),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'invalid_url');
      return true;
    }
  );
});

test('validateUrl rejects localhost', async () => {
  await assert.rejects(
    () => validateUrl('http://localhost/test'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'blocked_url');
      return true;
    }
  );
});

test('validateUrl rejects localhost with port', async () => {
  await assert.rejects(
    () => validateUrl('http://localhost:8080/test'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'blocked_url');
      return true;
    }
  );
});

test('validateUrl rejects IPv6 loopback', async () => {
  await assert.rejects(
    () => validateUrl('http://[::1]/test'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'blocked_url');
      return true;
    }
  );
});

test('validateUrl rejects 127.0.0.1', async () => {
  await assert.rejects(
    () => validateUrl('http://127.0.0.1/test'),
    (err) => {
      assert.equal(err.status, 400);
      assert.ok(err.error === 'blocked_url' || err.error === 'dns_failed');
      return true;
    }
  );
});

test('validateUrl rejects unresolvable hostnames', async () => {
  await assert.rejects(
    () => validateUrl('http://thishostdoesnotexist12345.invalid/'),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.error, 'dns_failed');
      return true;
    }
  );
});

test('validateUrl returns parsed URL object for valid URLs', async () => {
  const result = await validateUrl('https://example.com:443/path?q=test#hash');
  assert.equal(result.protocol, 'https:');
  assert.equal(result.hostname, 'example.com');
  assert.equal(result.pathname, '/path');
  assert.equal(result.search, '?q=test');
  assert.equal(result.hash, '#hash');
});
