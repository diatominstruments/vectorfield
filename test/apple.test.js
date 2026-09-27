import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyAppleIdToken } from '../server/apple.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const getKey = async (kid) => (kid === 'k1' ? jwk : null);
const AUD = 'com.example.vectorfield.web';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, header = {}, key = privateKey) {
  const head = b64({ alg: 'RS256', kid: 'k1', ...header });
  const body = b64({ iss: 'https://appleid.apple.com', aud: AUD, sub: '001.abc', exp: Date.now() / 1000 + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const check = (t) => verifyAppleIdToken(t, { audience: AUD, getKey });

test('a good Apple ID token verifies', async () => {
  const payload = await check(token({ email: 'x@privaterelay.appleid.com', email_verified: 'true' }));
  assert.equal(payload.sub, '001.abc');
});

test('bad Apple ID tokens are rejected', async () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(check(token({}, {}, other)), /signature/);
  await assert.rejects(check(token({ aud: 'someone.else' })), /audience/);
  await assert.rejects(check(token({ iss: 'https://evil.example' })), /issuer/);
  await assert.rejects(check(token({ exp: Date.now() / 1000 - 3600 })), /Expired/);
  await assert.rejects(check(token({}, { kid: 'nope' })), /Unknown/);
  await assert.rejects(check(token({}, { alg: 'none' })), /algorithm/);
  await assert.rejects(check('not.a-token'), /Malformed/);
});
