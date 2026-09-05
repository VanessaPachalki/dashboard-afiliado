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
    .select('email, display_name, active')
    .eq('email', email)
    .maybeSingle();
  if (cr && cr.active) {
    return { role: 'creator', display_name: cr.display_name || email, is_matriz: false };
  }

  return null;
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// Render nav bar with user info
async function renderNav(activePage) {
  const session = await getSession();
  const userInfo = await getUserRole();
  const isMatriz = userInfo?.is_matriz;
  const name = esc(userInfo?.display_name || session?.user?.email || '');

  const nav = document.getElementById('topbar-nav');
  if (!nav) return;

  // Creator e matriz usam Dashboard/Upload/Fechamento (isolado por RLS).
  let links = `
    <a href="dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="upload.html" class="${activePage === 'upload' ? 'active' : ''}">Upload</a>
    <a href="fechamento.html" class="${activePage === 'fechamento' ? 'active' : ''}">Fechamento</a>
  `;
  // Só a matriz tem a visão geral (creators) e a config da marca.
  if (isMatriz) {
    links += `<a href="admin.html" class="${activePage === 'admin' ? 'active' : ''}" style="color:var(--orange);">Matriz</a>`;
    links += `<a href="settings.html" class="${activePage === 'settings' ? 'active' : ''}">Config</a>`;
  }
  links += `
    <span style="color:var(--muted);font-size:11px;">${name}</span>
    <a href="#" class="logout" onclick="logout();return false;">Sair</a>
  `;
  nav.innerHTML = links;
}
