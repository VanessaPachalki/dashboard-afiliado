// ================================================
// Vercel Function — Sincronizar pedidos de afiliado (creator) da TikTok
//
// Fluxo: recebe ?owner=<creator user_id> -> pega o token salvo em
//        tiktok_connections -> chama "Search Creator Affiliate Orders"
//        (assinado) -> mapeia pro schema `orders` -> upsert no Supabase.
//
// ⚠️ ESTADO: plumbing pronto e assinatura fiel ao contrato oficial, MAS:
//   - a VERSÃO/PATH exatos do endpoint e os NOMES dos campos da resposta
//     precisam ser confirmados com 1 chamada real (só possível quando a
//     região BR for liberada e existir um token). Marcado com CONFIRMAR.
//
// Env vars: TIKTOK_APP_KEY, TIKTOK_APP_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ================================================

import crypto from 'crypto';

const TOKEN_HOST = 'https://auth.tiktok-shops.com';
const API_HOST = 'https://open-api.tiktokglobalshop.com';
// Search Creator Affiliate Orders — confirmado na OAS oficial (highest version).
const ORDERS_PATH = '/affiliate_creator/202410/orders/search';

// ---- assinatura HMAC-SHA256 (Sign your API request) ----
// base = app_secret + path + {sortedKey}{value}... (+ body cru) + app_secret
function signRequest(path, queryParams, bodyStr, appSecret) {
  const keys = Object.keys(queryParams)
    .filter(k => k !== 'sign' && k !== 'access_token')
    .sort();
  let base = appSecret + path;
  for (const k of keys) base += k + queryParams[k];
  if (bodyStr) base += bodyStr;
  base += appSecret;
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex');
}

async function signedPost(path, extraQuery, body, accessToken) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const timestamp = Math.floor(Date.now() / 1000).toString(); // Unix segundos
  const query = { app_key: appKey, timestamp, ...extraQuery };
  const bodyStr = body ? JSON.stringify(body) : '';
  query.sign = signRequest(path, query, bodyStr, appSecret);

  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const resp = await fetch(`${API_HOST}${path}?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken },
    body: bodyStr || undefined
  });
  return resp.json();
}

// ---- Supabase REST (service role) ----
async function sb(path, opts = {}) {
  const url = process.env.SUPABASE_URL + '/rest/v1/' + path;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(url, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'content-type': 'application/json', ...(opts.headers || {})
    }
  });
}

// ---- refresh do access_token quando expirado ----
async function refreshToken(conn) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const url = `${TOKEN_HOST}/api/v2/token/refresh`
    + `?app_key=${encodeURIComponent(appKey)}`
    + `&app_secret=${encodeURIComponent(appSecret)}`
    + `&refresh_token=${encodeURIComponent(conn.refresh_token)}`
    + '&grant_type=refresh_token';
  const j = await (await fetch(url)).json();
  const d = j && j.data;
  if (!d || !d.access_token) return null;
  const now = Date.now();
  const iso = s => s ? new Date(now + s * 1000).toISOString() : null;
  await sb(`tiktok_connections?owner_id=eq.${conn.owner_id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: d.access_token,
      refresh_token: d.refresh_token || conn.refresh_token,
      access_expire_at: iso(d.access_token_expire_in),
      refresh_expire_at: iso(d.refresh_token_expire_in),
      updated_at: new Date().toISOString()
    })
  });
  return d.access_token;
}

