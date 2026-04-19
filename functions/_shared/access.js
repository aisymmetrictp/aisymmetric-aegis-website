const VALID_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SKEW_TOLERANCE_MS = 5 * 60 * 1000;

async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

function bytesToBase36(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString(36).toUpperCase();
}

export async function generateAccessCode(secret) {
  if (!secret) throw new Error('ACCESS_SECRET not configured');
  const issuedSec = Math.floor(Date.now() / 1000);
  const issuedB36 = issuedSec.toString(36).padStart(7, '0').toUpperCase().slice(-7);
  const sig = await hmacSha256(secret, issuedB36);
  const sigB36 = bytesToBase36(sig).padStart(9, '0').slice(0, 9);
  const body = (issuedB36 + sigB36);
  const groups = body.match(/.{1,4}/g).join('-');
  return { code: 'AEGIS-' + groups, issuedAt: new Date(issuedSec * 1000), expiresAt: new Date(issuedSec * 1000 + VALID_WINDOW_MS) };
}

export async function verifyAccessCode(secret, code) {
  if (!secret) return { valid: false, error: 'server-misconfigured' };
  if (!code || typeof code !== 'string') return { valid: false, error: 'missing' };
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean.startsWith('AEGIS') || clean.length < 21) return { valid: false, error: 'malformed' };
  const payload = clean.slice(5);
  if (payload.length < 16) return { valid: false, error: 'malformed' };
  const issuedB36 = payload.slice(0, 7);
  const sigB36 = payload.slice(7, 16);
  const issuedSec = parseInt(issuedB36, 36);
  if (isNaN(issuedSec) || issuedSec <= 0) return { valid: false, error: 'malformed' };
  const ageMs = Date.now() - issuedSec * 1000;
  if (ageMs > VALID_WINDOW_MS) return { valid: false, error: 'expired' };
  if (ageMs < -SKEW_TOLERANCE_MS) return { valid: false, error: 'future' };
  const sig = await hmacSha256(secret, issuedB36);
  const expected = bytesToBase36(sig).padStart(9, '0').slice(0, 9);
  if (!timingSafeEqual(expected, sigB36)) return { valid: false, error: 'invalid' };
  return { valid: true, issuedAt: new Date(issuedSec * 1000), expiresAt: new Date(issuedSec * 1000 + VALID_WINDOW_MS) };
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
