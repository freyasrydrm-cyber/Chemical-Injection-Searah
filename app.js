/* =========================================================================
   app.js — UI wiring, filters, page renderers, charts, AI insight engine
   ========================================================================= */

const NAV = [
  { id: 'exec',       label: 'Executive Summary',   ic: '&#9679;' },
  { id: 'injection',  label: 'Chemical Injection',   ic: '&#128167;' },
  { id: 'ppd',        label: 'PPD',                  ic: '&#10052;' },
  { id: 'liquidci',   label: 'Liquid CI',             ic: '&#128167;' },
  { id: 'gasci',      label: 'Gas CI',                ic: '&#128168;' },
  { id: 'scale',      label: 'Scale Inhibitor',       ic: '&#9879;' },
  { id: 'h2s',        label: 'H2S Scavenger',         ic: '&#9888;' },
  { id: 'corrosion',  label: 'Corrosion Overview',    ic: '&#128295;' },
  { id: 'budget',     label: 'Chemical Budget',       ic: '&#128176;' },
  { id: 'facility',   label: 'Facility & Production', ic: '&#127981;' }
];

const PLATFORM_LABEL = { A: 'BTJT-A', B: 'BTJT-B', FPSO: 'BTJT-B FPSO', ALL: 'All Platforms' };

const state = {
  page: 'exec',
  filters: { years: [], months: [], platform: 'ALL' }
};

/* ------------------------------------------------------------------ INIT */
function initApp() {
  document.getElementById('loader-overlay').remove();
  document.getElementById('app').style.display = 'flex';
  buildYearOptions();
  renderSidebar();
  renderTopbarFilters();
  goTo('exec');
}

function buildYearOptions() {
  const years = new Set();
  Object.values(AppData.programs).forEach(byPlat => Object.values(byPlat).forEach(sheet => {
    if (!sheet) return;
    sheet.rows.forEach(r => years.add(parseInt(r.date.slice(0, 4), 10)));
  }));
  window.AVAILABLE_YEARS = Array.from(years).sort();
  // default: most recent year with data
  if (window.AVAILABLE_YEARS.length) state.filters.years = [window.AVAILABLE_YEARS[window.AVAILABLE_YEARS.length - 1]];
}

/* ------------------------------------------------------------------ NAV */
function renderSidebar() {
  const el = document.getElementById('sidebar');
  el.innerHTML = `
    <div class="brand">
      <div class="brand-mark">SC</div>
      <div class="brand-text">
        <div class="t1">Searah Chemical</div>
        <div class="t2">Injection Engineering</div>
      </div>
    </div>
    <div class="nav-group-label">Dashboards</div>
    <ul class="nav" id="nav-list"></ul>
    <div class="sidebar-foot">
      Source: uploaded chemical usage workbook.<br>
      No values are estimated or fabricated.
    </div>`;
  const list = document.getElementById('nav-list');
  list.innerHTML = NAV.map(n => `<li><button data-page="${n.id}" class="${state.page === n.id ? 'active' : ''}"><span class="ic">${n.ic}</span>${n.label}</button></li>`).join('');
  list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => goTo(b.dataset.page)));
}

function goTo(pageId) {
  state.page = pageId;
  document.querySelectorAll('#nav-list button').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
  renderPage();
}

/* ------------------------------------------------------------------ FILTER BAR */
function renderTopbarFilters() {
  const bar = document.getElementById('filter-bar');
  bar.innerHTML = `
    <div class="filter-chip" id="chip-year">
      <button>&#128197; Year <span id="year-sum"></span> &#9662;</button>
      <div class="filter-panel" id="panel-year"></div>
    </div>
    <div class="filter-chip" id="chip-month">
      <button>&#128198; Month <span id="month-sum"></span> &#9662;</button>
      <div class="filter-panel" id="panel-month"></div>
    </div>
    <div class="filter-chip" id="chip-platform">
      <button>&#127959; Platform: <span id="plat-sum">All</span> &#9662;</button>
      <div class="filter-panel" id="panel-platform"></div>
    </div>
  `;
  buildYearPanel();
  buildMonthPanel();
  buildPlatformPanel();

  ['chip-year', 'chip-month', 'chip-platform'].forEach(id => {
    const chip = document.getElementById(id);
    chip.querySelector('button').addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = chip.classList.contains('open');
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('open'));
      if (!isOpen) chip.classList.add('open');
    });
  });
  document.addEventListener('click', () => document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('open')));
  updateFilterSummaries();
}

