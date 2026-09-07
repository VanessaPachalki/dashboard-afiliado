// ================================================
// SPACEHUB - Fechamento de Comissões (Admin only)
// ================================================

const STATUS_LABELS = { 0: 'Liquidado', 1: 'Inelegível', 2: 'Pendente', 3: 'Aguardando Pagamento' };
const STATUS_COLORS = { 0: 'var(--green)', 1: 'var(--red)', 2: 'var(--cream)', 3: 'var(--muted)' };

let allSellers = [];
let allAccountsList = [];
let foundLives = [];    // { content_id, date, hour, order_count, gmv }
let fetchedOrders = []; // all orders for the selected period+account+lives
let dataMinTime = null; // menor horário (min do dia) — usado nos cards de referência
let dataMaxTime = null; // maior horário (min do dia)
let dataMinDT = null;   // menor data-hora do upload: "YYYY-MM-DDTHH:MM"
let dataMaxDT = null;   // maior data-hora do upload
let lastFechamento = null; // snapshot do último cálculo, para exportar em PDF
let savedTurnos = [];      // turnos salvos da conta selecionada

// minutos do dia (hora*60+min) -> "HH:MM"
function fmtMinToHHMM(tot) {
  if (tot == null || !isFinite(tot)) return '--:--';
  const h = Math.floor(tot / 60), m = tot % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
// "#E8551B" -> [232, 85, 27] (para o jsPDF)
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return isNaN(n) ? [232, 85, 27] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// branding do tenant atual (whitelabel) — cai pra SPACEHUB se não houver
function brandName() { return (window.AGENCY && window.AGENCY.name) || 'SPACEHUB'; }
function brandHex() { return window.BRAND_COLOR || '#E8551B'; }

// data-hora absoluta e comparável de um pedido: "YYYY-MM-DDTHH:MM"
// (formato ISO ordena lexicograficamente, então dá pra comparar como string)
function orderDT(o) {
  return `${o.order_date}T${String(o.hour).padStart(2, '0')}:${String(o.minute || 0).padStart(2, '0')}`;
}
// "YYYY-MM-DDTHH:MM" -> "DD/MM HH:MM" (exibição)
function fmtDT(s) {
  if (!s) return '--';
  const [date, time] = s.split('T');
  const [, m, d] = date.split('-');
  return `${d}/${m} ${time}`;
}
// período (só datas) a partir do intervalo do turno
function periodoDe(iniDT, fimDT) {
  const fmt = d => { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; };
  const d1 = (iniDT || '').split('T')[0], d2 = (fimDT || '').split('T')[0];
  return d1 === d2 ? fmt(d1) : `${fmt(d1)} a ${fmt(d2)}`;
}
// dois turnos conflitam se os intervalos [ini,fim) se sobrepõem
function turnosConflitam(a, b) {
  return a.start_dt < b.end_dt && b.start_dt < a.end_dt;
}

// ===== INIT =====

async function initFechamento() {
  let accQ = sb.from('accounts').select('id, name, email').order('name');
  if (agencyId()) accQ = accQ.eq('agency_id', agencyId());
  const { data: accounts } = await accQ;

  allAccountsList = accounts || [];

  // (compat) se ainda existir o select de conta de vendedor, popula
  const sellerAccSel = document.getElementById('sellerAccount');
  if (sellerAccSel) {
    const opts = allAccountsList.map(a =>
      `<option value="${escAttr(a.id)}">${esc(a.name)}${a.email ? ' (' + esc(a.email) + ')' : ''}</option>`
    ).join('');
    sellerAccSel.innerHTML = '<option value="">Selecione a conta</option>' + opts;
  }

  await loadSellers();
}

// ---- Combobox de busca do Creator Host ----
function comboFilter() {
  const q = (document.getElementById('fechAccountSearch').value || '').toLowerCase().trim();
  const listEl = document.getElementById('fechAccountList');
  if (!listEl) return;
  let items = allAccountsList;
  if (q) items = items.filter(a =>
    (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q));
  items = items.slice(0, 60);
  if (!items.length) { listEl.innerHTML = '<div class="combo-empty">Nenhum creator host encontrado.</div>'; listEl.style.display = ''; return; }
  listEl.innerHTML = items.map(a =>
    `<div class="combo-item" data-id="${escAttr(a.id)}" data-name="${escAttr(a.name)}" onmousedown="comboPick(this)">${esc(a.name)}${a.email ? ` <span style="color:var(--muted);">(${esc(a.email)})</span>` : ''}</div>`
  ).join('');
  listEl.style.display = '';
}
function comboPick(el) {
  document.getElementById('fechAccount').value = el.getAttribute('data-id');
  document.getElementById('fechAccountSearch').value = el.getAttribute('data-name');
  document.getElementById('fechAccountList').style.display = 'none';
}
document.addEventListener('click', (e) => {
  const listEl = document.getElementById('fechAccountList');
  if (listEl && e.target.id !== 'fechAccountSearch' && !e.target.closest('#fechAccountList')) listEl.style.display = 'none';
});

// Opções do seletor de conta do Fechamento (usado pela busca)
function fechAccountOptions(list) {
  return '<option value="">Selecione</option>' + list.map(a =>
    `<option value="${escAttr(a.id)}">${esc(a.name)}${a.email ? ' (' + esc(a.email) + ')' : ''}</option>`
  ).join('');
}

// Filtra o seletor de conta/creator conforme o texto digitado
function filterFechAccounts() {
  const q = (document.getElementById('fechAccountSearch').value || '').toLowerCase().trim();
  const list = q
    ? allAccountsList.filter(a =>
        (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q))
    : allAccountsList;
  const sel = document.getElementById('fechAccount');
  const cur = sel.value;
  sel.innerHTML = fechAccountOptions(list);
  // mantém a seleção se ainda estiver na lista filtrada
  if (cur && list.some(a => a.id === cur)) sel.value = cur;
}

// ===== SELLERS CRUD =====

async function loadSellers() {
  let selQ = sb.from('sellers').select('*, accounts(name)').order('created_at', { ascending: false });
  if (agencyId()) selQ = selQ.eq('agency_id', agencyId());
  const { data, error } = await selQ;

  allSellers = data || [];
  renderSellers();
}

function renderSellers() {
  const tb = document.getElementById('tSellers');
  if (!tb) return; // seção de vendedores não existe na jornada
  if (!allSellers.length) {
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhum vendedor cadastrado.</td></tr>';
    return;
  }

  tb.innerHTML = allSellers.map(s => {
    const date = new Date(s.created_at).toLocaleDateString('pt-BR');
    return `<tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td style="color:var(--orange);font-size:12px;">${esc(s.accounts?.name || '-')}</td>
      <td class="r">${s.commission_pct}%</td>
      <td>${date}</td>
      <td><button class="del" data-id="${escAttr(s.id)}" data-name="${escAttr(s.name)}">Remover</button></td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => removeSeller(btn.dataset.id, btn.dataset.name));
  });
}

async function addSeller() {
  const accountId = document.getElementById('sellerAccount').value;
  const name = document.getElementById('sellerName').value.trim();
  const pctRaw = document.getElementById('sellerPct').value.trim().replace(',', '.');
  const pct = parseFloat(pctRaw);
  const msg = document.getElementById('sellerMsg');

  if (!accountId) { msg.className = 'msg msg-err'; msg.textContent = 'Selecione uma conta.'; return; }
  if (!name) { msg.className = 'msg msg-err'; msg.textContent = 'Digite o nome do vendedor.'; return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { msg.className = 'msg msg-err'; msg.textContent = 'Comissão deve ser entre 0 e 100%.'; return; }

  // Optimistic: add to local list immediately
  const tempId = 'temp-' + Date.now();
  const account = allAccountsList.find(a => a.id === accountId);
  const optimistic = {
    id: tempId, account_id: accountId, name, commission_pct: pct,
    created_at: new Date().toISOString(),
    accounts: account ? { name: account.name } : null
  };
  allSellers.unshift(optimistic);
  renderSellers();
  msg.className = 'msg msg-ok';
  msg.textContent = `Vendedor "${name}" adicionado.`;
  document.getElementById('sellerName').value = '';
  document.getElementById('sellerPct').value = '';

  const { data, error } = await sb.from('sellers').insert({
    account_id: accountId, name, commission_pct: pct, agency_id: agencyId(), owner_id: await myUid()
  }).select('*, accounts(name)').single();

  if (error) {
    // Rollback
    allSellers = allSellers.filter(s => s.id !== tempId);
    renderSellers();
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro: ' + error.message;
  } else if (data) {
    // Replace temp with real record
    const idx = allSellers.findIndex(s => s.id === tempId);
    if (idx !== -1) allSellers[idx] = data;
  }
}

async function removeSeller(id, name) {
  if (!confirm(`Remover vendedor "${name}"?`)) return;

  // Optimistic
  const removed = allSellers.find(s => s.id === id);
  allSellers = allSellers.filter(s => s.id !== id);
  renderSellers();

  const { error } = await sb.from('sellers').delete().eq('id', id);
  if (error) {
    if (removed) allSellers.unshift(removed);
    renderSellers();
  }
}

function onSellerAccountChange() {
  // nothing extra needed for now
}

// ===== FECHAMENTO FLOW =====

function onFechAccountChange() {
  const accountId = document.getElementById('fechAccount').value;
  const sellerSel = document.getElementById('fechSeller');

  const sellers = allSellers.filter(s => s.account_id === accountId);
  sellerSel.innerHTML = '<option value="">Selecione</option>' +
    sellers.map(s => `<option value="${escAttr(s.id)}">${esc(s.name)} (${s.commission_pct}%)</option>`).join('');

  // Hide results when account changes
  document.getElementById('livesSection').style.display = 'none';
  document.getElementById('resultSection').style.display = 'none';

  // Carrega os turnos salvos dessa conta
  loadTurnos(accountId);
}

async function loadLives() {
  const accountId = document.getElementById('fechAccount').value;
  const sellerId = document.getElementById('fechSeller').value;
  const start = document.getElementById('fechStart').value;
  const end = document.getElementById('fechEnd').value;
  const msg = document.getElementById('fechMsg');

  if (!accountId) { msg.className = 'msg msg-err'; msg.textContent = 'Selecione uma conta.'; return; }
  if (!sellerId) { msg.className = 'msg msg-err'; msg.textContent = 'Selecione um vendedor.'; return; }
  if (!start || !end) { msg.className = 'msg msg-err'; msg.textContent = 'Selecione o período.'; return; }
  if (start > end) { msg.className = 'msg msg-err'; msg.textContent = 'Data inicial deve ser antes da final.'; return; }

  msg.className = 'msg'; msg.textContent = 'Buscando pedidos...';

  // Fetch only Live orders for the account in the date range
  let ordQ = sb
    .from('orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('content_type', 0)
    .gte('order_date', start)
    .lte('order_date', end)
    .order('order_date', { ascending: true });
  if (agencyId()) ordQ = ordQ.eq('agency_id', agencyId());
  const { data: orders, error } = await ordQ;

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro ao buscar: ' + error.message;
    return;
  }

  if (!orders?.length) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Nenhum pedido encontrado nesse período.';
    document.getElementById('livesSection').style.display = 'none';
    return;
  }

  fetchedOrders = orders;

  // Group by content_id to find unique lives/content
  const liveMap = {};
  orders.forEach(o => {
    const key = o.content_id;
    if (!liveMap[key]) {
      liveMap[key] = {
        content_id: key,
        content_type: o.content_type,
        dates: new Set(),
        minTime: Infinity,  // minuto do dia do 1o pedido (hora*60+min)
        maxTime: -Infinity, // minuto do dia do ultimo pedido
        stores: new Set(),
        order_count: 0,
        gmv: 0,
        liquidados: 0,
        devolucoes: 0,
        cancelamentos: 0
      };
    }
    liveMap[key].stores.add(o.store_name);
    liveMap[key].dates.add(o.order_date);
    const t = o.hour * 60 + (o.minute || 0);
    if (t < liveMap[key].minTime) liveMap[key].minTime = t;
    if (t > liveMap[key].maxTime) liveMap[key].maxTime = t;
    liveMap[key].order_count++;
    liveMap[key].gmv += parseFloat(o.gmv);
    if (o.settlement_status === 0) liveMap[key].liquidados++;
    if (o.settlement_status === 1 && o.items_refunded > 0) liveMap[key].devolucoes++;
    if (o.settlement_status === 1 && o.items_refunded === 0) liveMap[key].cancelamentos++;
  });

  foundLives = Object.values(liveMap).sort((a, b) => {
    const dateA = [...a.dates].sort()[0];
    const dateB = [...b.dates].sort()[0];
    return dateA.localeCompare(dateB);
  });

  // Range global de horário presente no upload (limita o seletor de turno)
  dataMinTime = Math.min(...foundLives.map(l => l.minTime));
  dataMaxTime = Math.max(...foundLives.map(l => l.maxTime));
  // Range de data-hora absoluta — para turnos que cruzam a meia-noite / vários dias
  dataMinDT = null; dataMaxDT = null;
  orders.forEach(o => {
    const dt = orderDT(o);
    if (dataMinDT === null || dt < dataMinDT) dataMinDT = dt;
    if (dataMaxDT === null || dt > dataMaxDT) dataMaxDT = dt;
  });

  msg.className = 'msg msg-ok';
  msg.textContent = `${orders.length} pedidos encontrados em ${foundLives.length} conteúdos.`;

  renderLives();
}

const CONTENT_LABELS = { 0: 'Live', 1: 'Vídeo', 2: 'Link', 3: 'Vitrine' };
const CONTENT_TAG_CLASS = { 0: 'tag-l', 1: 'tag-v', 2: 'tag-lk', 3: 'tag-vt' };

function renderLives() {
  const section = document.getElementById('livesSection');
  const list = document.getElementById('livesList');
  section.style.display = '';
  document.getElementById('resultSection').style.display = 'none';

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const subtleBg = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';

  // Configura o seletor de turno (data-hora), travado no range do upload.
  // Como é data-hora absoluta, funciona atravessando a meia-noite / vários dias.
  const turnoIni = document.getElementById('turnoIni');
  const turnoFim = document.getElementById('turnoFim');
  turnoIni.min = dataMinDT; turnoIni.max = dataMaxDT; turnoIni.value = dataMinDT;
  turnoFim.min = dataMinDT; turnoFim.max = dataMaxDT; turnoFim.value = dataMaxDT;
  document.getElementById('turnoRange').textContent =
    `disponível no upload: ${fmtDT(dataMinDT)} – ${fmtDT(dataMaxDT)}`;

  // Cards de referência (somente leitura) — mostram os horários disponíveis.
  list.innerHTML = foundLives.map((l) => {
    const dates = [...l.dates].sort();
    const dateStr = dates.map(d => {
      const [y, m, day] = d.split('-');
      return `${day}/${m}`;
    }).join(', ');
    const iniStr = fmtMinToHHMM(l.minTime);
    const fimStr = fmtMinToHHMM(l.maxTime);
    const fmtGMV = l.gmv.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const storeNames = [...l.stores].sort();
    const storesHtml = storeNames.map(s =>
      `<span style="color:var(--muted);font-size:11px;background:${subtleBg};padding:1px 6px;border-radius:3px;">${esc(s)}</span>`
    ).join(' ');

    return `<div class="live-item" style="padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="tag tag-l">Live</span>
        <strong style="color:var(--text);font-size:13px;">${esc(l.content_id)}</strong>
        <span style="display:flex;gap:4px;flex-wrap:wrap;">${storesHtml}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--muted);">${dateStr}</span>
        <span style="font-size:11px;color:var(--orange);background:${subtleBg};padding:2px 8px;border-radius:4px;font-weight:700;">${iniStr} – ${fimStr}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:11px;color:var(--green);background:rgba(46,204,113,0.1);padding:3px 8px;border-radius:4px;font-weight:600;">${l.liquidados} liquidados</span>
        <span style="font-size:11px;color:var(--red);background:rgba(231,76,60,0.1);padding:3px 8px;border-radius:4px;font-weight:600;">${l.devolucoes} devoluções</span>
        <span style="font-size:11px;color:#9B59B6;background:rgba(155,89,182,0.1);padding:3px 8px;border-radius:4px;font-weight:600;">${l.cancelamentos} cancelados</span>
        <span style="font-size:11px;color:var(--text);background:${subtleBg};padding:3px 8px;border-radius:4px;font-weight:700;">${l.order_count} pedidos</span>
        <span style="font-size:11px;color:var(--orange);font-weight:700;">${fmtGMV}</span>
      </div>
    </div>`;
  }).join('');
}

// ===== CALCULATE =====

// Status granular (5 níveis da API + fallback pro int do upload manual).
// Retorna: liquidado | pendente | naopago | cancelado | devolucao | analise | aguardando
function granularStatus(o) {
  const raw = String(o.settle_status_raw || '').toUpperCase();
  if (raw) {
    if (raw.includes('SETTLED')) return 'liquidado';
    if (raw.includes('INELIGIBLE')) return o.items_refunded > 0 ? 'devolucao' : 'cancelado';
    if (raw.includes('UNPAID')) return 'naopago';
    if (raw.includes('FROZEN')) return 'analise';
    if (raw.includes('PENDING')) return 'pendente';
  }
  // fallback pelo settlement_status int (dados do upload manual)
  const s = o.settlement_status;
  if (s === 0) return 'liquidado';
  if (s === 1) return o.items_refunded > 0 ? 'devolucao' : 'cancelado';
  if (s === 3) return 'aguardando';
  return 'pendente';
}

const GRAN_CARDS = [
  ['liquidado', 'Liquidados', 'var(--green)'],
  ['pendente', 'Pendentes', 'var(--cream)'],
  ['naopago', 'Não pago p/ cliente', 'var(--orange)'],
  ['cancelado', 'Cancelados', '#9B59B6'],
  ['devolucao', 'Devoluções', 'var(--red)'],
  ['analise', 'Em análise (fraude)', 'var(--muted)'],
  ['aguardando', 'Aguardando pgto.', 'var(--muted)']
];
const GRAN_LABEL = {
  liquidado: 'Liquidado', pendente: 'Pendente', naopago: 'Não pago',
  cancelado: 'Cancelado', devolucao: 'Devolução', analise: 'Em análise', aguardando: 'Aguardando'
};

// Lista de pedidos do turno atual (pra tabela de detalhes + busca + ordenação)
let lastTurnoOrders = [];
let ordDetailSort = { key: 'dt', dir: 'asc' };

// ordem lógica dos status (pra ordenar por status de forma útil)
const STATUS_ORDER = { liquidado: 0, pendente: 1, aguardando: 2, naopago: 3, cancelado: 4, devolucao: 5, analise: 6 };
const ORD_DETAIL_VAL = {
  dt: o => orderDT(o),
  product: o => (o.product_name || '').toLowerCase(),
  store: o => (o.store_name || '').toLowerCase(),
  status: o => STATUS_ORDER[granularStatus(o)] ?? 9,
  est: o => Number(o.estimated_commission) || 0,
  receb: o => Number(o.received_commission) || 0,
  gmv: o => Number(o.gmv) || 0
};

function sortOrdersDetail(key) {
  if (ordDetailSort.key === key) ordDetailSort.dir = ordDetailSort.dir === 'asc' ? 'desc' : 'asc';
  else ordDetailSort = { key, dir: 'asc' };
  renderOrdersDetail();
}

function renderOrdersDetail() {
  const el = document.getElementById('ordersDetail');
  if (!el) return;
  const q = (document.getElementById('ordersDetailSearch')?.value || '').toLowerCase().trim();
  let list = lastTurnoOrders;
  if (q) list = list.filter(o =>
    (o.product_name || '').toLowerCase().includes(q) || (o.store_name || '').toLowerCase().includes(q));
  // ordenação
  const dir = ordDetailSort.dir === 'asc' ? 1 : -1;
  const val = ORD_DETAIL_VAL[ordDetailSort.key] || ORD_DETAIL_VAL.dt;
  list = list.slice().sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : 0; });

  const fmtBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const body = list.map(o => {
    const k = granularStatus(o);
    return `<tr style="border-bottom:1px solid var(--border);">
      <td style="white-space:nowrap;padding:4px 8px;">${fmtDT(orderDT(o))}</td>
      <td style="padding:4px 8px;">${esc((o.product_name || '').slice(0, 42))}</td>
      <td style="padding:4px 8px;color:var(--muted);">${esc(o.store_name || '')}</td>
      <td style="padding:4px 8px;">${GRAN_LABEL[k] || k}</td>
      <td class="r" style="padding:4px 8px;">${fmtBRL(o.estimated_commission)}</td>
      <td class="r" style="padding:4px 8px;color:var(--green);">${fmtBRL(o.received_commission)}</td>
      <td class="r" style="padding:4px 8px;">${fmtBRL(o.gmv)}</td>
    </tr>`;
  }).join('');

  const arrow = k => ordDetailSort.key === k ? (ordDetailSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  const th = (k, label, cls) =>
    `<th class="${cls || ''}" onclick="sortOrdersDetail('${k}')" style="padding:4px 8px;cursor:pointer;user-select:none;white-space:nowrap;">${label}${arrow(k)}</th>`;
  el.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="text-align:left;color:var(--muted);border-bottom:1px solid var(--border);">
      ${th('dt', 'Data/Hora')}${th('product', 'Produto')}${th('store', 'Loja')}${th('status', 'Status')}
      ${th('est', 'Estimada', 'r')}${th('receb', 'Recebida', 'r')}${th('gmv', 'GMV', 'r')}
    </tr></thead>
    <tbody>${body || '<tr><td colspan="7" style="color:var(--muted);padding:10px;text-align:center;">Nenhum pedido.</td></tr>'}</tbody>
  </table>
  <div style="font-size:11px;color:var(--muted);margin-top:8px;">${list.length} pedido(s)</div>`;
}

function calcularFechamento() {
  const sellerId = document.getElementById('fechSeller').value;
  const seller = allSellers.find(s => s.id === sellerId);
  if (!seller) return;

  const msg = document.getElementById('fechMsg');

  // Turno do creator: uma faixa de DATA-HORA única, aplicada a TODAS as lives.
  // O horário é o primário; a live (content_id) é só pano de fundo.
  // Data-hora absoluta => funciona quando o turno cruza a meia-noite.
  const tIni = document.getElementById('turnoIni').value; // "YYYY-MM-DDTHH:MM"
  const tFim = document.getElementById('turnoFim').value;

  if (!tIni || !tFim) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Defina o início e o fim do turno (data e hora).';
    return;
  }
  if (tIni >= tFim) {
    msg.className = 'msg msg-err';
    msg.textContent = 'O início do turno deve ser antes do fim.';
    return;
  }

  // Filtra todos os pedidos do turno, independente de qual live.
  // Precisão de minuto: o pedido é um instante (data + hora + minuto).
  // Como a conta nunca transmite duas lives ao mesmo tempo, quem estava
  // no ar no minuto do pedido é a dona dele. Fronteira da Opção 1:
  // início INCLUSIVO, fim EXCLUSIVO — o pedido da virada (ex. 15:30)
  // cai só na creator que ASSUMIU, nunca é contado para as duas.
  const orders = fetchedOrders.filter(o => {
    const dt = orderDT(o);
    return dt >= tIni && dt < tFim;
  });

  if (!orders.length) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Nenhum pedido nesse turno. Ajuste o horário.';
    return;
  }
  msg.className = 'msg';
  msg.textContent = '';

  // Group by settlement_status
  const byStatus = { 0: [], 1: [], 2: [], 3: [] };
  orders.forEach(o => {
    const s = o.settlement_status;
    if (byStatus[s]) byStatus[s].push(o);
    else byStatus[s] = [o]; // fallback
  });

  const liquidados = byStatus[0];
  const inelegiveis = byStatus[1];
  const pendentes = byStatus[2];
  const aguardando = byStatus[3];

  // Split inelegíveis: devoluções (items_refunded > 0) vs cancelamentos (items_refunded = 0)
  const devolucoes = inelegiveis.filter(o => o.items_refunded > 0);
  const cancelamentos = inelegiveis.filter(o => o.items_refunded === 0);

  // Calculate totals
  const gmvTotal = orders.reduce((s, o) => s + parseFloat(o.gmv), 0);
  const gmvLiq = liquidados.reduce((s, o) => s + parseFloat(o.gmv), 0);
  const gmvDevol = devolucoes.reduce((s, o) => s + parseFloat(o.gmv), 0);
  const gmvCancel = cancelamentos.reduce((s, o) => s + parseFloat(o.gmv), 0);
  const gmvPend = pendentes.reduce((s, o) => s + parseFloat(o.gmv), 0);
  const gmvAguard = aguardando.reduce((s, o) => s + parseFloat(o.gmv), 0);

  const comissaoRecebida = liquidados.reduce((s, o) => s + parseFloat(o.received_commission), 0);
  const comissaoPendente = [...pendentes, ...aguardando].reduce((s, o) => s + parseFloat(o.estimated_commission), 0);

  const itensVendidos = orders.reduce((s, o) => s + o.items_sold, 0);
  const itensDevolvidos = orders.reduce((s, o) => s + o.items_refunded, 0);

  // Seller commission = commission_pct% of received_commission (liquidated)
  const comissaoVendedor = comissaoRecebida * (seller.commission_pct / 100);
  // Show results
  const resultSection = document.getElementById('resultSection');
  resultSection.style.display = '';

  // Summary
  const start = document.getElementById('fechStart').value;
  const end = document.getElementById('fechEnd').value;
  const fmtDate = d => { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; };
  const fmtBRL = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const totalPeriodo = fetchedOrders.length;
  const turnoStr = `${fmtDT(tIni)} → ${fmtDT(tFim)}`;

  // Guarda o snapshot pro export em PDF/imagem e pro salvar turno.
  lastFechamento = {
    accountId: document.getElementById('fechAccount').value,
    sellerId,
    creatorDefault: seller.name,
    tIni, tFim,
    periodo: periodoDe(tIni, tFim),
    turnoStr,
    comissao: comissaoVendedor,   // valor a pagar (sem exibir a %)
    liquidados: liquidados.length,
    inelegiveis: inelegiveis.length
  };

  // Contagem por status granular (mostra só os que têm pedido + Liquidados sempre)
  const gran = { liquidado: 0, pendente: 0, naopago: 0, cancelado: 0, devolucao: 0, analise: 0, aguardando: 0 };
  orders.forEach(o => { gran[granularStatus(o)]++; });
  const granHtml = GRAN_CARDS
    .filter(([k]) => gran[k] > 0 || k === 'liquidado')
    .map(([k, label, color]) =>
      `<div class="kpi"><div class="kpi-v" style="color:${color};">${gran[k]}</div><div class="kpi-l">${label}</div></div>`
    ).join('') +
    `<div class="kpi"><div class="kpi-v" style="color:var(--cream);">${itensDevolvidos}</div><div class="kpi-l">Itens Reembolsados</div></div>`;

  document.getElementById('resultSummary').innerHTML = `
    <div class="callout">
      <strong>${esc(seller.name)}</strong> &mdash;
      ${fmtDate(start)} a ${fmtDate(end)} &mdash;
      turno <strong>${turnoStr}</strong> &mdash;
      <strong>${orders.length}</strong> de ${totalPeriodo} pedidos do período
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:12px;">
      ${granHtml}
    </div>
  `;

  // Commission card
  document.getElementById('comissaoResult').innerHTML = `
    <div style="text-align:center;padding:16px 0;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Comissão Recebida (TikTok)</div>
      <div style="font-size:24px;font-weight:800;color:var(--green);margin:6px 0;">${fmtBRL(comissaoRecebida)}</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:16px;">sobre GMV liquidado de ${fmtBRL(gmvLiq)}</div>

      <div style="border-top:1px solid var(--border);padding-top:16px;">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">
          Pagar ao Vendedor (${seller.commission_pct}%)
        </div>
        <div style="font-size:32px;font-weight:800;color:var(--orange);margin:6px 0;">${fmtBRL(comissaoVendedor)}</div>
        <div style="font-size:11px;color:var(--muted);">${seller.commission_pct}% de ${fmtBRL(comissaoRecebida)}</div>
      </div>

      ${comissaoPendente > 0 ? `
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px;">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Comissão estimada pendente</div>
        <div style="display:flex;justify-content:center;gap:24px;flex-wrap:wrap;">
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--cream);">${fmtBRL(comissaoPendente)}</div>
            <div style="font-size:10px;color:var(--muted);">bruto (você recebe)</div>
          </div>
          <div>
            <div style="font-size:16px;font-weight:800;color:var(--cream);">${fmtBRL(comissaoPendente * (seller.commission_pct / 100))}</div>
            <div style="font-size:10px;color:var(--muted);">ajustado ${seller.commission_pct}% (vendedor)</div>
          </div>
        </div>
      </div>` : ''}
    </div>
  `;

  // Charts
  const chartColors = {
    liq: '#3CB371',
    devol: '#D9534F',
    cancel: '#9B59B6',
    pend: '#D4A76A',
    aguard: '#777'
  };

  // Destroy old charts
  ['chartLiquidados', 'chartNaoPagou', 'chartCancelou'].forEach(id => {
    const existing = Chart.getChart(id);
    if (existing) existing.destroy();
  });

  // Group by store for each category
  function groupByStore(arr) {
    const map = {};
    arr.forEach(o => {
      const s = o.store_name;
      if (!map[s]) map[s] = { gmv: 0, count: 0 };
      map[s].gmv += parseFloat(o.gmv);
      map[s].count++;
    });
    return Object.entries(map).sort((a, b) => b[1].gmv - a[1].gmv);
  }

  const liqStores = groupByStore(liquidados);
  const naoPagouStores = groupByStore(cancelamentos);   // items_refunded = 0 → não pagou
  const cancelouStores = groupByStore(devolucoes);       // items_refunded > 0 → cancelou/devolveu

  const pieColors = [window.BRAND_COLOR || '#E8551B', '#3CB371', '#4EC9B0', '#D4A76A', '#9B59B6', '#3498DB', '#E67E22', '#1ABC9C', '#E74C3C', '#95A5A6'];

  const pieOpts = (tooltipFn) => ({
    responsive: true,
    cutout: '50%',
    plugins: {
      legend: { position: 'bottom', labels: { color: document.documentElement.getAttribute('data-theme') === 'light' ? '#333' : '#ddd', font: { size: 11 }, padding: 12 } },
      tooltip: { callbacks: { label: tooltipFn } }
    }
  });

  // Chart: Liquidados
  new Chart(document.getElementById('chartLiquidados'), {
    type: 'doughnut',
    data: {
      labels: liqStores.length ? liqStores.map(([s]) => s) : ['Nenhum'],
      datasets: [{
        data: liqStores.length ? liqStores.map(([, v]) => v.gmv) : [0],
        backgroundColor: pieColors.slice(0, liqStores.length || 1),
        borderWidth: 0
      }]
    },
    options: pieOpts(ctx => ` ${ctx.label}: ${fmtBRL(ctx.raw)} (${liqStores[ctx.dataIndex]?.[1]?.count || 0} ped.)`)
  });

  // Chart: Não Pagou
  new Chart(document.getElementById('chartNaoPagou'), {
    type: 'doughnut',
    data: {
      labels: naoPagouStores.length ? naoPagouStores.map(([s]) => s) : ['Nenhum'],
      datasets: [{
        data: naoPagouStores.length ? naoPagouStores.map(([, v]) => v.gmv) : [0],
        backgroundColor: pieColors.slice(0, naoPagouStores.length || 1),
        borderWidth: 0
      }]
    },
    options: pieOpts(ctx => ` ${ctx.label}: ${fmtBRL(ctx.raw)} (${naoPagouStores[ctx.dataIndex]?.[1]?.count || 0} ped.)`)
  });

  // Chart: Cancelou / Devolveu
  new Chart(document.getElementById('chartCancelou'), {
    type: 'doughnut',
    data: {
      labels: cancelouStores.length ? cancelouStores.map(([s]) => s) : ['Nenhum'],
      datasets: [{
        data: cancelouStores.length ? cancelouStores.map(([, v]) => v.gmv) : [0],
        backgroundColor: pieColors.slice(0, cancelouStores.length || 1),
        borderWidth: 0
      }]
    },
    options: pieOpts(ctx => ` ${ctx.label}: ${fmtBRL(ctx.raw)} (${cancelouStores[ctx.dataIndex]?.[1]?.count || 0} ped.)`)
  });

  // Detalhes dos pedidos do turno (com busca)
  lastTurnoOrders = orders.slice().sort((a, b) => orderDT(a).localeCompare(orderDT(b)));
  const ds = document.getElementById('ordersDetailSearch');
  if (ds) ds.value = '';
  renderOrdersDetail();

  // Scroll to result
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== RELATÓRIO (PDF / imagem) — Variação 1 com logo do tenant =====
// d = { creator, periodo, turnoStr, comissao, liquidados, inelegiveis, qty }
// qty = nº de creators; se > 1 divide a comissão e mostra total + p/ creator.

