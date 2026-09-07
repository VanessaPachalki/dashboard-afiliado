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

// logo em PRETO (data URL) pro PDF/fundo claro; null se der taint/erro
function blackLogoDataURL(img) {
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const cx = c.getContext('2d');
    cx.filter = 'brightness(0)';
    cx.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) { return null; }
}
// remove a seta unicode (fonte do PDF não tem) pros textos do PDF
function pdfSafe(s) { return String(s || '').replace(/→/g, ' - '); }

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
  // cache das contas (5 min) — evita re-buscar centenas a cada visita
  const cacheKey = 'fech_accounts_' + (agencyId() || 'x');
  try {
    const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    if (c && c._ts && Date.now() - c._ts < 300000) allAccountsList = c.data || [];
  } catch (e) {}
  if (!allAccountsList.length) {
    let accQ = sb.from('accounts').select('id, name, email').order('name');
    if (agencyId()) accQ = accQ.eq('agency_id', agencyId());
    const { data: accounts } = await accQ;
    allAccountsList = accounts || [];
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ _ts: Date.now(), data: allAccountsList })); } catch (e) {}
  }

  // (compat) se ainda existir o select de conta de vendedor, popula
  const sellerAccSel = document.getElementById('sellerAccount');
  if (sellerAccSel) {
    const opts = allAccountsList.map(a =>
      `<option value="${escAttr(a.id)}">${esc(a.name)}${a.email ? ' (' + esc(a.email) + ')' : ''}</option>`
    ).join('');
    sellerAccSel.innerHTML = '<option value="">Selecione a conta</option>' + opts;
  }

  await loadAuxiliaresFech();
  await loadSellers();
}

// auxiliares -> autocomplete no "Responsável" + resolução de auxiliar_id no save
let auxByName = {};   // nome (minúsculo) -> { id, email }
async function loadAuxiliaresFech() {
  let q = sb.from('auxiliares').select('id,name,email').order('name');
  if (agencyId()) q = q.eq('agency_id', agencyId());
  const { data } = await q;
  auxByName = {};
  const opts = [];
  (data || []).forEach(a => {
    const key = (a.name || '').toLowerCase().trim();
    if (key) { auxByName[key] = { id: a.id, email: a.email || null }; opts.push(`<option value="${escAttr(a.name)}">`); }
  });
  const dl = document.getElementById('auxDatalist');
  if (dl) dl.innerHTML = opts.join('');
}
function escalaNomeCheck(input) {
  const badge = input.parentElement.querySelector('.es-aux-badge');
  if (badge) badge.style.display = auxByName[(input.value || '').toLowerCase().trim()] ? '' : 'none';
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
  const os = String(o.order_status || '').toUpperCase();   // ciclo do pedido (dado real)
  const ret = Number(o.returned_quantity) || 0;
  const ref = Number(o.refunded_quantity) || 0;
  const wasRefunded = ret > 0 || ref > 0 || Number(o.items_refunded) > 0;
  // desdobra INELIGIBLE usando o status real do pedido quando existe:
  //   CANCELLED -> cancelado · DEDUCTED -> estornado (clawback) · devolução se houve reembolso
  const splitInel = () => {
    if (os === 'CANCELLED') return 'cancelado';
    if (os === 'DEDUCTED') return 'deduzido';
    if (os === 'COMPLETED') return wasRefunded ? 'devolucao' : 'cancelado';
    return wasRefunded ? 'devolucao' : 'cancelado'; // sem order_status: cai na estimativa antiga
  };
  if (raw) {
    if (raw.includes('SETTLED')) return 'liquidado';
    if (raw.includes('INELIGIBLE')) return splitInel();
    if (raw.includes('UNPAID')) return 'naopago';
    if (raw.includes('FROZEN')) return 'analise';
    if (raw.includes('PENDING')) return 'pendente';
  }
  // fallback pelo settlement_status int (dados do upload manual)
  const s = o.settlement_status;
  if (s === 0) return 'liquidado';
  if (s === 1) return splitInel();
  if (s === 3) return 'aguardando';
  return 'pendente';
}

const GRAN_CARDS = [
  ['liquidado', 'Liquidados', 'var(--green)'],
  ['pendente', 'Pendentes', 'var(--cream)'],
  ['naopago', 'Não pago p/ cliente', 'var(--orange)'],
  ['cancelado', 'Cancelados', '#9B59B6'],
  ['devolucao', 'Devoluções', 'var(--red)'],
  ['deduzido', 'Estornados (clawback)', '#C0392B'],
  ['analise', 'Em análise (fraude)', 'var(--muted)'],
  ['aguardando', 'Aguardando pgto.', 'var(--muted)']
];
const GRAN_LABEL = {
  liquidado: 'Liquidado', pendente: 'Pendente', naopago: 'Não pago',
  cancelado: 'Cancelado', devolucao: 'Devolução', deduzido: 'Estornado', analise: 'Em análise', aguardando: 'Aguardando'
};

// Distribuição de status (granular) com contagem e % sobre o total de pedidos.
// Só retorna os status que aparecem. cancelado+devolucao = Inelegível (fiel à TikTok).
function statusBreakdown(orders) {
  const c = { liquidado: 0, pendente: 0, naopago: 0, cancelado: 0, devolucao: 0, deduzido: 0, analise: 0, aguardando: 0 };
  (orders || []).forEach(o => { c[granularStatus(o)]++; });
  const total = (orders || []).length || 1;
  const pctOf = n => n / total * 100;
  return {
    total: (orders || []).length,
    inelegiveis: c.cancelado + c.devolucao + c.deduzido,
    items: GRAN_CARDS.filter(([k]) => c[k] > 0).map(([k, label, color]) => ({
      k, label, color, hex: STATUS_HEX[k] || '#8a8a92', n: c[k], pct: pctOf(c[k])
    }))
  };
}
// cores hex equivalentes (pro canvas/PDF, onde var(--..) não vale)
const STATUS_HEX = { liquidado: '#2ECC71', pendente: '#D4A76A', naopago: '#E8873A', cancelado: '#9B59B6', devolucao: '#E74C3C', deduzido: '#C0392B', analise: '#8a8a92', aguardando: '#8a8a92' };
const pct1 = v => v.toFixed(1).replace('.', ',') + '%';

// Lista de pedidos do turno atual (pra tabela de detalhes + busca + ordenação)
let lastTurnoOrders = [];
let ordDetailSort = { key: 'dt', dir: 'asc' };

