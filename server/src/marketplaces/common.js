export async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof body === 'string' ? body.slice(0,500) : JSON.stringify(body).slice(0,500)}`);
  return body;
}
export async function fetchBinary(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0,500)}`);
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const data = await res.json();
    const b64 = data.file_content || data.content || data.result?.file_content || data.result?.content || data.result?.file;
    if (b64 && typeof b64 === 'string') return Buffer.from(b64, 'base64');
    const link = data.url || data.file_url || data.result?.url || data.result?.file_url;
    if (link) return fetchBinary(link);
    throw new Error('API returned JSON without PDF content/url');
  }
  return Buffer.from(await res.arrayBuffer());
}
export function boolEnv(name, fallback=false) {
  const v = process.env[name]; if (v == null) return fallback;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}

function firstFilled(obj, keys = []) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value == null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function firstFiniteNumber(obj, keys = []) {
  for (const key of keys) {
    const raw = obj?.[key];
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

export function summarizeLineItems(items, {
  nameKeys = ['name', 'offerName', 'offer_name', 'product_name', 'title', 'subject', 'supplierArticle', 'article', 'brand', 'shopSku', 'sku', 'offer_id', 'barcode'],
  qtyKeys = ['quantity', 'qty', 'count', 'itemCount'],
  assumeEachIsOne = false,
  fallbackName = '',
} = {}) {
  const list = Array.isArray(items) ? items : [];
  const names = [];
  let totalQty = 0;

  for (const item of list) {
    const name = firstFilled(item, nameKeys);
    if (name) names.push(name);

    const qty = firstFiniteNumber(item, qtyKeys);
    if (qty > 0) totalQty += qty;
    else if (assumeEachIsOne) totalQty += 1;
  }

  const uniqueNames = [...new Set(names)];
  let itemName = uniqueNames[0] || fallbackName || '';
  if (uniqueNames.length > 1) {
    itemName = `${uniqueNames[0]} + ещё ${uniqueNames.length - 1}`;
  }

  const quantityText = totalQty > 0 ? `${totalQty} шт.` : '';

  return {
    itemName,
    quantityText,
    totalQty,
    itemCount: uniqueNames.length,
  };
}
