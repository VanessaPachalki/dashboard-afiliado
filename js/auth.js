// ================================================
// SPACEHUB - Auth helpers (Multi-Tenant)
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

  const email = session.user.email;
  const agency = window.AGENCY;

  // Superadmin portal (no subdomain) — only superadmins allowed
  if (!agency?.id) {
    const { data: sa } = await sb
      .from('superadmins')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (!sa) {
      await sb.auth.signOut();
      window.location.href = 'index.html';
      return null;
    }
    return session;
  }

  // Agency subdomain — check agency_members
  const { data: member } = await sb
    .from('agency_members')
    .select('email, role, display_name')
    .eq('agency_id', agency.id)
    .eq('email', email)
    .maybeSingle();

  if (member) return session;

  // Not a member — maybe superadmin?
  const { data: sa } = await sb
    .from('superadmins')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (sa) return session;

  // Not authorized
  await sb.auth.signOut();
  window.location.href = 'index.html';
  return null;
}

async function getUserRole() {
  const session = await getSession();
  if (!session) return null;

  const email = session.user.email;
  const agency = window.AGENCY;

  // Superadmin check first
  const { data: sa } = await sb
    .from('superadmins')
    .select('email, display_name')
    .eq('email', email)
    .maybeSingle();

  if (sa) {
    return { role: 'admin', display_name: sa.display_name || email, is_superadmin: true };
  }

  // Agency member
  if (agency?.id) {
    const { data: member } = await sb
      .from('agency_members')
      .select('role, display_name')
      .eq('agency_id', agency.id)
      .eq('email', email)
      .maybeSingle();

    if (member) {
      return {
        role: member.role === 'agency_admin' ? 'admin' : 'affiliate',
        display_name: member.display_name || email,
        is_superadmin: false
      };
    }
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
  const isAdmin = userInfo?.role === 'admin';
  const name = esc(userInfo?.display_name || session?.user?.email || '');

  const nav = document.getElementById('topbar-nav');
  if (!nav) return;

  let links = `
    <a href="dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="upload.html" class="${activePage === 'upload' ? 'active' : ''}">Upload</a>
  `;
  if (isAdmin) {
    links += `<a href="fechamento.html" class="${activePage === 'fechamento' ? 'active' : ''}">Fechamento</a>`;
    links += `<a href="admin.html" class="${activePage === 'admin' ? 'active' : ''}">Admin</a>`;
    links += `<a href="settings.html" class="${activePage === 'settings' ? 'active' : ''}">Config</a>`;
  }
  if (userInfo?.is_superadmin) {
    links += `<a href="superadmin.html" class="${activePage === 'superadmin' ? 'active' : ''}" style="color:var(--orange);">Super</a>`;
  }
  links += `
    <span style="color:var(--muted);font-size:11px;">${name}</span>
    <a href="#" class="logout" onclick="logout();return false;">Sair</a>
  `;
  nav.innerHTML = links;
}
