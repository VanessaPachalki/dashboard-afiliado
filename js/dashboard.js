// ================================================
// SPACEHUB - Dashboard Logic
// ================================================

let RAW = [];
let filtered = [];
let charts = {};

Chart.defaults.color = '#666';
Chart.defaults.borderColor = '#1a1a1a';
Chart.defaults.font.family = "'Inter','Segoe UI',sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;

const O=(window.BRAND_COLOR||'#E8551B'),T='#4EC9B0',C='#D4A76A',G='#3CB371',R='#D9534F',GR='#666',OA=(window.BRAND_COLOR_ALPHA||'#E8551B30'),TA='#4EC9B030';
const LK='#9B59B6',VT='#E67E22';
const DAYS = ['Seg','Ter','Qua','Qui','Sex','Sab','Dom'];
const STLABEL = ['Liquidado','Inelegível','Pendente','Aguardando Pagamento'];
const CTLABEL = ['Live','Vídeo','Link','Vitrine'];
const CTCOLOR = [O, T, LK, VT];

function fmt(n){return 'R$ '+(n/1000).toFixed(0)+'k';}
function fmtR(n){return 'R$ '+Math.round(n).toLocaleString('pt-BR');}
function pct(a,b){return b?((a/b)*100).toFixed(1)+'%':'0%';}

// ===== CACHE =====
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCacheKey(targetUserId, accountId) {
  return `spacehub_data_${targetUserId || 'self'}_${accountId || 'all'}`;
}

function getCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ===== DATA LOADING =====

async function loadData(targetUserId, accountId) {
  const el = document.getElementById('loading');
  if (el) el.style.display = 'flex';

  const cacheKey = getCacheKey(targetUserId, accountId);
  let allData = getCache(cacheKey);

  if (!allData) {
    const PAGE = 1000;
    allData = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      let query = sb
        .from('orders')
        .select('month, order_date, hour, day_of_week, gmv, settlement_status, content_type, store_name, product_name, content_id, items_sold, items_refunded, estimated_commission, received_commission')
        .order('order_date', { ascending: false })
        .range(from, from + PAGE - 1);

      // Multi-tenant: filter by agency
      if (agencyId()) query = query.eq('agency_id', agencyId());

      if (targetUserId) {
        query = query.eq('user_id', targetUserId);
      }
      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        if (el) el.style.display = 'none';
        console.error('Error loading data:', error);
        document.getElementById('container').innerHTML = `
          <div class="callout" style="border-left-color:var(--red);">
            Erro ao carregar dados: ${error.message}
          </div>`;
        return;
      }

      allData = allData.concat(data || []);
      hasMore = data && data.length === PAGE;
      from += PAGE;
    }

    setCache(cacheKey, allData);
  }

  if (el) el.style.display = 'none';

  if (allData.length === 0) {
    document.getElementById('container').innerHTML = `
      <div class="callout">
        Nenhum dado encontrado. <a href="upload.html" style="color:var(--orange);">Faça upload das planilhas</a> para começar.
      </div>`;
    return;
  }

  const data = allData;

  // Transform to tuple format (same as render functions expect)
  // Derive year-month from order_date (e.g. "2025-03-15" → "2025-03")
  RAW = data.map(r => [
    r.order_date.slice(0, 7),
    r.order_date,
    r.hour,
    r.day_of_week,
    parseFloat(r.gmv),
    r.settlement_status,
    r.content_type,
    r.store_name,
    r.product_name,
    r.content_id,
    r.items_sold,
    r.items_refunded,
    parseFloat(r.estimated_commission),
    parseFloat(r.received_commission)
  ]);

  filtered = RAW;
  buildFilters();
  render('all');
}

function ymLabel(ym) {
  const MM = {'01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez'};
  const [y, m] = ym.split('-');
  return (MM[m] || m) + '/' + y.slice(2);
}

function buildFilters() {
  const months = [...new Set(RAW.map(r => r[0]))].sort();

  const filtersEl = document.getElementById('filters');
  filtersEl.innerHTML = '<button class="fbtn active" data-m="all">Todos</button>';
  months.forEach(m => {
    filtersEl.innerHTML += `<button class="fbtn" data-m="${m}">${ymLabel(m)}</button>`;
  });

  // Store MLABEL globally for charts
  window.MLABEL = { all: 'Todos' };
  months.forEach(m => { window.MLABEL[m] = ymLabel(m); });

  // Bind filter clicks
  document.querySelectorAll('.fbtn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.fbtn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const m = b.dataset.m;
      filtered = m === 'all' ? RAW : RAW.filter(r => r[0] === m);
      render(m);
    });
  });
}