function buildYearPanel() {
  const p = document.getElementById('panel-year');
  p.innerHTML = `<div class="fp-title">Select Year(s)</div>` +
    window.AVAILABLE_YEARS.map(y => `<label><input type="checkbox" value="${y}" ${state.filters.years.includes(y) ? 'checked' : ''}> ${y}</label>`).join('') +
    `<div class="filter-actions"><button class="btn-mini" id="year-all">All</button><button class="btn-mini primary" id="year-apply">Apply</button></div>`;
  p.querySelector('#year-all').addEventListener('click', () => { p.querySelectorAll('input').forEach(i => i.checked = true); });
  p.querySelector('#year-apply').addEventListener('click', () => {
    state.filters.years = Array.from(p.querySelectorAll('input:checked')).map(i => parseInt(i.value, 10));
    updateFilterSummaries(); renderPage();
  });
}

function buildMonthPanel() {
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const p = document.getElementById('panel-month');
  p.innerHTML = `<div class="fp-title">Select Month(s) — multi-select shows daily data across the union of selected months</div>` +
    names.map((n, i) => `<label><input type="checkbox" value="${i+1}" ${state.filters.months.includes(i+1) ? 'checked' : ''}> ${n}</label>`).join('') +
    `<div class="filter-actions"><button class="btn-mini" id="month-clear">Clear (All)</button><button class="btn-mini primary" id="month-apply">Apply</button></div>`;
  p.querySelector('#month-clear').addEventListener('click', () => { p.querySelectorAll('input').forEach(i => i.checked = false); });
  p.querySelector('#month-apply').addEventListener('click', () => {
    state.filters.months = Array.from(p.querySelectorAll('input:checked')).map(i => parseInt(i.value, 10));
    updateFilterSummaries(); renderPage();
  });
}

function buildPlatformPanel() {
  const p = document.getElementById('panel-platform');
  const opts = [['ALL','All Platforms'],['A','BTJT-A'],['B','BTJT-B'],['FPSO','BTJT-B FPSO']];
  p.innerHTML = `<div class="fp-title">Platform</div>` +
    opts.map(([v,l]) => `<label><input type="radio" name="plat" value="${v}" ${state.filters.platform===v?'checked':''}> ${l}</label>`).join('') +
    `<div class="filter-actions"><button class="btn-mini primary" id="plat-apply">Apply</button></div>`;
  p.querySelector('#plat-apply').addEventListener('click', () => {
    state.filters.platform = p.querySelector('input[name=plat]:checked').value;
    updateFilterSummaries(); renderPage();
  });
}

function updateFilterSummaries() {
  document.getElementById('year-sum').textContent = state.filters.years.length ? `(${state.filters.years.join(', ')})` : '(all)';
  document.getElementById('month-sum').textContent = state.filters.months.length ? `(${state.filters.months.length})` : '(all)';
  document.getElementById('plat-sum').textContent = PLATFORM_LABEL[state.filters.platform];
}

function currentFilters(extra) {
  return Object.assign({ years: state.filters.years, months: state.filters.months }, extra || {});
}

function platformsToShow() {
  if (state.filters.platform === 'ALL') return ['A', 'B'];
  return [state.filters.platform];
}

/* ------------------------------------------------------------------ HELPERS */
const fmt = {
  num(v, d = 1) { return (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }); },
  pct(v, d = 1) { return (v === null || v === undefined || isNaN(v)) ? '—' : `${Number(v).toFixed(d)}%`; },
  currency(v) { return (v === null || v === undefined || isNaN(v)) ? '—' : `Rp ${Number(v).toLocaleString(undefined,{maximumFractionDigits:0})}`; }
};

function statusPill(status) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.gray;
  return `<span class="status-pill" style="background:${c}1a;color:${c}"><span class="status-dot" style="background:${c}"></span>${STATUS_LABEL[status]}</span>`;
}
function statusDot(status) {
  return `<span class="status-dot" style="background:${STATUS_COLOR[status]||STATUS_COLOR.gray}"></span>`;
}

