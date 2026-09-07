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
  // 202603 cap_order: SETTLED | PENDING | INELIGIBLE | CUSTOMER UNPAID | FROZEN
  if (u.includes('INELIGIBLE')) return 1;          // inelegível (reembolso/cancelado)
  if (u.includes('SETTLED')) return 0;             // liquidado
  if (u.includes('UNPAID')) return 3;              // cliente não pagou = aguardando
  if (u.includes('PENDING') || u.includes('FROZEN')) return 2; // pendente
  // fallbacks (formatos antigos)
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

// 202603 cap_order/search: data.sku_orders[] já vem 1 item por SKU (flat).
// Mapeia UM sku_order -> UMA linha. account_id/agency_id preenchidos depois.
function mapSkuOrder(so, matrizUid, uploadId) {
  const t = brParts(so.create_time || 0);
  const qty = _num(so.quantity);
  const refunded = String(so.fully_return || '').toUpperCase() === 'YES' ? qty : 0;
  return {
    user_id: matrizUid,
    upload_id: uploadId,
    tiktok_order_id: String(so.id || ''),
    sku_id: String(so.sku_id || ''),
    creator_username: so.creator_username || null,
    month: t.month,
    order_date: t.order_date,
    hour: t.hour,
    minute: t.minute,
    day_of_week: t.dow,
    gmv: _amt(so.price),
    settlement_status: mapStatus(so.settle_status),
    content_type: CONTENT_TYPE_MAP[String(so.content_type || '').toUpperCase()] ?? 0,
    content_id: String(so.content_id || '').slice(-6),
    store_name: so.shop_name || 'Desconhecida',
    product_name: (so.product_name || '').slice(0, 60),
    items_sold: qty,
    items_refunded: refunded,
    estimated_commission: _amt(so.estimated_standard_commission),  // comissão estimada
    received_commission: _amt(so.actual_standard_commission)       // recebida (liquidada)
  };
}

const TOKEN_HOST = 'https://auth.tiktok-shops.com';
const API_HOST = 'https://open-api.tiktokglobalshop.com';
const CAP_ORDER_PATH = '/affiliate_partner/202603/cap_order/search';   // scope: partner.cap_orders.read
const TAP_ORDER_PATH = '/affiliate_partner/202603/orders/search';      // scope: partner.tap_campaign.read

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
// Retorna { id } ou { error } com o motivo real do Postgres.
// uploads.agency_id é NOT NULL — precisa vir preenchido.
async function ensureUpload(matrizUid, agencyId) {
  const q = `uploads?user_id=eq.${matrizUid}&filename=eq.__tiktok_partner__&select=id&limit=1`;
  const sel = await sb(q);
  if (sel.ok) {
    const rows = await sel.json();
    if (Array.isArray(rows) && rows[0]) return { id: rows[0].id };
  }
  const resp = await sb('uploads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: matrizUid, agency_id: agencyId, filename: '__tiktok_partner__', month_label: 'TikTok Partner' })
  });
  const txt = await resp.text();
  if (!resp.ok) return { error: `uploads insert ${resp.status}: ${txt}` };
  let created; try { created = JSON.parse(txt); } catch { created = null; }
  const id = Array.isArray(created) && created[0] ? created[0].id : null;
  return id ? { id } : { error: `uploads insert sem id: ${txt}` };
}

// lista os category_assets (cada categoria tem seu cipher + mercado)
async function getCategoryAssets(accessToken) {
  const path = '/authorization/202405/category_assets';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const q = { app_key: process.env.TIKTOK_APP_KEY, timestamp };
  q.sign = signRequest(path, q, '', process.env.TIKTOK_APP_SECRET);
  const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const caj = await (await fetch(`${API_HOST}${path}?${qs}`, {
    headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken }
  })).json();
  return (caj && caj.data && caj.data.category_assets) || [];
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
      const resp = await sb('accounts', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ name, owner_id: matrizUid, agency_id: agencyId, source: 'tiktok_partner' })
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(`accounts insert ${resp.status}: ${txt}`);
      let created; try { created = JSON.parse(txt); } catch { created = null; }
      id = Array.isArray(created) && created[0] ? created[0].id : null;
      if (!id) throw new Error(`accounts insert sem id: ${txt}`);
    }
    cache.set(name, id);
    return id;
  };
}