// ===== LAZY RENDERING =====

let lazyObserver = null;
let currentMonth = 'all';

function setupLazy() {
  if (lazyObserver) lazyObserver.disconnect();
  const rendered = new Set();
  lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = e.target.dataset.lazy;
        if (id && !rendered.has(id)) {
          rendered.add(id);
          lazyRender(id, currentMonth);
        }
      }
    });
  }, { rootMargin: '200px' });

  document.querySelectorAll('[data-lazy]').forEach(el => lazyObserver.observe(el));
}

function lazyRender(id, month) {
  const map = {
    'cWeekly': () => renderWeekly(month),
    'cDedicacao': () => renderDedicacao(),
    'cRetorno': () => renderRetorno(),
    'cLiveVideo': () => renderLiveVideo(),
    'cMix': () => renderMix(),
    'cHour': () => renderHour(),
    'cDay': () => renderDay(),
    'cComissao': () => renderComissao(),
    'cStatus': () => renderStatus(),
    'scenarios': () => renderScenarios(),
    'cCancelMes': () => renderCancelMes(month),
    'cCancelTipo': () => renderCancelTipo(),
    'tLojas': () => renderLojas(),
    'tConteudos': () => renderConteudos(),
    'tBad': () => renderProducts()
  };
  if (map[id]) map[id]();
}

// ===== RENDER FUNCTIONS =====

function render(month) {
  currentMonth = month;
  // Always render above-the-fold immediately
  renderMaturity();
  renderKPIs();
  renderInsights(month);

  // Lazy render everything else
  if (lazyObserver) lazyObserver.disconnect();
  setupLazy();
  // Force render visible sections
  document.querySelectorAll('[data-lazy]').forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200) {
      lazyRender(el.dataset.lazy, month);
    }
  });
}

function maturityPct(){
  const d=filtered;
  const total=d.length;
  if(!total) return {liq:0,inel:0,pend:0,aw:0,pctBaixado:100,parcial:false};
  const liq=d.filter(r=>r[5]===0).length;
  const inel=d.filter(r=>r[5]===1).length;
  const pend=d.filter(r=>r[5]===2).length;
  const aw=d.filter(r=>r[5]===3).length;
  const baixado=liq+inel;
  const pctBaixado=baixado/total*100;
  return {liq,inel,pend,aw,total,baixado,pctBaixado,parcial:pctBaixado<80};
}

function renderMaturity(){
  const m=maturityPct();
  const el=document.getElementById('maturity');
  if(!m.total){el.style.display='none';return;}
  el.style.display='block';
  const pL=(m.liq/m.total*100).toFixed(1);
  const pI=(m.inel/m.total*100).toFixed(1);
  const pP=(m.pend/m.total*100).toFixed(1);
  const pA=(m.aw/m.total*100).toFixed(1);
  document.getElementById('matBar').innerHTML=`
    <div class="seg" style="width:${pL}%;background:var(--green)"></div>
    <div class="seg" style="width:${pI}%;background:var(--red)"></div>
    <div class="seg" style="width:${pA}%;background:var(--orange)"></div>
    <div class="seg" style="width:${pP}%;background:#444"></div>`;
  document.getElementById('matInfo').innerHTML=`
    <span><span class="dot" style="background:var(--green)"></span>Liquidados ${m.liq}</span>
    <span><span class="dot" style="background:var(--red)"></span>Inelegíveis ${m.inel}</span>
    <span><span class="dot" style="background:var(--orange)"></span>Aguardando pgto. ${m.aw}</span>
    <span><span class="dot" style="background:#444"></span>Pendentes ${m.pend}</span>
    <span style="margin-left:auto;color:${m.parcial?'var(--orange)':'var(--green)'};font-weight:700;">${m.pctBaixado.toFixed(0)}% baixados</span>`;
}