// ordem lógica dos status: Liquidado -> Cancelado -> Devolução -> resto
const STATUS_ORDER = { liquidado: 0, cancelado: 1, devolucao: 2, deduzido: 3, naopago: 4, pendente: 5, aguardando: 6, analise: 7 };
const STATUS_COLOR = { liquidado: 'var(--green)', cancelado: '#9B59B6', devolucao: 'var(--red)', deduzido: '#C0392B', pendente: 'var(--cream)', naopago: 'var(--orange)', aguardando: 'var(--muted)', analise: 'var(--muted)' };
const ORD_DETAIL_VAL = {
  dt: o => orderDT(o),
  resp: o => (o._resp || '').toLowerCase(),
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
  const respFilter = document.getElementById('ordersDetailResp')?.value || '';
  const statusFilter = document.getElementById('ordersDetailStatus')?.value || '';
  let list = lastTurnoOrders;
  if (respFilter) list = list.filter(o => (o._resp || '') === respFilter);
  if (statusFilter) list = list.filter(o => granularStatus(o) === statusFilter);
  if (q) list = list.filter(o =>
    (o.product_name || '').toLowerCase().includes(q) || (o.store_name || '').toLowerCase().includes(q) || (o._resp || '').toLowerCase().includes(q));
  // ordenação
  const dir = ordDetailSort.dir === 'asc' ? 1 : -1;
  const val = ORD_DETAIL_VAL[ordDetailSort.key] || ORD_DETAIL_VAL.dt;
  list = list.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if (x < y) return -dir; if (x > y) return dir;
    const da = orderDT(a), db = orderDT(b); // desempate sempre por data
    return da < db ? -1 : da > db ? 1 : 0;
  });

  const fmtBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const body = list.map((o, i) => {
    const k = granularStatus(o);
    const c = STATUS_COLOR[k] || 'var(--muted)';
    const zebra = i % 2 ? 'background:var(--bg);' : '';
    return `<tr style="border-bottom:1px solid var(--border);${zebra}">
      <td style="white-space:nowrap;padding:7px 10px;">${fmtDT(orderDT(o))}</td>
      <td style="padding:7px 10px;">${o._resp ? esc(o._resp) : '<span style="color:var(--muted);">sem turno</span>'}</td>
      <td style="padding:7px 10px;">${esc((o.product_name || '').slice(0, 42))}</td>
      <td style="padding:7px 10px;color:var(--muted);">${esc(o.store_name || '')}</td>
      <td style="padding:7px 10px;"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:${c}22;color:${c};">${GRAN_LABEL[k] || k}</span>${o.aftersale_reason ? `<div style="font-size:10px;color:var(--muted);margin-top:3px;max-width:180px;">${esc(o.aftersale_reason)}${o.aftersale_role ? ' · ' + esc(String(o.aftersale_role).toLowerCase()) : ''}</div>` : ''}</td>
      <td class="r" style="padding:7px 10px;color:var(--muted);">${fmtBRL(o.estimated_commission)}</td>
      <td class="r" style="padding:7px 10px;font-weight:600;color:var(--green);">${fmtBRL(o.received_commission)}</td>
      <td class="r" style="padding:7px 10px;">${fmtBRL(o.gmv)}</td>
    </tr>`;
  }).join('');

  const arrow = k => ordDetailSort.key === k ? (ordDetailSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  const th = (k, label, cls) =>
    `<th class="${cls || ''}" onclick="sortOrdersDetail('${k}')" style="padding:8px 10px;cursor:pointer;user-select:none;white-space:nowrap;position:sticky;top:0;background:var(--card);z-index:1;border-bottom:2px solid var(--border);">${label}${arrow(k)}</th>`;
  el.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.3px;">
      ${th('dt', 'Data/Hora')}${th('resp', 'Responsável')}${th('product', 'Produto')}${th('store', 'Loja')}${th('status', 'Status')}
      ${th('est', 'Estimada', 'r')}${th('receb', 'Recebida', 'r')}${th('gmv', 'GMV', 'r')}
    </tr></thead>
    <tbody>${body || '<tr><td colspan="8" style="color:var(--muted);padding:14px;text-align:center;">Nenhum pedido.</td></tr>'}</tbody>
  </table>
  <div style="font-size:11px;color:var(--muted);margin-top:10px;">${list.length} pedido(s)</div>`;
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
  const gran = { liquidado: 0, pendente: 0, naopago: 0, cancelado: 0, devolucao: 0, deduzido: 0, analise: 0, aguardando: 0 };
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

function pdfBlob(d) {
 return new Promise(resolve => {
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
      doc.addImage(blackLogoDataURL(img) || logoUrl, 'PNG', 20, 16, w, h);
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(26);
      doc.text(brandName(), 20, 25);
    }
    if (d.liveName) { doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(26); doc.text(d.liveName, 20, 37); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120);
    doc.text('Fechamento de Comissão', 20, d.liveName ? 45 : 37);
    const topY = d.liveName ? 51 : 43;
    doc.setDrawColor(220); doc.line(20, topY, 190, topY);

    let y = topY + 12;
    const linha = (label, val) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(90);
      doc.text(label, 20, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30);
      doc.text(String(val), 190, y, { align: 'right' });
      y += 9;
    };
    linha(qty > 1 ? 'Responsáveis' : 'Responsável', creator);
    linha('Período', pdfSafe(d.periodo));
    linha('Turno', pdfSafe(d.turnoStr));

    y += 6; doc.setDrawColor(220); doc.line(20, y, 190, y); y += 12;
    // só o valor que a pessoa recebe (sem "total")
    const receber = qty > 1 ? d.comissao / qty : d.comissao;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(120);
    doc.text(qty > 1 ? 'A RECEBER (sua parte da dupla)' : 'A RECEBER', 20, y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(...orange);
    doc.text(fmtBRL(receber), 20, y + 14); y += 28;

    doc.setDrawColor(220); doc.line(20, y, 190, y); y += 12;
    linha('Pedidos pagos', d.liquidados);
    linha('Pedidos inelegíveis', d.inelegiveis);

    // produtos detalhados
    if (d.orders && d.orders.length) {
      y += 4; doc.setDrawColor(220); doc.line(20, y, 190, y); y += 9;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(90); doc.text('Produtos', 20, y); y += 7;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(140);
      doc.text('PRODUTO', 20, y); doc.text('STATUS', 130, y); doc.text('RECEBIDA', 190, y, { align: 'right' }); y += 5;
      d.orders.forEach(o => {
        if (y > 285) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(40);
        doc.text((doc.splitTextToSize(o.product, 105)[0] || o.product), 20, y);
        doc.setTextColor(120); doc.text(o.status, 130, y);
        doc.setTextColor(60); doc.text(fmtBRL(o.receb), 190, y, { align: 'right' });
        y += 5;
      });
    }

    if (y > 283) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
    doc.text(`${brandName()} · gerado em ${new Date().toLocaleString('pt-BR')}`, 20, y + 8);

    resolve(doc.output('blob'));
  };

  if (logoUrl) {
    const img = new Image();
    img.onload = () => render(img);
    img.onerror = () => render(null);
    img.src = logoUrl;
  } else render(null);
 });
}
function baixarPdf(d) {
  pdfBlob(d).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo(d, 'pdf');
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });
}

function imagemBlob(d) {
 return new Promise(resolve => {
  const creator = d.creator || '—';
  const qty = (d.qty && d.qty > 1) ? d.qty : 1;
  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brand = brandHex();
  const W = 1080, PAD = 90;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = 1700;
  const ctx = canvas.getContext('2d');

  // fundo CLARO
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, 1700);
  ctx.fillStyle = brand; ctx.fillRect(0, 0, W, 12);

  const divider = yy => {
    ctx.strokeStyle = '#ececf0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, yy); ctx.lineTo(W - PAD, yy); ctx.stroke();
  };
  const rowLR = (yy, label, val, bold) => {
    ctx.textAlign = 'left'; ctx.fillStyle = '#8a8a92'; ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(label, PAD, yy);
    ctx.textAlign = 'right'; ctx.fillStyle = '#1a1a1e'; ctx.font = (bold ? '700 34px' : '500 32px') + ' system-ui, sans-serif';
    ctx.fillText(val, W - PAD, yy);
    ctx.textAlign = 'left';
  };

  // título (logo desenhada no onload)
  let y = 236;
  ctx.textAlign = 'left'; ctx.fillStyle = '#1a1a1e'; ctx.font = '700 42px system-ui, sans-serif';
  ctx.fillText(d.liveName || 'Fechamento de Comissão', PAD, y);
  if (d.liveName) { y += 40; ctx.fillStyle = '#8a8a92'; ctx.font = '400 28px system-ui, sans-serif'; ctx.fillText('Fechamento de Comissão', PAD, y); }
  y += 46; divider(y);

  y += 74; rowLR(y, qty > 1 ? 'Responsáveis' : 'Responsável', creator, true);
  y += 66; rowLR(y, 'Período', d.periodo);
  y += 66; rowLR(y, 'Turno', d.turnoStr);
  y += 48; divider(y);

  y += 80;
  const receber = qty > 1 ? d.comissao / qty : d.comissao;
  ctx.fillStyle = '#8a8a92'; ctx.font = '700 26px system-ui, sans-serif';
  ctx.fillText(qty > 1 ? 'A RECEBER · sua parte da dupla' : 'A RECEBER', PAD, y);
  y += 104; ctx.fillStyle = brand; ctx.font = '800 104px system-ui, sans-serif'; ctx.fillText(fmtBRL(receber), PAD, y);
  y += 54; divider(y);

  y += 68; rowLR(y, 'Pedidos pagos', String(d.liquidados));
  y += 66; rowLR(y, 'Pedidos inelegíveis', String(d.inelegiveis));
  y += 66;
  ctx.textAlign = 'left'; ctx.fillStyle = '#b0b0b6'; ctx.font = '400 22px system-ui, sans-serif';
  ctx.fillText(`${brandName()} · gerado em ${new Date().toLocaleString('pt-BR')}`, PAD, y);

  const finalH = y + 52;
  const exportar = () => {
    const out = document.createElement('canvas');
    out.width = W; out.height = finalH;
    out.getContext('2d').drawImage(canvas, 0, 0);
    out.toBlob(blob => resolve(blob), 'image/png');
  };

  const drawName = () => {
    ctx.textAlign = 'left'; ctx.fillStyle = '#1a1a1e'; ctx.font = '900 64px system-ui, sans-serif';
    ctx.fillText(brandName(), PAD, 158);
  };
  const logoUrl = tenantLogo();
  if (logoUrl) {
    const img = new Image();
    img.onload = () => {
      const h = 56, w = img.width * (h / img.height);
      try { ctx.filter = 'brightness(0)'; } catch (e) {} // logo preta no fundo claro
      ctx.drawImage(img, PAD, 100, w, h);
      ctx.filter = 'none';
      exportar();
    };
    img.onerror = () => { drawName(); exportar(); };
    img.src = logoUrl;
  } else { drawName(); exportar(); }
 });
}
function baixarImagem(d) {
  imagemBlob(d).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo(d, 'png');
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });
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
  if (m) m.textContent = ''; // não usa mais inline — vira toast
  if (!txt) return;
  if (cls === 'err') toast('err', txt);
  else if (cls === 'ok') toast('ok', txt);
  // cls '' (ex: "Carregando...") é transitório, ignora
}

function sbBanner(type, icon, text) {
  return `<div class="status-banner sb-${type}"><span class="sb-icon">${icon}</span><span>${text}</span></div>`;
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
  // abre uma live salva (vindo do Histórico): ?live=<id>
  const liveId = new URLSearchParams(location.search).get('live');
  if (liveId) await abrirLiveSalva(liveId);
}

async function abrirLiveSalva(id) {
  const { data } = await sb.from('lives').select('*, accounts(name)').eq('id', id).maybeSingle();
  if (!data) { toast('err', 'Fechamento não encontrado.'); return; }
  document.getElementById('fechAccountSearch').value = data.accounts?.name || '';
  document.getElementById('fechAccount').value = data.account_id;
  document.getElementById('liveIni').value = data.start_dt;
  document.getElementById('liveFim').value = data.end_dt;
  await escalaCarregarPeriodo();
  const pctEl = document.getElementById('escalaPct'); if (pctEl) pctEl.value = data.pct != null ? data.pct : 100;
  const tb = document.getElementById('escalaRows');
  const turnos = Array.isArray(data.turnos) ? data.turnos : [];
  if (tb && turnos.length) {
    tb.innerHTML = '';
    turnos.forEach(t => {
      escalaAddRow(t.ini, t.fim);
      const last = tb.querySelector('tr:last-child');
      if (last) {
        // reconstrói os responsáveis (novo formato com array; ou o antigo com 1 nome)
        last._resp = Array.isArray(t.responsaveis) && t.responsaveis.length
          ? t.responsaveis.map(p => ({ nome: p.nome, pct: p.pct != null ? Number(p.pct) : null, aux_id: p.aux_id || null, aux_email: p.aux_email || null }))
          : (t.nome ? [{ nome: t.nome, pct: null, aux_id: null, aux_email: null }] : []);
        if (last._resp.some(r => r.pct == null)) respRedistribute(last);
        renderResp(last);
      }
    });
    escalaCheckLive();
  }
  toast('ok', `"${data.name}" carregada. Ajuste e recalcule se quiser.`);
}

// ---- Passo 1: frescor dos dias ----
async function loadFreshness() {
  const from = document.getElementById('freshFrom').value;
  const to = document.getElementById('freshTo').value;
  const el = document.getElementById('freshList');
  if (!from || !to) { el.innerHTML = '<div class="msg msg-err">Selecione De e Até.</div>'; return; }
  el.innerHTML = '<div class="msg">Carregando...</div>';
  const { data, error } = await sb.rpc('fech_days', { p_from: from, p_to: to, p_agency: agencyId() || null });
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
  const liveIni = document.getElementById('liveIni').value; // "YYYY-MM-DDTHH:MM"
  const liveFim = document.getElementById('liveFim').value;
  if (!accId) return setEscalaMsg('err', 'Selecione o Creator Host.');
  if (!liveIni || !liveFim) return setEscalaMsg('err', 'Defina o início e o fim da live.');
  if (liveIni >= liveFim) return setEscalaMsg('err', 'O início da live deve ser antes do fim.');
  const from = liveIni.slice(0, 10), to = liveFim.slice(0, 10);
  setEscalaMsg('', 'Carregando pedidos...');
  let q = sb.from('orders').select('*').eq('account_id', accId).eq('content_type', 0)
    .gte('order_date', from).lte('order_date', to).order('order_date');
  if (agencyId()) q = q.eq('agency_id', agencyId());
  const { data, error } = await q;
  if (error) return setEscalaMsg('err', 'Erro: ' + error.message);
  const all = data || [];
  const box = document.getElementById('escalaBox');

  // dias do período que NÃO foram importados -> bloqueia com modal
  const present = new Set(all.map(o => o.order_date));
  const missing = [];
  const d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
  while (d <= end) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!present.has(iso)) missing.push(iso);
    d.setDate(d.getDate() + 1);
  }
  if (missing.length) {
    if (box) box.style.display = 'none';
    setEscalaMsg('err', `Faltam dados de ${missing.length} dia(s).`);
    showDataModal(missing);
    return;
  }

  // ESCOPO = só os pedidos DENTRO da janela da live (não os dias inteiros)
  const inLive = all.filter(o => { const dt = orderDT(o); return dt >= liveIni && dt <= liveFim; });
  escalaState = { accountId: accId, from, to, liveIni, liveFim, orders: inLive, results: [], pct: 100, min: liveIni, max: liveFim };
  if (!inLive.length) {
    if (box) box.style.display = 'none';
    setEscalaMsg('err', 'Nenhum pedido dentro do horário da live. Ajuste o início/fim.');
    return;
  }
  document.getElementById('escalaRange').textContent =
    `${inLive.length} pedidos na live · ${fmtDT(liveIni)} → ${fmtDT(liveFim)}`;
  if (box) box.style.display = '';
  setEscalaMsg('', '');
  document.getElementById('escalaRows').innerHTML = '';
  escalaAddRow(liveIni, ''); // 1º responsável começa no início da live
}

function showDataModal(missing) {
  const fmtDay = s => { const [, m, dd] = s.split('-'); return `${dd}/${m}`; };
  const el = document.getElementById('dataModalDays');
  if (el) el.innerHTML = missing.map(s => `<span class="modal-day">${fmtDay(s)}</span>`).join('');
  const link = document.getElementById('dataModalSync');
  if (link) link.href = `sincronizar.html?from=${missing[0]}&to=${missing[missing.length - 1]}`;
  const m = document.getElementById('dataModal');
  if (m) m.style.display = 'flex';
}
function closeDataModal() { const m = document.getElementById('dataModal'); if (m) m.style.display = 'none'; }

// soma minutos a um "YYYY-MM-DDTHH:MM" (datetime-local)
function addMin(v, m) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  d.setMinutes(d.getMinutes() + m);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escalaAddRow(iniDT, fimDT) {
  const tb = document.getElementById('escalaRows');
  if (!tb) return;
  const lastTr = tb.querySelector('tr:last-child');
  // "+ Adicionar turno": exige o turno anterior completo e encadeia +1 min
  if (!iniDT && lastTr) {
    const n = (lastTr._resp || []).length;
    const i = lastTr.dataset.ini;                       // início = fonte estável
    const f = lastTr.querySelector('.es-fim').value;
    if (!n || !i || !f || f <= i) { setEscalaMsg('err', 'Preencha o turno atual (responsável e fim) antes de adicionar outro.'); return; }
    iniDT = addMin(f, 1);
  }
  // fim já vem com a DATA certa (= a do início) pra você só ajustar a hora
  const mm = escalaState.liveIni ? `min="${escalaState.liveIni}" max="${escalaState.liveFim}"` : '';
  const isFirst = !tb.querySelector('tr');               // 1ª linha não pode ser excluída
  const tr = document.createElement('tr');
  tr.dataset.ini = iniDT || '';                          // início NÃO some (não é input editável)
  tr._resp = [];                                         // responsáveis do turno (chips)
  tr.innerHTML =
    `<td><div class="resp-cell" style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;">
       <input class="resp-add" list="auxDatalist" placeholder="Responsável (Enter)" onkeydown="if(event.key==='Enter'){event.preventDefault();respAdd(this);}" onchange="respAdd(this)" onblur="respAdd(this)" style="border:1px solid var(--border);border-radius:8px;padding:6px 8px;background:var(--bg);color:var(--text);font-size:13px;flex:1;min-width:120px;">
     </div></td>
     <td><span class="es-ini-lbl" style="font-size:13px;color:var(--muted);white-space:nowrap;">${iniDT ? fmtDT(iniDT) : '—'}</span></td>
     <td><input type="datetime-local" class="es-fim" ${mm} value="${fimDT || iniDT || ''}" oninput="escalaFimChange(this);escalaCheckLive()"></td>
     <td class="col-qtd"><span class="es-qtd-lbl" style="font-size:13px;color:var(--muted);">1</span></td>
     ${isFirst ? '<td></td>' : '<td><button class="del" title="Remover" onclick="escalaDelRow(this)">×</button></td>'}`;
  tb.appendChild(tr);
  escalaCheckLive();
}

// ---- responsáveis do turno (vários; cadastrados ou avulsos; com % por pessoa) ----
function respAdd(input) {
  const val = (input.value || '').trim();
  if (!val) return;
  const tr = input.closest('tr');
  if (!tr._resp) tr._resp = [];
  const aux = auxByName[val.toLowerCase()];
  tr._resp.push({ nome: val, aux_id: aux ? aux.id : null, aux_email: aux ? aux.email : null, pct: 0 });
  input.value = '';
  respRedistribute(tr);
  renderResp(tr);
  escalaCheckLive();
}
function respRemove(tr, i) {
  if (!tr._resp) return;
  tr._resp.splice(i, 1);
  respRedistribute(tr);
  renderResp(tr);
  escalaCheckLive();
}
// distribui igualmente (100/N); último absorve a sobra pra fechar 100.
function respRedistribute(tr) {
  const n = (tr._resp || []).length;
  if (!n) return;
  const base = Math.floor(100 / n);
  tr._resp.forEach(r => { r.pct = base; });
  tr._resp[n - 1].pct = 100 - base * (n - 1);
}
function respPct(tr, i, val) {
  const p = Math.max(0, Math.min(100, parseFloat(String(val).replace(',', '.')) || 0));
  if (tr._resp && tr._resp[i]) tr._resp[i].pct = p;
  renderRespSum(tr);
  escalaCheckLive();
}
function renderResp(tr) {
  const cell = tr.querySelector('.resp-cell');
  if (!cell) return;
  const input = cell.querySelector('.resp-add');
  cell.querySelectorAll('.resp-chip').forEach(c => c.remove());
  const resp = tr._resp || [];
  const multi = resp.length > 1;
  resp.forEach((r, i) => {
    const chip = document.createElement('span');
    chip.className = 'resp-chip';
    const linked = !!r.aux_id;
    chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;background:${linked ? 'var(--orange-soft)' : 'var(--card)'};border:1px solid ${linked ? 'var(--orange)' : 'var(--border)'};border-radius:14px;padding:3px 8px;font-size:12px;`;
    chip.innerHTML =
      `${linked ? '<span style="color:var(--green);">✓</span>' : ''}<span>${esc(r.nome)}</span>` +
      (multi ? ` <input class="resp-pct" type="text" inputmode="decimal" value="${r.pct}" onchange="respPct(this.closest('tr'),${i},this.value)" style="width:36px;text-align:center;border:1px solid var(--border);border-radius:6px;padding:1px 3px;font-size:11px;background:var(--bg);color:var(--text);"><span style="color:var(--muted);">%</span>` : '') +
      ` <span onclick="respRemove(this.closest('tr'),${i})" style="cursor:pointer;color:var(--muted);font-weight:700;">×</span>`;
    cell.insertBefore(chip, input);
  });
  const q = tr.querySelector('.es-qtd-lbl'); if (q) q.textContent = Math.max(1, resp.length);
  renderRespSum(tr);
}
function renderRespSum(tr) {
  const resp = tr._resp || [];
  const cell = tr.querySelector('.resp-cell');
  if (!cell) return;
  let sumEl = cell.querySelector('.resp-sum');
  if (resp.length > 1) {
    const sum = resp.reduce((s, r) => s + (Number(r.pct) || 0), 0);
    if (!sumEl) { sumEl = document.createElement('span'); sumEl.className = 'resp-sum'; sumEl.style.cssText = 'font-size:10px;width:100%;'; cell.appendChild(sumEl); }
    sumEl.textContent = sum === 100 ? '' : `soma ${sum}% (tem que dar 100%)`;
    sumEl.style.color = sum === 100 ? 'var(--muted)' : 'var(--red)';
  } else if (sumEl) { sumEl.remove(); }
}