function tenantLogo() { return (window.AGENCY && window.AGENCY.logo_url) || null; }

// nome do arquivo com creator + data (período) pra localizar fácil
function nomeArquivo(d, ext) {
  const slug = s => String(s || '').trim().replace(/[^\p{L}\p{N}-]+/gu, '_').replace(/^_+|_+$/g, '');
  const creator = slug(d.creator) || 'creator';
  const data = slug((d.periodo || '').replace(/\//g, '-'));
  return `fechamento_${creator}${data ? '_' + data : ''}.${ext}`;
}

function baixarPdf(d) {
  const creator = d.creator || '—';
  const qty = (d.qty && d.qty > 1) ? d.qty : 1;
  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const orange = hexToRgb(brandHex());
  const logoUrl = tenantLogo();

  const render = (img) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    if (img) {
      const h = 12, w = img.width * (h / img.height);
      doc.addImage(logoUrl, 'PNG', 20, 16, w, h);
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...orange);
      doc.text(brandName(), 20, 25);
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120);
    doc.text('Fechamento de Comissão', 20, 37);
    doc.setDrawColor(220); doc.line(20, 43, 190, 43);

    let y = 55;
    const linha = (label, val) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(90);
      doc.text(label, 20, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30);
      doc.text(String(val), 190, y, { align: 'right' });
      y += 9;
    };
    linha('Creator', creator);
    linha('Período', d.periodo);
    linha('Turno', d.turnoStr);

    y += 6; doc.setDrawColor(220); doc.line(20, y, 190, y); y += 12;
    if (qty > 1) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120);
      doc.text('COMISSÃO TOTAL', 20, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(60);
      doc.text(fmtBRL(d.comissao), 20, y + 10); y += 21;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120);
      doc.text('P/ CREATOR', 20, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(...orange);
      doc.text(fmtBRL(d.comissao / qty), 20, y + 14); y += 26;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120);
      doc.text('COMISSÃO', 20, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(...orange);
      doc.text(fmtBRL(d.comissao), 20, y + 14); y += 28;
    }

    doc.setDrawColor(220); doc.line(20, y, 190, y); y += 12;
    linha('Pedidos pagos', d.liquidados);
    linha('Pedidos inelegíveis', d.inelegiveis);

    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 20, 285);

    doc.save(nomeArquivo(d, 'pdf'));
  };

  if (logoUrl) {
    const img = new Image();
    img.onload = () => render(img);
    img.onerror = () => render(null);
    img.src = logoUrl;
  } else render(null);
}

