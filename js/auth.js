// ================================================
// SPACEHUB - Auth helpers
// ================================================

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }

  // Verificar se e-mail está na lista de autorizados
  const { data: approved } = await sb
    .from('approved_emails')
    .select('email')
    .eq('email', session.user.email)
    .single();

  if (!approved) {
    await sb.auth.signOut();
    window.location.href = 'index.html';
    return null;
  }

  return session;
}

async function getUserRole() {
  const session = await getSession();
  if (!session) return null;
  const { data } = await sb
    .from('approved_emails')
    .select('role, display_name')
    .eq('email', session.user.email)
    .single();
  return data;
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// Render nav bar with user info
async function renderNav(activePage) {
  const session = await getSession();
  const userInfo = await getUserRole();
  const isAdmin = userInfo?.role === 'admin';
  const name = userInfo?.display_name || session?.user?.email || '';

  const nav = document.getElementById('topbar-nav');
  if (!nav) return;

  let links = `
    <a href="dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="upload.html" class="${activePage === 'upload' ? 'active' : ''}">Upload</a>
  `;
  if (isAdmin) {
    links += `<a href="admin.html" class="${activePage === 'admin' ? 'active' : ''}">Admin</a>`;
  }
  links += `
    <span style="color:var(--muted);font-size:11px;">${name}</span>
    <a href="#" class="logout" onclick="logout();return false;">Sair</a>
  `;
  nav.innerHTML = links;
}
