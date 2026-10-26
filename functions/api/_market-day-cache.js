// Public exchange-day facts only. Never store KIS credentials or tokens here.
export const MARKET_DAY_TTL_MS = 24 * 60 * 60 * 1000;
export function marketDayDate(value) {
  const date = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date + 'T00:00:00Z')) &&
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
}
export function marketDayEvidence(value, date, now = Date.now()) {
  if (!marketDayDate(date) || !value || value.date !== date || value.source !== 'KIS/CTCA0903R' ||
      typeof value.open !== 'boolean' || !['Y', 'N'].includes(value.opndYn) ||
      value.open !== (value.opndYn === 'Y')) return null;
  const at = Date.parse(value.checkedAt || '');
  if (!Number.isFinite(at) || at > now + 90000 || now - at >= MARKET_DAY_TTL_MS) return null;
  return {ok:true, market:'KRX', date, open:value.open, opndYn:value.opndYn,
    businessDay:String(value.businessDay || ''), tradeDay:String(value.tradeDay || ''),
    settlementDay:String(value.settlementDay || ''), source:'KIS/CTCA0903R',
    env:value.env === 'real' ? 'real' : 'vts', checkedAt:new Date(at).toISOString()};
}
const json = (value, status = 200) => Response.json(value, {status, headers:{'cache-control':'no-store'}});
export async function marketDayCache(storage, request, now = Date.now()) {
  if (!['GET', 'POST'].includes(request.method)) return json({ok:false,error:'method not allowed'},405);
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const date = request.method === 'POST' ? body?.date : new URL(request.url).searchParams.get('date');
  if (!marketDayDate(date)) return json({ok:false,error:'invalid market date'},400);
  const key = 'market-day:' + date;
  if (request.method === 'GET') return json({ok:true,evidence:marketDayEvidence(await storage.get(key),date,now)});
  const evidence = marketDayEvidence(body,date,now);
  if (!evidence) return json({ok:false,error:'verified fresh exchange-day evidence required'},400);
  await storage.put(key,evidence);
  return json({ok:true,evidence});
}