function baixarImagem(d) {
  const creator = d.creator || '—';
  const qty = (d.qty && d.qty > 1) ? d.qty : 1;
  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const orange = brandHex();
  const W = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = 1500;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f0f10'; ctx.fillRect(0, 0, W, 1500);
  ctx.fillStyle = orange; ctx.fillRect(0, 0, W, 14);

  const divider = yy => {
    ctx.strokeStyle = '#26262a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(80, yy); ctx.lineTo(W - 80, yy); ctx.stroke();
  };
  const rowLR = (yy, label, val) => {
    ctx.textAlign = 'left'; ctx.fillStyle = '#8a8a92'; ctx.font = '600 32px system-ui, sans-serif';
    ctx.fillText(label, 80, yy);
    ctx.textAlign = 'right'; ctx.fillStyle = '#f2f2f4'; ctx.font = '500 32px system-ui, sans-serif';
    ctx.fillText(val, W - 80, yy);
    ctx.textAlign = 'left';
  };

  // Subtítulo (a logo é desenhada depois, no onload)
  let y = 214;
  ctx.textAlign = 'left'; ctx.fillStyle = '#8a8a92'; ctx.font = '400 34px system-ui, sans-serif';
  ctx.fillText('Fechamento de Comissão', 80, y);
  y += 44; divider(y);

  y += 66; rowLR(y, 'Creator', creator);
  y += 66; rowLR(y, 'Período', d.periodo);
  y += 66; rowLR(y, 'Turno', d.turnoStr);
  y += 40; divider(y);

  y += 66;
  if (qty > 1) {
    ctx.fillStyle = '#8a8a92'; ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText('COMISSÃO TOTAL', 80, y);
    y += 68;
    ctx.fillStyle = '#f2f2f4'; ctx.font = '800 68px system-ui, sans-serif';
    ctx.fillText(fmtBRL(d.comissao), 80, y);
    y += 58;
    ctx.fillStyle = '#8a8a92'; ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText('P/ CREATOR', 80, y);
    y += 92;
    ctx.fillStyle = orange; ctx.font = '800 96px system-ui, sans-serif';
    ctx.fillText(fmtBRL(d.comissao / qty), 80, y);
  } else {
    ctx.fillStyle = '#8a8a92'; ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText('COMISSÃO', 80, y);
    y += 96;
    ctx.fillStyle = orange; ctx.font = '800 96px system-ui, sans-serif';
    ctx.fillText(fmtBRL(d.comissao), 80, y);
  }
  y += 44; divider(y);

  y += 62; rowLR(y, 'Pedidos pagos', String(d.liquidados));
  y += 66; rowLR(y, 'Pedidos inelegíveis', String(d.inelegiveis));
  y += 58;
  ctx.textAlign = 'left'; ctx.fillStyle = '#55555c'; ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 80, y);

  const finalH = y + 44;
  const exportar = () => {
    const out = document.createElement('canvas');
    out.width = W; out.height = finalH;
    out.getContext('2d').drawImage(canvas, 0, 0);
    out.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nomeArquivo(d, 'png');
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const logoUrl = tenantLogo();
  if (logoUrl) {
    const img = new Image();
    img.onload = () => {
      const h = 60, w = img.width * (h / img.height);
      ctx.drawImage(img, 80, 84, w, h);
      exportar();
    };
    img.onerror = () => {
      ctx.textAlign = 'left'; ctx.fillStyle = orange; ctx.font = '900 76px system-ui, sans-serif';
      ctx.fillText(brandName(), 80, 150);
      exportar();
    };
    img.src = logoUrl;
  } else {
    ctx.textAlign = 'left'; ctx.fillStyle = orange; ctx.font = '900 76px system-ui, sans-serif';
    ctx.fillText(brandName(), 80, 150);
    exportar();
  }
}

