// ================================================
// SPACEHUB - Fechamento por PRODUTO
// Reaproveita helpers de js/fechamento.js (carregado antes):
//   esc, escAttr, agencyId, sb, orderDT, fmtDT, granularStatus,
//   statusBreakdown, GRAN_CARDS, GRAN_LABEL, STATUS_HEX, STATUS_COLOR,
//   pct1, brandName, brandHex, hexToRgb, tenantLogo, blackLogoDataURL,
//   pdfSafe, toast, initFechamento (accounts + auxByName), auxByName
// ================================================

let fpState = {
  accountId: '',       // '' => todos os creators da agência
  hostName: '',        // texto do creator host (só rótulo)
  from: '', to: '',    // "YYYY-MM-DD"
  orders: [],          // todos os pedidos do período (todos os content_types)
  products: [],        // [{name, count, gmv, recebida}] agregados
  selected: new Set(), // product_name selecionados
  resp: [],            // [{nome, aux_id, aux_email, pct}]
  pct: 0,              // % de repasse (0 = sem repasse)
  result: null,        // snapshot do cálculo
  detail: []           // pedidos filtrados (tabela de detalhes)
};

const FP_CONTENT = { 0: 'Live', 1: 'Vídeo', 2: 'Link', 3: 'Vitrine' };
const fpBRL = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fpDate = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };

async function initFechamentoProduto() {
  // popula allAccountsList (combo) + auxByName (autocomplete de responsável)
  await initFechamento();
  // padrão: mês corrente até hoje
  const today = new Date();
  const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const fromEl = document.getElementById('fpFrom'), toEl = document.getElementById('fpTo');
  if (fromEl && !fromEl.value) fromEl.value = iso(first);
  if (toEl && !toEl.value) toEl.value = iso(today);
}

function fpMsg(cls, txt) {
  const el = document.getElementById('fpMsg');
  if (!el) return;
  el.className = 'msg' + (cls ? ' msg-' + cls : '');
  el.textContent = txt || '';
}

function fpWizardGo(n) {
  document.getElementById('fpwpanel1').style.display = n === 1 ? '' : 'none';
  document.getElementById('fpwpanel2').style.display = n === 2 ? '' : 'none';
  document.getElementById('fpws1').classList.toggle('active', n === 1);
  document.getElementById('fpws2').classList.toggle('active', n === 2);
  window.scrollTo(0, 0);
}

// ===== PASSO 1: carrega pedidos do período e lista os produtos =====

async function fpCarregar() {
  const accId = document.getElementById('fechAccount').value;
  const hostName = (document.getElementById('fechAccountSearch') || {}).value || '';
  const from = document.getElementById('fpFrom').value;
  const to = document.getElementById('fpTo').value;
  if (!from || !to) return fpMsg('err', 'Defina a data de início e de fim.');
  if (from > to) return fpMsg('err', 'A data de início deve ser antes da de fim.');

  fpMsg('', 'Carregando pedidos...');
  // Todos os tipos de conteúdo (sem filtro de content_type).
  // Paginado: sem account_id o período pode passar do teto de 1000 linhas do PostgREST.
  const all = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from('orders').select('*')
      .gte('order_date', from).lte('order_date', to)
      .order('order_date').order('id')
      .range(offset, offset + PAGE - 1);
    if (accId) q = q.eq('account_id', accId);
    if (agencyId()) q = q.eq('agency_id', agencyId());
    const { data, error } = await q;
    if (error) return fpMsg('err', 'Erro: ' + error.message);
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < PAGE) break;
    fpMsg('', `Carregando pedidos... ${all.length}`);
  }

  if (!all.length) {
    document.getElementById('fpProdBox').style.display = 'none';
    return fpMsg('err', 'Nenhum pedido nesse período.');
  }

  // agrega por product_name
  const map = {};
  all.forEach(o => {
    const k = (o.product_name || '—');
    if (!map[k]) map[k] = { name: k, count: 0, gmv: 0, estimada: 0, recebida: 0 };
    map[k].count++;
    map[k].gmv += parseFloat(o.gmv) || 0;
    map[k].estimada += parseFloat(o.estimated_commission) || 0;  // comissão da venda (todos os pedidos)
    if (o.settlement_status === 0) map[k].recebida += parseFloat(o.received_commission) || 0;
  });
  fpState = {
    ...fpState,
    accountId: accId, hostName, from, to, orders: all,
    products: Object.values(map).sort((a, b) => b.estimada - a.estimada || b.gmv - a.gmv),
    selected: new Set()
  };

  fpMsg('ok', `${all.length} pedidos · ${fpState.products.length} produtos no período.`);
  document.getElementById('fpProdBox').style.display = '';
  document.getElementById('fpProdSearch').value = '';
  fpRenderProducts();
  fpRenderResp();
}

