// ================================================
// Vercel Function — TikTok Shop OAuth callback (creator)
// Redirect URL registrada na TikTok: https://app.creatorfy.shop/api/tiktok/callback
//
// Fluxo: creator autoriza -> TikTok redireciona aqui com ?code & ?state(owner_id)
//        -> troca o code por token -> salva no Supabase (service role) -> volta pro app.
//
// Env vars (Vercel):
//   TIKTOK_APP_KEY, TIKTOK_APP_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   APP_URL (ex: https://app.creatorfy.shop)
// ================================================

export default async function handler(req, res) {
  const APP_URL = process.env.APP_URL || '';
  const back = (status) => res.redirect(302, `${APP_URL}/upload.html?tiktok=${status}`);

  try {
    const { code, state, error } = req.query;
    if (error || !code || !state) return back('denied');

    const appKey = process.env.TIKTOK_APP_KEY;
    const appSecret = process.env.TIKTOK_APP_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!appKey || !appSecret || !SUPABASE_URL || !SERVICE_KEY) return back('misconfig');

    // 1) troca o auth_code por tokens (grant_type = authorized_code — NÃO o padrão OAuth)
    const tokenUrl = 'https://auth.tiktok-shops.com/api/v2/token/get'
      + `?app_key=${encodeURIComponent(appKey)}`
      + `&app_secret=${encodeURIComponent(appSecret)}`
      + `&auth_code=${encodeURIComponent(code)}`
      + '&grant_type=authorized_code';
    const tr = await fetch(tokenUrl);
    const tj = await tr.json();
    const d = tj && tj.data;
    if (!d || !d.access_token) {
      console.error('token/get falhou:', JSON.stringify(tj));
      return back('error');
    }

    const now = Date.now();
    const iso = (secs) => secs ? new Date(now + secs * 1000).toISOString() : null;
    const row = {
      owner_id: state,
      open_id: d.open_id || null,
      seller_name: d.seller_name || null,
      access_token: d.access_token,
      refresh_token: d.refresh_token || null,
      access_expire_at: iso(d.access_token_expire_in),
      refresh_expire_at: iso(d.refresh_token_expire_in),
      scopes: Array.isArray(d.granted_scopes) ? d.granted_scopes.join(',') : (d.granted_scopes || null),
      updated_at: new Date().toISOString()
    };

    // 2) upsert no Supabase (service role bypassa RLS)
    const up = await fetch(`${SUPABASE_URL}/rest/v1/tiktok_connections?on_conflict=owner_id`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(row)
    });
    if (!up.ok) {
      console.error('supabase upsert falhou:', up.status, await up.text());
      return back('error');
    }

    return back('connected');
  } catch (e) {
    console.error('callback erro:', e);
    return back('error');
  }
}
