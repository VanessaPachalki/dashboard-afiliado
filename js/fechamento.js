// ================================================
// SPACEHUB - Fechamento de Comissões (Admin only)
// ================================================

const STATUS_LABELS = { 0: 'Liquidado', 1: 'Inelegível', 2: 'Pendente', 3: 'Aguardando Pagamento' };
const STATUS_COLORS = { 0: 'var(--green)', 1: 'var(--red)', 2: 'var(--cream)', 3: 'var(--muted)' };

let allSellers = [];
let allAccountsList = [];
let foundLives = [];    // { content_id, date, hour, order_count, gmv }
let fetchedOrders = []; // all orders for the selected period+account+lives

// ===== INIT =====

async function initFechamento() {
  const { data: accounts } = await sb
    .from('accounts')
    .select('id, name, email')
    .order('name');

  allAccountsList = accounts || [];

  const sellerAccSel = document.getElementById('sellerAccount');
  const fechAccSel = document.getElementById('fechAccount');

  const opts = allAccountsList.map(a =>
    `<option value="${escAttr(a.id)}">${esc(a.name)} (${esc(a.email)})</option>`
  ).join('');

  sellerAccSel.innerHTML = '<option value="">Selecione a conta</option>' + opts;
  fechAccSel.innerHTML = '<option value="">Conta</option>' + opts;

  await loadSellers();
}

// ===== SELLERS CRUD =====

