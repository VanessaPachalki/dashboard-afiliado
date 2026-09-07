// ================================================
// Vercel Function — Sincronizar pedidos via Partner (TAP)
//
// A MATRIZ autorizou 1x (tiktok_partner). Aqui puxamos TODOS os pedidos de
// afiliado da agência (com creator_username + comissão + impostos) e gravamos
// no schema `orders`, com a matriz como dona. O fechamento por creator+horário
// filtra depois por creator_username.
//
// Endpoint (OAS oficial): POST /affiliate_partner/202504/cap_order/search
//   Query: app_key, timestamp, category_asset_cipher, page_size, page_token, sign
//   Body:  { create_time_ge, create_time_lt }  (unix seconds)
//   Header: x-tts-access-token
//
// Chamada: GET /api/tiktok/partner-sync?owner=<matriz_uid>&days=60
//
// Env vars: TIKTOK_APP_KEY, TIKTOK_APP_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ================================================

import crypto from 'crypto';

// ---- Mapeamento (inline, pra Function ser auto-contida — sem import de .mjs) ----
const _num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const _amt = o => (o && o.amount != null ? _num(o.amount) : 0); // { amount, currency }
const CONTENT_TYPE_MAP = { LIVE: 0, VIDEO: 1, SHOWCASE: 3, PRODUCT_CARD: 2 };

function mapStatus(s) {
  const u = String(s || '').toUpperCase();
  if (u.includes('UNSETTLE')) return 2;
  if (u.includes('SETTLE')) return 0;
  if (u.includes('INVALID') || u.includes('CANCEL') || u.includes('REFUND')) return 1;
  return 2;
}

// create_time (unix UTC) -> partes no horário de Brasília
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

// cap_order -> N linhas (1 por SKU). account_id/agency_id são preenchidos depois.
function mapCapOrderToRows(order, matrizUid, uploadId) {
  const t = brParts(order.create_time || 0);
  const status = mapStatus(order.status);
  const skus = Array.isArray(order.skus) ? order.skus : (order.skus ? [order.skus] : []);
  return skus.map(sku => ({
    user_id: matrizUid,
    upload_id: uploadId,
    tiktok_order_id: String(order.id || ''),
    sku_id: String(sku.id || ''),
    creator_username: sku.creator_username || null,
    month: t.month,
    order_date: t.order_date,
    hour: t.hour,
    minute: t.minute,
    day_of_week: t.dow,
    gmv: _amt(sku.price),
    settlement_status: status,
    content_type: CONTENT_TYPE_MAP[String(sku.content_type || '').toUpperCase()] ?? 0,
    content_id: String(sku.content_id || '').slice(-6),
    store_name: sku.shop_name || 'Desconhecida',
    product_name: (sku.product_name || '').slice(0, 60),
    items_sold: _num(sku.quantity),
    items_refunded: _num(sku.refunded_quantity) + _num(sku.returned_quantity),
    estimated_commission: _amt(sku.estimated_commission),
    received_commission: _amt(sku.actual_commission)
  }));
}

const TOKEN_HOST = 'https://auth.tiktok-shops.com';
const API_HOST = 'https://open-api.tiktokglobalshop.com';
const CAP_ORDER_PATH = '/affiliate_partner/202504/cap_order/search';

// HMAC-SHA256: base = app_secret + path + {sortedKey}{value}... (+ body cru) + app_secret
function signRequest(path, queryParams, bodyStr, appSecret) {
  const keys = Object.keys(queryParams).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let base = appSecret + path;
  for (const k of keys) base += k + queryParams[k];
  if (bodyStr) base += bodyStr;
  base += appSecret;
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex');
}

async function signedPost(path, extraQuery, body, accessToken) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const timestamp = Math.floor(Date.now() / 1000).toString();
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

// refresh do access_token do partner (linha id=1)
async function refreshPartnerToken(part) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const url = `${TOKEN_HOST}/api/v2/token/refresh`
    + `?app_key=${encodeURIComponent(appKey)}`
    + `&app_secret=${encodeURIComponent(appSecret)}`
    + `&refresh_token=${encodeURIComponent(part.refresh_token)}`
    + '&grant_type=refresh_token';
  const j = await (await fetch(url)).json();
  const d = j && j.data;
  if (!d || !d.access_token) return null;
  const now = Date.now();
  const iso = s => s ? new Date(now + s * 1000).toISOString() : null;
  await sb('tiktok_partner?id=eq.1', {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: d.access_token,
      refresh_token: d.refresh_token || part.refresh_token,
      access_expire_at: iso(d.access_token_expire_in),
      refresh_expire_at: iso(d.refresh_token_expire_in),
      updated_at: new Date().toISOString()
    })
  });
  return d.access_token;
}

// 1 "upload" fixo pra pendurar os pedidos do partner (bucket da matriz)
async function ensureUpload(matrizUid) {
  const q = `uploads?user_id=eq.${matrizUid}&filename=eq.__tiktok_partner__&select=id&limit=1`;
  const rows = await (await sb(q)).json();
  if (Array.isArray(rows) && rows[0]) return rows[0].id;
  const created = await (await sb('uploads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: matrizUid, filename: '__tiktok_partner__', month_label: 'TikTok Partner' })
  })).json();
  return created && created[0] && created[0].id;
}