// re-encadeia só os INÍCIOS (início = fim anterior +1min). NÃO mexe nos fins
// digitados — a validação (fora da janela / fim<=início) é avisada, não forçada.
function escalaRechain() {
  let prevFim = null;
  document.querySelectorAll('#escalaRows tr').forEach((tr, i) => {
    const ini = i === 0 ? escalaState.liveIni : (prevFim ? addMin(prevFim, 1) : (tr.dataset.ini || escalaState.liveIni));
    tr.dataset.ini = ini;
    const lbl = tr.querySelector('.es-ini-lbl'); if (lbl) lbl.textContent = ini ? fmtDT(ini) : '—';
    const fim = tr.querySelector('.es-fim').value;
    prevFim = (fim && fim > ini) ? fim : null;
  });
}

// só re-encadeia os inícios seguintes; nunca altera o que você digitou no fim.
function escalaFimChange(input) { escalaRechain(); }

function escalaDelRow(btn) { const tr = btn.closest('tr'); if (!tr || !tr.previousElementSibling) return; tr.remove(); escalaRechain(); escalaCheckLive(); }

function escalaReadRows() {
  const rows = [];
  document.querySelectorAll('#escalaRows tr').forEach(tr => {
    const resp = tr._resp || [];
    const nome = resp.map(r => r.nome).join(', ');
    const ini = tr.dataset.ini || '';
    const fim = tr.querySelector('.es-fim').value;
    const qtd = Math.max(1, resp.length);
    const auxEmails = resp.map(r => r.aux_email).filter(Boolean);
    rows.push({
      nome, ini, fim, qtd,
      responsaveis: resp.map(r => ({ nome: r.nome, pct: Number(r.pct) || 0, aux_id: r.aux_id || null, aux_email: r.aux_email || null })),
      auxiliar_emails: auxEmails, auxiliar_email: auxEmails[0] || null
    });
  });
  return rows;
}

