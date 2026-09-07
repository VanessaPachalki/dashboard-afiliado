// ================================================
// Vercel Function — TikTok Shop OAuth callback
// Redirect URL: https://app.creatorfy.shop/api/tiktok/callback
//
// Dois fluxos, distinguidos pelo `state`:
//   - state === 'partner'  -> autorização Partner/TAP (a MATRIZ autoriza 1x):
//        troca token -> pega category_asset_cipher -> salva em tiktok_partner
//   - qualquer outro state -> autorização Creator (state = owner_id):
//        troca token -> salva em tiktok_connections
//
// Env vars: TIKTOK_APP_KEY, TIKTOK_APP_SECRET, SUPABASE_URL,
//           SUPABASE_SERVICE_ROLE_KEY, APP_URL
// ================================================

import crypto from 'crypto';

const TOKEN_URL = 'https://auth.tiktok-shops.com/api/v2/token/get';
const API_HOST = 'https://open-api.tiktokglobalshop.com';

// HMAC-SHA256: base = app_secret + path + {sortedKey}{value}... (+ body) + app_secret
function signRequest(path, query, bodyStr, appSecret) {
  const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token').sort();
  let base = appSecret + path;
  for (const k of keys) base += k + query[k];
  if (bodyStr) base += bodyStr;
  base += appSecret;
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex');
}

async function exchangeToken(code) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const url = `${TOKEN_URL}?app_key=${encodeURIComponent(appKey)}`
    + `&app_secret=${encodeURIComponent(appSecret)}`
    + `&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
  const j = await (await fetch(url)).json();
  if (j && j.code !== 0) console.error('token/get code:', j.code, j.message);
  return j && j.data;
}

function sbUpsert(table, conflict, row) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });
}

const isoIn = secs => secs ? new Date(Date.now() + secs * 1000).toISOString() : null;

// ---- Partner (TAP): pega o category_asset_cipher e salva a conexão da matriz ----
async function handlePartner(d, back) {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  // GET /authorization/202405/category_assets (assinado)
  const path = '/authorization/202405/category_assets';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const query = { app_key: appKey, timestamp };
  query.sign = signRequest(path, query, '', appSecret);
  const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const caj = await (await fetch(`${API_HOST}${path}?${qs}`, {
    headers: { 'content-type': 'application/json', 'x-tts-access-token': d.access_token }
  })).json();
  if (caj && caj.code !== 0) console.error('category_assets code:', caj.code, caj.message);
  const assets = caj && caj.data && caj.data.category_assets;
  const cipher = Array.isArray(assets) && assets[0] ? assets[0].cipher : null;
  if (!cipher) { console.error('sem category_asset_cipher:', JSON.stringify(caj)); return back('no_cipher'); }

  const up = await sbUpsert('tiktok_partner', 'id', {
    id: 1,
    access_token: d.access_token,
    refresh_token: d.refresh_token || null,
    access_expire_at: isoIn(d.access_token_expire_in),
    refresh_expire_at: isoIn(d.refresh_token_expire_in),
    category_asset_cipher: cipher,
    scopes: Array.isArray(d.granted_scopes) ? d.granted_scopes.join(',') : (d.granted_scopes || null),
    updated_at: new Date().toISOString()
  });
  if (!up.ok) { console.error('upsert tiktok_partner falhou:', up.status, await up.text()); return back('error'); }
  return back('partner_connected');
}

export default async function handler(req, res) {
  const APP_URL = process.env.APP_URL || '';
  const { code, state, error } = req.query;
  const isPartner = state === 'partner';
  const dest = isPartner ? 'conta.html' : 'upload.html';
  const back = (status) => res.redirect(302, `${APP_URL}/${dest}?tiktok=${status}`);

  try {
    if (error || !code) return back('denied');
    if (!process.env.TIKTOK_APP_KEY || !process.env.TIKTOK_APP_SECRET
      || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return back('misconfig');

    const d = await exchangeToken(code);
    if (!d || !d.access_token) return back('error');
    console.log('granted_scopes:', d.granted_scopes, 'user_type:', d.user_type);

    // ===== Fluxo Partner (matriz) =====
    if (isPartner) return await handlePartner(d, back);

    // ===== Fluxo Creator =====
    if (!state) return back('denied');
    if (d.user_type !== undefined && Number(d.user_type) !== 1) return back('wrong_identity');
    const up = await sbUpsert('tiktok_connections', 'owner_id', {
      owner_id: state,
      open_id: d.open_id || null,
      seller_name: d.seller_name || null,
      access_token: d.access_token,
      refresh_token: d.refresh_token || null,
      access_expire_at: isoIn(d.access_token_expire_in),
      refresh_expire_at: isoIn(d.refresh_token_expire_in),
      scopes: Array.isArray(d.granted_scopes) ? d.granted_scopes.join(',') : (d.granted_scopes || null),
      updated_at: new Date().toISOString()
    });
    if (!up.ok) { console.error('upsert tiktok_connections falhou:', up.status, await up.text()); return back('error'); }
    return back('connected');
  } catch (e) {
    console.error('callback erro:', e);
    return back('error');
  }
}