function renderKPIs() {
  const d=filtered;
  const m=maturityPct();
  const gmv=d.reduce((s,r)=>s+r[4],0);
  const ped=d.length;
  const gmvArr=d.map(r=>r[4]).sort((a,b)=>a-b);
  const median=gmvArr.length?gmvArr[Math.floor(gmvArr.length/2)]:0;
  const lojas=new Set(d.map(r=>r[7])).size;
  const ctCount=[0,1,2,3].map(t=>new Set(d.filter(r=>r[6]===t).map(r=>r[9])).size);
  const liq=d.filter(r=>r[5]===0).length;
  const cancel=d.filter(r=>r[5]===1).length;
  const baixados=liq+cancel;
  const taxaCancel=baixados?(cancel/baixados*100).toFixed(1):0;
  const reemb=d.reduce((s,r)=>s+r[11],0);
  const vendidos=d.reduce((s,r)=>s+r[10],0);
  const taxaReemb=vendidos?(reemb/vendidos*100).toFixed(1):0;
  const recebido=d.reduce((s,r)=>s+r[13],0);
  const parcial=m.parcial?'<div style="font-size:9px;color:var(--orange);margin-top:2px;">parcial</div>':'';

  const lives=ctCount[0], videos=ctCount[1];

  document.getElementById('kpis').innerHTML=`
    <div class="kpi main"><div class="kpi-v">${fmtR(gmv)}</div><div class="kpi-l">GMV Gerado</div></div>
    <div class="kpi"><div class="kpi-v">${ped.toLocaleString()}</div><div class="kpi-l">Pedidos</div></div>
    <div class="kpi"><div class="kpi-v">R$ ${median.toFixed(0)}</div><div class="kpi-l">Ticket Mediano</div></div>
    <div class="kpi"><div class="kpi-v">${lojas}</div><div class="kpi-l">Lojas</div></div>
    <div class="kpi"><div class="kpi-v">${lives} / ${videos}</div><div class="kpi-l">Lives / Vídeos</div></div>
    <div class="kpi"><div class="kpi-v">${taxaCancel}%${parcial}</div><div class="kpi-l">Taxa Inelegível</div></div>
    <div class="kpi"><div class="kpi-v">${taxaReemb}%</div><div class="kpi-l">Taxa de Reembolso</div></div>
    <div class="kpi"><div class="kpi-v">${fmtR(recebido)}</div><div class="kpi-l">Comissão Recebida</div></div>
  `;
}

function renderInsights(month) {
  const d=filtered;
  const gmv=d.reduce((s,r)=>s+r[4],0);
  const ctGMV=[0,1,2,3].map(t=>d.filter(r=>r[6]===t).reduce((s,r)=>s+r[4],0));
  const ctN=[0,1,2,3].map(t=>new Set(d.filter(r=>r[6]===t).map(r=>r[9])).size);
  const ctAvg=ctN.map((n,i)=>n?ctGMV[i]/n:0);

  // Top tipo por GMV
  const topCt=ctGMV.indexOf(Math.max(...ctGMV));
  const topPct=gmv?(ctGMV[topCt]/gmv*100).toFixed(0):0;

  const lojaGMV={};
  d.forEach(r=>{lojaGMV[r[7]]=(lojaGMV[r[7]]||0)+r[4];});
  const topLoja=Object.entries(lojaGMV).sort((a,b)=>b[1]-a[1])[0];
  const topLojaPct=gmv&&topLoja?(topLoja[1]/gmv*100).toFixed(0):0;
  const hourGMV=Array(24).fill(0);
  d.forEach(r=>{hourGMV[r[2]]+=r[4];});
  // Encontrar as 3 horas consecutivas com maior GMV
  let bestStart=0, bestSum=0;
  for(let i=0;i<22;i++){
    const sum=hourGMV[i]+hourGMV[i+1]+hourGMV[i+2];
    if(sum>bestSum){bestSum=sum;bestStart=i;}
  }
  const primePct=gmv?(bestSum/gmv*100).toFixed(0):0;

  const retornoParts=CTLABEL.map((l,i)=>ctN[i]?`${l}: ${fmtR(ctAvg[i])}`:null).filter(Boolean).join(' · ');
  const prodParts=CTLABEL.map((l,i)=>ctN[i]?`${ctN[i]} ${l.toLowerCase()}s`:null).filter(Boolean).join(' + ');

  const livePct=gmv?(ctGMV[0]/gmv*100).toFixed(0):0;
  const videoPct=gmv?(ctGMV[1]/gmv*100).toFixed(0):0;

  const ins = [
    `<strong>Live = ${livePct}% do GMV · Vídeo = ${videoPct}%.</strong> Retorno médio: ${retornoParts}.`,
    `<strong>Horário prime ${bestStart}h–${bestStart+2}h</strong> concentra ${primePct}% do GMV.`,
    topLoja?`<strong>${topLoja[0]}</strong> é a loja nº 1 com ${fmtR(topLoja[1])} (${topLojaPct}% do GMV).`:'',
    `<strong>${prodParts}</strong> produzidos${month!=='all'?' neste período':''}.`
  ].filter(Boolean);

  document.getElementById('insights').innerHTML=ins.map(i=>`<div class="ins">${i}</div>`).join('');
}