export default async function handler(req, res) {
  try {
    const matrizUid = req.query.owner;
    if (!matrizUid && !req.query.debug) return res.status(400).json({ error: 'owner (matriz) obrigatório' });

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

    // DEBUG: dump da resposta crua de category_assets (mercados + ids)
    if (req.query.debug && req.query.debug !== 'probe' && req.query.debug !== 'sample') {
      const path = '/authorization/202405/category_assets';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const q = { app_key: process.env.TIKTOK_APP_KEY, timestamp };
      q.sign = signRequest(path, q, '', process.env.TIKTOK_APP_SECRET);
      const qs = Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const caj = await (await fetch(`${API_HOST}${path}?${qs}`, {
        headers: { 'content-type': 'application/json', 'x-tts-access-token': accessToken }
      })).json();
      return res.status(200).json({ debug: true, scopes: part.scopes, stored_cipher: part.category_asset_cipher, category_assets: caj });
    }

    // DEBUG=sample: mostra 1-2 pedidos CRUS do CAP (Creator Management) pra ver a estrutura real
    if (req.query.debug === 'sample') {
      const nowSec = Math.floor(Date.now() / 1000);
      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 3));
      const ge = req.query.ge ? parseInt(req.query.ge, 10) : nowSec - days * 86400;
      const lt = req.query.lt ? parseInt(req.query.lt, 10) : nowSec;
      const data = await signedPost(CAP_ORDER_PATH,
        { category_asset_cipher: part.category_asset_cipher, page_size: '2' },
        { create_time_ge: ge, create_time_lt: lt }, accessToken);
      const d = data && data.data;
      const firstOrder = d && Array.isArray(d.orders) ? d.orders[0] : null;
      return res.status(200).json({
        debug: 'sample',
        code: data && data.code, message: data && data.message,
        data_keys: d ? Object.keys(d) : null,
        total_count: d && d.total_count,
        orders_len: d && Array.isArray(d.orders) ? d.orders.length : null,
        first_order_keys: firstOrder ? Object.keys(firstOrder) : null,
        first_order: firstOrder,
        raw_data_preview: d
      });
    }

    // DEBUG=probe: testa CAP e TAP em cada categoria e conta os pedidos (sem importar)
    if (req.query.debug === 'probe') {
      const nowSec = Math.floor(Date.now() / 1000);
      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 60));
      const ge = nowSec - days * 86400, lt = nowSec;
      const assets = (await getCategoryAssets(accessToken))
        .filter(a => String(a.target_market || '').toUpperCase() === 'BR');
      const nm = a => (a.category && a.category.name) || '';
      const out = [];
      for (const ep of [{ path: CAP_ORDER_PATH, tag: 'cap' }, { path: TAP_ORDER_PATH, tag: 'tap' }]) {
        for (const a of assets) {
          const probe = await signedPost(ep.path,
            { category_asset_cipher: a.cipher, page_size: '1' },
            { create_time_ge: ge, create_time_lt: lt }, accessToken);
          const ok = !probe.code || probe.code === 0;
          out.push({ endpoint: ep.tag, category: nm(a), code: probe.code,
            count: ok && probe.data ? (probe.data.total_count ?? (probe.data.orders || []).length) : null,
            message: ok ? undefined : probe.message });
        }
      }
      // resumo: só o que tem pedido
      const comPedidos = out.filter(r => r.count > 0);
      return res.status(200).json({ debug: 'probe', window: { ge, lt, days }, comPedidos, todas: out });
    }

    // 3) agência BRX + upload bucket + resolvedor de conta por creator
    const agencyId = await getAgencyId();
    if (!agencyId) return res.status(500).json({ error: 'agência BRX não encontrada' });
    const upl = await ensureUpload(matrizUid, agencyId);
    if (!upl.id) return res.status(500).json({ error: upl.error || 'falha ao criar upload' });
    const uploadId = upl.id;
    const resolveAccount = makeAccountResolver(matrizUid, agencyId);

    // 4) janela de tempo (default últimos 60 dias)
    const nowSec = Math.floor(Date.now() / 1000);
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 60));
    const ge = req.query.ge ? parseInt(req.query.ge, 10) : nowSec - days * 86400;
    const lt = req.query.lt ? parseInt(req.query.lt, 10) : nowSec;

    // 4.1) descobre a categoria/cipher certa + o endpoint que funciona.
    // Cada categoria tem seu cipher; o de pedidos de afiliado é o de
    // "Affiliate Management"/creators — não o [0] (que era "Connectors").
    const assets = (await getCategoryAssets(accessToken))
      .filter(a => String(a.target_market || '').toUpperCase() === 'BR');
    const PRIORITY = [
      'Affiliate Management', 'Seller and Scalable Creator Match-Up',
      'Creator collaborations', 'Creator Management', 'Mass Recruiting', 'Mass Tutoring'
    ];
    const nameOf = a => (a.category && a.category.name) || '';
    // ordena: candidatos de afiliado primeiro (na ordem), depois o resto.
    // e coloca o cipher já salvo na frente (fast path em syncs repetidos).
    const ordered = [
      ...(part.category_asset_cipher ? assets.filter(a => a.cipher === part.category_asset_cipher) : []),
      ...PRIORITY.map(n => assets.find(a => nameOf(a) === n)).filter(Boolean),
      ...assets.filter(a => !PRIORITY.includes(nameOf(a)))
    ].filter((a, i, arr) => arr.findIndex(x => x.cipher === a.cipher) === i);

    let orderPath = null, endpoint = null, cipher = null, winCategory = null, winCount = null;
    let fallback = null; // 1º endpoint/cipher que responde ok, mesmo vazio
    const tried = [];
    for (const ep of [{ path: CAP_ORDER_PATH, tag: 'cap' }, { path: TAP_ORDER_PATH, tag: 'tap' }]) {
      for (const a of ordered) {
        const probe = await signedPost(ep.path,
          { category_asset_cipher: a.cipher, page_size: '1' },
          { create_time_ge: ge, create_time_lt: lt }, accessToken);
        const ok = !probe.code || probe.code === 0;
        const count = ok && probe.data ? (probe.data.total_count ?? (probe.data.orders || []).length) : null;
        tried.push({ endpoint: ep.tag, category: nameOf(a), code: probe.code, count, message: ok ? undefined : probe.message });
        if (ok) {
          if (!fallback) fallback = { path: ep.path, tag: ep.tag, cipher: a.cipher, cat: nameOf(a) };
          if (count > 0) { orderPath = ep.path; endpoint = ep.tag; cipher = a.cipher; winCategory = nameOf(a); winCount = count; break; }
        } else if (probe.code === 105005) {
          break; // sem escopo nesse endpoint — pula pro próximo endpoint
        }
      }
      if (cipher) break;
    }
    // se nenhuma categoria trouxe pedidos, usa a 1ª válida (importa 0, mas não erra)
    if (!cipher && fallback) { orderPath = fallback.path; endpoint = fallback.tag; cipher = fallback.cipher; winCategory = fallback.cat; }
    if (!cipher) {
      return res.status(502).json({ error: 'nenhuma categoria/cipher funcionou nos endpoints de pedidos', tried });
    }
    // salva o cipher vencedor pra acelerar as próximas sincronizações
    if (cipher !== part.category_asset_cipher) {
      await sb('tiktok_partner?id=eq.1', {
        method: 'PATCH',
        body: JSON.stringify({ category_asset_cipher: cipher, updated_at: new Date().toISOString() })
      });
    }

    // 5) paginação
    let pageToken = '';
    let total = 0, pages = 0;
    let sample = null;
    const creatorsSet = new Set();
    do {
      const query = {
        category_asset_cipher: cipher,
        page_size: '50',
        ...(pageToken ? { page_token: pageToken } : {})
      };
      const data = await signedPost(orderPath, query, { create_time_ge: ge, create_time_lt: lt }, accessToken);
      if (data.code && data.code !== 0) {
        return res.status(502).json({ error: 'tiktok api', code: data.code, message: data.message, request_id: data.request_id, endpoint });
      }
      const list = (data.data && (data.data.sku_orders || data.data.orders)) || [];
      if (!sample && list[0]) sample = list[0]; // 1º item cru pra conferência
      const rows = list.map(o => mapSkuOrder(o, matrizUid, uploadId));
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
      ok: true, imported: total, pages, endpoint, category: winCategory,
      total_disponivel: winCount, parcial: winCount != null && total < winCount,
      creators: creatorsSet.size,
      window: { ge, lt, days },
      ...(total === 0 ? { diagnostico: tried } : {}),
      sample: sample ? { id: sample.id, status: sample.status, create_time: sample.create_time,
        skus_type: Array.isArray(sample.skus) ? 'array' : typeof sample.skus } : null
    });
  } catch (e) {
    console.error('partner-sync erro:', e);
    return res.status(500).json({ error: String(e) });
  }
}
