// ================================================
// BRX - Visão Matriz (creators + overview)
// ================================================

const PER_PAGE = 15;

function fmtBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function renderPag(containerId, currentPage, totalPages, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }
  let html = `<button ${currentPage === 1 ? 'disabled' : ''} data-p="${currentPage - 1}">&laquo;</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="${i === currentPage ? 'active' : ''}" data-p="${i}">${i}</button>`;
  }
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-p="${currentPage + 1}">&raquo;</button>`;
  el.innerHTML = html;
  el.querySelectorAll('button:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', () => onPageChange(+btn.dataset.p));
  });
}

async function loadAdmin() {
  await Promise.all([loadCreators(), loadStats()]);
  render();
  loadLoginAttempts().catch(e => console.error('loadLoginAttempts:', e));
}

// ===== CREATORS + STATS =====

let creatorsList = [];
let statsByUser = {}; // user_id -> { uploads, lastUpload, comissao, turnos }

async function loadCreators() {
  const { data } = await sb.from('creators').select('*').order('created_at', { ascending: false });
  creatorsList = data || [];
}

async function loadStats() {
  statsByUser = {};
  const bump = (uid) => statsByUser[uid] || (statsByUser[uid] = { uploads: 0, lastUpload: null, comissao: 0, turnos: 0 });

  // uploads (matriz vê todos via RLS)
  const { data: ups } = await sb.from('uploads').select('user_id, uploaded_at');
  (ups || []).forEach(u => {
    if (!u.user_id) return;
    const s = bump(u.user_id);
    s.uploads++;
    if (!s.lastUpload || u.uploaded_at > s.lastUpload) s.lastUpload = u.uploaded_at;
  });

  // turnos (comissão salva)
  const { data: ts } = await sb.from('turnos').select('owner_id, comissao');
  (ts || []).forEach(t => {
    if (!t.owner_id) return;
    const s = bump(t.owner_id);
    s.comissao += Number(t.comissao) || 0;
    s.turnos++;
  });
}

function render() {
  renderOverview();
  renderCreators();
}

function renderOverview() {
  const total = creatorsList.length;
  const ativos = creatorsList.filter(c => c.active).length;
  let comissao = 0, uploads = 0;
  Object.values(statsByUser).forEach(s => { comissao += s.comissao; uploads += s.uploads; });
  document.getElementById('overview').innerHTML = `
    <div class="kpi"><div class="kpi-v">${total}</div><div class="kpi-l">Creators (${ativos} ativos)</div></div>
    <div class="kpi"><div class="kpi-v" style="color:var(--orange);">${fmtBRL(comissao)}</div><div class="kpi-l">Comissão (turnos salvos)</div></div>
    <div class="kpi"><div class="kpi-v">${uploads}</div><div class="kpi-l">Uploads</div></div>
  `;
}

function renderCreators() {
  const list = document.getElementById('creatorsList');
  if (!creatorsList.length) {
    list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px;font-size:13px;">Nenhum creator convidado ainda. Convide pelo e-mail acima.</div>';
    return;
  }
  list.innerHTML = creatorsList.map(c => {
    const s = (c.user_id && statsByUser[c.user_id]) || { uploads: 0, lastUpload: null, comissao: 0, turnos: 0 };
    const last = s.lastUpload ? new Date(s.lastUpload).toLocaleDateString('pt-BR') : '—';
    const statusTag = c.active
      ? '<span style="font-size:11px;color:var(--green);font-weight:600;">ativo</span>'
      : '<span style="font-size:11px;color:var(--muted);">inativo</span>';
    const activity = c.user_id
      ? `${s.uploads} uploads · últ. ${last}`
      : '<span style="color:var(--muted);">convidado (ainda não logou)</span>';
    const verBtn = c.user_id
      ? `<button class="btn-sm c-ver" data-uid="${escAttr(c.user_id)}">Ver lives</button>`
      : '';
    return `<div style="padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <strong style="color:var(--text);font-size:14px;">${esc(c.display_name || c.email)}</strong>
      <span style="font-size:11px;color:var(--muted);">${esc(c.email)}</span>
      ${statusTag}
      <span style="font-size:11px;color:var(--muted);">${activity}</span>
      <span style="font-size:13px;color:var(--orange);font-weight:700;">${fmtBRL(s.comissao)}</span>
      <span style="margin-left:auto;display:flex;gap:6px;">
        ${verBtn}
        <button class="del c-del" data-email="${escAttr(c.email)}" data-name="${escAttr(c.display_name || c.email)}">Remover</button>
      </span>
    </div>`;
  }).join('');

  list.querySelectorAll('.c-ver').forEach(b =>
    b.addEventListener('click', () => { window.location.href = `dashboard.html?user=${encodeURIComponent(b.dataset.uid)}`; }));
  list.querySelectorAll('.c-del').forEach(b =>
    b.addEventListener('click', () => removeCreator(b.dataset.email, b.dataset.name)));
}

async function inviteCreator() {
  const email = document.getElementById('inviteEmail').value.trim().toLowerCase();
  const name = document.getElementById('inviteName').value.trim();
  const msg = document.getElementById('inviteMsg');
  if (!email || !email.includes('@')) {
    msg.className = 'msg msg-err'; msg.textContent = 'E-mail inválido.'; return;
  }
  const { data, error } = await sb.from('creators')
    .insert({ email, display_name: name || null, active: true })
    .select().single();
  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = error.code === '23505' ? 'Este creator já foi convidado.' : error.message;
    return;
  }
  creatorsList.unshift(data);
  document.getElementById('inviteEmail').value = '';
  document.getElementById('inviteName').value = '';
  msg.className = 'msg msg-ok';
  msg.textContent = `${email} convidado. É só ele logar com Google.`;
  render();
}

async function removeCreator(email, name) {
  if (!confirm(`Remover o creator "${name}"? Ele perde o acesso (os dados dele permanecem).`)) return;
  const prev = creatorsList;
  creatorsList = creatorsList.filter(c => c.email !== email);
  render();
  const { error } = await sb.from('creators').delete().eq('email', email);
  if (error) { creatorsList = prev; render(); }
}

// ===== AVANÇADO: tentativas de login bloqueadas =====

let allAttempts = [];
let attemptsPage = 1;

async function loadLoginAttempts() {
  const { data, error } = await sb.from('login_attempts').select('*').order('attempted_at', { ascending: false });
  const tb = document.getElementById('tAttempts');
  if (error || !data?.length) {
    allAttempts = [];
    if (tb) tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;">Nenhuma tentativa bloqueada.</td></tr>';
    renderPag('pagAttempts', 1, 1, () => {});
    return;
  }
  const grouped = {};
  data.forEach(a => {
    if (!grouped[a.email]) grouped[a.email] = { count: 0, last: a.attempted_at };
    grouped[a.email].count++;
    if (a.attempted_at > grouped[a.email].last) grouped[a.email].last = a.attempted_at;
  });
  allAttempts = Object.entries(grouped).sort((a, b) => b[1].last.localeCompare(a[1].last));
  attemptsPage = 1;
  renderAttempts();
}

function renderAttempts() {
  const tb = document.getElementById('tAttempts');
  if (!tb) return;
  if (!allAttempts.length) {
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;">Nenhuma tentativa bloqueada.</td></tr>';
    renderPag('pagAttempts', 1, 1, () => {});
    return;
  }
  const totalPages = Math.ceil(allAttempts.length / PER_PAGE);
  const start = (attemptsPage - 1) * PER_PAGE;
  const page = allAttempts.slice(start, start + PER_PAGE);
  tb.innerHTML = page.map(([email, info]) => {
    const date = new Date(info.last).toLocaleString('pt-BR');
    const countStyle = info.count >= 3 ? 'color:var(--orange);font-weight:700;' : '';
    return `<tr>
      <td>${esc(email)}</td>
      <td>${date}</td>
      <td class="r" style="${countStyle}">${info.count}x</td>
      <td><button class="del" data-email="${escAttr(email)}">Remover</button></td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('.del').forEach(btn => btn.addEventListener('click', () => removeAttempt(btn.dataset.email)));
  renderPag('pagAttempts', attemptsPage, totalPages, p => { attemptsPage = p; renderAttempts(); });
}

async function removeAttempt(email) {
  if (!confirm(`Remover tentativas de ${email}?`)) return;
  const removed = allAttempts.find(([e]) => e === email);
  allAttempts = allAttempts.filter(([e]) => e !== email);
  renderAttempts();
  const { error } = await sb.from('login_attempts').delete().eq('email', email);
  if (error) { if (removed) allAttempts.unshift(removed); renderAttempts(); }
}