function complianceOf(rows) {
  const t = sumRows(rows, r => r.total.target);
  const a = sumRows(rows, r => r.total.actual);
  if (t === null || a === null || t === 0) return { target: t, actual: a, pct: null, status: 'gray' };
  const pct = (a / t) * 100;
  return { target: t, actual: a, pct, status: RULES.injectionStatus(t, a) };
}

function kpiCard(label, value, unit, sub, status) {
  return `<div class="kpi-card">
    <div class="kpi-top">
      <div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}${unit ? `<span class="kpi-unit">${unit}</span>` : ''}</div>
      </div>
      ${status ? statusDot(status) : ''}
    </div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

function emptyState(msg, sub) {
  return `<div class="empty-state"><div class="es-ic">&#9888;</div><h4>${msg}</h4><div>${sub||''}</div></div>`;
}

function legendRow() {
  return `<div class="legend-row">
    <span class="li"><span class="sw" style="background:${STATUS_COLOR.green}"></span>Normal / Within target</span>
    <span class="li"><span class="sw" style="background:${STATUS_COLOR.yellow}"></span>Warning / Moderate deviation</span>
    <span class="li"><span class="sw" style="background:${STATUS_COLOR.red}"></span>Critical / Exceedance</span>
    <span class="li"><span class="sw" style="background:${STATUS_COLOR.gray}"></span>No Data</span>
  </div>`;
}

let chartCounter = 0;
function nextChartId() { return `chart_${++chartCounter}`; }

function plotlyLayout(extra) {
  return Object.assign({
    margin: { t:10, r:16, l:44, b:34 },
    font: { family: 'Inter, sans-serif', size:11.5, color:'#2E3A46' },
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    legend: { orientation:'h', y:1.15 },
    xaxis: { gridcolor:'#eef1f4', showline:true, linecolor:'#dce3ea' },
    yaxis: { gridcolor:'#eef1f4', showline:true, linecolor:'#dce3ea' }
  }, extra || {});
}
const plotlyConfig = { displaylogo:false, responsive:true, modeBarButtonsToRemove:['lasso2d','select2d'] };

/* Daily Actual vs Target line chart for a set of rows (already filtered) */
function dailyTrendChart(elId, rows, opts={}) {
  const dates = rows.map(r => r.date);
  const actual = rows.map(r => r.total.actual);
  const target = rows.map(r => r.total.target);
  Plotly.newPlot(elId, [
    { x:dates, y:target, name:'Target', type:'scatter', mode:'lines', line:{ color:'#9AA6B2', width:1.6, dash:'dot' } },
    { x:dates, y:actual, name:'Actual', type:'scatter', mode:'lines', fill:'tozeroy', fillcolor:'rgba(0,100,157,0.08)', line:{ color:'#00649D', width:2.2 } }
  ], plotlyLayout({ yaxis:{ title: opts.unit||'', gridcolor:'#eef1f4' } }), plotlyConfig);
}

/* Zone comparison bar chart (sum over filtered rows) */
function zoneBarChart(elId, rows, zones) {
  const targets = zones.map(z => sumRows(rows, r => r.zones[z] ? r.zones[z].target : null));
  const actuals = zones.map(z => sumRows(rows, r => r.zones[z] ? r.zones[z].actual : null));
  Plotly.newPlot(elId, [
    { x:zones, y:targets, name:'Target', type:'bar', marker:{ color:'#DCE3EA' } },
    { x:zones, y:actuals, name:'Actual', type:'bar', marker:{ color:'#00649D' } }
  ], plotlyLayout({ barmode:'group' }), plotlyConfig);
}

function corrosionTrendChart(elId, rows, zones) {
  const dates = rows.map(r => r.date);
  const traces = zones.map((z, i) => ({
    x: dates, y: rows.map(r => r.corrosion[z]), name:z, type:'scatter', mode:'lines', line:{ width:1.8 }
  }));
  Plotly.newPlot(elId, traces, plotlyLayout({ yaxis:{ title:'MPY' }, shapes:[
    { type:'line', x0:dates[0], x1:dates[dates.length-1], y0:2, y1:2, line:{ color:STATUS_COLOR.yellow, width:1, dash:'dash' } },
    { type:'line', x0:dates[0], x1:dates[dates.length-1], y0:5, y1:5, line:{ color:STATUS_COLOR.red, width:1, dash:'dash' } }
  ]}), plotlyConfig);
}