function makeChart(id,cfg){
  if(charts[id]) charts[id].destroy();
  charts[id]=new Chart(document.getElementById(id),cfg);
}

function renderWeekly(month) {
  const wk={};
  filtered.forEach(r=>{const w=r[1];wk[w]=(wk[w]||0)+r[4];});
  const weeks=Object.keys(wk).sort();
  const labels=weeks.map(w=>{const d=new Date(w);return (d.getDate()).toString().padStart(2,'0')+'/'+(d.getMonth()+1<10?'0':'')+(d.getMonth()+1);});
  makeChart('cWeekly',{
    type:'line',
    data:{labels,datasets:[{label:'GMV',data:weeks.map(w=>Math.round(wk[w])),borderColor:O,backgroundColor:OA,fill:true,tension:0.3,pointRadius:3}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtR(c.raw)}}},scales:{y:{ticks:{callback:v=>fmt(v)}}}}
  });
}

function renderDedicacao() {
  const byM={};
  filtered.forEach(r=>{
    const m=r[0];
    if(!byM[m])byM[m]={ct:[new Set(),new Set(),new Set(),new Set()],gmv:0};
    if(r[6]>=0&&r[6]<=3)byM[m].ct[r[6]].add(r[9]);
    byM[m].gmv+=r[4];
  });
  const ms=Object.keys(byM).sort();
  const labels=ms.map(m=>(window.MLABEL||{})[m]||m);
  const datasets=CTLABEL.map((l,i)=>({
    label:l,data:ms.map(m=>byM[m].ct[i].size),backgroundColor:CTCOLOR[i],stack:'s',yAxisID:'y',borderRadius:3
  })).filter(ds=>ds.data.some(v=>v>0));
  datasets.push({label:'GMV',data:ms.map(m=>Math.round(byM[m].gmv)),type:'line',borderColor:T,backgroundColor:T,pointRadius:6,borderWidth:2,yAxisID:'y1',tension:0.3});
  makeChart('cDedicacao',{
    type:'bar',
    data:{labels,datasets},
    options:{responsive:true,interaction:{mode:'index',intersect:false},scales:{y:{stacked:true,ticks:{color:O}},y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:T,callback:v=>fmt(v)}}}}
  });
}

function renderRetorno() {
  const byM={};
  filtered.forEach(r=>{
    const m=r[0];
    if(!byM[m])byM[m]={g:[0,0,0,0],c:[new Set(),new Set(),new Set(),new Set()]};
    if(r[6]>=0&&r[6]<=3){byM[m].g[r[6]]+=r[4];byM[m].c[r[6]].add(r[9]);}
  });
  const ms=Object.keys(byM).sort();
  const datasets=CTLABEL.map((l,i)=>({
    label:'GMV/'+l,data:ms.map(m=>byM[m].c[i].size?Math.round(byM[m].g[i]/byM[m].c[i].size):0),borderColor:CTCOLOR[i],backgroundColor:CTCOLOR[i],pointRadius:5,tension:0.3
  })).filter(ds=>ds.data.some(v=>v>0));
  makeChart('cRetorno',{
    type:'line',
    data:{labels:ms.map(m=>(window.MLABEL||{})[m]||m),datasets},
    options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>fmtR(c.raw)}}},scales:{y:{ticks:{callback:v=>fmt(v)}}}}
  });
}

function renderLiveVideo(){
  const byM={};
  filtered.forEach(r=>{
    const m=r[0];if(!byM[m])byM[m]={l:0,v:0};
    if(r[6]===0)byM[m].l+=r[4]; else if(r[6]===1)byM[m].v+=r[4];
  });
  const ms=Object.keys(byM).sort();
  makeChart('cLiveVideo',{
    type:'bar',
    data:{labels:ms.map(m=>(window.MLABEL||{})[m]||m),datasets:[
      {label:'Live',data:ms.map(m=>Math.round(byM[m].l)),backgroundColor:O},
      {label:'Vídeo',data:ms.map(m=>Math.round(byM[m].v)),backgroundColor:T}
    ]},
    options:{responsive:true,scales:{x:{stacked:true},y:{stacked:true,ticks:{callback:v=>fmt(v)}}},plugins:{tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmtR(c.raw)}}}}
  });
}

