/**
 * POST /api/webhook
 *
 * PayOS calls this endpoint when a payment is completed or cancelled.
 * Verifies the HMAC signature, then updates the order status in D1.
 *
 * PayOS webhook docs: https://payos.vn/docs/webhook/
 */

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // ── 1. Verify PayOS webhook signature ─────────────────────────────────────
  const { code, data, signature } = body;

  const signatureData = [
    `amount=${data.amount}`,
    `description=${data.description}`,
    `orderCode=${data.orderCode}`,
    `reference=${data.reference}`,
    `transactionDateTime=${data.transactionDateTime}`,
  ].join('&');

  const expectedSig = await hmacSHA256(env.PAYOS_CHECKSUM_KEY, signatureData);

  if (expectedSig !== signature) {
    console.warn('Webhook signature mismatch');
    return new Response('Unauthorized', { status: 401 });
  }

  // ── 2. Map PayOS code to order status ─────────────────────────────────────
  // code '00' = success, '01' = cancelled
  const newStatus = code === '00' ? 'PAID' : 'CANCELLED';

  // ── 3. Update order in D1 by payment reference ────────────────────────────
  try {
    await env.DB.prepare(`
      UPDATE orders SET status = ? WHERE payment_ref = ?
    `).bind(newStatus, String(data.orderCode)).run();
  } catch (err) {
    console.error('D1 update failed:', err);
    return new Response('Internal Server Error', { status: 500 });
  }

  // PayOS expects a 200 OK to acknowledge receipt
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hmacSHA256(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
