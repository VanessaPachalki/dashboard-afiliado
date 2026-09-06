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
// CONFIRMAR na doc oficial (Partner Center): path + versão YYYYMM do
// "Search Creator Affiliate Orders". Versão é por-API e muda ~mensal.
const ORDERS_PATH = '/affiliate_creator/202405/orders/search';

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

// ---- mapeia 1 pedido de afiliado da TikTok pro nosso schema `orders` ----
// CONFIRMAR os nomes de campo (o.xxx) contra 1 resposta real da API.
const STATUS_MAP = { SETTLED: 0, UNSETTLED: 2, INVALID: 1, PENDING: 2 };
function mapOrder(o, ownerId, accountId, agencyId) {
  const dt = new Date((o.create_time || o.order_create_time || 0) * 1000);
  const num = v => (v == null ? 0 : Number(v) || 0);
  return {
    user_id: ownerId,   // dono do pedido (RLS de orders é por user_id)
    account_id: accountId,
    agency_id: agencyId,
    tiktok_order_id: String(o.order_id || ''),
    sku_id: String(o.sku_id || ''),
    month: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`,
    order_date: dt.toISOString().split('T')[0],
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    day_of_week: (dt.getDay() + 6) % 7,
    gmv: num(o.gmv || o.order_amount),
    settlement_status: STATUS_MAP[o.settlement_status || o.status] ?? 2,
    content_type: 0, // Live (afiliado por live)
    content_id: String(o.content_id || o.live_id || '').slice(-6),
    store_name: o.shop_name || o.store_name || 'Desconhecida',
    product_name: (o.product_name || '').slice(0, 60),
    items_sold: num(o.quantity || o.items_sold),
    items_refunded: num(o.refund_quantity || o.items_refunded),
    estimated_commission: num(o.estimated_commission),
    received_commission: num(o.settled_commission || o.received_commission)
  };
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

    // 4) busca os pedidos de afiliado (paginado) — CONFIRMAR params/paginação
    let pageToken = '';
    let total = 0;
    do {
      const body = { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) };
      const data = await signedPost(ORDERS_PATH, {}, body, accessToken);
      if (data.code && data.code !== 0) {
        return res.status(502).json({ error: 'tiktok api', detail: data });
      }
      const list = (data.data && (data.data.orders || data.data.order_list)) || [];
      if (list.length) {
        const rows = list.map(o => mapOrder(o, ownerId, accountId, agencyId));
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