function escalaCheckLive() {
  const el = document.getElementById('escalaConflito');
  if (!el || !escalaState.orders) return;
  const allRows = escalaReadRows();
  // não mostra nada até começar a preencher (evita "tudo certo" prematuro)
  if (!allRows.some(r => r.nome)) { el.innerHTML = ''; return; }
  const rows = allRows.filter(r => r.ini && r.fim && r.ini < r.fim);
  const fmtBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const warns = [];
  if (allRows.some(r => r.nome && r.fim && r.fim <= r.ini))
    warns.push('Um turno tem o fim antes ou igual ao início. Ajuste a data/hora de fim (se virou o dia, mude a data).');
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++)
      if (rows[i].ini <= rows[j].fim && rows[j].ini <= rows[i].fim)
        warns.push(`Sobreposição: "${rows[i].nome || 'turno ' + (i + 1)}" e "${rows[j].nome || 'turno ' + (j + 1)}" pegam o mesmo horário.`);
  if (escalaState.liveIni && rows.some(r => r.ini < escalaState.liveIni || r.fim > escalaState.liveFim))
    warns.push('Algum turno está fora da janela da live (início/fim).');
  let gap = 0, gapReceb = 0, over = 0;
  escalaState.orders.forEach(o => {
    const dt = orderDT(o);
    const cov = rows.filter(r => dt >= r.ini && dt <= r.fim).length;
    if (cov === 0) { gap++; if (o.settlement_status === 0) gapReceb += parseFloat(o.received_commission) || 0; }
    else if (cov > 1) over++;
  });
  let html = warns.map(w => sbBanner('err', '⚠', w)).join('');
  if (gap > 0) html += sbBanner('warn', '◔', `${gap.toLocaleString('pt-BR')} pedido(s) fora de qualquer turno (sem responsável).`);
  if (over > 0) html += sbBanner('err', '⚠', `${over.toLocaleString('pt-BR')} pedido(s) em mais de um turno (contados 2x).`);
  if (!html && rows.length) html = sbBanner('ok', '✓', 'Tudo certo. Todos os pedidos cobertos.');
  el.innerHTML = html;
}