// ===== POPUP DE EXPORT (nome + quantidade de creators) =====

let _exportKind = null;

function exportarImagem() { abrirExportModal('img'); }
function exportarPDF() { abrirExportModal('pdf'); }

function abrirExportModal(kind) {
  const msg = document.getElementById('fechMsg');
  if (!lastFechamento) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Calcule o fechamento antes de exportar.';
    return;
  }
  _exportKind = kind;
  document.getElementById('expNome').value = lastFechamento.creatorDefault || '';
  document.getElementById('expQtd').value = 1;
  document.getElementById('exportModal').style.display = 'flex';
  setTimeout(() => document.getElementById('expNome').focus(), 30);
}

function fecharExportModal() {
  document.getElementById('exportModal').style.display = 'none';
}

function confirmarExportModal() {
  if (!lastFechamento) return;
  const creator = (document.getElementById('expNome').value || '').trim() || '—';
  let qty = parseInt(document.getElementById('expQtd').value, 10);
  if (!qty || qty < 1) qty = 1;
  fecharExportModal();
  const f = lastFechamento;
  const d = {
    creator, qty,
    periodo: f.periodo, turnoStr: f.turnoStr,
    comissao: f.comissao, liquidados: f.liquidados, inelegiveis: f.inelegiveis
  };
  if (_exportKind === 'pdf') baixarPdf(d); else baixarImagem(d);
}

