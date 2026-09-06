// ================================================
// TikTok Shop — config do cliente (app_key é semi-público: vai no link de auth)
// ================================================

// >>> PREENCHA com o App Key do seu app na TikTok Partner Center <<<
const TIKTOK_APP_KEY = 'PREENCHA_APP_KEY';

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
    misconfig: ['msg-err', 'Integração ainda não configurada (env vars).']
  };
  const [cls, txt] = map[st] || ['msg-err', 'Falha na conexão.'];
  el.className = 'msg ' + cls;
  el.textContent = txt;
}
