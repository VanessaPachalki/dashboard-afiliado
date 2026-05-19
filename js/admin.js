// ================================================
// SPACEHUB - Admin Logic
// ================================================

async function loadAdmin() {
  await Promise.all([loadEmails(), loadAccounts(), loadAffiliates(), loadAllUploads()]);
}

// ===== EMAILS =====

async function loadEmails() {
  const { data, error } = await sb
    .from('approved_emails')
    .select('*')
    .order('created_at', { ascending: false });

  const tb = document.getElementById('tEmails');
  if (error || !data?.length) {
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhum e-mail cadastrado.</td></tr>';
    return;
  }

  tb.innerHTML = data.map(e => {
    const date = new Date(e.created_at).toLocaleDateString('pt-BR');
    const roleTag = e.role === 'admin'
      ? '<span style="color:var(--orange);font-weight:600;">Admin</span>'
      : '<span style="color:var(--muted);">Afiliado</span>';
    return `<tr>
      <td>${e.email}</td>
      <td>${e.display_name || '-'}</td>
      <td>${roleTag}</td>
      <td>${date}</td>
      <td><button class="del" onclick="removeEmail('${e.email}')">Remover</button></td>
    </tr>`;
  }).join('');
}

async function addEmail() {
  const email = document.getElementById('newEmail').value.trim().toLowerCase();
  const name = document.getElementById('newName').value.trim();
  const role = document.getElementById('newRole').value;
  const msg = document.getElementById('emailMsg');

  if (!email || !email.includes('@')) {
    msg.className = 'msg msg-err';
    msg.textContent = 'E-mail inválido.';
    return;
  }

  const { error } = await sb.from('approved_emails').insert({
    email, role, display_name: name || null
  });

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = error.code === '23505' ? 'Este e-mail já está cadastrado.' : error.message;
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

async function loadAccounts() {
  const { data: accounts, error } = await sb
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false });

  // Populate dropdown with approved emails
  const { data: emails } = await sb
    .from('approved_emails')
    .select('email, display_name')
    .order('email');

  const select = document.getElementById('newAccountEmail');
  select.innerHTML = '<option value="">Selecione o e-mail</option>';
  (emails || []).forEach(e => {
    const label = e.display_name ? `${e.display_name} (${e.email})` : e.email;
    select.innerHTML += `<option value="${e.email}">${label}</option>`;
  });

  const tb = document.getElementById('tAccounts');
  if (error || !accounts?.length) {
    tb.innerHTML = '<tr><td colspan="4" style="color:var(--muted);text-align:center;">Nenhuma conta cadastrada ainda.</td></tr>';
    return;
  }

  tb.innerHTML = accounts.map(a => {
    const date = new Date(a.created_at).toLocaleDateString('pt-BR');
    return `<tr>
      <td><strong>${a.name}</strong></td>
      <td>${a.email}</td>
      <td>${date}</td>
      <td><button class="del" onclick="removeAccount('${a.id}','${a.name}')">Remover</button></td>
    </tr>`;
  }).join('');
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

// ===== AFFILIATES =====

async function loadAffiliates() {
  // Get approved affiliates
  const { data: emails } = await sb
    .from('approved_emails')
    .select('email, display_name')
    .eq('role', 'affiliate');

  // Get upload stats
  const { data: uploads } = await sb
    .from('uploads')
    .select('user_id, row_count');

  // Get user IDs from auth (via uploads)
  const userStats = {};
  (uploads || []).forEach(u => {
    if (!userStats[u.user_id]) userStats[u.user_id] = { uploads: 0, orders: 0 };
    userStats[u.user_id].uploads++;
    userStats[u.user_id].orders += u.row_count;
  });

  const tb = document.getElementById('tAffiliates');
  if (!emails?.length) {
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhum afiliado cadastrado ainda.</td></tr>';
    return;
  }

  // We need to match emails to user_ids. Query orders grouped by user_id
  // For now, show what we have from approved_emails
  tb.innerHTML = emails.map(e => {
    return `<tr>
      <td>${e.email}</td>
      <td>${e.display_name || '-'}</td>
      <td class="r">-</td>
      <td class="r">-</td>
      <td><a href="dashboard.html" style="color:var(--orange);font-size:11px;">Ver dashboard</a></td>
    </tr>`;
  }).join('');
}

// ===== ALL UPLOADS =====

let allUploads = [];

async function loadAllUploads() {
  const { data: uploads, error } = await sb
    .from('uploads')
    .select('*, accounts(name, email)')
    .order('uploaded_at', { ascending: false });

  allUploads = uploads || [];

  // Populate filter dropdowns
  const emails = [...new Set(allUploads.map(u => u.accounts?.email).filter(Boolean))].sort();
  const accounts = [...new Set(allUploads.map(u => u.accounts?.name).filter(Boolean))].sort();

  const filterEmail = document.getElementById('filterEmail');
  const filterAccount = document.getElementById('filterAccount');
  filterEmail.innerHTML = '<option value="">Todos os e-mails</option>' + emails.map(e => `<option value="${e}">${e}</option>`).join('');
  filterAccount.innerHTML = '<option value="">Todas as contas</option>' + accounts.map(a => `<option value="${a}">${a}</option>`).join('');

  renderUploads(allUploads);
}

function filterUploads() {
  const email = document.getElementById('filterEmail').value;
  const account = document.getElementById('filterAccount').value;
  let filtered = allUploads;
  if (email) filtered = filtered.filter(u => u.accounts?.email === email);
  if (account) filtered = filtered.filter(u => u.accounts?.name === account);
  renderUploads(filtered);
}

function renderUploads(uploads) {
  const tb = document.getElementById('tUploads');
  if (!uploads?.length) {
    tb.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;">Nenhum upload.</td></tr>';
    return;
  }

  tb.innerHTML = uploads.map(u => {
    const date = new Date(u.uploaded_at).toLocaleDateString('pt-BR');
    const email = u.accounts?.email || '-';
    const accountName = u.accounts?.name || 'Sem conta';
    return `<tr>
      <td>${u.filename}</td>
      <td style="font-size:11px;">${email}</td>
      <td style="color:var(--orange);font-size:12px;">${accountName}</td>
      <td class="r">${u.row_count.toLocaleString()}</td>
      <td>${date}</td>
      <td><button class="del" onclick="deleteUploadAdmin('${u.id}','${u.filename}')">Excluir</button></td>
    </tr>`;
  }).join('');
}

async function deleteUploadAdmin(id, filename) {
  if (!confirm(`Tem certeza que deseja excluir "${filename}" e todos os pedidos?`)) return;
  await sb.from('uploads').delete().eq('id', id);
  await loadAllUploads();
}
