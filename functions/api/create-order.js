/**
 * POST /api/create-order
 *
 * Creates an order in D1, generates a VietQR payment URL,
 * and sends a Telegram notification to the shop owner.
 *
 * Expected request body:
 * {
 *   customerName: string,
 *   phone:        string,
 *   address:      string,
 *   items:        [{ name, price, qty }],
 *   totalAmount:  number   (VND, e.g. 75000)
 * }
 *
 * Returns:
 * {
 *   success:     boolean,
 *   orderId:     string,
 *   vietqrUrl:   string,   (QR image URL)
 *   paymentDesc: string    (bank transfer description)
 * }
 *
 * Required env secrets (set via: wrangler secret put <NAME>):
 *   VIETQR_BANK_ID      — bank code, e.g. "MB", "VCB", "TCB"
 *   VIETQR_ACCOUNT_NO   — account number
 *   VIETQR_ACCOUNT_NAME — account holder name (uppercase, no accents)
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_ID    — your personal or group chat ID
 */

export async function onRequestPost({ request, env }) {
  // ── 1. Parse & validate ────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { customerName, phone, address, items, totalAmount } = body;

  if (!customerName || !phone || !address || !items?.length || !totalAmount) {
    return jsonError('Missing required fields', 400);
  }

  // ── 2. Generate order ID ───────────────────────────────────────────────────
  const orderId     = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const paymentDesc = `168CAFE ${orderId.slice(-8)}`; // short bank transfer memo

  // ── 3. Build VietQR image URL ──────────────────────────────────────────────
  // Docs: https://vietqr.io/danh-sach-api/khoi-tao-ma-qr/
  const vietqrUrl = buildVietQRUrl({
    bankId:      env.VIETQR_BANK_ID,
    accountNo:   env.VIETQR_ACCOUNT_NO,
    accountName: env.VIETQR_ACCOUNT_NAME,
    amount:      totalAmount,
    addInfo:     paymentDesc,
  });

  // ── 4. Persist order to D1 ─────────────────────────────────────────────────
  try {
    await env.DB.prepare(`
      INSERT INTO orders (order_id, customer_name, phone, address, items, amount, status, checkout_url, payment_ref)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).bind(
      orderId,
      customerName,
      phone,
      address,
      JSON.stringify(items),
      totalAmount,
      vietqrUrl,
      paymentDesc,
    ).run();
  } catch (err) {
    console.error('D1 insert failed:', err);
    return jsonError('Database error', 500);
  }

  // ── 5. Send Telegram notification ─────────────────────────────────────────
  try {
    await sendTelegram(env, orderId, customerName, phone, address, items, totalAmount);
  } catch (err) {
    console.error('Telegram notify failed:', err.message);
  }

  // ── 6. Respond ─────────────────────────────────────────────────────────────
  return jsonResponse({ success: true, orderId, vietqrUrl, paymentDesc }, 201);
}

// ─────────────────────────────────────────────────────────────────────────────
// VietQR URL builder
// Template "compact2" gives a clean QR with logo and amount pre-filled.
// ─────────────────────────────────────────────────────────────────────────────
function buildVietQRUrl({ bankId, accountNo, accountName, amount, addInfo }) {
  const base = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png`;
  const params = new URLSearchParams({
    amount:      String(amount),
    addInfo:     addInfo,
    accountName: accountName,
  });
  return `${base}?${params.toString()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Bot notification
// ─────────────────────────────────────────────────────────────────────────────
async function sendTelegram(env, orderId, customerName, phone, address, items, totalAmount) {
  console.log('sendTelegram called, token present:', !!env.TELEGRAM_BOT_TOKEN, 'chat_id present:', !!env.TELEGRAM_CHAT_ID);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

  const lines = items.map(i => {
    const price = Number(i.price.replace(/[^0-9]/g, '')).toLocaleString('vi-VN');
    const note = i.note ? ` (${i.note})` : '';
    return `  • ${i.name} x${i.qty} — ${price}đ${note}`;
  }).join('\n');
  const text = [
    `🛍 *Đơn hàng mới* — ${orderId}`,
    ``,
    `👤 ${customerName}`,
    `📞 ${phone}`,
    `📍 ${address}`,
    ``,
    lines,
    ``,
    `💰 *Tổng: ${totalAmount.toLocaleString('vi-VN')}đ*`,
    ``,
    `Trạng thái: PENDING — chờ thanh toán VietQR`,
  ].join('\n');

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id:    env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
    }),
  }).then(r => r.json()).then(r => {
    if (!r.ok) console.error('Telegram API error:', JSON.stringify(r));
    else console.log('Telegram sent ok, message_id:', r.result?.message_id);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ success: false, error: message }, status);
}