// ===== TURNOS SALVOS =====

function turnoReportData(t) {
  return {
    creator: t.creator_name,
    periodo: periodoDe(t.start_dt, t.end_dt),
    turnoStr: `${fmtDT(t.start_dt)} → ${fmtDT(t.end_dt)}`,
    comissao: Number(t.comissao),
    liquidados: t.liquidados,
    inelegiveis: t.inelegiveis,
    qty: t.qty || 1
  };
}

async function salvarTurno() {
  const msg = document.getElementById('fechMsg');
  if (!lastFechamento) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Calcule o fechamento antes de salvar o turno.';
    return;
  }
  const nomeInput = document.getElementById('turnoNome');
  const creator = (nomeInput.value || '').trim() || lastFechamento.creatorDefault || '';
  if (!creator) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Digite o nome do creator para salvar o turno.';
    return;
  }
  let qty = parseInt(document.getElementById('turnoQtd').value, 10);
  if (!qty || qty < 1) qty = 1;
  const f = lastFechamento;
  const { data, error } = await sb.from('turnos').insert({
    agency_id: agencyId(),
    owner_id: await myUid(),
    account_id: f.accountId,
    seller_id: f.sellerId || null,
    creator_name: creator,
    start_dt: f.tIni,
    end_dt: f.tFim,
    comissao: f.comissao,
    liquidados: f.liquidados,
    inelegiveis: f.inelegiveis,
    qty
  }).select().single();

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro ao salvar turno: ' + error.message;
    return;
  }
  nomeInput.value = '';
  document.getElementById('turnoQtd').value = 1;
  msg.className = 'msg msg-ok';
  msg.textContent = `Turno de "${creator}" salvo.`;
  savedTurnos.push(data);
  savedTurnos.sort((a, b) => a.start_dt.localeCompare(b.start_dt));
  renderTurnos();
}

