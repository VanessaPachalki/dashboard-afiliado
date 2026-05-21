// ================================================
// SPACEHUB - Super Admin Logic
// ================================================

let allAgencies = [];
let selectedAgencyId = null;
let agencyMembers = [];

const RESERVED_SLUGS = ['www', 'app', 'api', 'admin', 'test', 'staging', 'mail', 'ftp', 'static', 'assets', 'spacehub'];

// ===== INIT =====

async function initSuperAdmin() {
  await Promise.all([loadAgencies(), loadStats()]);
}

// ===== GLOBAL STATS =====

async function loadStats() {
  const [agencies, members, orders, uploads] = await Promise.all([
    sb.from('agencies').select('id', { count: 'exact', head: true }),
    sb.from('agency_members').select('id', { count: 'exact', head: true }),
    sb.from('orders').select('id', { count: 'exact', head: true }),
    sb.from('uploads').select('id', { count: 'exact', head: true })
  ]);

  document.getElementById('statAgencies').textContent = (agencies.count || 0).toLocaleString();
  document.getElementById('statMembers').textContent = (members.count || 0).toLocaleString();
  document.getElementById('statOrders').textContent = (orders.count || 0).toLocaleString();
  document.getElementById('statUploads').textContent = (uploads.count || 0).toLocaleString();
}

// ===== AGENCIES =====

async function loadAgencies() {
  const { data, error } = await sb
    .from('agencies')
    .select('*')
    .order('created_at', { ascending: false });

  allAgencies = data || [];
  renderAgencies();
}

function renderAgencies() {
  const list = document.getElementById('agenciesList');

  if (!allAgencies.length) {
    list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;">Nenhuma agencia cadastrada.</div>';
    return;
  }

  list.innerHTML = allAgencies.map(a => {
    const date = new Date(a.created_at).toLocaleDateString('pt-BR');
    const planClass = a.plan === 'pro' ? 'plan-pro' : 'plan-starter';
    const activeStyle = a.is_active ? '' : 'opacity:0.5;';
    const activeLabel = a.is_active ? '' : ' <span style="color:var(--red);font-size:10px;">(inativa)</span>';

    return `<div class="agency-card" style="${activeStyle}" data-id="${escAttr(a.id)}">
      <div class="agency-header">
        ${a.logo_url ? `<img src="${escAttr(a.logo_url)}" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="agency-name" style="color:${escAttr(a.primary_color)};">${esc(a.name)}${activeLabel}</div>
          <div class="agency-slug">${esc(a.slug)}.spacehub-ai.com</div>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
          <span class="color-preview" style="background:${escAttr(a.primary_color)};"></span>
          <span class="plan-tag ${planClass}">${esc(a.plan)}</span>
        </div>
      </div>
      <div class="agency-meta">
        <span>Criada em ${date}</span>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-sm" style="font-size:11px;padding:5px 12px;" onclick="openDetail('${escAttr(a.id)}')">Membros</button>
        <button class="btn-sm" style="font-size:11px;padding:5px 12px;background:transparent;border:1px solid var(--border);color:var(--muted);" onclick="toggleAgency('${escAttr(a.id)}', ${a.is_active})">${a.is_active ? 'Desativar' : 'Ativar'}</button>
        <a href="https://${esc(a.slug)}.spacehub-ai.com" target="_blank" class="btn-sm" style="font-size:11px;padding:5px 12px;background:transparent;border:1px solid var(--orange);color:var(--orange);text-decoration:none;">Abrir</a>
      </div>
    </div>`;
  }).join('');
}

// ===== CREATE AGENCY =====

async function createAgency() {
  const name = document.getElementById('agName').value.trim();
  const slug = document.getElementById('agSlug').value.trim().toLowerCase();
  const color = document.getElementById('agColor').value;
  const plan = document.getElementById('agPlan').value;
  const adminEmail = document.getElementById('agAdminEmail').value.trim().toLowerCase();
  const adminName = document.getElementById('agAdminName').value.trim();
  const msg = document.getElementById('agMsg');

  if (!name) { msg.className = 'msg msg-err'; msg.textContent = 'Digite o nome da agencia.'; return; }
  if (!slug || slug.length < 3) { msg.className = 'msg msg-err'; msg.textContent = 'Slug deve ter pelo menos 3 caracteres.'; return; }
  if (!/^[a-z0-9][a-z0-9\-]*[a-z0-9]$/.test(slug)) { msg.className = 'msg msg-err'; msg.textContent = 'Slug invalido. Use apenas letras minusculas, numeros e hifen.'; return; }
  if (RESERVED_SLUGS.includes(slug)) { msg.className = 'msg msg-err'; msg.textContent = `Slug "${slug}" e reservado.`; return; }
  if (!adminEmail || !adminEmail.includes('@')) { msg.className = 'msg msg-err'; msg.textContent = 'E-mail do admin invalido.'; return; }

  msg.className = 'msg'; msg.textContent = 'Criando agencia...';

  // Create agency
  const { data: agency, error: agErr } = await sb
    .from('agencies')
    .insert({ slug, name, primary_color: color, plan })
    .select()
    .single();

  if (agErr) {
    msg.className = 'msg msg-err';
    msg.textContent = agErr.code === '23505' ? `Slug "${slug}" ja esta em uso.` : agErr.message;
    return;
  }

  // Add admin member
  const { error: memErr } = await sb
    .from('agency_members')
    .insert({
      agency_id: agency.id,
      email: adminEmail,
      role: 'agency_admin',
      display_name: adminName || null
    });

  if (memErr) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Agencia criada, mas erro ao adicionar admin: ' + memErr.message;
    await loadAgencies();
    return;
  }

  // Also add to approved_emails for backwards compatibility
  await sb.from('approved_emails').upsert({
    email: adminEmail,
    role: 'admin',
    display_name: adminName || null,
    agency_id: agency.id
  }, { onConflict: 'email' });

  msg.className = 'msg msg-ok';
  msg.textContent = `Agencia "${name}" criada! Acesso: ${slug}.spacehub-ai.com`;

  // Clear form
  document.getElementById('agName').value = '';
  document.getElementById('agSlug').value = '';
  document.getElementById('agAdminEmail').value = '';
  document.getElementById('agAdminName').value = '';

  await Promise.all([loadAgencies(), loadStats()]);
}

// ===== TOGGLE AGENCY =====

async function toggleAgency(id, currentlyActive) {
  const action = currentlyActive ? 'desativar' : 'ativar';
  const agency = allAgencies.find(a => a.id === id);
  if (!confirm(`${currentlyActive ? 'Desativar' : 'Ativar'} agencia "${agency?.name}"?`)) return;

  await sb.from('agencies').update({
    is_active: !currentlyActive,
    updated_at: new Date().toISOString()
  }).eq('id', id);

  await loadAgencies();
}

// ===== AGENCY DETAIL (MEMBERS) =====

async function openDetail(agencyId) {
  selectedAgencyId = agencyId;
  const agency = allAgencies.find(a => a.id === agencyId);
  if (!agency) return;

  document.getElementById('detailTitle').textContent = `Membros — ${agency.name}`;
  document.getElementById('agencyDetail').style.display = '';

  await loadMembers();
  document.getElementById('agencyDetail').scrollIntoView({ behavior: 'smooth' });
}

function closeDetail() {
  selectedAgencyId = null;
  document.getElementById('agencyDetail').style.display = 'none';
}

async function loadMembers() {
  if (!selectedAgencyId) return;

  const { data } = await sb
    .from('agency_members')
    .select('*')
    .eq('agency_id', selectedAgencyId)
    .order('created_at', { ascending: false });

  agencyMembers = data || [];
  renderMembers();
}

function renderMembers() {
  const tb = document.getElementById('tMembers');

  if (!agencyMembers.length) {
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhum membro.</td></tr>';
    return;
  }

  tb.innerHTML = agencyMembers.map(m => {
    const date = new Date(m.created_at).toLocaleDateString('pt-BR');
    const roleTag = m.role === 'agency_admin'
      ? '<span style="color:var(--orange);font-weight:600;">Admin</span>'
      : '<span style="color:var(--muted);">Afiliado</span>';
    return `<tr>
      <td>${esc(m.email)}</td>
      <td>${esc(m.display_name || '-')}</td>
      <td>${roleTag}</td>
      <td>${date}</td>
      <td><button class="del" data-id="${escAttr(m.id)}">Remover</button></td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => removeMember(btn.dataset.id));
  });
}