function escalaCalcAll() {
  // último turno com fim ainda no padrão (<= início) -> autocompleta com o fim da live
  const trs = document.querySelectorAll('#escalaRows tr');
  if (trs.length && escalaState.liveFim) {
    const lastTr = trs[trs.length - 1];
    const lastFim = lastTr.querySelector('.es-fim');
    const lastIni = lastTr.dataset.ini;
    if (lastFim && (!lastFim.value || lastFim.value <= lastIni)) { lastFim.value = escalaState.liveFim; escalaRechain(); }
  }
  const rows = escalaReadRows();
  const valid = rows.filter(r => r.nome && r.ini && r.fim && r.ini < r.fim);
  if (!valid.length) return setEscalaMsg('err', 'Adicione ao menos um turno com nome, início e fim.');
  const pct = parseFloat((document.getElementById('escalaPct').value || '100').replace(',', '.')) || 0;
  escalaState.results = valid.map(r => {
    const sel = escalaState.orders.filter(o => { const dt = orderDT(o); return dt >= r.ini && dt <= r.fim; });
    const liq = sel.filter(o => o.settlement_status === 0);
    const inel = sel.filter(o => o.settlement_status === 1);
    const recebida = liq.reduce((s, o) => s + (parseFloat(o.received_commission) || 0), 0);
    const pagar = recebida * pct / 100;
    // valor por responsável = pagar × (% dele); se não houver % válido, divide igual
    const somaPct = (r.responsaveis || []).reduce((s, p) => s + (Number(p.pct) || 0), 0);
    const responsaveis = (r.responsaveis || []).map(p => ({
      ...p, valor: somaPct === 100 ? pagar * (Number(p.pct) || 0) / 100 : pagar / r.qtd
    }));
    return { ...r, pct, recebida, pagar, porCreator: pagar / r.qtd, responsaveis, liquidados: liq.length, inelegiveis: inel.length, total: sel.length };
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
    const cov = rows.filter(r => dt >= r.ini && dt <= r.fim).length;
    if (cov === 0) { gap++; if (o.settlement_status === 0) gapReceb += parseFloat(o.received_commission) || 0; }
    else if (cov > 1) over++;
  });
  let warn = '';
  if (gap > 0) warn += sbBanner('warn', '◔', `${gap.toLocaleString('pt-BR')} pedido(s) fora de qualquer turno (sem responsável).`);
  if (over > 0) warn += sbBanner('err', '⚠', `${over.toLocaleString('pt-BR')} pedido(s) em mais de um turno (comissão contada 2x).`);
  if (!warn) warn = sbBanner('ok', '✓', 'Cobertura completa, sem sobreposição.');
  if (el2) el2.innerHTML = warn;

  const totPagar = rows.reduce((s, r) => s + r.pagar, 0);
  // distribuição de status (com %) sobre todos os pedidos da live
  const bd = statusBreakdown(escalaState.orders);
  const chips = bd.items.map(s =>
    `<span style="display:inline-flex;align-items:center;gap:6px;background:${s.color}1e;color:${s.color};padding:4px 11px;border-radius:20px;font-size:12px;font-weight:700;">
       <span style="width:8px;height:8px;border-radius:50%;background:${s.color};"></span>${s.label}: ${s.n} <span style="opacity:.75;font-weight:600;">${pct1(s.pct)}</span></span>`).join('');
  const inelNote = bd.inelegiveis > 0
    ? `<div style="font-size:11px;color:var(--muted);margin-top:7px;">Inelegíveis (${bd.inelegiveis}) = Cancelados + Devoluções — não geram comissão.</div>` : '';
  document.getElementById('escalaResultInfo').innerHTML =
    `<strong>${rows.length}</strong> turno(s) · repasse <strong>${escalaState.pct}%</strong> · total a pagar <strong>${fmtBRL(totPagar)}</strong> · período ${fmtDT(escalaState.min)} a ${fmtDT(escalaState.max)}
     <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;">${chips}</div>${inelNote}`;

  const body = rows.map((r, i) => `<tr>
      <td>${esc(r.nome)}${r.qtd > 1 ? ` <span style="color:var(--muted);">(${r.qtd}x)</span>` : ''}</td>
      <td style="white-space:nowrap;">${fmtDT(r.ini)} → ${fmtDT(r.fim)}</td>
      <td class="r">${r.liquidados}</td>
      <td class="r">${r.inelegiveis}</td>
      <td class="r">${fmtBRL(r.recebida)}</td>
      <td class="r"><strong style="color:var(--orange);">${fmtBRL(r.pagar)}</strong></td>
      <td class="r" style="font-size:11px;line-height:1.6;white-space:nowrap;">${r.responsaveis && r.responsaveis.length > 1 ? r.responsaveis.map(p => `${esc(p.nome)}: <strong>${fmtBRL(p.valor)}</strong>${p.pct != null ? ` <span style="color:var(--muted);">(${p.pct}%)</span>` : ''}`).join('<br>') : '—'}</td>
      <td class="r" style="white-space:nowrap;"><button class="btn-sm" onclick="reportRow(${i},'img')">Img</button> <button class="btn-sm" onclick="reportRow(${i},'pdf')">PDF</button></td>
    </tr>`).join('');
  const totRecebida = rows.reduce((s, r) => s + r.recebida, 0);
  const totalRow = `<tr style="border-top:2px solid var(--border);">
      <td colspan="4" style="text-align:right;padding:12px 8px;font-weight:800;">TOTAL A PAGAR</td>
      <td class="r" style="padding:12px 8px;font-weight:700;">${fmtBRL(totRecebida)}</td>
      <td class="r" style="padding:12px 8px;"><strong style="color:var(--orange);font-size:16px;">${fmtBRL(totPagar)}</strong></td>
      <td></td><td></td>
    </tr>`;
  document.getElementById('escalaResults').innerHTML =
    `<div style="overflow-x:auto;"><table class="escala-table">
      <thead><tr><th>Responsável</th><th>Turno</th><th class="r">Liq.</th><th class="r">Inel.</th><th class="r">Recebida</th><th class="r">A pagar</th><th class="r">P/ creator</th><th></th></tr></thead>
      <tbody>${body}${totalRow}</tbody></table></div>`;

  // detalhes dos pedidos: cada pedido com o responsável do turno que o cobre
  lastTurnoOrders = escalaState.orders.map(o => {
    const dt = orderDT(o);
    const cov = rows.filter(r => dt >= r.ini && dt <= r.fim);
    return Object.assign({}, o, { _resp: cov.length === 1 ? cov[0].nome : (cov.length > 1 ? '⚠ vários' : '') });
  });
  ordDetailSort = { key: 'status', dir: 'asc' }; // padrão: Liquidado -> Cancelado -> ... + data
  const ds = document.getElementById('ordersDetailSearch'); if (ds) ds.value = '';
  const respSel = document.getElementById('ordersDetailResp');
  if (respSel) {
    const names = [...new Set(rows.map(r => r.nome))];
    respSel.innerHTML = '<option value="">Todos os responsáveis</option>' +
      names.map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`).join('');
  }
  renderOrdersDetail();
}

// ---- Relatório geral (consolidado da live) ----
function reportGeralData() {
  const rows = escalaState.results || [];
  const host = (document.getElementById('fechAccountSearch') || {}).value || '';
  return {
    liveName: `Live ${host}`.trim(), host,
    periodo: `${fmtDT(escalaState.liveIni)} → ${fmtDT(escalaState.liveFim)}`,
    pct: escalaState.pct,
    totalPagar: rows.reduce((s, r) => s + r.pagar, 0),
    totalRecebida: rows.reduce((s, r) => s + r.recebida, 0),
    totLiq: rows.reduce((s, r) => s + r.liquidados, 0),
    totInel: rows.reduce((s, r) => s + r.inelegiveis, 0),
    statusDist: statusBreakdown(escalaState.orders),
    turnos: rows.map(r => ({ nome: r.nome, turnoStr: `${fmtDT(r.ini)} → ${fmtDT(r.fim)}`, pagar: r.pagar, porCreator: r.porCreator, qtd: r.qtd }))
  };
}
async function baixarGeral(kind) {
  if (!(escalaState.results || []).length) { toast('err', 'Calcule a escala primeiro.'); return; }
  const g = reportGeralData();
  const blob = kind === 'pdf' ? await pdfGeralBlob(g) : await imagemGeralBlob(g);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (g.liveName || 'live').replace(/[^\p{L}\p{N}-]+/gu, '_');
  a.href = url; a.download = `fechamento_geral_${slug}.${kind === 'pdf' ? 'pdf' : 'png'}`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function imagemGeralBlob(g) {
 return new Promise(resolve => {
  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brand = brandHex();
  const W = 1080, PAD = 90, rowH = 82;
  const distN = (g.statusDist && g.statusDist.items.length) || 0;
  const H = 640 + g.turnos.length * rowH + 140 + (distN ? distN * 42 + 130 : 0);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = brand; ctx.fillRect(0, 0, W, 12);
  const divider = yy => { ctx.strokeStyle = '#ececf0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(PAD, yy); ctx.lineTo(W - PAD, yy); ctx.stroke(); };
  let y = 240;
  ctx.textAlign = 'left'; ctx.fillStyle = '#1a1a1e'; ctx.font = '700 42px system-ui, sans-serif'; ctx.fillText(g.liveName, PAD, y);
  y += 40; ctx.fillStyle = '#8a8a92'; ctx.font = '400 26px system-ui, sans-serif'; ctx.fillText(g.periodo, PAD, y);
  y += 46; divider(y);
  y += 78; ctx.fillStyle = '#8a8a92'; ctx.font = '700 26px system-ui, sans-serif'; ctx.fillText(`TOTAL A PAGAR · repasse ${g.pct}%`, PAD, y);
  y += 104; ctx.fillStyle = brand; ctx.font = '800 100px system-ui, sans-serif'; ctx.fillText(fmtBRL(g.totalPagar), PAD, y);
  y += 44; ctx.fillStyle = '#8a8a92'; ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText(`Recebida ${fmtBRL(g.totalRecebida)} · ${g.statusDist ? g.statusDist.total : 0} pedidos no total`, PAD, y);
  y += 44; divider(y);
  // distribuição de status (contagem + %)
  const dist = g.statusDist;
  if (dist && dist.items.length) {
    y += 52; ctx.fillStyle = '#8a8a92'; ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('STATUS DOS PEDIDOS', PAD, y);
    dist.items.forEach(s => {
      y += 42;
      ctx.fillStyle = s.hex; ctx.beginPath(); ctx.arc(PAD + 9, y - 8, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1a1a1e'; ctx.font = '600 25px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(s.label, PAD + 32, y);
      ctx.textAlign = 'right'; ctx.font = '700 25px system-ui, sans-serif';
      ctx.fillText(`${s.n}  ·  ${pct1(s.pct)}`, W - PAD, y);
      ctx.textAlign = 'left';
    });
    if (dist.inelegiveis > 0) {
      y += 36; ctx.fillStyle = '#b0b0b6'; ctx.font = '400 19px system-ui, sans-serif';
      ctx.fillText(`Inelegíveis (${dist.inelegiveis}) = Cancelados + Devoluções — não geram comissão`, PAD, y);
    }
    y += 44; divider(y);
  }
  y += 54; ctx.fillStyle = '#8a8a92'; ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('RESPONSÁVEL', PAD, y); ctx.textAlign = 'right'; ctx.fillText('A PAGAR', W - PAD, y); ctx.textAlign = 'left';
  g.turnos.forEach(t => {
    y += rowH;
    ctx.fillStyle = '#1a1a1e'; ctx.font = '700 30px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(t.nome + (t.qtd > 1 ? ` (${t.qtd}x)` : ''), PAD, y);
    ctx.fillStyle = '#8a8a92'; ctx.font = '400 22px system-ui, sans-serif'; ctx.fillText(t.turnoStr, PAD, y + 28);
    ctx.textAlign = 'right'; ctx.fillStyle = brand; ctx.font = '800 34px system-ui, sans-serif'; ctx.fillText(fmtBRL(t.pagar), W - PAD, y);
    if (t.qtd > 1) { ctx.fillStyle = '#8a8a92'; ctx.font = '400 20px system-ui, sans-serif'; ctx.fillText(`${fmtBRL(t.porCreator)} p/ creator`, W - PAD, y + 26); }
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#f2f2f5'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, y + 46); ctx.lineTo(W - PAD, y + 46); ctx.stroke();
  });
  y += 70; ctx.fillStyle = '#b0b0b6'; ctx.font = '400 22px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${brandName()} · gerado em ${new Date().toLocaleString('pt-BR')}`, PAD, y);
  const finalH = y + 40;
  const exportar = () => { const out = document.createElement('canvas'); out.width = W; out.height = finalH; out.getContext('2d').drawImage(canvas, 0, 0); out.toBlob(b => resolve(b), 'image/png'); };
  const drawName = () => { ctx.textAlign = 'left'; ctx.fillStyle = '#1a1a1e'; ctx.font = '900 60px system-ui, sans-serif'; ctx.fillText(brandName(), PAD, 158); };
  const logoUrl = tenantLogo();
  if (logoUrl) { const img = new Image(); img.onload = () => { const h = 54, w = img.width * (h / img.height); try { ctx.filter = 'brightness(0)'; } catch (e) {} ctx.drawImage(img, PAD, 104, w, h); ctx.filter = 'none'; exportar(); }; img.onerror = () => { drawName(); exportar(); }; img.src = logoUrl; }
  else { drawName(); exportar(); }
 });
}
function pdfGeralBlob(g) {
 return new Promise(resolve => {
  const fmtBRL = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const orange = hexToRgb(brandHex());
  const logoUrl = tenantLogo();
  const render = (img) => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    if (img) { const h = 12, w = img.width * (h / img.height); doc.addImage(blackLogoDataURL(img) || logoUrl, 'PNG', 20, 16, w, h); }
    else { doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(26); doc.text(brandName(), 20, 25); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(26); doc.text(g.liveName, 20, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120); doc.text(pdfSafe(g.periodo), 20, 47);
    doc.setDrawColor(220); doc.line(20, 52, 190, 52);
    doc.setFontSize(10); doc.setTextColor(120); doc.text(`TOTAL A PAGAR · repasse ${g.pct}%`, 20, 62);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...orange); doc.text(fmtBRL(g.totalPagar), 20, 74);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text(`Recebida ${fmtBRL(g.totalRecebida)} · ${g.statusDist ? g.statusDist.total : 0} pedidos no total`, 20, 81);
    doc.setDrawColor(220); doc.line(20, 86, 190, 86);
    let y = 95;
    // distribuição de status (contagem + %)
    const dist = g.statusDist;
    if (dist && dist.items.length) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120); doc.text('STATUS DOS PEDIDOS', 20, y); y += 7;
      dist.items.forEach(s => {
        const rgb = hexToRgb(s.hex);
        doc.setFillColor(...rgb); doc.circle(22, y - 1.4, 1.6, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40); doc.text(pdfSafe(s.label), 27, y);
        doc.setFont('helvetica', 'bold'); doc.text(`${s.n}   ${pct1(s.pct)}`, 190, y, { align: 'right' });
        y += 6.5;
      });
      if (dist.inelegiveis > 0) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`Inelegiveis (${dist.inelegiveis}) = Cancelados + Devolucoes - nao geram comissao`, 20, y); y += 5;
      }
      doc.setDrawColor(220); doc.line(20, y + 1, 190, y + 1); y += 10;
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text('RESPONSÁVEL', 20, y); doc.text('TURNO', 85, y); doc.text('A PAGAR', 190, y, { align: 'right' }); y += 7;
    g.turnos.forEach(t => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30); doc.text(t.nome + (t.qtd > 1 ? ` (${t.qtd}x)` : ''), 20, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110); doc.text(pdfSafe(t.turnoStr), 85, y);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...orange); doc.text(fmtBRL(t.pagar), 190, y, { align: 'right' });
      y += 8;
    });
    resolve(doc.output('blob'));
  };
  if (logoUrl) { const img = new Image(); img.onload = () => render(img); img.onerror = () => render(null); img.src = logoUrl; }
  else render(null);
 });
}

