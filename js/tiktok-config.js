// ================================================
// TikTok Shop — config do cliente (app_key é semi-público: vai no link de auth)
// ================================================

const TIKTOK_APP_KEY = '6l6tpfb1cfqdg';

// Link de autorização do CREATOR (state = id do creator, pra ligar o token a ele)
function tiktokCreatorAuthUrl(state) {
  return 'https://shop.tiktok.com/alliance/creator/auth'
    + `?app_key=${encodeURIComponent(TIKTOK_APP_KEY)}`
    + `&state=${encodeURIComponent(state)}`;
}

async function connectTiktok() {
  if (!TIKTOK_APP_KEY || TIKTOK_APP_KEY === 'PREENCHA_APP_KEY') {
    alert('App Key da TikTok ainda não configurado.');
    return;
  }
  const uid = await myUid();
  if (!uid) return;
  window.location.href = tiktokCreatorAuthUrl(uid);
}

// Puxa os pedidos de afiliado da TikTok pro fechamento (via a Function de sync)
async function sincronizarTiktok() {
  const el = document.getElementById('tiktokMsg');
  const uid = await myUid();
  if (!uid) return;
  if (el) { el.className = 'msg'; el.textContent = 'Sincronizando com a TikTok...'; }
  try {
    const r = await fetch(`/api/tiktok/sync?owner=${encodeURIComponent(uid)}`);
    const j = await r.json();
    if (!el) return;
    if (j.ok) {
      el.className = 'msg msg-ok';
      el.textContent = `Importados ${j.imported} pedidos da TikTok.`;
    } else {
      el.className = 'msg msg-err';
      el.textContent = 'Erro na sincronização: ' + (j.error || 'desconhecido');
    }
  } catch (e) {
    if (el) { el.className = 'msg msg-err'; el.textContent = 'Falha ao sincronizar.'; }
  }
}

// Mostra o resultado da conexão quando volta do callback (?tiktok=connected|denied|error)
function showTiktokResult() {
  const params = new URLSearchParams(window.location.search);
  const st = params.get('tiktok');
  if (!st) return;
  const el = document.getElementById('tiktokMsg');
  if (!el) return;
  const map = {
    connected: ['msg-ok', 'TikTok conectado! Seus dados vão importar automaticamente.'],
    denied: ['msg-err', 'Autorização cancelada.'],
    error: ['msg-err', 'Erro ao conectar. Tente de novo.'],
    misconfig: ['msg-err', 'Integração ainda não configurada (env vars).'],
    wrong_identity: ['msg-err', 'Login não é de Creator. Entre com a conta de creator (não seller).']
  };
  const [cls, txt] = map[st] || ['msg-err', 'Falha na conexão.'];
  el.className = 'msg ' + cls;
  el.textContent = txt;
}