// pega o id da agência BRX (todos os dados são filtrados por agency_id)
async function getAgencyId() {
  const rows = await (await sb('agencies?slug=eq.brx&select=id&limit=1')).json();
  return Array.isArray(rows) && rows[0] ? rows[0].id : null;
}

// resolve (ou cria) a conta virtual de um creator, pelo @username.
// Cache em memória evita repetir query por página.
function makeAccountResolver(matrizUid, agencyId) {
  const cache = new Map();
  return async function resolveAccount(username) {
    const name = (username && String(username).trim()) || '(sem creator)';
    if (cache.has(name)) return cache.get(name);
    // procura existente (service role ignora RLS)
    const q = `accounts?agency_id=eq.${agencyId}&name=eq.${encodeURIComponent(name)}&select=id&limit=1`;
    const found = await (await sb(q)).json();
    let id = Array.isArray(found) && found[0] ? found[0].id : null;
    if (!id) {
      const created = await (await sb('accounts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, owner_id: matrizUid, agency_id: agencyId, source: 'tiktok_partner' })
      })).json();
      id = Array.isArray(created) && created[0] ? created[0].id : null;
    }
    cache.set(name, id);
    return id;
  };
}

export default async function handler(req, res) {
  try {
    const matrizUid = req.query.owner;
    if (!matrizUid) return res.status(400).json({ error: 'owner (matriz) obrigatório' });

    // 1) conexão partner (token + cipher)
    const parts = await (await sb('tiktok_partner?id=eq.1&select=*')).json();
    const part = parts && parts[0];
    if (!part || !part.access_token) return res.status(404).json({ error: 'sem conexão partner — autorize primeiro' });
    if (!part.category_asset_cipher) return res.status(400).json({ error: 'sem category_asset_cipher' });

    // 2) token válido? senão refresh
    let accessToken = part.access_token;
    if (part.access_expire_at && new Date(part.access_expire_at).getTime() < Date.now() + 60000) {
      accessToken = await refreshPartnerToken(part);
      if (!accessToken) return res.status(401).json({ error: 'refresh falhou — reautorize o partner' });
    }

    // 3) upload bucket + agência + resolvedor de conta por creator
    const uploadId = await ensureUpload(matrizUid);
    if (!uploadId) return res.status(500).json({ error: 'falha ao criar upload' });
    const agencyId = await getAgencyId();
    if (!agencyId) return res.status(500).json({ error: 'agência BRX não encontrada' });
    const resolveAccount = makeAccountResolver(matrizUid, agencyId);

    // 4) janela de tempo (default últimos 60 dias)
    const nowSec = Math.floor(Date.now() / 1000);
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 60));
    const ge = req.query.ge ? parseInt(req.query.ge, 10) : nowSec - days * 86400;
    const lt = req.query.lt ? parseInt(req.query.lt, 10) : nowSec;

    // 5) paginação
    let pageToken = '';
    let total = 0, pages = 0;
    let sample = null;
    const creatorsSet = new Set();
    do {
      const query = {
        category_asset_cipher: part.category_asset_cipher,
        page_size: '50',
        ...(pageToken ? { page_token: pageToken } : {})
      };
      const data = await signedPost(CAP_ORDER_PATH, query, { create_time_ge: ge, create_time_lt: lt }, accessToken);
      if (data.code && data.code !== 0) {
        return res.status(502).json({ error: 'tiktok api', code: data.code, message: data.message, request_id: data.request_id });
      }
      const list = (data.data && data.data.orders) || [];
      if (!sample && list[0]) sample = list[0]; // 1º pedido cru pra conferência
      const rows = list.flatMap(o => mapCapOrderToRows(o, matrizUid, uploadId));
      // atribui cada linha à conta do creator (por @username) + agência BRX
      for (const r of rows) {
        r.account_id = await resolveAccount(r.creator_username);
        r.agency_id = agencyId;
        creatorsSet.add(r.creator_username || '(sem creator)');
      }
      if (rows.length) {
        const up = await sb('orders?on_conflict=user_id,tiktok_order_id,sku_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(rows)
        });
        if (!up.ok) return res.status(500).json({ error: 'upsert orders falhou', detail: await up.text() });
        total += rows.length;
      }
      pageToken = (data.data && data.data.next_page_token) || '';
      pages++;
    } while (pageToken && pages < 200);

    // atualiza contagem do bucket
    await sb(`uploads?id=eq.${uploadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ row_count: total, uploaded_at: new Date().toISOString() })
    });

    return res.status(200).json({
      ok: true, imported: total, pages,
      creators: creatorsSet.size,
      window: { ge, lt, days },
      sample: sample ? { id: sample.id, status: sample.status, create_time: sample.create_time,
        skus_type: Array.isArray(sample.skus) ? 'array' : typeof sample.skus } : null
    });
  } catch (e) {
    console.error('partner-sync erro:', e);
    return res.status(500).json({ error: String(e) });
  }
}