function reportDataRow(r) {
  const orders = (escalaState.orders || [])
    .filter(o => { const dt = orderDT(o); return dt >= r.ini && dt <= r.fim; })
    .sort((a, b) => { // status (Liquidado -> Cancelado -> ...) e depois data
      const sa = STATUS_ORDER[granularStatus(a)] ?? 9, sb = STATUS_ORDER[granularStatus(b)] ?? 9;
      if (sa !== sb) return sa - sb;
      const da = orderDT(a), db = orderDT(b);
      return da < db ? -1 : da > db ? 1 : 0;
    })
    .map(o => ({
      product: (o.product_name || '-'), store: o.store_name || '',
      status: GRAN_LABEL[granularStatus(o)] || '', receb: Number(o.received_commission) || 0
    }));
  return {
    creator: r.nome, periodo: periodoDe(r.ini, r.fim),
    turnoStr: `${fmtDT(r.ini)} → ${fmtDT(r.fim)}`,
    comissao: r.pagar, liquidados: r.liquidados, inelegiveis: r.inelegiveis, qty: r.qtd,
    orders
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
  if (!rows.length) { toast('err', 'Calcule a escala primeiro.'); return; }
  const ext = kind === 'pdf' ? 'pdf' : 'png';
  if (typeof JSZip === 'undefined') { // fallback: um a um
    for (let i = 0; i < rows.length; i++) { reportRow(i, kind); await new Promise(r => setTimeout(r, 800)); }
    return;
  }
  toast('ok', `Gerando ${rows.length} relatório(s)...`);
  const zip = new JSZip();
  for (let i = 0; i < rows.length; i++) {
    const d = reportDataRow(rows[i]);
    const blob = kind === 'pdf' ? await pdfBlob(d) : await imagemBlob(d);
    zip.file(`${String(i + 1).padStart(2, '0')}_${nomeArquivo(d, ext)}`, blob);
  }
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url; a.download = `fechamento_${(escalaState.liveIni || '').slice(0, 10)}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('ok', `Pronto! ${rows.length} relatório(s) no ZIP (pasta).`);
}

// abre o modal de salvar (pede nome da live)
let _conflictIds = [];
function salvarEscala() {
  if (!(escalaState.results || []).length) { toast('err', 'Calcule a escala primeiro.'); return; }
  const host = (document.getElementById('fechAccountSearch') || {}).value || '';
  const nome = document.getElementById('saveLiveName');
  const [y, mo, dia] = (escalaState.liveIni || '').slice(0, 10).split('-');
  if (nome && !nome.value) nome.value = `Live ${host} ${dia || ''}/${mo || ''}`.trim();
  document.getElementById('saveMeta').textContent =
    `Host: ${host} · ${fmtDT(escalaState.liveIni)} → ${fmtDT(escalaState.liveFim)} · ${escalaState.results.length} turno(s)`;
  document.getElementById('saveConflito').innerHTML = '';
  document.getElementById('saveModal').style.display = 'flex';
  setTimeout(() => nome && nome.focus(), 30);
}
function closeSaveModal() { document.getElementById('saveModal').style.display = 'none'; }

async function confirmSaveLive(force) {
  const name = (document.getElementById('saveLiveName').value || '').trim();
  const conf = document.getElementById('saveConflito');
  if (!name) { conf.innerHTML = sbBanner('err', '⚠', 'Dê um nome pra live.'); return; }
  const s = escalaState;
  if (!force) {
    // conflito: mesmo Creator Host + sobreposição de horário (uma conta não tem 2 lives ao mesmo tempo)
    const { data: conflicts } = await sb.from('lives').select('id,name,start_dt,end_dt')
      .eq('account_id', s.accountId).lt('start_dt', s.liveFim).gt('end_dt', s.liveIni);
    if (conflicts && conflicts.length) {
      _conflictIds = conflicts.map(c => c.id);
      conf.innerHTML = sbBanner('err', '⚠',
        `Esse Creator Host já tem live salva nesse horário: ${conflicts.map(c => `"${esc(c.name)}" (${fmtDT(c.start_dt)}→${fmtDT(c.end_dt)})`).join(', ')}.`)
        + `<div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">
             <button class="btn-ghost" onclick="closeSaveModal()">Cancelar e ajustar horários</button>
             <button class="btn-primary" onclick="excluirEConfirmar()">Excluir a existente e salvar</button>
           </div>`;
      return;
    }
  }
  await doSaveLive(name);
}
async function excluirEConfirmar() {
  if (_conflictIds.length) await sb.from('lives').delete().in('id', _conflictIds);
  _conflictIds = [];
  confirmSaveLive(true);
}
async function doSaveLive(name) {
  const s = escalaState;
  const uid = await myUid();
  const auxEmails = [...new Set((s.results || []).flatMap(r => r.auxiliar_emails || []))];
  const { error } = await sb.from('lives').insert({
    agency_id: agencyId(), owner_id: uid, account_id: s.accountId,
    name, start_dt: s.liveIni, end_dt: s.liveFim, pct: s.pct, turnos: s.results,
    auxiliar_emails: auxEmails.length ? auxEmails : null
  });
  if (error) { document.getElementById('saveConflito').innerHTML = sbBanner('err', '⚠', 'Erro ao salvar: ' + error.message); return; }
  closeSaveModal();
  toast('ok', `Fechamento "${name}" salvo.`);
}
