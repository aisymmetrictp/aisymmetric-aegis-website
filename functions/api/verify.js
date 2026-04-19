import { verifyAccessCode } from '../_shared/access.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || request.headers.get('x-aegis-code');
  const result = await verifyAccessCode(env.ACCESS_SECRET, code);

  return new Response(JSON.stringify({
    ok: result.valid,
    error: result.error,
    expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
  }), {
    status: result.valid ? 200 : 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
