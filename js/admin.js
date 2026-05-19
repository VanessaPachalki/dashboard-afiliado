// ================================================
// SPACEHUB - Admin Logic
// ================================================

const PER_PAGE = 15;

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
  loadEmails().catch(e => console.error('loadEmails erro:', e));
  loadAccounts().catch(e => console.error('loadAccounts erro:', e));
  loadLoginAttempts().catch(e => console.error('loadLoginAttempts erro:', e));
  loadAllUploads().catch(e => console.error('loadAllUploads erro:', e));
}

// ===== EMAILS =====

let allEmails = [];
let emailsPage = 1;

async function loadEmails() {
  const { data, error } = await sb
    .from('approved_emails')
    .select('*')
    .order('created_at', { ascending: false });

  allEmails = data || [];
  emailsPage = 1;
  renderEmails();
}

function renderEmails() {
  const tb = document.getElementById('tEmails');
  if (!allEmails.length) {
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhum e-mail cadastrado.</td></tr>';
    renderPag('pagEmails', 1, 1, () => {});
    return;
  }

  const totalPages = Math.ceil(allEmails.length / PER_PAGE);
  const start = (emailsPage - 1) * PER_PAGE;
  const page = allEmails.slice(start, start + PER_PAGE);

  tb.innerHTML = page.map(e => {
    const date = new Date(e.created_at).toLocaleDateString('pt-BR');
    const roleTag = e.role === 'admin'
      ? '<span style="color:var(--orange);font-weight:600;">Admin</span>'
      : '<span style="color:var(--muted);">Afiliado</span>';
    return `<tr>
      <td>${esc(e.email)}</td>
      <td>${esc(e.display_name || '-')}</td>
      <td>${roleTag}</td>
      <td>${date}</td>
      <td><button class="del" data-email="${escAttr(e.email)}">Remover</button></td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => removeEmail(btn.dataset.email));
  });

  renderPag('pagEmails', emailsPage, totalPages, p => { emailsPage = p; renderEmails(); });
}

async function addEmail() {
  const email = document.getElementById('newEmail').value.trim().toLowerCase();
  const name = document.getElementById('newName').value.trim();
  const role = document.getElementById('newRole').value;
  const msg = document.getElementById('emailMsg');

  if (!email || !email.includes('@')) {
    msg.className = 'msg msg-err';
    msg.textContent = 'E-mail invalido.';
    return;
  }

  const { error } = await sb.from('approved_emails').insert({
    email, role, display_name: name || null
  });

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = error.code === '23505' ? 'Este e-mail ja esta cadastrado.' : error.message;
    return;
  }

  msg.className = 'msg msg-ok';
  msg.textContent = `${email} adicionado com sucesso.`;
  document.getElementById('newEmail').value = '';
  document.getElementById('newName').value = '';
  await loadEmails();
}

async function removeEmail(email) {
  if (!confirm(`Tem certeza que deseja remover ${email}?`)) return;
  await sb.from('approved_emails').delete().eq('email', email);
  await loadEmails();
}

// ===== ACCOUNTS =====

let allAccounts = [];
let accountsPage = 1;

async function loadAccounts() {
  const { data: accounts, error } = await sb
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });

  const { data: emails } = await sb
    .from('approved_emails')
    .select('email, display_name')
    .order('email');

  const select = document.getElementById('newAccountEmail');
  select.innerHTML = '<option value="">Selecione o e-mail</option>';
  (emails || []).forEach(e => {
    const label = e.display_name ? `${esc(e.display_name)} (${esc(e.email)})` : esc(e.email);
    select.innerHTML += `<option value="${escAttr(e.email)}">${label}</option>`;
  });

  allAccounts = accounts || [];
  accountsPage = 1;
  renderAccounts();
}

function renderAccounts() {
  const tb = document.getElementById('tAccounts');
  if (!allAccounts.length) {
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;">Nenhuma conta cadastrada ainda.</td></tr>';
    renderPag('pagAccounts', 1, 1, () => {});
    return;
  }

  const totalPages = Math.ceil(allAccounts.length / PER_PAGE);
  const start = (accountsPage - 1) * PER_PAGE;
  const page = allAccounts.slice(start, start + PER_PAGE);

  tb.innerHTML = page.map(a => {
    const date = new Date(a.created_at).toLocaleDateString('pt-BR');
    return `<tr>
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(a.email)}</td>
      <td>${date}</td>
      <td><button class="del" data-id="${escAttr(a.id)}" data-name="${escAttr(a.name)}">Remover</button></td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => removeAccount(btn.dataset.id, btn.dataset.name));
  });

  renderPag('pagAccounts', accountsPage, totalPages, p => { accountsPage = p; renderAccounts(); });
}