// casa por PARTE do nome: quebra a busca em palavras e exige todas (qualquer ordem).
// ex.: "tablet e19" acha "Tablet Positivo E19 Preto".
function fpMatch(text, q) {
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const t = (text || '').toLowerCase();
  return terms.every(term => t.includes(term));
}
function fpFilteredProducts() {
  const q = (document.getElementById('fpProdSearch')?.value || '').toLowerCase().trim();
  return q ? fpState.products.filter(p => fpMatch(p.name, q)) : fpState.products;
}

function fpRenderProducts() {
  const el = document.getElementById('fpProdList');
  if (!el) return;
  const list = fpFilteredProducts();
  const shown = list.slice(0, 300);
  const body = shown.map(p => {
    const on = fpState.selected.has(p.name);
    return `<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer;${on ? 'background:var(--orange-soft);' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="fpToggleProduct(this.getAttribute('data-n'))" data-n="${escAttr(p.name)}" style="width:16px;height:16px;flex:none;">
      <span style="flex:1;min-width:0;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(p.name)}</span>
      <span style="font-size:11px;color:var(--muted);white-space:nowrap;">${p.count} ped.</span>
      <span style="font-size:11px;color:var(--orange);font-weight:700;white-space:nowrap;" title="comissão estimada">${fpBRL(p.estimada)}</span>
    </label>`;
  }).join('');
  const more = list.length > shown.length ? `<div style="padding:8px 12px;font-size:11px;color:var(--muted);">+ ${list.length - shown.length} produto(s) — refine a busca.</div>` : '';
  el.innerHTML = body + more || '<div style="padding:14px;color:var(--muted);font-size:13px;text-align:center;">Nenhum produto.</div>';

  const metaEl = document.getElementById('fpProdMeta');
  if (metaEl) metaEl.textContent = `${fpState.selected.size} selecionado(s) de ${fpState.products.length}`;
}

function fpToggleProduct(name) {
  if (fpState.selected.has(name)) fpState.selected.delete(name);
  else fpState.selected.add(name);
  fpRenderProducts();
}
function fpSelectAllFiltered() {
  fpFilteredProducts().forEach(p => fpState.selected.add(p.name));
  fpRenderProducts();
}
function fpClearSelection() {
  fpState.selected.clear();
  fpRenderProducts();
}

// ===== Responsáveis (repasse opcional) =====