function renderMix(){
  const byM={};
  filtered.forEach(r=>{
    const m=r[0];if(!byM[m])byM[m]={l:0,v:0};
    if(r[6]===0)byM[m].l+=r[4]; else if(r[6]===1)byM[m].v+=r[4];
  });
  const ms=Object.keys(byM).sort();
  makeChart('cMix',{
    type:'bar',
    data:{labels:ms.map(m=>(window.MLABEL||{})[m]||m),datasets:[
      {label:'Live %',data:ms.map(m=>{const t=byM[m].l+byM[m].v;return t?+(byM[m].l/t*100).toFixed(1):0;}),backgroundColor:O},
      {label:'Vídeo %',data:ms.map(m=>{const t=byM[m].l+byM[m].v;return t?+(byM[m].v/t*100).toFixed(1):0;}),backgroundColor:T}
    ]},
    options:{responsive:true,scales:{x:{stacked:true},y:{stacked:true,max:100,ticks:{callback:v=>v+'%'}}},plugins:{tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.raw+'%'}}}}
  });
}

function renderHour(){
  const h=Array(24).fill(0);
  filtered.forEach(r=>{h[r[2]]+=r[4];});
  let peakStart=0,peakSum=0;
  for(let i=0;i<22;i++){const s=h[i]+h[i+1]+h[i+2];if(s>peakSum){peakSum=s;peakStart=i;}}
  makeChart('cHour',{
    type:'bar',
    data:{labels:Array.from({length:24},(_,i)=>i+'h'),datasets:[{data:h.map(Math.round),backgroundColor:h.map((_,i)=>i>=peakStart&&i<=peakStart+2?O:T)}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtR(c.raw)}}},scales:{y:{ticks:{callback:v=>fmt(v)}}}}
  });
}

function renderDay(){
  const d=Array(7).fill(0);
  filtered.forEach(r=>{d[r[3]]+=r[4];});
  const best=Math.max(...d);
  makeChart('cDay',{
    type:'bar',
    data:{labels:DAYS,datasets:[{data:d.map(Math.round),backgroundColor:d.map(v=>v===best?O:T)}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtR(c.raw)}}},scales:{y:{ticks:{callback:v=>fmt(v)}}}}
  });
}

function renderComissao(){
  const byM={};
  filtered.forEach(r=>{
    const m=r[0];if(!byM[m])byM[m]={rec:0,perdida:0,pendente:0,aguardando:0};
    if(r[5]===0) byM[m].rec+=r[13];
    else if(r[5]===1) byM[m].perdida+=r[12];
    else if(r[5]===2) byM[m].pendente+=r[12];
    else if(r[5]===3) byM[m].aguardando+=r[12];
  });
  const ms=Object.keys(byM).sort();
  makeChart('cComissao',{
    type:'bar',
    data:{labels:ms.map(m=>(window.MLABEL||{})[m]||m),datasets:[
      {label:'Recebida',data:ms.map(m=>Math.round(byM[m].rec)),backgroundColor:G},
      {label:'Aguardando pagamento',data:ms.map(m=>Math.round(byM[m].aguardando)),backgroundColor:GR},
      {label:'Pendente',data:ms.map(m=>Math.round(byM[m].pendente)),backgroundColor:C},
      {label:'Perdida (inelegíveis)',data:ms.map(m=>Math.round(byM[m].perdida)),backgroundColor:R}
    ]},
    options:{responsive:true,scales:{x:{stacked:true},y:{stacked:true,ticks:{callback:v=>fmt(v)}}},plugins:{tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmtR(c.raw)}}}}
  });
}

function renderStatus(){
  const st=[0,0,0,0];
  filtered.forEach(r=>{st[r[5]]++;});
  makeChart('cStatus',{
    type:'doughnut',
    data:{labels:STLABEL,datasets:[{data:st,backgroundColor:[G,R,C,GR]}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{boxWidth:10}}}}
  });
}

