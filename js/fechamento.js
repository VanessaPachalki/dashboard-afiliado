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

// minutos do dia (hora*60+min) -> "HH:MM"
function fmtMinToHHMM(tot) {
  if (tot == null || !isFinite(tot)) return '--:--';
  const h = Math.floor(tot / 60), m = tot % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
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

// ===== INIT =====

async function initFechamento() {
  let accQ = sb.from('accounts').select('id, name, email').order('name');
  if (agencyId()) accQ = accQ.eq('agency_id', agencyId());
  const { data: accounts } = await accQ;

  allAccountsList = accounts || [];

  const sellerAccSel = document.getElementById('sellerAccount');
  const fechAccSel = document.getElementById('fechAccount');

  const opts = allAccountsList.map(a =>
    `<option value="${escAttr(a.id)}">${esc(a.name)} (${esc(a.email)})</option>`
  ).join('');

  sellerAccSel.innerHTML = '<option value="">Selecione a conta</option>' + opts;
  fechAccSel.innerHTML = '<option value="">Selecione</option>' + opts;

  await loadSellers();
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
    account_id: accountId, name, commission_pct: pct, agency_id: agencyId()
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
  document.getElementById('resultSummary').innerHTML = `
    <div class="callout">
      <strong>${esc(seller.name)}</strong> &mdash;
      ${fmtDate(start)} a ${fmtDate(end)} &mdash;
      turno <strong>${turnoStr}</strong> &mdash;
      <strong>${orders.length}</strong> de ${totalPeriodo} pedidos do período
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px;">
      <div class="kpi"><div class="kpi-v" style="color:var(--green);">${liquidados.length}</div><div class="kpi-l">Liquidados</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#9B59B6;">${cancelamentos.length}</div><div class="kpi-l">Cancelados</div></div>
      <div class="kpi"><div class="kpi-v" style="color:var(--red);">${devolucoes.length}</div><div class="kpi-l">Devoluções</div></div>
      <div class="kpi"><div class="kpi-v" style="color:var(--cream);">${itensDevolvidos}</div><div class="kpi-l">Itens Reembolsados</div></div>
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

  // Scroll to result
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