function fpRespAdd(input) {
  const val = (input.value || '').trim();
  if (!val) return;
  const aux = (typeof auxByName !== 'undefined' && auxByName[val.toLowerCase()]) || null;
  fpState.resp.push({ nome: val, aux_id: aux ? aux.id : null, aux_email: aux ? aux.email : null, pct: 0 });
  input.value = '';
  fpRespRedistribute();
  fpRenderResp();
}
function fpRespRemove(i) {
  fpState.resp.splice(i, 1);
  fpRespRedistribute();
  fpRenderResp();
}
function fpRespRedistribute() {
  const n = fpState.resp.length;
  if (!n) return;
  const base = Math.floor(100 / n);
  fpState.resp.forEach(r => { r.pct = base; });
  fpState.resp[n - 1].pct = 100 - base * (n - 1);
}
function fpRespPct(i, val) {
  const p = Math.max(0, Math.min(100, parseFloat(String(val).replace(',', '.')) || 0));
  if (fpState.resp[i]) fpState.resp[i].pct = p;
  fpRenderRespSum();
}
function fpRenderResp() {
  const cell = document.getElementById('fpRespCell');
  if (!cell) return;
  const input = document.getElementById('fpRespInput');
  cell.querySelectorAll('.resp-chip').forEach(c => c.remove());
  const multi = fpState.resp.length > 1;
  fpState.resp.forEach((r, i) => {
    const chip = document.createElement('span');
    chip.className = 'resp-chip';
    const linked = !!r.aux_id;
    chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;background:${linked ? 'var(--orange-soft)' : 'var(--card)'};border:1px solid ${linked ? 'var(--orange)' : 'var(--border)'};border-radius:14px;padding:3px 8px;font-size:12px;`;
    chip.innerHTML =
      `${linked ? '<span style="color:var(--green);">✓</span>' : ''}<span>${esc(r.nome)}</span>` +
      (multi ? ` <input class="resp-pct" type="text" inputmode="decimal" value="${r.pct}" onchange="fpRespPct(${i},this.value)" style="width:36px;text-align:center;border:1px solid var(--border);border-radius:6px;padding:1px 3px;font-size:11px;background:var(--bg);color:var(--text);"><span style="color:var(--muted);">%</span>` : '') +
      ` <span onclick="fpRespRemove(${i})" style="cursor:pointer;color:var(--muted);font-weight:700;">×</span>`;
    cell.insertBefore(chip, input);
  });
  fpRenderRespSum();
}
function fpRenderRespSum() {
  const el = document.getElementById('fpRespSum');
  if (!el) return;
  if (fpState.resp.length > 1) {
    const sum = fpState.resp.reduce((s, r) => s + (Number(r.pct) || 0), 0);
    el.textContent = sum === 100 ? '' : `soma ${sum}% (tem que dar 100%)`;
    el.style.color = sum === 100 ? 'var(--muted)' : 'var(--red)';
  } else el.textContent = '';
}

// ===== PASSO 2: cálculo =====

function fpCalcular() {
  if (!fpState.selected.size) return fpMsg('err', 'Selecione ao menos um produto.');
  const orders = fpState.orders.filter(o => fpState.selected.has(o.product_name || '—'));
  if (!orders.length) return fpMsg('err', 'Nenhum pedido nos produtos selecionados.');

  // agrega por produto (guarda os pedidos de cada um pra montar o breakdown de status)
  const map = {};
  orders.forEach(o => {
    const k = o.product_name || '—';
    if (!map[k]) map[k] = { name: k, count: 0, gmv: 0, estimada: 0, recebida: 0, pendente: 0, liq: 0, inel: 0, itens: 0, _orders: [] };
    const g = map[k];
    g._orders.push(o);
    g.count++;
    g.gmv += parseFloat(o.gmv) || 0;
    g.itens += Number(o.items_sold) || 0;
    g.estimada += parseFloat(o.estimated_commission) || 0;  // comissão da venda (todos os pedidos)
    const st = granularStatus(o);
    if (o.settlement_status === 0) { g.recebida += parseFloat(o.received_commission) || 0; g.liq++; }
    if (o.settlement_status === 1) g.inel++;
    if (st === 'pendente' || st === 'aguardando' || st === 'naopago') g.pendente += parseFloat(o.estimated_commission) || 0;
  });
  const produtos = Object.values(map)
    .map(g => { g.dist = statusBreakdown(g._orders); delete g._orders; return g; })  // breakdown por produto
    .sort((a, b) => b.estimada - a.estimada || b.gmv - a.gmv);

  const estimada = produtos.reduce((s, p) => s + p.estimada, 0);
  const recebida = produtos.reduce((s, p) => s + p.recebida, 0);
  const pendente = produtos.reduce((s, p) => s + p.pendente, 0);
  const gmv = produtos.reduce((s, p) => s + p.gmv, 0);
  const pct = parseFloat((document.getElementById('fpPct').value || '').replace(',', '.')) || 0;
  const pagar = recebida * pct / 100;

  // split do repasse entre responsáveis
  const somaPct = fpState.resp.reduce((s, r) => s + (Number(r.pct) || 0), 0);
  const responsaveis = fpState.resp.map(r => ({
    ...r, valor: fpState.resp.length && somaPct === 100 ? pagar * (Number(r.pct) || 0) / 100 : pagar / (fpState.resp.length || 1)
  }));

  fpState.pct = pct;
  fpState.result = {
    produtos, orders, estimada, recebida, pendente, gmv, pct, pagar, responsaveis,
    statusDist: statusBreakdown(orders),
    total: orders.length
  };
  fpState.detail = orders;
  fpMsg('', '');
  fpRenderResults();
  fpWizardGo(2);
}

function fpRenderResults() {
  const r = fpState.result;
  if (!r) return;
  const hostStr = fpState.hostName ? esc(fpState.hostName) : 'Todos os creators';
  const bd = r.statusDist;
  const chips = bd.items.map(s =>
    `<span style="display:inline-flex;align-items:center;gap:6px;background:${s.color}1e;color:${s.color};padding:4px 11px;border-radius:20px;font-size:12px;font-weight:700;">
       <span style="width:8px;height:8px;border-radius:50%;background:${s.color};"></span>${s.label}: ${s.n} <span style="opacity:.75;font-weight:600;">${pct1(s.pct)}</span></span>`).join('');
  const repasseLine = r.pct > 0
    ? ` · repasse <strong>${r.pct}%</strong> · a pagar <strong style="color:var(--orange);">${fpBRL(r.pagar)}</strong>` : '';
  // igual ao turno: o número que vale é o LIQUIDADO (recebida); o pendente é só aviso.
  const pendWarn = r.pendente > 0
    ? sbBanner('warn', '◔', `${fpBRL(r.pendente)} em comissão ainda pendente de liquidação (estimada) — entra no valor quando o TikTok liquidar.`)
    : '';
  document.getElementById('fpResultInfo').innerHTML =
    `<strong>${fpState.selected.size}</strong> produto(s) · <strong>${hostStr}</strong> · ${fpDate(fpState.from)} a ${fpDate(fpState.to)}
     <br>comissão recebida <strong style="color:var(--green);">${fpBRL(r.recebida)}</strong>${repasseLine} · GMV ${fpBRL(r.gmv)} · ${r.total} pedidos
     <br><span style="font-size:12px;color:var(--muted);">comissão estimada total ${fpBRL(r.estimada)} · pendente ${fpBRL(r.pendente)}</span>
     <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;">${chips}</div>
     ${pendWarn ? `<div style="margin-top:10px;">${pendWarn}</div>` : ''}`;

  // tabela por produto
  const showPagar = r.pct > 0;
  const body = r.produtos.map(p => `<tr>
      <td>${esc(p.name)}</td>
      <td class="r">${p.count}</td>
      <td class="r">${p.liq}</td>
      <td class="r">${p.inel}</td>
      <td class="r">${fpBRL(p.gmv)}</td>
      <td class="r"><strong style="color:var(--green);">${fpBRL(p.recebida)}</strong></td>
      <td class="r" style="color:var(--muted);">${fpBRL(p.estimada)}</td>
      <td class="r" style="color:var(--muted);">${fpBRL(p.pendente)}</td>
      ${showPagar ? `<td class="r"><strong style="color:var(--orange);">${fpBRL(p.recebida * r.pct / 100)}</strong></td>` : ''}
    </tr>`).join('');
  const totRow = `<tr style="border-top:2px solid var(--border);font-weight:800;">
      <td>TOTAL</td>
      <td class="r">${r.total}</td>
      <td class="r">${r.produtos.reduce((s, p) => s + p.liq, 0)}</td>
      <td class="r">${r.produtos.reduce((s, p) => s + p.inel, 0)}</td>
      <td class="r">${fpBRL(r.gmv)}</td>
      <td class="r" style="color:var(--green);">${fpBRL(r.recebida)}</td>
      <td class="r" style="color:var(--muted);">${fpBRL(r.estimada)}</td>
      <td class="r" style="color:var(--muted);">${fpBRL(r.pendente)}</td>
      ${showPagar ? `<td class="r" style="color:var(--orange);">${fpBRL(r.pagar)}</td>` : ''}
    </tr>`;
  let html = `<div style="overflow-x:auto;"><table class="escala-table">
    <thead><tr><th>Produto</th><th class="r">Ped.</th><th class="r">Liq.</th><th class="r">Inel.</th><th class="r">GMV</th><th class="r">Recebida</th><th class="r" title="comissão da venda (todos os pedidos)">Estimada</th><th class="r">Pendente</th>${showPagar ? '<th class="r">A pagar</th>' : ''}</tr></thead>
    <tbody>${body}${totRow}</tbody></table></div>`;

  // repasse por responsável
  if (showPagar && r.responsaveis.length) {
    const rbody = r.responsaveis.map(p =>
      `<tr><td>${esc(p.nome)}</td><td class="r">${p.pct != null ? p.pct + '%' : '—'}</td><td class="r"><strong style="color:var(--orange);">${fpBRL(p.valor)}</strong></td></tr>`).join('');
    html += `<div style="margin-top:16px;overflow-x:auto;"><strong style="font-size:13px;">Repasse por responsável</strong>
      <table class="escala-table" style="margin-top:8px;">
        <thead><tr><th>Responsável</th><th class="r">%</th><th class="r">Valor</th></tr></thead>
        <tbody>${rbody}</tbody></table></div>`;
  }
  document.getElementById('fpResults').innerHTML = html;

  const ds = document.getElementById('fpDetailSearch'); if (ds) ds.value = '';
  const st = document.getElementById('fpDetailStatus'); if (st) st.value = '';
  fpRenderDetail();
}

// ===== detalhes dos pedidos =====

function fpRenderDetail() {
  const el = document.getElementById('fpDetail');
  if (!el) return;
  const q = (document.getElementById('fpDetailSearch')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('fpDetailStatus')?.value || '';
  let list = fpState.detail || [];
  if (statusFilter) list = list.filter(o => granularStatus(o) === statusFilter);
  if (q) list = list.filter(o => fpMatch(o.product_name || '', q) || fpMatch(o.store_name || '', q));
  // ordena por status lógico, depois data
  list = list.slice().sort((a, b) => {
    const sa = (typeof STATUS_ORDER !== 'undefined' && STATUS_ORDER[granularStatus(a)]) ?? 9;
    const sbv = (typeof STATUS_ORDER !== 'undefined' && STATUS_ORDER[granularStatus(b)]) ?? 9;
    if (sa !== sbv) return sa - sbv;
    const da = orderDT(a), db = orderDT(b);
    return da < db ? -1 : da > db ? 1 : 0;
  });

  const body = list.map((o, i) => {
    const k = granularStatus(o);
    const c = STATUS_COLOR[k] || 'var(--muted)';
    const zebra = i % 2 ? 'background:var(--bg);' : '';
    return `<tr style="border-bottom:1px solid var(--border);${zebra}">
      <td style="white-space:nowrap;padding:7px 10px;">${fmtDT(orderDT(o))}</td>
      <td style="padding:7px 10px;">${esc((o.product_name || '').slice(0, 42))}</td>
      <td style="padding:7px 10px;color:var(--muted);">${esc(o.store_name || '')}</td>
      <td style="padding:7px 10px;color:var(--muted);font-size:11px;">${FP_CONTENT[o.content_type] || '—'}</td>
      <td style="padding:7px 10px;"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:${c}22;color:${c};">${GRAN_LABEL[k] || k}</span></td>
      <td class="r" style="padding:7px 10px;color:var(--muted);">${fpBRL(o.estimated_commission)}</td>
      <td class="r" style="padding:7px 10px;font-weight:600;color:var(--green);">${fpBRL(o.received_commission)}</td>
      <td class="r" style="padding:7px 10px;">${fpBRL(o.gmv)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
    <thead><tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.3px;">
      <th style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Data/Hora</th>
      <th style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Produto</th>
      <th style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Loja</th>
      <th style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Origem</th>
      <th style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Status</th>
      <th class="r" style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Estimada</th>
      <th class="r" style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">Recebida</th>
      <th class="r" style="padding:8px 10px;position:sticky;top:0;background:var(--card);border-bottom:2px solid var(--border);">GMV</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="8" style="color:var(--muted);padding:14px;text-align:center;">Nenhum pedido.</td></tr>'}</tbody>
  </table>
  <div style="font-size:11px;color:var(--muted);margin-top:10px;">${list.length} pedido(s)</div>`;
}

// ===== export (imagem / PDF) =====

function fpReportData() {
  const r = fpState.result;
  const hostStr = fpState.hostName ? fpState.hostName : 'Todos os creators';
  return {
    title: 'Fechamento por produto',
    host: hostStr,
    periodo: `${fpDate(fpState.from)} a ${fpDate(fpState.to)}`,
    pct: r.pct, pagar: r.pagar, estimada: r.estimada, recebida: r.recebida, pendente: r.pendente,
    total: r.total, statusDist: r.statusDist,
    produtos: r.produtos.map(p => ({ name: p.name, estimada: p.estimada, recebida: p.recebida, gmv: p.gmv, count: p.count, inel: p.inel, dist: p.dist })),
    responsaveis: r.responsaveis
  };
}

async function fpBaixar(kind) {
  if (!fpState.result) { toast('err', 'Calcule primeiro.'); return; }
  const g = fpReportData();
  const blob = kind === 'pdf' ? await fpPdfBlob(g) : await fpImagemBlob(g);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (g.host || 'produtos').replace(/[^\p{L}\p{N}-]+/gu, '_');
  a.href = url; a.download = `fechamento_produto_${slug}.${kind === 'pdf' ? 'pdf' : 'png'}`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function fpImagemBlob(g) {
 return new Promise(resolve => {
  const brand = brandHex();
  const W = 1080, PAD = 90;
  const prodRows = Math.min(g.produtos.length, 40);
  const distN = (g.statusDist && g.statusDist.items.length) || 0;
  const hasPag = g.pct > 0;
  const H = 720 + prodRows * 56 + (distN ? distN * 42 + 130 : 0) + (hasPag && g.responsaveis.length ? g.responsaveis.length * 46 + 120 : 0) + 160;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = brand; ctx.fillRect(0, 0, W, 12);
  const divider = yy => { ctx.strokeStyle = '#ececf0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(PAD, yy); ctx.lineTo(W - PAD, yy); ctx.stroke(); };
  let y = 240;
  ctx.textAlign = 'left'; ctx.fillStyle = '#1a1a1e'; ctx.font = '700 42px system-ui, sans-serif'; ctx.fillText(g.title, PAD, y);
  y += 40; ctx.fillStyle = '#8a8a92'; ctx.font = '400 26px system-ui, sans-serif'; ctx.fillText(`${g.host} · ${g.periodo}`, PAD, y);
  y += 46; divider(y);
  y += 78; ctx.fillStyle = '#8a8a92'; ctx.font = '700 26px system-ui, sans-serif';
  ctx.fillText(hasPag ? `TOTAL A PAGAR · repasse ${g.pct}%` : 'COMISSÃO RECEBIDA (liquidada)', PAD, y);
  y += 104; ctx.fillStyle = brand; ctx.font = '800 100px system-ui, sans-serif';
  ctx.fillText(fpBRL(hasPag ? g.pagar : g.recebida), PAD, y);
  y += 44; ctx.fillStyle = '#8a8a92'; ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText(`Recebida ${fpBRL(g.recebida)} · estimada ${fpBRL(g.estimada)} · ${g.total} pedidos`, PAD, y);
  if (g.pendente > 0) { y += 34; ctx.fillStyle = '#D4A76A'; ctx.font = '700 22px system-ui, sans-serif'; ctx.fillText(`◔ ${fpBRL(g.pendente)} pendente de liquidação (estimada) — ainda não entra no valor`, PAD, y); }
  y += 44; divider(y);

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
    y += 44; divider(y);
  }

  y += 54; ctx.fillStyle = '#8a8a92'; ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('PRODUTO', PAD, y); ctx.textAlign = 'right'; ctx.fillText('RECEBIDA', W - PAD, y); ctx.textAlign = 'left';
  g.produtos.slice(0, 40).forEach(p => {
    y += 56;
    ctx.fillStyle = '#1a1a1e'; ctx.font = '600 26px system-ui, sans-serif'; ctx.textAlign = 'left';
    const name = p.name.length > 46 ? p.name.slice(0, 45) + '…' : p.name;
    ctx.fillText(name, PAD, y);
    ctx.fillStyle = '#8a8a92'; ctx.font = '400 20px system-ui, sans-serif'; ctx.fillText(`GMV ${fpBRL(p.gmv)} · estimada ${fpBRL(p.estimada)}`, PAD, y + 24);
    ctx.textAlign = 'right'; ctx.fillStyle = brand; ctx.font = '700 28px system-ui, sans-serif'; ctx.fillText(fpBRL(p.recebida), W - PAD, y);
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#f2f2f5'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, y + 36); ctx.lineTo(W - PAD, y + 36); ctx.stroke();
  });
  if (g.produtos.length > 40) { y += 44; ctx.fillStyle = '#b0b0b6'; ctx.font = '400 20px system-ui, sans-serif'; ctx.fillText(`+ ${g.produtos.length - 40} produto(s) — veja o detalhamento no dashboard.`, PAD, y); }

  if (hasPag && g.responsaveis.length) {
    y += 44; divider(y);
    y += 54; ctx.fillStyle = '#8a8a92'; ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('REPASSE POR RESPONSÁVEL', PAD, y);
    g.responsaveis.forEach(p => {
      y += 46;
      ctx.fillStyle = '#1a1a1e'; ctx.font = '600 26px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(p.nome + (p.pct != null ? ` (${p.pct}%)` : ''), PAD, y);
      ctx.textAlign = 'right'; ctx.fillStyle = brand; ctx.font = '700 28px system-ui, sans-serif'; ctx.fillText(fpBRL(p.valor), W - PAD, y);
      ctx.textAlign = 'left';
    });
  }

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

function fpPdfBlob(g) {
 return new Promise(resolve => {
  const orange = hexToRgb(brandHex());
  const logoUrl = tenantLogo();
  const hasPag = g.pct > 0;
  const render = (img) => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    if (img) { const h = 12, w = img.width * (h / img.height); doc.addImage(blackLogoDataURL(img) || logoUrl, 'PNG', 20, 16, w, h); }
    else { doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(26); doc.text(brandName(), 20, 25); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(26); doc.text(pdfSafe(g.title), 20, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120); doc.text(pdfSafe(`${g.host} - ${g.periodo}`), 20, 47);
    doc.setDrawColor(220); doc.line(20, 52, 190, 52);
    doc.setFontSize(10); doc.setTextColor(120); doc.text(hasPag ? `TOTAL A PAGAR - repasse ${g.pct}%` : 'COMISSAO RECEBIDA (liquidada)', 20, 62);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...orange); doc.text(fpBRL(hasPag ? g.pagar : g.recebida), 20, 74);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
    doc.text(pdfSafe(`Recebida ${fpBRL(g.recebida)} - estimada ${fpBRL(g.estimada)} - ${g.total} pedidos`), 20, 81);
    let y = 86;
    if (g.pendente > 0) { doc.setFontSize(9); doc.setTextColor(180, 140, 60); doc.text(pdfSafe(`(*) ${fpBRL(g.pendente)} em comissao pendente de liquidacao (estimada) - ainda nao entra no valor`), 20, y); y += 5; }
    doc.setDrawColor(220); doc.line(20, y, 190, y); y += 9;
    // ---- POR PRODUTO: valores + breakdown de status (número + %) ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120); doc.text('POR PRODUTO', 20, y); y += 7;
    g.produtos.forEach(p => {
      if (y > 262) { doc.addPage(); y = 20; }
      const name = p.name.length > 72 ? p.name.slice(0, 71) + '...' : p.name;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26); doc.text(pdfSafe(name), 20, y); y += 5.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
      doc.text(pdfSafe(`${p.count} pedidos - ${p.inel} inelegivel(is) - GMV ${fpBRL(p.gmv)}`), 20, y); y += 4.5;
      doc.setTextColor(...orange); doc.setFont('helvetica', 'bold');
      doc.text(pdfSafe(`comissao recebida ${fpBRL(p.recebida)} - estimada ${fpBRL(p.estimada)}`), 20, y); y += 5.5;
      (p.dist.items || []).forEach(s => {
        if (y > 288) { doc.addPage(); y = 20; }
        const rgb = hexToRgb(s.hex);
        doc.setFillColor(...rgb); doc.circle(27, y - 1.3, 1.3, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(60); doc.text(pdfSafe(s.label), 31, y);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(40); doc.text(`${s.n}   ${pct1(s.pct)}`, 120, y, { align: 'right' });
        y += 4.8;
      });
      y += 2.5; doc.setDrawColor(235); doc.line(20, y, 190, y); y += 6;
    });
    // ---- STATUS GERAL: consolidado de todos os produtos selecionados ----
    const dist = g.statusDist;
    if (dist && dist.items.length) {
      if (y > 255) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120); doc.text('STATUS GERAL (todos os produtos selecionados)', 20, y); y += 7;
      dist.items.forEach(s => {
        if (y > 288) { doc.addPage(); y = 20; }
        const rgb = hexToRgb(s.hex);
        doc.setFillColor(...rgb); doc.circle(22, y - 1.4, 1.6, 'F');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40); doc.text(pdfSafe(s.label), 27, y);
        doc.setFont('helvetica', 'bold'); doc.text(`${s.n}   ${pct1(s.pct)}`, 190, y, { align: 'right' });
        y += 6.5;
      });
      if (dist.inelegiveis > 0) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
        doc.text(pdfSafe(`Inelegiveis (${dist.inelegiveis}) = Cancelados + Devolucoes + Estornados - nao geram comissao`), 20, y); y += 5;
      }
      doc.setDrawColor(220); doc.line(20, y + 1, 190, y + 1); y += 10;
    }
    if (hasPag && g.responsaveis.length) {
      if (y > 265) { doc.addPage(); y = 20; }
      y += 6; doc.setDrawColor(220); doc.line(20, y, 190, y); y += 8;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120); doc.text('REPASSE POR RESPONSAVEL', 20, y); y += 7;
      g.responsaveis.forEach(p => {
        if (y > 285) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30); doc.text(pdfSafe(p.nome + (p.pct != null ? ` (${p.pct}%)` : '')), 20, y);
        doc.setTextColor(...orange); doc.text(fpBRL(p.valor), 190, y, { align: 'right' });
        y += 8;
      });
    }
    resolve(doc.output('blob'));
  };
  if (logoUrl) { const img = new Image(); img.onload = () => render(img); img.onerror = () => render(null); img.src = logoUrl; }
  else render(null);
 });
}
