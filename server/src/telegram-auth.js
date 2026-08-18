import crypto from 'node:crypto';

export function parseInitData(initData = '') {
  return Object.fromEntries(new URLSearchParams(initData));
}

export function validateTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) return { ok: false, reason: 'missing initData or bot token' };
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) return { ok: false, reason: 'hash missing' };
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const a = Buffer.from(receivedHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad hash' };
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now()/1000 - authDate) > maxAgeSeconds) return { ok: false, reason: 'initData expired' };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch {}
  if (!user?.id) return { ok: false, reason: 'user missing' };
  return { ok: true, user, authDate };
}