function budgetChart(elId, rows) {
  const dates = rows.map(r => r.date);
  Plotly.newPlot(elId, [
    { x:dates, y:rows.map(r=>r.budget.planned), name:'Planned', type:'bar', marker:{ color:'#DCE3EA' } },
    { x:dates, y:rows.map(r=>r.budget.expense), name:'Expense', type:'bar', marker:{ color:'#F7921E' } }
  ], plotlyLayout({ barmode:'group' }), plotlyConfig);
}

/* Sortable / searchable table */
function renderTable(containerId, columns, rows) {
  const el = document.getElementById(containerId);
  let sortCol = null, sortDir = 1, filterText = '';

  function draw() {
    let data = rows;
    if (filterText) {
      const ft = filterText.toLowerCase();
      data = data.filter(row => columns.some(c => String(row[c.key]).toLowerCase().includes(ft)));
    }
    if (sortCol) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return av > bv ? sortDir : av < bv ? -sortDir : 0;
      });
    }
    const rowsHtml = data.slice(0, 500).map(row => `<tr>${columns.map(c => `<td>${c.fmt ? c.fmt(row[c.key]) : (row[c.key] ?? '—')}</td>`).join('')}</tr>`).join('');
    el.querySelector('.table-scroll').innerHTML = `<table class="data-table"><thead><tr>${columns.map(c => `<th data-key="${c.key}">${c.label}</th>`).join('')}</tr></thead><tbody>${rowsHtml || `<tr><td colspan="${columns.length}" style="text-align:center;color:#9AA6B2;padding:20px;">No rows match current filters</td></tr>`}</tbody></table>`;
    el.querySelectorAll('th').forEach(th => th.addEventListener('click', () => {
      const k = th.dataset.key;
      sortDir = (sortCol === k) ? -sortDir : 1;
      sortCol = k;
      draw();
    }));
  }

  el.innerHTML = `
    <div class="table-tools">
      <input type="text" placeholder="Search table..." id="${containerId}-search">
      <button class="btn-mini" id="${containerId}-csv">&#8681; Export CSV</button>
      <span style="font-size:11.5px;color:var(--text-soft)">${rows.length.toLocaleString()} rows (showing up to 500)</span>
    </div>
    <div class="table-scroll"></div>`;
  el.querySelector(`#${containerId}-search`).addEventListener('input', e => { filterText = e.target.value; draw(); });
  el.querySelector(`#${containerId}-csv`).addEventListener('click', () => exportCSV(columns, rows, containerId));
  draw();
}

