// ================================================
// Vercel Function — Busca o MOTIVO real de cancelamentos/devoluções (Seller API)
// e grava de volta nos pedidos (orders.aftersale_reason/role/type).
//
// Para cada loja conectada (tiktok_sellers), no período pedido:
//   POST /return_refund/202309/cancellations/search  -> cancel_reason_text + role
//   POST /return_refund/202309/returns/search        -> return_reason_text + role
// Casa por order_id e faz PATCH em orders (todas as SKUs daquele pedido).
//
// Chamada (matriz, com Bearer): GET /api/tiktok/seller-reasons?ge=..&lt=..
// Requer: escopo Return & Refund aprovado no app + seller autorizado.
// ================================================

import crypto from 'crypto';

const TOKEN_HOST = 'https://auth.tiktok-shops.com';
const API_HOST = 'https://open-api.tiktokglobalshop.com';
const CANCEL_PATH = '/return_refund/202309/cancellations/search';
const RETURN_PATH = '/return_refund/202309/returns/search';

function signRequest(path, query, bodyStr, appSecret) {
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let base = appSecret + path;
  for (const k of keys) base += k + query[k];
  if (bodyStr) base += bodyStr;
  base += appSecret;
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex');
}

// credenciais do APP DE SELLER (separado do afiliado); cai no afiliado se não setado
const SELLER_KEY = process.env.TIKTOK_SELLER_APP_KEY || process.env.TIKTOK_APP_KEY;
const SELLER_SECRET = process.env.TIKTOK_SELLER_APP_SECRET || process.env.TIKTOK_APP_SECRET;

async function signedPost(path, extraQuery, body, accessToken) {
  const appKey = SELLER_KEY;
  const appSecret = SELLER_SECRET;
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
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(opts.headers || {}) }
  });
}

async function authedMatriz(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.email) return null;
  const saj = await (await sb(`superadmins?email=eq.${encodeURIComponent(u.email)}&select=email`)).json();
  return (Array.isArray(saj) && saj.length) ? u : null;
}

async function refreshSellerToken(shop) {
  const appKey = SELLER_KEY;
  const appSecret = SELLER_SECRET;
  if (!shop.refresh_token) return null;
  const url = `${TOKEN_HOST}/api/v2/token/refresh`
    + `?app_key=${encodeURIComponent(appKey)}&app_secret=${encodeURIComponent(appSecret)}`
    + `&refresh_token=${encodeURIComponent(shop.refresh_token)}&grant_type=refresh_token`;
  const j = await (await fetch(url)).json();
  const d = j && j.data;
  if (!d || !d.access_token) return null;
  const now = Date.now();
  const iso = s => s ? new Date(now + s * 1000).toISOString() : null;
  await sb(`tiktok_sellers?shop_id=eq.${encodeURIComponent(shop.shop_id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token: d.access_token, refresh_token: d.refresh_token || shop.refresh_token,
      access_expire_at: iso(d.access_token_expire_in), refresh_expire_at: iso(d.refresh_token_expire_in),
      updated_at: new Date().toISOString()
    })
  });
  return d.access_token;
}

// paginação de um endpoint de busca; devolve todos os registros
async function searchAll(path, cipher, body, accessToken, maxPages = 20) {
  const out = [];
  let pageToken = '';
  for (let p = 0; p < maxPages; p++) {
    const q = { shop_cipher: cipher, page_size: '50', ...(pageToken ? { page_token: pageToken } : {}) };
    const data = await signedPost(path, q, body, accessToken);
    if (data.code && data.code !== 0) return { error: data, records: out };
    const dd = data.data || {};
    // a lista pode vir com nomes diferentes; pega a 1ª array encontrada
    const list = dd.cancellations || dd.returns || dd.orders || dd.items ||
      (Array.isArray(dd) ? dd : []) || [];
    for (const it of list) out.push(it);
    pageToken = dd.next_page_token || '';
    if (!pageToken) break;
  }
  return { records: out };
}

export default async function handler(req, res) {
  try {
    const matriz = await authedMatriz(req);
    if (!matriz) return res.status(401).json({ error: 'não autorizado' });

    const nowSec = Math.floor(Date.now() / 1000);
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 90));
    const ge = req.query.ge ? parseInt(req.query.ge, 10) : nowSec - days * 86400;
    const lt = req.query.lt ? parseInt(req.query.lt, 10) : nowSec;

    const shops = await (await sb('tiktok_sellers?select=*')).json();
    if (!Array.isArray(shops) || !shops.length) {
      return res.status(400).json({ error: 'nenhum seller conectado — peça a autorização primeiro' });
    }

    // order_id -> { reason, role, type }  (mantém o 1º motivo encontrado)
    const reasons = new Map();
    const errors = [];
    const put = (oid, reason, role, type) => {
      const id = String(oid || '');
      if (!id || reasons.has(id)) return;
      reasons.set(id, { reason: reason || null, role: role || null, type });
    };

    for (const shop of shops) {
      let token = shop.access_token;
      if (shop.access_expire_at && new Date(shop.access_expire_at).getTime() < Date.now() + 60000) {
        token = await refreshSellerToken(shop);
        if (!token) { errors.push({ shop: shop.shop_name, error: 'refresh falhou' }); continue; }
      }
      const body = { create_time_ge: ge, create_time_lt: lt };
      const c = await searchAll(CANCEL_PATH, shop.shop_cipher, body, token);
      if (c.error) errors.push({ shop: shop.shop_name, endpoint: 'cancellations', detail: c.error });
      for (const r of c.records) put(r.order_id, r.cancel_reason_text || r.cancel_reason, r.role, 'cancel');
      const rt = await searchAll(RETURN_PATH, shop.shop_cipher, body, token);
      if (rt.error) errors.push({ shop: shop.shop_name, endpoint: 'returns', detail: rt.error });
      for (const r of rt.records) put(r.order_id, r.return_reason_text || r.return_reason, r.role, 'return');
    }

    // grava nos pedidos (1 PATCH por order_id -> atinge todas as SKUs)
    let updated = 0;
    for (const [oid, info] of reasons) {
      const up = await sb(`orders?tiktok_order_id=eq.${encodeURIComponent(oid)}`, {
        method: 'PATCH',
        body: JSON.stringify({ aftersale_reason: info.reason, aftersale_role: info.role, aftersale_type: info.type })
      });
      if (up.ok) updated++;
    }

    return res.status(200).json({
      ok: true, shops: shops.length, motivos_encontrados: reasons.size, pedidos_atualizados: updated,
      window: { ge, lt }, ...(errors.length ? { erros: errors } : {})
    });
  } catch (e) {
    console.error('seller-reasons erro:', e);
    return res.status(500).json({ error: String(e) });
  }
}
