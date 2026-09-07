// ================================================
// SPACEHUB - Auth helpers (Multi-Tenant)
// ================================================

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

// id do usuário logado (dono das linhas — usado nos inserts com owner_id)
async function myUid() {
  const s = await getSession();
  return s?.user?.id || null;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  const role = await getUserRole();
  if (!role) {
    await sb.auth.signOut();
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

// Papéis: 'matriz' (superadmin, vê tudo) | 'creator' (vê só o dele)
async function getUserRole() {
  const session = await getSession();
  if (!session) return null;

  const email = session.user.email;

  // Matriz = superadmin
  const { data: sa } = await sb
    .from('superadmins')
    .select('email, display_name')
    .eq('email', email)
    .maybeSingle();
  if (sa) {
    return { role: 'matriz', display_name: sa.display_name || email, is_matriz: true };
  }

  // Creator convidado e ativo
  const { data: cr } = await sb
    .from('creators')
    .select('email, display_name, active, user_id')
    .eq('email', email)
    .maybeSingle();
  if (cr && cr.active) {
    // Captura o user_id no 1º login (pra matriz cruzar com os dados dele)
    if (!cr.user_id) {
      sb.from('creators').update({ user_id: session.user.id }).eq('email', email).then(() => {});
    }
    return { role: 'creator', display_name: cr.display_name || email, is_matriz: false };
  }

  return null;
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// Render do menu lateral (agrupado) com info do usuário
async function renderNav(activePage) {
  const session = await getSession();
  const userInfo = await getUserRole();
  const isMatriz = userInfo?.is_matriz;
  const name = esc(userInfo?.display_name || session?.user?.email || '');

  const nav = document.getElementById('topbar-nav');
  if (!nav) return;
  document.body.classList.add('has-nav');

  const link = (href, label, page) =>
    `<a href="${href}" class="${activePage === page ? 'active' : ''}">${label}</a>`;

  // OPERAÇÃO — creator e matriz (isolado por RLS)
  let html = `
    <div class="nav-group">
      <div class="nav-group-title">Operação</div>
      ${link('fechamento.html', 'Fechamento', 'fechamento')}
      ${link('dashboard.html', 'Dashboard', 'dashboard')}
      ${link('upload.html', 'Upload', 'upload')}
    </div>`;

  // GESTÃO — só matriz
  if (isMatriz) {
    html += `
    <div class="nav-group">
      <div class="nav-group-title">Gestão</div>
      ${link('admin.html', 'Creators', 'admin')}
      ${link('conta.html', 'Conta', 'conta')}
      ${link('settings.html', 'Config', 'settings')}
    </div>`;
  }

  html += `
    <div class="nav-footer">
      <span class="nav-user">${name}</span>
      <a href="#" class="logout" onclick="logout();return false;">Sair</a>
    </div>`;

  nav.innerHTML = html;
}
