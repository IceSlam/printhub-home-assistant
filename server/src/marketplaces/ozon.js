import { fetchJson, fetchBinary, boolEnv, summarizeLineItems } from './common.js';

const API = 'https://api-seller.ozon.ru';
const DAY_MS = 24 * 60 * 60 * 1000;

function headers() {
  return {
    'Client-Id': process.env.OZON_CLIENT_ID || '',
    'Api-Key': process.env.OZON_API_KEY || '',
    'Content-Type': 'application/json',
  };
}

function intEnv(name, fallback, min = 1, max = 365) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isoOffsetFromNow(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export function ozonEnabled() {
  return boolEnv('OZON_ENABLED', true)
    && Boolean(process.env.OZON_CLIENT_ID)
    && Boolean(process.env.OZON_API_KEY);
}

/**
 * Ozon требует для FBS unfulfilled:
 *   sort_dir
 *   filter.cutoff_from
 *   filter.cutoff_to
 *
 * Нам нужны только отправления, у которых этикетка уже доступна для печати:
 * awaiting_deliver.
 */
export async function listOzonPrintables() {
  if (!ozonEnabled()) return [];

  const pastDays = intEnv('OZON_FBS_CUTOFF_PAST_DAYS', 30);
  const futureDays = intEnv('OZON_FBS_CUTOFF_FUTURE_DAYS', 30);

  const baseBody = {
    sort_dir: 'ASC',
    filter: {
      cutoff_from: isoOffsetFromNow(-pastDays),
      cutoff_to: isoOffsetFromNow(futureDays),
      status: 'awaiting_deliver',
    },
    with: {
      analytics_data: false,
      barcodes: false,
      financial_data: false,
      translit: false,
    },
  };

  // Ozon v4 ограничивает limit диапазоном (0, 100].
  // Загружаем все доступные отправления постранично, не теряя записи после первых 100.
  const pageLimit = 100;
  const maxPages = intEnv('OZON_FBS_MAX_PAGES', 50, 1, 200);
  const postings = [];
  const seenPostingNumbers = new Set();

  for (let page = 0; page < maxPages; page++) {
    const uniqueBeforePage = postings.length;
    const body = {
      ...baseBody,
      limit: pageLimit,
      offset: page * pageLimit,
    };

    let data;
    try {
      data = await fetchJson(`${API}/v4/posting/fbs/unfulfilled/list`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = String(error?.message || error);

      if (message.includes('the mismatch between cutoff & delivery date')) {
        throw new Error(
          'Ozon отклонил диапазон cutoff для FBS. '
          + `Запрошено ${baseBody.filter.cutoff_from} — ${baseBody.filter.cutoff_to}. `
          + 'Проверьте системное время сервера и настройки OZON_FBS_CUTOFF_*.'
        );
      }

      throw new Error(`Ozon FBS page ${page + 1}: ${message}`);
    }

    const pagePostings = data.postings || data.result?.postings || [];

    for (const posting of pagePostings) {
      const number = posting?.posting_number;
      if (!number || seenPostingNumbers.has(number)) continue;
      seenPostingNumbers.add(number);
      postings.push(posting);
    }

    // Последняя страница: Ozon вернул меньше максимального размера.
    if (pagePostings.length < pageLimit) break;

    // Защита от API, игнорирующего offset: если страница не принесла
    // ни одного нового posting_number, дальнейшие запросы не имеют смысла.
    if (pagePostings.length > 0 && postings.length === uniqueBeforePage) break;
  }

  return postings
    .filter(posting => {
      const status = String(posting.status || posting.substatus || '').toLowerCase();
      return status === 'awaiting_deliver' || status === 'awaiting_delivery';
    })
    .map(posting => {
      const summary = summarizeLineItems(posting.products || posting.items || [], {
        nameKeys: ['name', 'offer_name', 'product_name', 'title', 'offer_id', 'sku'],
        qtyKeys: ['quantity', 'qty', 'count'],
        assumeEachIsOne: true,
      });

      return {
        key: `ozon:posting:${posting.posting_number}`,
        marketplace: 'ozon',
        kind: 'shipment-label',
        title: 'Этикетка отправления',
        subtitle: `Ozon • ${posting.posting_number}`,
        itemName: summary.itemName || null,
        quantityText: summary.quantityText || null,
        size: '58x40',
        widthMm: 58,
        heightMm: 40,
        remoteId: posting.posting_number,
        updatedAt:
          posting.in_process_at
          || posting.shipment_date
          || posting.cutoff
          || new Date().toISOString(),
      };
    });
}

export async function downloadOzonPrintable(item) {
  return fetchBinary(`${API}/v2/posting/fbs/package-label`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      posting_number: [item.remoteId],
    }),
  });
}
