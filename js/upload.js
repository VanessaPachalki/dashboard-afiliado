// ================================================
// SPACEHUB - Upload Logic
// Parses xlsx client-side and inserts into Supabase
// ================================================

const STATUS_MAP = {
  'Liquidado': 0,
  'Inelegível': 1,
  'Inelegivel': 1,
  'Pendente': 2,
  'AwaitingPayment': 3,
  'Aguardando Pagamento': 3
};

const CONTENT_TYPE_MAP = {
  'Live': 0, 'LIVE': 0, 'live': 0,
  'Video': 1, 'VIDEO': 1, 'video': 1,
  'Vídeo': 1, 'vídeo': 1,
  'Compartilhamento de link': 2,
  'Vitrine': 3
};

// Column names from TikTok Shop xlsx
const COL = {
  orderId: 'ID do pedido',
  skuId: 'ID do SKU',
  orderDate: 'Data do pedido',
  gmv: 'GMV',
  status: 'Status de liquidação do pedido',
  contentType: 'Tipo de conteúdo',
  storeName: 'Nome da loja',
  productName: 'Nome do produto',
  contentId: 'ID do conteúdo',
  itemsSold: 'Itens vendidos',
  itemsRefunded: 'Itens reembolsados',
  estimatedCommission: 'Comissão padrão estimada',
  receivedCommission: 'Valor total final recebido'
};

// ===== ACCOUNTS =====

async function loadAccounts() {
  const session = await getSession();
  if (!session) return;

  const account = await getOrCreateMyAccount(session);
  const select = document.getElementById('accountSelect');
  const selector = document.getElementById('accountSelector');

  if (!account) {
    select.innerHTML = '<option value="">Erro ao preparar sua conta</option>';
    return;
  }
  // Self-service: cada creator tem 1 conta automática — sem escolher.
  select.innerHTML = `<option value="${escAttr(account.id)}">${esc(account.name)}</option>`;
  selector.style.display = 'none';
}

// Retorna a conta do creator (dono = ele), criando na 1ª vez.
async function getOrCreateMyAccount(session) {
  const uid = session.user.id;

  const { data: existing } = await sb
    .from('accounts')
    .select('id, name, email')
    .eq('owner_id', uid)
    .order('created_at', { ascending: true })
    .limit(1);
  if (existing && existing.length) return existing[0];

  const role = await getUserRole();
  const name = (role && role.display_name) || session.user.email;
  const { data, error } = await sb.from('accounts').insert({
    owner_id: uid,
    email: session.user.email,
    name,
    agency_id: agencyId()
  }).select('id, name, email').single();

  if (error) { console.error('getOrCreateMyAccount:', error); return null; }
  return data;
}

// ===== DRAG & DROP =====

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

async function handleFiles(files) {
  for (const file of files) {
    if (!file.name.endsWith('.xlsx')) {
      showMsg('Apenas arquivos .xlsx são aceitos.', true);
      continue;
    }
    await processFile(file);
  }
}

function showMsg(text, isError) {
  const el = document.getElementById('uploadMsg');
  el.className = 'msg ' + (isError ? 'msg-err' : 'msg-ok');
  el.textContent = text;
}

function showProgress(pct) {
  const bar = document.getElementById('progressBar');
  const fill = document.getElementById('progressFill');
  bar.style.display = pct >= 0 ? 'block' : 'none';
  fill.style.width = pct + '%';
}

// ===== PROCESS FILE =====

async function processFile(file) {
  const session = await getSession();
  if (!session) return;
  const userId = session.user.id;

  const accountId = document.getElementById('accountSelect').value;
  if (!accountId) {
    showMsg('Selecione uma conta antes de enviar.', true);
    return;
  }

  showMsg('Lendo arquivo...', false);
  showProgress(10);

  try {
    // Read xlsx
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);

    if (!rows.length) {
      showMsg('A planilha está vazia.', true);
      showProgress(-1);
      return;
    }

    // Validate columns
    const firstRow = rows[0];
    const missing = Object.values(COL).filter(c => !(c in firstRow));
    if (missing.length > 0) {
      showMsg(`Colunas faltando: ${missing.join(', ')}`, true);
      showProgress(-1);
      return;
    }

    showMsg(`Processando ${rows.length} pedidos...`, false);
    showProgress(30);

    // Create upload record
    const { data: upload, error: upErr } = await sb
      .from('uploads')
      .insert({ user_id: userId, account_id: accountId, agency_id: agencyId(), filename: file.name, row_count: rows.length })
      .select()
      .single();

    if (upErr) throw upErr;

    // Parse rows
    const orders = [];
    for (const row of rows) {
      const parsed = parseRow(row, upload.id, userId, accountId);
      if (parsed) orders.push(parsed);
    }

    showMsg(`Enviando ${orders.length} pedidos...`, false);
    showProgress(60);

    // Upsert in chunks — ignora duplicatas pelo índice único (user_id + tiktok_order_id)
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < orders.length; i += CHUNK) {
      const chunk = orders.slice(i, i + CHUNK);
      const { data: result, error: insErr } = await sb.from('orders')
        .upsert(chunk, { onConflict: 'user_id,tiktok_order_id,sku_id', ignoreDuplicates: true })
        .select('id');
      if (insErr) throw insErr;
      inserted += result ? result.length : 0;
      showProgress(60 + Math.round((i / orders.length) * 35));
    }

    const skipped = orders.length - inserted;

    // Update row count with actual inserted
    await sb.from('uploads').update({ row_count: inserted }).eq('id', upload.id);

    showProgress(100);
    const skippedMsg = skipped > 0 ? ` (${skipped.toLocaleString()} duplicados ignorados)` : '';
    showMsg(`Pronto! ${inserted.toLocaleString()} pedidos importados com sucesso.${skippedMsg}`, false);
    setTimeout(() => showProgress(-1), 2000);

    await loadUploads();

  } catch (err) {
    showMsg('Erro: ' + err.message, true);
    showProgress(-1);
  }
}