function exportCSV(columns, rows, name) {
  const header = columns.map(c => c.label).join(',');
  const lines = rows.map(row => columns.map(c => JSON.stringify(row[c.key] ?? '')).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
}

/* ------------------------------------------------------------------ AI INSIGHT ENGINE (deterministic, rule-based) */
function insightForProgram(progKey, dataByPlat, filters) {
  const lines = [];
  Object.keys(dataByPlat).forEach(plat => {
    const sheet = dataByPlat[plat];
    if (!sheet) return;
    const rows = filterRows(sheet.rows, filters);
    if (!rows.length) return;
    const c = complianceOf(rows);
    if (c.pct === null) return;
    const label = PLATFORM_LABEL[plat];
    if (c.status === 'red') {
      const dir = c.actual < c.target ? 'under-injection' : 'over-injection';
      lines.push(`<b>${label}:</b> Cumulative actual injection deviates ${fmt.pct(Math.abs(c.pct-100))} from target (${dir}) — exceeds the ±10% critical threshold. Recommend reviewing pump rate / chemical availability.`);
    } else if (c.status === 'yellow') {
      lines.push(`<b>${label}:</b> Injection compliance at ${fmt.pct(c.pct)} of target — within the 5–10% moderate-deviation band. Monitor trend.`);
    } else if (c.status === 'green') {
      lines.push(`<b>${label}:</b> Injection compliance at ${fmt.pct(c.pct)} of target — within ±5% of plan.`);
    }
    // persistent under/over injection: check last 7 available days
    const last7 = rows.slice(-7).filter(r => typeof r.total.actual === 'number' && typeof r.total.target === 'number' && r.total.target > 0);
    if (last7.length >= 5) {
      const underCount = last7.filter(r => r.total.actual < r.total.target * 0.9).length;
      const overCount = last7.filter(r => r.total.actual > r.total.target * 1.1).length;
      if (underCount >= 5) lines.push(`<b>${label}:</b> Persistent under-injection detected across the last ${last7.length} recorded days (>10% below target on ${underCount} of ${last7.length} days).`);
      if (overCount >= 5) lines.push(`<b>${label}:</b> Persistent over-injection detected across the last ${last7.length} recorded days (>10% above target on ${overCount} of ${last7.length} days).`);
    }
  });
  if (!lines.length) return null;
  return lines;
}

function insightForCorrosion(dataByPlat, filters) {
  const lines = [];
  Object.keys(dataByPlat).forEach(plat => {
    const sheet = dataByPlat[plat];
    if (!sheet || !sheet.hasCorrosion) return;
    const rows = filterRows(sheet.rows, filters);
    Object.keys(sheet.rows[0]?.corrosion || {}).length; // noop guard
    const zoneSet = new Set();
    rows.forEach(r => Object.keys(r.corrosion).forEach(z => zoneSet.add(z)));
    zoneSet.forEach(z => {
      const v = latestNonNull(rows, r => r.corrosion[z]);
      if (v === null) return;
      const status = RULES.corrosionStatus(v);
      if (status === 'red') lines.push(`<b>${PLATFORM_LABEL[plat]} / ${z}:</b> Latest corrosion rate ${fmt.num(v,2)} MPY exceeds 5 MPY — critical. Verify inhibitor dosage and coupon/probe integrity.`);
      else if (status === 'yellow') lines.push(`<b>${PLATFORM_LABEL[plat]} / ${z}:</b> Latest corrosion rate ${fmt.num(v,2)} MPY is in the 2–5 MPY moderate band.`);
    });
  });
  return lines.length ? lines : null;
}

function insightForBudget(dataByPlat, filters) {
  const lines = [];
  Object.keys(dataByPlat).forEach(plat => {
    const sheet = dataByPlat[plat];
    if (!sheet || !sheet.hasBudget) return;
    const rows = filterRows(sheet.rows, filters);
    const planned = sumRows(rows, r => r.budget.planned);
    const expense = sumRows(rows, r => r.budget.expense);
    if (planned === null || expense === null) return;
    const status = RULES.costStatus(planned, expense);
    const dev = planned !== 0 ? ((expense - planned) / planned * 100) : 0;
    if (status === 'red') lines.push(`<b>${PLATFORM_LABEL[plat]}:</b> Expense vs planned budget variance ${fmt.pct(dev)} — exceeds ±10% control limit.`);
    else if (status === 'yellow') lines.push(`<b>${PLATFORM_LABEL[plat]}:</b> Budget variance ${fmt.pct(dev)} — within the ≤10% tolerance band.`);
    else if (status === 'green') lines.push(`<b>${PLATFORM_LABEL[plat]}:</b> Actual expense matches planned budget.`);
  });
  return lines.length ? lines : null;
}

function aiPanel(title, lines) {
  return `<div class="ai-panel">
    <div class="ai-head"><span class="ai-badge">AI</span>${title}</div>
    ${lines ? `<ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul>` : `<div class="ai-empty">Insufficient data to generate engineering insight for the current filter selection.</div>`}
  </div>`;
}

/* ------------------------------------------------------------------ PAGE DISPATCH */
function renderPage() {
  const nav = NAV.find(n => n.id === state.page);
  document.getElementById('page-title').textContent = nav.label;
  const c = document.getElementById('page-content');
  const renderers = {
    exec: renderExecutive, injection: renderInjectionOverview, ppd: () => renderProgramPage('ppd'),
    liquidci: () => renderProgramPage('liquidci'), gasci: () => renderProgramPage('gasci'),
    scale: () => renderProgramPage('scale'), h2s: renderH2SPage, corrosion: renderCorrosionPage,
    budget: renderBudgetPage, facility: renderFacilityPage
  };
  c.innerHTML = '';
  (renderers[state.page] || (() => c.innerHTML = emptyState('Page not found')))();
  renderCharts(state.page);
}

const pendingCharts = [];
function queueChart(fn) { pendingCharts.push(fn); }
function renderCharts() { pendingCharts.forEach(fn => fn()); pendingCharts.length = 0; }
