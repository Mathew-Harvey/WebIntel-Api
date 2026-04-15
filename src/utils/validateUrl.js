const dns = require('dns');
const { promisify } = require('util');

const dnsLookup = promisify(dns.lookup);

const BLOCKED_RANGES = [
  { prefix: '127.', label: 'loopback' },
  { prefix: '10.', label: 'private' },
  { prefix: '0.', label: 'reserved' },
  { prefix: '169.254.', label: 'link-local' },
  { prefix: '192.168.', label: 'private' },
];

function isBlockedIPv4(ip) {
  for (const range of BLOCKED_RANGES) {
    if (ip.startsWith(range.prefix)) return range.label;
  }
  // 172.16.0.0 – 172.31.255.255
  const parts = ip.split('.');
  if (parts[0] === '172') {
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) return 'private';
  }
  return null;
}

function isBlockedIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return 'loopback';
  if (normalized.startsWith('fe80:')) return 'link-local';
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return 'private';
  // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7);
    return isBlockedIPv4(v4);
  }
  return null;
}

async function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http and https URLs are supported');
    }
  } catch (err) {
    throw { status: 400, error: 'invalid_url', message: err.message };
  }

  const hostname = parsed.hostname;

  if (hostname === 'localhost' || hostname === '[::1]') {
    throw { status: 400, error: 'blocked_url', message: 'Requests to localhost are not allowed' };
  }

  try {
    const { address, family } = await dnsLookup(hostname);
    const reason = family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
    if (reason) {
      throw {
        status: 400,
        error: 'blocked_url',
        message: `Requests to ${reason} network addresses are not allowed`
      };
    }
  } catch (err) {
    if (err.status) throw err;
    throw { status: 400, error: 'dns_failed', message: `Could not resolve hostname: ${hostname}` };
  }

  return parsed;
}

module.exports = { validateUrl };