function parseRow(row, uploadId, userId, accountId) {
  try {
    const dateStr = row[COL.orderDate];
    if (!dateStr) return null;

    // Parse date: "11/05/2026 15:06:48" or "2026-05-11"
    let dt;
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      const parts = dateStr.split(' ')[0].split('/');
      dt = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    } else {
      dt = new Date(dateStr);
    }
    if (isNaN(dt.getTime())) return null;

    const month = (dt.getMonth() + 1).toString().padStart(2, '0');
    const orderDate = dt.toISOString().split('T')[0];
    const hasTime = typeof dateStr === 'string' && dateStr.includes(':');
    const hour = hasTime
      ? parseInt(dateStr.split(' ')[1].split(':')[0])
      : dt.getHours();
    const minute = hasTime
      ? parseInt(dateStr.split(' ')[1].split(':')[1])
      : dt.getMinutes();
    const dayOfWeek = (dt.getDay() + 6) % 7; // Mon=0

    const parseNum = v => {
      if (v == null || v === '' || v === '/') return 0;
      if (typeof v === 'number') return v;
      return parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, '')) || 0;
    };

    return {
      upload_id: uploadId,
      user_id: userId,
      account_id: accountId,
      agency_id: agencyId(),
      tiktok_order_id: String(row[COL.orderId] || ''),
      sku_id: String(row[COL.skuId] || ''),
      month,
      order_date: orderDate,
      hour,
      minute,
      day_of_week: dayOfWeek,
      gmv: parseNum(row[COL.gmv]),
      settlement_status: STATUS_MAP[row[COL.status]] ?? 2,
      content_type: CONTENT_TYPE_MAP[row[COL.contentType]] ?? 0,
      store_name: row[COL.storeName] || 'Desconhecida',
      product_name: (row[COL.productName] || '').slice(0, 60),
      content_id: String(row[COL.contentId] || '').slice(-6),
      items_sold: parseInt(row[COL.itemsSold]) || 0,
      items_refunded: parseInt(row[COL.itemsRefunded]) || 0,
      estimated_commission: parseNum(row[COL.estimatedCommission]),
      received_commission: parseNum(row[COL.receivedCommission])
    };
  } catch {
    return null;
  }
}

// ===== UPLOAD LIST =====

async function loadUploads() {
  const listEl = document.getElementById('uploadList');
  const loadEl = document.getElementById('listLoading');
  loadEl.style.display = 'flex';

  let upQuery = sb
    .from('uploads')
    .select('*, accounts(name)')
    .order('uploaded_at', { ascending: false });
  if (agencyId()) upQuery = upQuery.eq('agency_id', agencyId());
  const { data: uploads, error } = await upQuery;

  loadEl.style.display = 'none';

  if (error || !uploads?.length) {
    listEl.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:20px;">Nenhum arquivo enviado ainda. Faça seu primeiro upload acima.</div>';
    return;
  }

  listEl.innerHTML = uploads.map(u => {
    const date = new Date(u.uploaded_at).toLocaleDateString('pt-BR');
    const accountName = esc(u.accounts?.name || 'Sem conta');
    return `
      <div class="upload-item">
        <div class="meta">
          <strong>${esc(u.filename)}</strong>
          <span>${u.row_count.toLocaleString()} pedidos</span>
          <span style="color:var(--orange);">${accountName}</span>
          <span>${date}</span>
        </div>
        <button class="del" data-id="${escAttr(u.id)}" data-name="${escAttr(u.filename)}">Excluir</button>
      </div>`;
  }).join('');
  // Bind delete buttons
  listEl.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => deleteUpload(btn.dataset.id, btn.dataset.name));
  });
}

async function deleteUpload(id, filename) {
  if (!confirm(`Tem certeza que deseja excluir "${filename}" e todos os pedidos associados?`)) return;

  const { error } = await sb.from('uploads').delete().eq('id', id);
  if (error) {
    showMsg('Erro ao excluir: ' + error.message, true);
    return;
  }
  showMsg(`"${filename}" excluído com sucesso.`, false);
  await loadUploads();
}
