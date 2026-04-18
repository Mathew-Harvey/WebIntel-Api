/**
 * Web Bot Auth — HTTP Message Signatures directory.
 *
 * Publishes an Ed25519 JWKS at /.well-known/http-message-signatures-directory
 * and signs the directory response itself per RFC 9421, so receiving sites
 * can verify WebIntel's identity when it makes signed agent requests.
 *
 *   Docs: https://datatracker.ietf.org/wg/webbotauth/about/
 *         https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/
 *         https://www.rfc-editor.org/rfc/rfc9421
 *
 * Key material:
 *   WEB_BOT_AUTH_ED25519_PRIVATE_KEY_PEM  — PKCS#8 PEM of an Ed25519 private
 *                                           key. If unset, an ephemeral key
 *                                           is generated on boot (dev only).
 */

const crypto = require('crypto');

let keypair = null;
let cachedJwk = null;
let cachedThumbprint = null;

function load() {
  const pem = process.env.WEB_BOT_AUTH_ED25519_PRIVATE_KEY_PEM;
  if (pem) {
    const privateKey = crypto.createPrivateKey(pem);
    const publicKey = crypto.createPublicKey(privateKey);
    keypair = { privateKey, publicKey };
  } else {
    keypair = crypto.generateKeyPairSync('ed25519');
    console.warn(
      '[web-bot-auth] Using ephemeral Ed25519 key — set ' +
      'WEB_BOT_AUTH_ED25519_PRIVATE_KEY_PEM in production so the key is stable.'
    );
  }

  // Cache JWK (RFC 7517) and JWK thumbprint (RFC 7638).
  cachedJwk = keypair.publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({
    crv: cachedJwk.crv,
    kty: cachedJwk.kty,
    x: cachedJwk.x
  });
  cachedThumbprint = crypto.createHash('sha256').update(canonical).digest('base64url');
}

function getJwk() {
  if (!cachedJwk) load();
  return cachedJwk;
}

function getThumbprint() {
  if (!cachedThumbprint) load();
  return cachedThumbprint;
}

/**
 * Build an RFC 9421 signature base for a single covered component. Used for
 * both signing the directory response and (optionally) signing outbound
 * requests with tag="web-bot-auth".
 */
function buildSignatureBase(components, params) {
  const lines = components.map(([name, value]) => `"${name}": ${value}`);
  lines.push(`"@signature-params": ${params}`);
  return lines.join('\n');
}

function paramsString({ components, keyid, tag, created, expires, alg = 'ed25519' }) {
  const covered = '(' + components.map((c) => `"${c}"`).join(' ') + ')';
  return (
    `${covered};created=${created};expires=${expires};` +
    `keyid="${keyid}";alg="${alg}";tag="${tag}"`
  );
}

/**
 * Sign the directory response per the Web Bot Auth draft.
 *
 * Covered components: @authority
 * Tag:                http-message-signatures-directory
 */
function signDirectoryResponse({ authority, now = Math.floor(Date.now() / 1000), ttlSec = 86400 }) {
  if (!keypair) load();

  const created = now;
  const expires = now + ttlSec;
  const keyid = getThumbprint();

  const params = paramsString({
    components: ['@authority'],
    keyid,
    tag: 'http-message-signatures-directory',
    created,
    expires
  });

  const base = buildSignatureBase([['@authority', authority]], params);
  const signature = crypto.sign(null, Buffer.from(base, 'utf8'), keypair.privateKey);

  return {
    signatureInput: `sig1=${params}`,
    signature: `sig1=:${signature.toString('base64')}:`,
    keyid
  };
}

module.exports = {
  load,
  getJwk,
  getThumbprint,
  signDirectoryResponse,
  _internal: { buildSignatureBase, paramsString }
};