async function addAccount() {
  const email = document.getElementById('newAccountEmail').value;
  const name = document.getElementById('newAccountName').value.trim();
  const msg = document.getElementById('accountMsg');

  if (!email) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Selecione um e-mail.';
    return;
  }
  if (!name) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Digite um nome para a conta.';
    return;
  }

  const { error } = await sb.from('accounts').insert({ email, name });

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro: ' + error.message;
    return;
  }

  msg.className = 'msg msg-ok';
  msg.textContent = `Conta "${name}" criada com sucesso.`;
  document.getElementById('newAccountName').value = '';
  document.getElementById('newAccountEmail').value = '';
  await loadAccounts();
}

async function removeAccount(id, name) {
  if (!confirm(`Tem certeza que deseja remover a conta "${name}" e todos os dados vinculados?`)) return;
  await sb.from('accounts').delete().eq('id', id);
  await loadAccounts();
}

// ===== LOGIN ATTEMPTS =====

let allAttempts = [];
let attemptsPage = 1;

async function loadLoginAttempts() {
  const { data, error } = await sb
    .from('login_attempts')
    .select('*')
    .order('attempted_at', { ascending: false });

  const tb = document.getElementById('tAttempts');
  if (error || !data?.length) {
    allAttempts = [];
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;">Nenhuma tentativa bloqueada.</td></tr>';
    renderPag('pagAttempts', 1, 1, () => {});
    return;
  }

  // Agrupar por email
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

  tb.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => removeAttempt(btn.dataset.email));
  });

  renderPag('pagAttempts', attemptsPage, totalPages, p => { attemptsPage = p; renderAttempts(); });
}

async function removeAttempt(email) {
  if (!confirm(`Remover tentativas de ${email}?`)) return;
  await sb.from('login_attempts').delete().eq('email', email);
  await loadLoginAttempts();
}

// ===== ALL UPLOADS =====

let allUploads = [];
let uploadsPage = 1;

async function loadAllUploads() {
  const { data: uploads, error } = await sb
    .from('uploads')
    .select('*, accounts(name, email)')
    .order('uploaded_at', { ascending: false });

  allUploads = uploads || [];

  const emails = [...new Set(allUploads.map(u => u.accounts?.email).filter(Boolean))].sort();
  const accounts = [...new Set(allUploads.map(u => u.accounts?.name).filter(Boolean))].sort();

  const filterEmail = document.getElementById('filterEmail');
  const filterAccount = document.getElementById('filterAccount');
  filterEmail.innerHTML = '<option value="">Todos os e-mails</option>' + emails.map(e => `<option value="${e}">${e}</option>`).join('');
  filterAccount.innerHTML = '<option value="">Todas as contas</option>' + accounts.map(a => `<option value="${a}">${a}</option>`).join('');

  uploadsPage = 1;
  renderUploads(allUploads);
}

function filterUploads() {
  const email = document.getElementById('filterEmail').value;
  const account = document.getElementById('filterAccount').value;
  let filtered = allUploads;
  if (email) filtered = filtered.filter(u => u.accounts?.email === email);
  if (account) filtered = filtered.filter(u => u.accounts?.name === account);
  uploadsPage = 1;
  renderUploads(filtered);
}

let currentFilteredUploads = [];

function renderUploads(uploads) {
  currentFilteredUploads = uploads;
  const tb = document.getElementById('tUploads');
  if (!uploads?.length) {
    tb.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;">Nenhum upload.</td></tr>';
    renderPag('pagUploads', 1, 1, () => {});
    return;
  }

  const totalPages = Math.ceil(uploads.length / PER_PAGE);
  const start = (uploadsPage - 1) * PER_PAGE;
  const page = uploads.slice(start, start + PER_PAGE);

  tb.innerHTML = page.map(u => {
    const date = new Date(u.uploaded_at).toLocaleDateString('pt-BR');
    return `<tr>
      <td>${esc(u.filename)}</td>
      <td style="font-size:11px;">${esc(u.accounts?.email || '-')}</td>
      <td style="color:var(--orange);font-size:12px;">${esc(u.accounts?.name || 'Sem conta')}</td>
      <td class="r">${u.row_count.toLocaleString()}</td>
      <td>${date}</td>
      <td><button class="del" data-id="${escAttr(u.id)}" data-name="${escAttr(u.filename)}">Excluir</button></td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => deleteUploadAdmin(btn.dataset.id, btn.dataset.name));
  });

  renderPag('pagUploads', uploadsPage, totalPages, p => { uploadsPage = p; renderUploads(currentFilteredUploads); });
}

async function deleteUploadAdmin(id, filename) {
  if (!confirm(`Tem certeza que deseja excluir "${filename}" e todos os pedidos?`)) return;
  await sb.from('uploads').delete().eq('id', id);
  await loadAllUploads();
}