function renderScenarios(){
  const f2=n=>'R$ '+n.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');

  // Comissao ja recebida (liquidados)
  const rec=filtered.filter(r=>r[5]===0).reduce((s,r)=>s+r[13],0);
  // GMV dos liquidados para calcular taxa de comissao real
  const gmvLiq=filtered.filter(r=>r[5]===0).reduce((s,r)=>s+r[4],0);
  const taxaComissao=gmvLiq>0?rec/gmvLiq:0;

  // Pedidos pendentes (Pendente + Aguardando)
  const pend=filtered.filter(r=>r[5]>=2);
  const gmvPend=pend.reduce((s,r)=>s+r[4],0);

  // Taxa de inelegibilidade historica media (sobre baixados)
  const baixados=filtered.filter(r=>r[5]<=1);
  const inel=baixados.filter(r=>r[5]===1).length;
  const taxaIneleg=baixados.length?inel/baixados.length:0.30;

  // Pior taxa mensal historica (para cenario pessimista)
  const byMIneleg={};
  RAW.forEach(r=>{
    if(r[5]>1) return;
    const m=r[0];if(!byMIneleg[m])byMIneleg[m]={liq:0,inel:0};
    if(r[5]===0)byMIneleg[m].liq++;if(r[5]===1)byMIneleg[m].inel++;
  });
  const taxasMensais=Object.values(byMIneleg).filter(v=>v.liq+v.inel>=10).map(v=>v.inel/(v.liq+v.inel));
  const piorTaxa=taxasMensais.length?Math.max(...taxasMensais):taxaIneleg*1.5;

  // Comissao perdida em inelegiveis
  const gmvInel=filtered.filter(r=>r[5]===1).reduce((s,r)=>s+r[4],0);
  const perdido=gmvInel*taxaComissao;

  const hasPend=pend.length>0;
  const cards=document.querySelectorAll('.scenario h3');

  if(hasPend){
    // Comissao potencial dos pendentes = GMV pendente × taxa de comissao historica
    const comPend=gmvPend*taxaComissao;
    const best=rec+comPend;
    const mid=rec+comPend*(1-taxaIneleg);
    const worst=rec+comPend*(1-piorTaxa);

    if(cards.length>=3){
      cards[0].textContent='Cenário Perfeito';
      cards[1].textContent='Cenário Realista';
      cards[2].textContent='Cenário Pessimista';
    }
    document.getElementById('scBest').textContent=f2(best);
    document.getElementById('scBestSub').textContent=`Recebido ${f2(rec)} + potencial ${f2(comPend)}`;
    document.getElementById('scMid').textContent=f2(mid);
    document.getElementById('scMidSub').textContent=`Ineleg. ${(taxaIneleg*100).toFixed(1)}% · perde ${f2(comPend*taxaIneleg)}`;
    document.getElementById('scWorst').textContent=f2(worst);
    document.getElementById('scWorstSub').textContent=`Pior mês: ineleg. ${(piorTaxa*100).toFixed(1)}% · perde ${f2(comPend*piorTaxa)}`;
  } else {
    const potencial=rec+perdido;
    if(cards.length>=3){
      cards[0].textContent='Potencial Máximo';
      cards[1].textContent='Comissão Real';
      cards[2].textContent='Perdido em Inelegíveis';
    }
    document.getElementById('scBest').textContent=f2(potencial);
    document.getElementById('scBestSub').textContent=`Se 0% inelegíveis (taxa de comissão ${(taxaComissao*100).toFixed(1)}%)`;
    document.getElementById('scMid').textContent=f2(rec);
    document.getElementById('scMidSub').textContent='Comissão efetiva recebida';
    document.getElementById('scWorst').textContent=f2(perdido);
    document.getElementById('scWorstSub').textContent=`${inel} pedidos inelegíveis (${(taxaIneleg*100).toFixed(1)}%)`;
  }
}