// ---- helpers de mapeamento (schema confirmado na OAS 202410) ----
const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const amt = o => (o && o.amount != null ? num(o.amount) : 0); // {amount,currency}
const CONTENT_TYPE_MAP = { LIVE: 0, VIDEO: 1, SHOWCASE: 3, PRODUCT_CARD: 2 };
function mapStatus(s) {
  const u = String(s || '').toUpperCase();
  if (u.includes('UNSETTLE')) return 2;            // ainda não liquidado
  if (u.includes('SETTLE')) return 0;              // liquidado
  if (u.includes('INVALID') || u.includes('CANCEL') || u.includes('REFUND')) return 1;
  return 2;
}
// create_time (unix UTC) -> partes no horário de Brasília (turno por hora depende disso)
function brParts(unixSec) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(unixSec * 1000))) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  const order_date = `${p.year}-${p.month}-${p.day}`;
  const dow = (new Date(order_date + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return { order_date, month: `${p.year}-${p.month}`, hour, minute: parseInt(p.minute, 10), dow };
}

// Achata um pedido em N linhas (1 por SKU) — igual ao xlsx (pedido + SKU).
function mapOrderToRows(order, ownerId, accountId, agencyId) {
  const t = brParts(order.create_time || 0);
  const status = mapStatus(order.status);
  return (order.skus || []).map(sku => ({
    user_id: ownerId,           // dono (RLS de orders é por user_id)
    account_id: accountId,
    agency_id: agencyId,
    tiktok_order_id: String(order.id || ''),
    sku_id: String(sku.id || ''),
    month: t.month,
    order_date: t.order_date,
    hour: t.hour,
    minute: t.minute,
    day_of_week: t.dow,
    gmv: amt(sku.price),
    settlement_status: status,
    content_type: CONTENT_TYPE_MAP[String(sku.content_type || '').toUpperCase()] ?? 0,
    content_id: String(sku.content_id || '').slice(-6),
    store_name: sku.shop_name || 'Desconhecida',
    product_name: (sku.product_name || '').slice(0, 60),
    items_sold: num(sku.quantity),
    items_refunded: num(sku.refunded_quantity),
    estimated_commission: amt(sku.estimated_commission),
    received_commission: amt(sku.actual_commission)   // comissão liquidada = recebida
  }));
}

export default async function handler(req, res) {
  try {
    const ownerId = req.query.owner;
    if (!ownerId) return res.status(400).json({ error: 'owner obrigatório' });

    // 1) pega a conexão (token) do creator
    const connResp = await sb(`tiktok_connections?owner_id=eq.${ownerId}&select=*`);
    const conns = await connResp.json();
    const conn = conns && conns[0];
    if (!conn) return res.status(404).json({ error: 'creator sem conexão TikTok' });

    // 2) token válido? senão refresh
    let accessToken = conn.access_token;
    if (conn.access_expire_at && new Date(conn.access_expire_at).getTime() < Date.now() + 60000) {
      accessToken = await refreshToken(conn);
      if (!accessToken) return res.status(401).json({ error: 'refresh falhou — reautorizar' });
    }

    // 3) descobre a conta (account_id + agency_id) do creator pra pendurar os pedidos
    const accResp = await sb(`accounts?owner_id=eq.${ownerId}&select=id,agency_id&limit=1`);
    const accs = await accResp.json();
    const account = accs && accs[0];
    if (!account) return res.status(400).json({ error: 'creator sem conta' });
    const accountId = account.id;
    const agencyId = account.agency_id;

    // 4) busca os pedidos de afiliado (paginado). page_size/page_token = query; body = filtro de tempo (vazio = tudo).
    let pageToken = '';
    let total = 0;
    do {
      const query = { page_size: '50', ...(pageToken ? { page_token: pageToken } : {}) };
      const data = await signedPost(ORDERS_PATH, query, {}, accessToken);
      if (data.code && data.code !== 0) {
        return res.status(502).json({ error: 'tiktok api', detail: data });
      }
      const list = (data.data && data.data.orders) || [];
      const rows = list.flatMap(o => mapOrderToRows(o, ownerId, accountId, agencyId));
      if (rows.length) {
        await sb('orders?on_conflict=user_id,tiktok_order_id,sku_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(rows)
        });
        total += rows.length;
      }
      pageToken = (data.data && data.data.next_page_token) || '';
    } while (pageToken);

    return res.status(200).json({ ok: true, imported: total });
  } catch (e) {
    console.error('sync erro:', e);
    return res.status(500).json({ error: String(e) });
  }
}