async function addMember() {
  const email = document.getElementById('memberEmail').value.trim().toLowerCase();
  const name = document.getElementById('memberName').value.trim();
  const role = document.getElementById('memberRole').value;
  const msg = document.getElementById('memberMsg');

  if (!selectedAgencyId) { msg.className = 'msg msg-err'; msg.textContent = 'Nenhuma agencia selecionada.'; return; }
  if (!email || !email.includes('@')) { msg.className = 'msg msg-err'; msg.textContent = 'E-mail invalido.'; return; }

  // Optimistic
  const optimistic = { id: 'temp-' + Date.now(), email, role, display_name: name || null, agency_id: selectedAgencyId, created_at: new Date().toISOString() };
  agencyMembers.unshift(optimistic);
  renderMembers();
  msg.className = 'msg msg-ok';
  msg.textContent = `${email} adicionado.`;
  document.getElementById('memberEmail').value = '';
  document.getElementById('memberName').value = '';

  const { data, error } = await sb.from('agency_members').insert({
    agency_id: selectedAgencyId,
    email,
    role,
    display_name: name || null
  }).select().single();

  if (error) {
    agencyMembers = agencyMembers.filter(m => m.id !== optimistic.id);
    renderMembers();
    msg.className = 'msg msg-err';
    msg.textContent = error.code === '23505' ? 'Este e-mail ja e membro desta agencia.' : error.message;
  } else if (data) {
    const idx = agencyMembers.findIndex(m => m.id === optimistic.id);
    if (idx !== -1) agencyMembers[idx] = data;
  }

  loadStats();
}

async function removeMember(id) {
  const member = agencyMembers.find(m => m.id === id);
  if (!confirm(`Remover ${member?.email}?`)) return;

  // Optimistic
  agencyMembers = agencyMembers.filter(m => m.id !== id);
  renderMembers();

  const { error } = await sb.from('agency_members').delete().eq('id', id);
  if (error) {
    if (member) agencyMembers.unshift(member);
    renderMembers();
  }

  loadStats();
}