function renderCancelMes(month){
  const hEl=document.getElementById('hCancelMes');
  if(month==='all'){
    if(hEl) hEl.textContent='Taxa de Inelegíveis por Mês';
    // Tendencia mensal
    const byM={};
    RAW.forEach(r=>{
      if(r[5]>1) return;
      const m=r[0];if(!byM[m])byM[m]={liq:0,can:0};
      if(r[5]===0)byM[m].liq++;if(r[5]===1)byM[m].can++;
    });
    const ms=Object.keys(byM).sort();
    makeChart('cCancelMes',{
      type:'line',
      data:{labels:ms.map(m=>(window.MLABEL||{})[m]||m),datasets:[{
        label:'Taxa Ineleg. %',
        data:ms.map(m=>{const t=byM[m].liq+byM[m].can;return t?+(byM[m].can/t*100).toFixed(1):0;}),
        borderColor:R,backgroundColor:R,pointRadius:6,tension:0.3
      }]},
      options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'%'}}},scales:{y:{min:0,ticks:{callback:v=>v+'%'}}}}
    });
  } else {
    if(hEl) hEl.textContent='Taxa de Inelegíveis por Loja';
    // Mes filtrado: taxa por loja + linha de media
    const baixados=filtered.filter(r=>r[5]<=1);
    const mediaGeral=baixados.length?baixados.filter(r=>r[5]===1).length/baixados.length*100:0;
    const byLoja={};
    baixados.forEach(r=>{
      const n=r[7];if(!byLoja[n])byLoja[n]={liq:0,can:0};
      if(r[5]===0)byLoja[n].liq++;if(r[5]===1)byLoja[n].can++;
    });
    const sorted=Object.entries(byLoja)
      .map(([n,v])=>({n,taxa:v.liq+v.can?(v.can/(v.liq+v.can)*100):0,total:v.liq+v.can}))
      .filter(v=>v.total>=5)
      .sort((a,b)=>b.taxa-a.taxa)
      .slice(0,12);
    makeChart('cCancelMes',{
      type:'bar',
      data:{labels:sorted.map(v=>v.n.length>20?v.n.slice(0,18)+'…':v.n),datasets:[
        {label:'Taxa Ineleg. %',data:sorted.map(v=>+v.taxa.toFixed(1)),backgroundColor:sorted.map(v=>v.taxa>mediaGeral?R:T)},
        {label:'Média geral',data:sorted.map(()=>+mediaGeral.toFixed(1)),type:'line',borderColor:O,borderDash:[6,3],pointRadius:0,borderWidth:2}
      ]},
      options:{responsive:true,plugins:{tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.raw+'%'}}},scales:{y:{min:0,ticks:{callback:v=>v+'%'}}}}
    });
  }
}

function renderCancelTipo(){
  const comReemb=filtered.filter(r=>r[5]===1&&r[11]>0).length;
  const semReemb=filtered.filter(r=>r[5]===1&&r[11]===0).length;
  makeChart('cCancelTipo',{
    type:'doughnut',
    data:{labels:[`Com reembolso (${comReemb})`,`Sem reembolso (${semReemb})`],datasets:[{data:[comReemb,semReemb],backgroundColor:[R,O]}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{boxWidth:10}}}}
  });
}

function renderLojas(){
  const lj={};
  filtered.forEach(r=>{
    const n=r[7];if(!lj[n])lj[n]={p:0,g:0,iv:0,ir:0,can:0,liq:0,bx:0};
    lj[n].p++;lj[n].g+=r[4];lj[n].iv+=r[10];lj[n].ir+=r[11];
    if(r[5]===0)lj[n].liq++;
    if(r[5]===1)lj[n].can++;
    if(r[5]<=1)lj[n].bx++;
  });
  const sorted=Object.entries(lj).sort((a,b)=>b[1].g-a[1].g).slice(0,15);
  const tb=document.getElementById('tLojas');
  tb.innerHTML=sorted.map((e,i)=>{
    const [n,v]=e;
    const txC=v.bx?(v.can/v.bx*100).toFixed(1):0;
    const txR=v.iv?(v.ir/v.iv*100).toFixed(1):0;
    const pctBx=v.p?(v.bx/v.p*100):100;
    const isDim=pctBx<50;
    const dimCls=isDim?' dim':'';
    const barColor=pctBx>=80?'var(--green)':pctBx>=50?'var(--orange)':'var(--red)';
    const miniBar=`<span class="mini-bar"><span class="fill" style="width:${pctBx.toFixed(0)}%;background:${barColor}"></span></span>`;
    const gmvArr=filtered.filter(r=>r[7]===n).map(r=>r[4]).sort((a,b)=>a-b);
    const med=gmvArr[Math.floor(gmvArr.length/2)]||0;
    return `<tr><td>${i+1}</td><td><strong>${esc(n)}</strong></td><td class="r">${v.p.toLocaleString()}</td><td class="r">${fmtR(v.g)}</td><td class="r">R$ ${med.toFixed(0)}</td><td class="r">${v.liq}</td><td class="r${dimCls} ${txC>33?'bad':''}">${txC}%</td><td class="r${dimCls} ${txR>3.7?'bad':''}">${txR}%</td><td class="r">${v.bx}/${v.p} ${miniBar}</td></tr>`;
  }).join('');
}