async function loadSellers() {
  const { data, error } = await sb
    .from('sellers')
    .select('*, accounts(name)')
    .order('created_at', { ascending: false });

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
  const pct = parseFloat(document.getElementById('sellerPct').value);
  const msg = document.getElementById('sellerMsg');

  if (!accountId) { msg.className = 'msg msg-err'; msg.textContent = 'Selecione uma conta.'; return; }
  if (!name) { msg.className = 'msg msg-err'; msg.textContent = 'Digite o nome do vendedor.'; return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { msg.className = 'msg msg-err'; msg.textContent = 'Comissão deve ser entre 0 e 100%.'; return; }

  const { error } = await sb.from('sellers').insert({
    account_id: accountId,
    name,
    commission_pct: pct
  });

  if (error) {
    msg.className = 'msg msg-err';
    msg.textContent = 'Erro: ' + error.message;
    return;
  }

  msg.className = 'msg msg-ok';
  msg.textContent = `Vendedor "${name}" adicionado.`;
  document.getElementById('sellerName').value = '';
  document.getElementById('sellerPct').value = '';
  await loadSellers();
}

async function removeSeller(id, name) {
  if (!confirm(`Remover vendedor "${name}"?`)) return;
  await sb.from('sellers').delete().eq('id', id);
  await loadSellers();
}

function onSellerAccountChange() {
  // nothing extra needed for now
}

// ===== FECHAMENTO FLOW =====

function onFechAccountChange() {
  const accountId = document.getElementById('fechAccount').value;
  const sellerSel = document.getElementById('fechSeller');

  const sellers = allSellers.filter(s => s.account_id === accountId);
  sellerSel.innerHTML = '<option value="">Vendedor</option>' +
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
  const { data: orders, error } = await sb
    .from('orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('content_type', 0)
    .gte('order_date', start)
    .lte('order_date', end)
    .order('order_date', { ascending: true });

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
        hours: new Set(),
        order_count: 0,
        gmv: 0,
        store_name: o.store_name
      };
    }
    liveMap[key].dates.add(o.order_date);
    liveMap[key].hours.add(o.hour);
    liveMap[key].order_count++;
    liveMap[key].gmv += parseFloat(o.gmv);
  });

  foundLives = Object.values(liveMap).sort((a, b) => {
    const dateA = [...a.dates].sort()[0];
    const dateB = [...b.dates].sort()[0];
    return dateA.localeCompare(dateB);
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
  document.getElementById('checkAll').checked = false;

  list.innerHTML = foundLives.map((l, i) => {
    const dates = [...l.dates].sort();
    const dateStr = dates.map(d => {
      const [y, m, day] = d.split('-');
      return `${day}/${m}`;
    }).join(', ');
    const hours = [...l.hours].sort((a, b) => a - b);
    const hourStr = hours.length <= 3
      ? hours.map(h => `${h}h`).join(', ')
      : `${hours[0]}h - ${hours[hours.length - 1]}h`;
    const typeLabel = CONTENT_LABELS[l.content_type] || '?';
    const tagClass = CONTENT_TAG_CLASS[l.content_type] || 'tag-l';

    return `<label class="live-item" style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor='var(--orange)'" onmouseout="this.style.borderColor='var(--border)'">
      <input type="checkbox" class="live-check" data-idx="${i}" style="accent-color:var(--orange);width:16px;height:16px;">
      <span class="tag ${tagClass}">${typeLabel}</span>
      <span style="flex:1;">
        <strong style="color:var(--text);font-size:12px;">${esc(l.content_id)}</strong>
        <span style="color:var(--muted);font-size:11px;margin-left:8px;">${esc(l.store_name)}</span>
      </span>
      <span style="font-size:11px;color:var(--muted);">${dateStr} &middot; ${hourStr}</span>
      <span style="font-size:12px;font-weight:600;color:var(--text);">${l.order_count} pedidos</span>
      <span style="font-size:12px;font-weight:700;color:var(--orange);">R$ ${l.gmv.toFixed(2).replace('.', ',')}</span>
    </label>`;
  }).join('');
}

function toggleAll() {
  const checked = document.getElementById('checkAll').checked;
  document.querySelectorAll('.live-check').forEach(cb => { cb.checked = checked; });
}

// ===== CALCULATE =====

function calcularFechamento() {
  const sellerId = document.getElementById('fechSeller').value;
  const seller = allSellers.find(s => s.id === sellerId);
  if (!seller) return;

  const selectedIdxs = [];
  document.querySelectorAll('.live-check:checked').forEach(cb => {
    selectedIdxs.push(parseInt(cb.dataset.idx));
  });

  if (!selectedIdxs.length) {
    const msg = document.getElementById('fechMsg');
    msg.className = 'msg msg-err';
    msg.textContent = 'Selecione pelo menos uma live/conteúdo.';
    return;
  }

  // Get content_ids of selected lives
  const selectedContentIds = new Set(selectedIdxs.map(i => foundLives[i].content_id));

  // Filter orders to only selected content_ids
  const orders = fetchedOrders.filter(o => selectedContentIds.has(o.content_id));

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
  const comissaoEstimada = orders.reduce((s, o) => s + parseFloat(o.estimated_commission), 0);

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
  document.getElementById('resultSummary').innerHTML = `
    <div class="callout">
      <strong>${esc(seller.name)}</strong> &mdash;
      ${fmtDate(start)} a ${fmtDate(end)} &mdash;
      ${selectedIdxs.length} conteúdo(s) selecionado(s) &mdash;
      ${orders.length} pedidos totais
    </div>
  `;

  // Status breakdown
  const fmt = v => 'R$ ' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace('.', ',').replace(/,(\d{2})$/, ',$1');
  // Fix the formatting
  const fmtBRL = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  document.getElementById('statusBreakdown').innerHTML = `
    <table style="width:100%;font-size:12px;">
      <tr>
        <td><span style="color:${STATUS_COLORS[0]};">&#9679;</span> Liquidados</td>
        <td class="r"><strong>${liquidados.length}</strong> pedidos</td>
        <td class="r" style="color:${STATUS_COLORS[0]};font-weight:700;">${fmtBRL(gmvLiq)}</td>
      </tr>
      <tr>
        <td><span style="color:var(--red);">&#9679;</span> Devoluções <span style="font-size:10px;color:var(--muted);">(recebeu e devolveu)</span></td>
        <td class="r"><strong>${devolucoes.length}</strong> pedidos</td>
        <td class="r" style="color:var(--red);font-weight:700;">${fmtBRL(gmvDevol)}</td>
      </tr>
      <tr>
        <td><span style="color:#9B59B6;">&#9679;</span> Cancelamentos <span style="font-size:10px;color:var(--muted);">(cancelou antes de receber)</span></td>
        <td class="r"><strong>${cancelamentos.length}</strong> pedidos</td>
        <td class="r" style="color:#9B59B6;font-weight:700;">${fmtBRL(gmvCancel)}</td>
      </tr>
      <tr>
        <td><span style="color:${STATUS_COLORS[2]};">&#9679;</span> Pendentes</td>
        <td class="r"><strong>${pendentes.length}</strong> pedidos</td>
        <td class="r" style="color:${STATUS_COLORS[2]};font-weight:700;">${fmtBRL(gmvPend)}</td>
      </tr>
      <tr>
        <td><span style="color:${STATUS_COLORS[3]};">&#9679;</span> Aguardando Pagamento</td>
        <td class="r"><strong>${aguardando.length}</strong> pedidos</td>
        <td class="r" style="color:${STATUS_COLORS[3]};font-weight:700;">${fmtBRL(gmvAguard)}</td>
      </tr>
      <tr style="border-top:2px solid var(--border);">
        <td><strong>Total</strong></td>
        <td class="r"><strong>${orders.length}</strong> pedidos</td>
        <td class="r" style="font-weight:700;">${fmtBRL(gmvTotal)}</td>
      </tr>
    </table>
    <div style="margin-top:12px;font-size:11px;color:var(--muted);">
      Itens vendidos: <strong style="color:var(--text);">${itensVendidos}</strong> &mdash;
      Itens devolvidos: <strong style="color:var(--red);">${itensDevolvidos}</strong>
      ${itensVendidos > 0 ? `(${((itensDevolvidos / itensVendidos) * 100).toFixed(1)}% de devolução)` : ''}
    </div>
  `;

  // Commission result
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

      ${comissaoEstimada > comissaoRecebida ? `
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px;">
        <div style="font-size:11px;color:var(--cream);">
          Comissão estimada pendente: <strong>${fmtBRL(comissaoEstimada - comissaoRecebida)}</strong>
        </div>
      </div>` : ''}
    </div>
  `;

  // Order tables
  renderOrderTable('tLiquidados', liquidados, 'liquidado');
  renderOrderTable('tDevolucoes', devolucoes, 'devolucao');
  renderOrderTable('tCancelamentos', cancelamentos, 'cancelamento');
  renderOrderTable('tPendentes', [...pendentes, ...aguardando], 'pendente');

  // Scroll to result
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderOrderTable(tbodyId, orders, type) {
  const tb = document.getElementById(tbodyId);
  if (!orders.length) {
    const cols = type === 'liquidado' ? 6 : 6;
    tb.innerHTML = `<tr><td colspan="${cols}" style="color:var(--muted);text-align:center;">Nenhum pedido.</td></tr>`;
    return;
  }

  const fmtBRL = v => parseFloat(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = d => { const [y, m, day] = d.split('-'); return `${day}/${m}/${y}`; };

  if (type === 'liquidado') {
    tb.innerHTML = orders.map(o => `<tr>
      <td style="font-size:11px;">${esc(o.tiktok_order_id)}</td>
      <td>${fmtDate(o.order_date)} ${o.hour}h</td>
      <td>${esc(o.product_name)}</td>
      <td style="font-size:11px;">${esc(o.store_name)}</td>
      <td class="r" style="font-weight:600;">${fmtBRL(o.gmv)}</td>
      <td class="r good" style="font-weight:700;">${fmtBRL(o.received_commission)}</td>
    </tr>`).join('');
  } else if (type === 'devolucao') {
    tb.innerHTML = orders.map(o => `<tr>
      <td style="font-size:11px;">${esc(o.tiktok_order_id)}</td>
      <td>${fmtDate(o.order_date)} ${o.hour}h</td>
      <td>${esc(o.product_name)}</td>
      <td style="font-size:11px;">${esc(o.store_name)}</td>
      <td class="r" style="font-weight:600;">${fmtBRL(o.gmv)}</td>
      <td class="r bad" style="font-weight:700;">${o.items_refunded}</td>
    </tr>`).join('');
  } else if (type === 'cancelamento') {
    tb.innerHTML = orders.map(o => `<tr>
      <td style="font-size:11px;">${esc(o.tiktok_order_id)}</td>
      <td>${fmtDate(o.order_date)} ${o.hour}h</td>
      <td>${esc(o.product_name)}</td>
      <td style="font-size:11px;">${esc(o.store_name)}</td>
      <td class="r" style="font-weight:600;">${fmtBRL(o.gmv)}</td>
      <td class="r" style="color:#9B59B6;font-weight:700;">${fmtBRL(o.estimated_commission)}</td>
    </tr>`).join('');
  } else {
    tb.innerHTML = orders.map(o => {
      const label = STATUS_LABELS[o.settlement_status] || '?';
      const color = STATUS_COLORS[o.settlement_status] || 'var(--muted)';
      return `<tr>
        <td style="font-size:11px;">${esc(o.tiktok_order_id)}</td>
        <td>${fmtDate(o.order_date)} ${o.hour}h</td>
        <td>${esc(o.product_name)}</td>
        <td style="font-size:11px;">${esc(o.store_name)}</td>
        <td class="r" style="font-weight:600;">${fmtBRL(o.gmv)}</td>
        <td style="color:${color};font-weight:600;font-size:11px;">${label}</td>
      </tr>`;
    }).join('');
  }
}