async function loadTurnos(accountId) {
  savedTurnos = [];
  if (accountId) {
    let q = sb.from('turnos').select('*').eq('account_id', accountId).order('start_dt');
    if (agencyId()) q = q.eq('agency_id', agencyId());
    const { data } = await q;
    savedTurnos = data || [];
  }
  renderTurnos();
}

function renderTurnos() {
  const section = document.getElementById('turnosSection');
  const list = document.getElementById('turnosList');
  const warn = document.getElementById('turnosConflito');
  if (!savedTurnos.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  // Detecta sobreposição de horário (mesmos pedidos em dois creators).
  const conflictIds = new Set();
  for (let i = 0; i < savedTurnos.length; i++) {
    for (let j = i + 1; j < savedTurnos.length; j++) {
      if (turnosConflitam(savedTurnos[i], savedTurnos[j])) {
        conflictIds.add(savedTurnos[i].id);
        conflictIds.add(savedTurnos[j].id);
      }
    }
  }
  warn.innerHTML = conflictIds.size
    ? `<div class="msg msg-err" style="margin-bottom:12px;">⚠ ${conflictIds.size} turno(s) com horário sobreposto — os mesmos pedidos podem estar sendo contados para mais de um creator. Ajuste os horários.</div>`
    : '';

  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  list.innerHTML = savedTurnos.map(t => {
    const conflita = conflictIds.has(t.id);
    const border = conflita ? 'var(--red)' : 'var(--border)';
    const qty = t.qty || 1;
    const commHtml = qty > 1
      ? `${fmtBRL(t.comissao)} <span style="color:var(--muted);font-weight:500;">÷${qty} = <strong style="color:var(--orange);">${fmtBRL(t.comissao / qty)}</strong></span>`
      : fmtBRL(t.comissao);
    return `<div style="padding:12px 16px;background:var(--card);border:1px solid ${border};border-radius:10px;margin-bottom:8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <strong style="color:var(--text);font-size:14px;">${esc(t.creator_name)}</strong>
      ${conflita ? '<span style="font-size:11px;color:var(--red);font-weight:700;">⚠ conflito</span>' : ''}
      <span style="font-size:12px;color:var(--muted);">${fmtDT(t.start_dt)} → ${fmtDT(t.end_dt)}</span>
      <span style="font-size:13px;color:var(--orange);font-weight:700;">${commHtml}</span>
      <span style="font-size:11px;color:var(--muted);">${t.liquidados} pagos · ${t.inelegiveis} inelegíveis</span>
      <span style="margin-left:auto;display:flex;gap:6px;">
        <button class="btn-sm t-img" data-id="${escAttr(t.id)}">Imagem</button>
        <button class="btn-sm t-pdf" data-id="${escAttr(t.id)}">PDF</button>
        <button class="del t-del" data-id="${escAttr(t.id)}" data-name="${escAttr(t.creator_name)}">Remover</button>
      </span>
    </div>`;
  }).join('');

  list.querySelectorAll('.t-img').forEach(b =>
    b.addEventListener('click', () => baixarTurnoImagem(b.dataset.id)));
  list.querySelectorAll('.t-pdf').forEach(b =>
    b.addEventListener('click', () => baixarTurnoPdf(b.dataset.id)));
  list.querySelectorAll('.t-del').forEach(b =>
    b.addEventListener('click', () => removerTurno(b.dataset.id, b.dataset.name)));
}

function baixarTurnoImagem(id) {
  const t = savedTurnos.find(x => x.id === id);
  if (t) baixarImagem(turnoReportData(t));
}
function baixarTurnoPdf(id) {
  const t = savedTurnos.find(x => x.id === id);
  if (t) baixarPdf(turnoReportData(t));
}

async function removerTurno(id, name) {
  if (!confirm(`Remover turno${name ? ' de "' + name + '"' : ''}?`)) return;
  const prev = savedTurnos;
  savedTurnos = savedTurnos.filter(t => t.id !== id);
  renderTurnos();
  const { error } = await sb.from('turnos').delete().eq('id', id);
  if (error) { savedTurnos = prev; renderTurnos(); }
}

// ================================================
// JORNADA DO FECHAMENTO (wizard) — Dados → Escala → Relatórios
// ================================================

let escalaState = { orders: [], results: [], pct: 100 };

function setEscalaMsg(cls, txt) {
  const m = document.getElementById('escalaMsg');
  if (m) { m.className = 'msg' + (cls ? ' msg-' + cls : ''); m.textContent = txt; }
}

function wizardGo(n) {
  for (let i = 1; i <= 2; i++) {
    const p = document.getElementById('wpanel' + i);
    if (p) p.style.display = i === n ? '' : 'none';
    const ws = document.getElementById('ws' + i);
    if (ws) { ws.classList.toggle('active', i === n); ws.classList.toggle('done', i < n); }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function initFechamentoJornada() {
  wizardGo(1);
}

// ---- Passo 1: frescor dos dias ----
async function loadFreshness() {
  const from = document.getElementById('freshFrom').value;
  const to = document.getElementById('freshTo').value;
  const el = document.getElementById('freshList');
  if (!from || !to) { el.innerHTML = '<div class="msg msg-err">Selecione De e Até.</div>'; return; }
  el.innerHTML = '<div class="msg">Carregando...</div>';
  const { data, error } = await sb.rpc('fech_days', { p_from: from, p_to: to });
  if (error) { el.innerHTML = `<div class="msg msg-err">Erro: ${error.message} (rodou a migration fech-days-summary.sql?)</div>`; return; }
  if (!data || !data.length) { el.innerHTML = '<div class="msg">Nenhum pedido nesse período. Importe abaixo.</div>'; return; }
  const fmtDay = d => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
  el.innerHTML = `<table class="freshness"><thead><tr><th>Dia</th><th class="r">Pedidos</th><th>Status</th></tr></thead><tbody>` +
    data.map(r => {
      const pend = Number(r.pendentes);
      const badge = pend > 0
        ? `<span class="badge badge-pend">⟳ ${pend.toLocaleString('pt-BR')} pendentes — vale atualizar</span>`
        : `<span class="badge badge-final">✓ Final</span>`;
      return `<tr><td>${fmtDay(r.order_date)}</td><td class="r">${Number(r.total).toLocaleString('pt-BR')}</td><td>${badge}</td></tr>`;
    }).join('') + `</tbody></table>`;
}

// ---- Passo 1: importar/atualizar da TikTok (matriz), em lotes ----
async function importDays() {
  const msg = document.getElementById('impMsg');
  const btn = document.getElementById('impBtn');
  const from = document.getElementById('impFrom').value;
  const to = document.getElementById('impTo').value;
  const uid = await myUid();
  if (!uid) return;
  let ge, lt;
  if (from) {
    ge = Math.floor(new Date(from + 'T00:00:00-03:00').getTime() / 1000);
    const ed = to || from;
    lt = Math.floor(new Date(ed + 'T00:00:00-03:00').getTime() / 1000) + 86400;
  } else {
    const now = Math.floor(Date.now() / 1000); ge = now - 86400; lt = now;
  }
  const base = `owner=${encodeURIComponent(uid)}&ge=${ge}&lt=${lt}&max_pages=20`;
  if (btn) btn.disabled = true;
  const set = (c, t) => { if (msg) { msg.className = 'msg ' + c; msg.textContent = t; } };
  set('', 'Importando...');
  let pt = null, ci = null, ep = null, grand = 0, b = 0, td = null;
  try {
    while (b < 1000) {
      let url = `/api/tiktok/partner-sync?${base}`;
      if (pt) url += `&page_token=${encodeURIComponent(pt)}&cipher=${encodeURIComponent(ci)}&endpoint=${encodeURIComponent(ep)}`;
      const j = await (await fetch(url)).json();
      if (!j.ok) { set('msg-err', 'Erro: ' + (j.message || j.error || '') + (j.code ? ` [${j.code}]` : '')); return; }
      grand += j.imported || 0; ci = j.cipher || ci; ep = j.endpoint || ep;
      if (j.total_disponivel != null) td = j.total_disponivel; b++;
      set('', `Importando... ${grand.toLocaleString('pt-BR')}${td ? ' de ~' + td.toLocaleString('pt-BR') : ''} (lote ${b})`);
      if (j.done || !j.next_page_token) break;
      pt = j.next_page_token;
    }
    set('msg-ok', `Pronto! ${grand.toLocaleString('pt-BR')} pedidos. Clique em "Ver dias" pra conferir.`);
    loadFreshness();
  } catch (e) { set('msg-err', `Parou após ${grand.toLocaleString('pt-BR')} pedidos. Clique de novo pra continuar.`); }
  finally { if (btn) btn.disabled = false; }
}

// ---- Passo 2: carrega os pedidos (Live) do período ----
async function escalaCarregarPeriodo() {
  const accId = document.getElementById('fechAccount').value;
  const from = document.getElementById('escalaFrom').value;
  const to = document.getElementById('escalaTo').value;
  if (!accId) return setEscalaMsg('err', 'Selecione o creator.');
  if (!from || !to) return setEscalaMsg('err', 'Selecione De e Até.');
  if (from > to) return setEscalaMsg('err', 'De deve ser antes de Até.');
  setEscalaMsg('', 'Carregando pedidos...');
  let q = sb.from('orders').select('*').eq('account_id', accId).eq('content_type', 0)
    .gte('order_date', from).lte('order_date', to).order('order_date');
  if (agencyId()) q = q.eq('agency_id', agencyId());
  const { data, error } = await q;
  if (error) return setEscalaMsg('err', 'Erro: ' + error.message);
  escalaState = { accountId: accId, from, to, orders: data || [], results: [], pct: 100 };
  const box = document.getElementById('escalaBox');
  if (!escalaState.orders.length) {
    if (box) box.style.display = 'none';
    setEscalaMsg('err', 'Ainda não há pedidos desse período no sistema.');
    if (confirm('Ainda não há dados desse período no sistema.\n\nIr para a Sincronização para importar da TikTok?')) {
      window.location.href = 'sincronizar.html';
    }
    return;
  }
  let mn = null, mx = null;
  escalaState.orders.forEach(o => { const dt = orderDT(o); if (mn === null || dt < mn) mn = dt; if (mx === null || dt > mx) mx = dt; });
  escalaState.min = mn; escalaState.max = mx;
  document.getElementById('escalaRange').textContent =
    `${escalaState.orders.length} pedidos (Live) · disponível de ${fmtDT(mn)} a ${fmtDT(mx)}`;
  if (box) box.style.display = '';
  setEscalaMsg('ok', `${escalaState.orders.length} pedidos carregados.`);
  document.getElementById('escalaRows').innerHTML = '';
  escalaAddRow(mn, mx); // 1ª linha já cobrindo o período todo
}

function escalaAddRow(ini, fim) {
  const tb = document.getElementById('escalaRows');
  if (!tb) return;
  const mm = escalaState.min ? `min="${escalaState.min}" max="${escalaState.max}"` : '';
  const tr = document.createElement('tr');
  tr.innerHTML =
    `<td><input class="es-nome" placeholder="Nome do responsável" oninput="escalaCheckLive()"></td>
     <td><input type="datetime-local" class="es-ini" ${mm} value="${ini || ''}" oninput="escalaCheckLive()"></td>
     <td><input type="datetime-local" class="es-fim" ${mm} value="${fim || ''}" oninput="escalaCheckLive()"></td>
     <td class="col-qtd"><input class="es-qtd" type="number" min="1" step="1" value="1" oninput="escalaCheckLive()"></td>
     <td><button class="del" title="Remover" onclick="this.closest('tr').remove();escalaCheckLive()">×</button></td>`;
  tb.appendChild(tr);
  escalaCheckLive();
}

function escalaReadRows() {
  const rows = [];
  document.querySelectorAll('#escalaRows tr').forEach(tr => {
    const nome = tr.querySelector('.es-nome').value.trim();
    const ini = tr.querySelector('.es-ini').value;
    const fim = tr.querySelector('.es-fim').value;
    let qtd = parseInt(tr.querySelector('.es-qtd').value, 10); if (!qtd || qtd < 1) qtd = 1;
    rows.push({ nome, ini, fim, qtd });
  });
  return rows;
}

// checagem em tempo real: sobreposição entre turnos + gap/overlap vs pedidos
function escalaCheckLive() {
  const el = document.getElementById('escalaConflito');
  if (!el || !escalaState.orders) return;
  const rows = escalaReadRows().filter(r => r.ini && r.fim && r.ini < r.fim);
  const fmtBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const warns = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++)
      if (rows[i].ini < rows[j].fim && rows[j].ini < rows[i].fim)
        warns.push(`⚠ Sobreposição: "${rows[i].nome || 'turno ' + (i + 1)}" e "${rows[j].nome || 'turno ' + (j + 1)}" pegam o mesmo horário.`);
  let gap = 0, gapReceb = 0, over = 0;
  escalaState.orders.forEach(o => {
    const dt = orderDT(o);
    const cov = rows.filter(r => dt >= r.ini && dt < r.fim).length;
    if (cov === 0) { gap++; if (o.settlement_status === 0) gapReceb += parseFloat(o.received_commission) || 0; }
    else if (cov > 1) over++;
  });
  let html = warns.map(w => `<div class="msg msg-err" style="margin-bottom:6px;">${w}</div>`).join('');
  if (gap > 0) html += `<div class="msg" style="margin-bottom:6px;background:var(--orange-soft);color:var(--orange);">⬤ ${gap.toLocaleString('pt-BR')} pedido(s) fora de qualquer turno (${fmtBRL(gapReceb)} de comissão sem responsável). Cubra o período ou siga assim.</div>`;
  if (over > 0) html += `<div class="msg msg-err" style="margin-bottom:6px;">⚠ ${over.toLocaleString('pt-BR')} pedido(s) caem em mais de um turno (contados 2x).</div>`;
  if (!html && rows.length) html = `<div class="msg msg-ok">✓ Todos os pedidos cobertos, sem sobreposição.</div>`;
  el.innerHTML = html;
}

function escalaCalcAll() {
  const rows = escalaReadRows();
  const valid = rows.filter(r => r.nome && r.ini && r.fim && r.ini < r.fim);
  if (!valid.length) return setEscalaMsg('err', 'Adicione ao menos um turno com nome, início e fim.');
  const pct = parseFloat((document.getElementById('escalaPct').value || '100').replace(',', '.')) || 0;
  escalaState.results = valid.map(r => {
    const sel = escalaState.orders.filter(o => { const dt = orderDT(o); return dt >= r.ini && dt < r.fim; });
    const liq = sel.filter(o => o.settlement_status === 0);
    const inel = sel.filter(o => o.settlement_status === 1);
    const recebida = liq.reduce((s, o) => s + (parseFloat(o.received_commission) || 0), 0);
    const pagar = recebida * pct / 100;
    return { ...r, pct, recebida, pagar, porCreator: pagar / r.qtd, liquidados: liq.length, inelegiveis: inel.length, total: sel.length };
  });
  escalaState.pct = pct;
  renderEscalaResults();
  wizardGo(2);
}

function renderEscalaResults() {
  const fmtBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const rows = escalaState.results || [];
  // avisos finais (gap/sobreposição) contra os pedidos
  const el2 = document.getElementById('escalaConflito2');
  let gap = 0, gapReceb = 0, over = 0;
  escalaState.orders.forEach(o => {
    const dt = orderDT(o);
    const cov = rows.filter(r => dt >= r.ini && dt < r.fim).length;
    if (cov === 0) { gap++; if (o.settlement_status === 0) gapReceb += parseFloat(o.received_commission) || 0; }
    else if (cov > 1) over++;
  });
  let warn = '';
  if (gap > 0) warn += `<div class="msg" style="margin-bottom:6px;background:var(--orange-soft);color:var(--orange);">⬤ ${gap.toLocaleString('pt-BR')} pedido(s) ficaram FORA de qualquer turno (${fmtBRL(gapReceb)} sem responsável).</div>`;
  if (over > 0) warn += `<div class="msg msg-err" style="margin-bottom:6px;">⚠ ${over.toLocaleString('pt-BR')} pedido(s) estão em MAIS DE UM turno (comissão contada 2x).</div>`;
  if (!warn) warn = `<div class="msg msg-ok" style="margin-bottom:6px;">✓ Cobertura completa, sem sobreposição.</div>`;
  if (el2) el2.innerHTML = warn;

  const totPagar = rows.reduce((s, r) => s + r.pagar, 0);
  document.getElementById('escalaResultInfo').innerHTML =
    `<strong>${rows.length}</strong> turno(s) · repasse <strong>${escalaState.pct}%</strong> · total a pagar <strong>${fmtBRL(totPagar)}</strong> · período ${fmtDT(escalaState.min)} a ${fmtDT(escalaState.max)}`;

  const body = rows.map((r, i) => `<tr>
      <td>${esc(r.nome)}${r.qtd > 1 ? ` <span style="color:var(--muted);">(${r.qtd}x)</span>` : ''}</td>
      <td style="white-space:nowrap;">${fmtDT(r.ini)} → ${fmtDT(r.fim)}</td>
      <td class="r">${r.liquidados}</td>
      <td class="r">${r.inelegiveis}</td>
      <td class="r">${fmtBRL(r.recebida)}</td>
      <td class="r"><strong style="color:var(--orange);">${fmtBRL(r.pagar)}</strong></td>
      <td class="r">${r.qtd > 1 ? fmtBRL(r.porCreator) : '—'}</td>
      <td class="r" style="white-space:nowrap;"><button class="btn-sm" onclick="reportRow(${i},'img')">Img</button> <button class="btn-sm" onclick="reportRow(${i},'pdf')">PDF</button></td>
    </tr>`).join('');
  document.getElementById('escalaResults').innerHTML =
    `<div style="overflow-x:auto;"><table class="escala-table">
      <thead><tr><th>Responsável</th><th>Turno</th><th class="r">Liq.</th><th class="r">Inel.</th><th class="r">Recebida</th><th class="r">A pagar</th><th class="r">P/ creator</th><th></th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
}

function reportDataRow(r) {
  return {
    creator: r.nome, periodo: periodoDe(r.ini, r.fim),
    turnoStr: `${fmtDT(r.ini)} → ${fmtDT(r.fim)}`,
    comissao: r.pagar, liquidados: r.liquidados, inelegiveis: r.inelegiveis, qty: r.qtd
  };
}
function reportRow(i, kind) {
  const r = (escalaState.results || [])[i];
  if (!r) return;
  const d = reportDataRow(r);
  if (kind === 'pdf') baixarPdf(d); else baixarImagem(d);
}
async function gerarTodos(kind) {
  const rows = escalaState.results || [];
  for (let i = 0; i < rows.length; i++) {
    reportRow(i, kind);
    await new Promise(res => setTimeout(res, 700));
  }
}

async function salvarEscala() {
  const msg = document.getElementById('escalaSaveMsg');
  const set = (c, t) => { if (msg) { msg.className = 'msg ' + c; msg.textContent = t; } };
  const rows = escalaState.results || [];
  if (!rows.length) return set('msg-err', 'Calcule a escala primeiro.');
  const uid = await myUid();
  const recs = rows.map(r => ({
    agency_id: agencyId(), owner_id: uid, account_id: escalaState.accountId, seller_id: null,
    creator_name: r.nome, start_dt: r.ini, end_dt: r.fim,
    comissao: r.pagar, liquidados: r.liquidados, inelegiveis: r.inelegiveis, qty: r.qtd
  }));
  const { error } = await sb.from('turnos').insert(recs);
  if (error) return set('msg-err', 'Erro ao salvar: ' + error.message);
  set('msg-ok', `${recs.length} turno(s) salvos.`);
}