function renderConteudos(){
  const ct={};
  filtered.forEach(r=>{
    const id=r[9];if(!ct[id])ct[id]={p:0,g:0,tp:r[6],lojas:new Set()};
    ct[id].p++;ct[id].g+=r[4];ct[id].lojas.add(r[7]);
  });
  const sorted=Object.entries(ct).sort((a,b)=>b[1].g-a[1].g).slice(0,15);
  const tb=document.getElementById('tConteudos');
  tb.innerHTML=sorted.map((e,i)=>{
    const [id,v]=e;
    const tagColors=['tag-l','tag-v','tag-lk','tag-vt'];
    const tag=`<span class="tag ${tagColors[v.tp]||'tag-v'}">${CTLABEL[v.tp]||'Outro'}</span>`;
    return `<tr><td>${i+1}</td><td><code>...${id}</code></td><td>${tag}</td><td class="r">${v.p.toLocaleString()}</td><td class="r">${fmtR(v.g)}</td><td class="r">${v.lojas.size}</td></tr>`;
  }).join('');
}

function renderProducts(){
  const settled=filtered.filter(r=>r[5]<=1);
  const prod={};
  settled.forEach(r=>{
    const k=r[8]+'|||'+r[7];
    if(!prod[k])prod[k]={n:r[8],lj:r[7],iv:0,ir:0,can:0,liq:0,g:0};
    prod[k].iv+=r[10];prod[k].ir+=r[11];
    if(r[5]===1)prod[k].can++;if(r[5]===0)prod[k].liq++;
    prod[k].g+=r[4];
  });

  // Minimo de itens: 0.5% do total com piso de 10
  const totalItens=Object.values(prod).reduce((s,p)=>s+p.iv,0);
  const minItens=Math.max(10, Math.round(totalItens*0.005));
  const arr=Object.values(prod).filter(p=>p.iv>=minItens);

  // Medias gerais para comparacao relativa
  const avgReemb=arr.reduce((s,p)=>s+p.ir,0)/Math.max(arr.reduce((s,p)=>s+p.iv,0),1)*100;
  const avgCancel=arr.reduce((s,p)=>s+p.can,0)/Math.max(arr.reduce((s,p)=>s+p.can+p.liq,0),1)*100;

  // Produto ruim: ineleg. > 1.5× media OU reembolso > 1.5× media
  const bad=arr.filter(p=>{
    const tc=p.can/(p.can+p.liq)*100;
    const tr=p.ir/p.iv*100;
    return tc>avgCancel*1.5 || tr>avgReemb*1.5;
  }).sort((a,b)=>(b.g*b.can/(b.can+b.liq))-(a.g*a.can/(a.can+a.liq))).slice(0,12);

  const pendProd={};
  filtered.filter(r=>r[5]>=2).forEach(r=>{
    const k=r[8]+'|||'+r[7];
    pendProd[k]=(pendProd[k]||0)+1;
  });

  document.getElementById('tBad').innerHTML=bad.map(p=>{
    const tc=(p.can/(p.can+p.liq)*100).toFixed(1);
    const tr=(p.ir/p.iv*100).toFixed(1);
    const lost=Math.round(p.g*p.can/(p.can+p.liq));
    const k=p.n+'|||'+p.lj;
    const total=p.can+p.liq+(pendProd[k]||0);
    const isDim=total>0&&(pendProd[k]||0)/total>0.5;
    const d=isDim?' dim':'';
    return `<tr><td>${esc(p.n.slice(0,45))}</td><td>${esc(p.lj)}</td><td class="r">${p.iv}</td><td class="r bad${d}">${tr}%</td><td class="r bad${d}">${tc}%</td><td class="r bad${d}">${fmtR(lost)}</td></tr>`;
  }).join('');

  // Produto bom: ineleg. abaixo da media E reembolso abaixo da media
  const good=arr.filter(p=>{
    const tc=p.can/(p.can+p.liq)*100;
    const tr=p.ir/p.iv*100;
    return tc<=avgCancel && tr<=avgReemb;
  }).sort((a,b)=>b.g-a.g).slice(0,12);

  document.getElementById('tGood').innerHTML=good.map(p=>{
    const tc=(p.can/(p.can+p.liq)*100).toFixed(1);
    const tr=(p.ir/p.iv*100).toFixed(1);
    const tl=(p.liq/(p.can+p.liq)*100).toFixed(1);
    const k=p.n+'|||'+p.lj;
    const total=p.can+p.liq+(pendProd[k]||0);
    const isDim=total>0&&(pendProd[k]||0)/total>0.5;
    const d=isDim?' dim':'';
    return `<tr><td>${esc(p.n.slice(0,45))}</td><td>${esc(p.lj)}</td><td class="r">${p.iv}</td><td class="r good${d}">${tr}%</td><td class="r${d}">${tc}%</td><td class="r good${d}">${tl}%</td></tr>`;
  }).join('');
}
