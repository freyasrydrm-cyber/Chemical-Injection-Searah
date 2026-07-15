/* =========================================================================
   pages.js — individual dashboard page renderers
   ========================================================================= */

function periodLabel() {
  const y = state.filters.years.length ? state.filters.years.join(', ') : 'All years';
  const m = state.filters.months.length ? state.filters.months.length + ' month(s) selected' : 'all months';
  return `${y} · ${m} · ${PLATFORM_LABEL[state.filters.platform]}`;
}

function setSub(text) { document.getElementById('page-sub').textContent = text; }

/* ============================================================ EXECUTIVE */
function renderExecutive() {
  setSub(`Roll-up across all chemical injection programs — ${periodLabel()}`);
  const plats = platformsToShow();
  const progKeys = Object.keys(PROGRAM_LABEL);

  // per-program aggregate compliance across selected platforms
  const progAgg = progKeys.map(pk => {
    let target = 0, actual = 0, any = false;
    plats.forEach(p => {
      const sheet = AppData.programs[pk][p];
      if (!sheet) return;
      const rows = filterRows(sheet.rows, currentFilters());
      const c = complianceOf(rows);
      if (c.target !== null) { target += c.target; actual += c.actual; any = true; }
    });
    const pct = any && target ? (actual / target) * 100 : null;
    return { pk, label: PROGRAM_LABEL[pk], target: any ? target : null, actual: any ? actual : null, pct, status: pct === null ? 'gray' : RULES.injectionStatus(target, actual) };
  });

  // budget roll-up
  let bPlanned = 0, bExpense = 0, bAny = false;
  progKeys.forEach(pk => plats.forEach(p => {
    const sheet = AppData.cost[pk] ? AppData.cost[pk][p] : null;
    if (!sheet || !sheet.hasBudget) return;
    const rows = filterRows(sheet.rows, currentFilters());
    const pl = sumRows(rows, r => r.budget.planned), ex = sumRows(rows, r => r.budget.expense);
    if (pl !== null) { bPlanned += pl; bExpense += ex || 0; bAny = true; }
  }));
  const budgetStatus = bAny ? RULES.costStatus(bPlanned, bExpense) : 'gray';

  // corrosion worst case
  let worstCorr = null, worstCorrStatus = 'gray';
  ['gasci', 'liquidci'].forEach(pk => plats.forEach(p => {
    const sheet = AppData.programs[pk][p];
    if (!sheet || !sheet.hasCorrosion) return;
    const rows = filterRows(sheet.rows, currentFilters());
    const zoneSet = new Set(); rows.forEach(r => Object.keys(r.corrosion).forEach(z => zoneSet.add(z)));
    zoneSet.forEach(z => {
      const v = latestNonNull(rows, r => r.corrosion[z]);
      if (v === null) return;
      const st = RULES.corrosionStatus(v);
      const rank = { green:0, yellow:1, red:2, gray:-1 };
      if (rank[st] > (rank[worstCorrStatus] ?? -1)) { worstCorrStatus = st; worstCorr = v; }
    });
  }));

  const overallRank = { green:0, yellow:1, red:2, gray:0 };
  const overallStatus = ['red','yellow','green'].find(s => progAgg.some(p => p.status === s)) || 'gray';

  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="kpi-row">
      ${kpiCard('Overall Program Status', STATUS_LABEL[overallStatus], '', 'Worst-case across all injection programs', overallStatus)}
      ${kpiCard('Chemical Budget Variance', bAny ? fmt.pct(bPlanned ? ((bExpense-bPlanned)/bPlanned*100) : 0) : '—', '', bAny ? `${fmt.currency(bExpense)} of ${fmt.currency(bPlanned)} planned` : 'No budget data in filter range', budgetStatus)}
      ${kpiCard('Worst Corrosion Rate', worstCorr!==null?fmt.num(worstCorr,2):'—', 'MPY', 'Latest reading, Gas CI + Liquid CI zones', worstCorrStatus)}
      ${kpiCard('Programs Tracked', progKeys.length, '', 'PPD · Scale · Gas CI · Liquid CI · H2S', null)}
    </div>

    <div id="exec-ai"></div>

    <div class="card">
      <div class="card-head"><h3>Program Compliance Scorecard</h3><div class="card-sub">Cumulative Actual vs Target for the selected period, ${PLATFORM_LABEL[state.filters.platform]}</div></div>
      <div class="card-body">
        <div class="kpi-row">
          ${progAgg.map(p => kpiCard(p.label, p.pct!==null?fmt.pct(p.pct):'—', '', p.target!==null?`${fmt.num(p.actual)} / ${fmt.num(p.target)} L (actual/target)`:'No data in range', p.status)).join('')}
        </div>
        ${legendRow()}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Total Chemical Injection Trend</h3><div class="card-sub">Sum of all programs and selected platform(s), daily</div></div>
        <div class="card-body"><div id="exec-trend" style="height:300px;"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Platform Comparison</h3><div class="card-sub">Cumulative actual injection by platform, all programs</div></div>
        <div class="card-body"><div id="exec-platform" style="height:300px;"></div></div>
      </div>
    </div>`;

  // AI summary combining top signals
  let lines = [];
  progAgg.forEach(p => { if (p.status === 'red') lines.push(`<b>${p.label}:</b> compliance ${fmt.pct(p.pct)} — outside ±10% control band across selected platforms.`); });
  if (budgetStatus === 'red') lines.push(`<b>Budget:</b> aggregate expense variance exceeds the ±10% control limit versus planned budget.`);
  if (worstCorrStatus === 'red') lines.push(`<b>Corrosion:</b> at least one monitored zone reads above 5 MPY (latest ${fmt.num(worstCorr,2)} MPY) — critical band.`);
  progAgg.forEach(p => { if (p.status === 'yellow') lines.push(`<b>${p.label}:</b> compliance ${fmt.pct(p.pct)} — moderate deviation (5–10%).`); });
  document.getElementById('exec-ai').innerHTML = aiPanel('Executive AI Summary', lines.length ? lines : null);

  // daily combined trend: build union of dates across programs/platforms and sum actual/target
  queueChart(() => {
    const dateMap = {};
    progKeys.forEach(pk => plats.forEach(p => {
      const sheet = AppData.programs[pk][p];
      if (!sheet) return;
      filterRows(sheet.rows, currentFilters()).forEach(r => {
        dateMap[r.date] = dateMap[r.date] || { target:0, actual:0 };
        if (typeof r.total.target === 'number') dateMap[r.date].target += r.total.target;
        if (typeof r.total.actual === 'number') dateMap[r.date].actual += r.total.actual;
      });
    }));
    const dates = Object.keys(dateMap).sort();
    if (!dates.length) { document.getElementById('exec-trend').innerHTML = emptyState('No Data Available','No records match the selected filters.'); return; }
    Plotly.newPlot('exec-trend', [
      { x:dates, y:dates.map(d=>dateMap[d].target), name:'Target', type:'scatter', mode:'lines', line:{ color:'#9AA6B2', width:1.4, dash:'dot' } },
      { x:dates, y:dates.map(d=>dateMap[d].actual), name:'Actual', type:'scatter', mode:'lines', fill:'tozeroy', fillcolor:'rgba(0,100,157,.08)', line:{ color:'#00649D', width:2 } }
    ], plotlyLayout({}), plotlyConfig);

    const platTotals = plats.map(p => {
      let a = 0, any=false;
      progKeys.forEach(pk => { const sheet = AppData.programs[pk][p]; if (!sheet) return; const s=sumRows(filterRows(sheet.rows,currentFilters()), r=>r.total.actual); if (s!==null){a+=s;any=true;} });
      return any?a:0;
    });
    Plotly.newPlot('exec-platform', [{ x: plats.map(p=>PLATFORM_LABEL[p]), y: platTotals, type:'bar', marker:{ color:['#00649D','#F7921E'] } }], plotlyLayout({}), plotlyConfig);
  });
}

/* ============================================================ INJECTION OVERVIEW */
function renderInjectionOverview() {
  setSub(`Consolidated view across PPD, Scale, Gas CI, Liquid CI and H2S Scavenger — ${periodLabel()}`);
  const plats = platformsToShow();
  const progKeys = Object.keys(PROGRAM_LABEL);
  const c = document.getElementById('page-content');

  const rowsByProg = progKeys.map(pk => {
    let target=0, actual=0, any=false;
    plats.forEach(p => { const sheet = AppData.programs[pk][p]; if (!sheet) return; const cc = complianceOf(filterRows(sheet.rows, currentFilters())); if (cc.target!==null){target+=cc.target; actual+=cc.actual; any=true;} });
    return { pk, label: PROGRAM_LABEL[pk], target: any?target:null, actual: any?actual:null, pct: any&&target? actual/target*100 : null, status: any? RULES.injectionStatus(target,actual):'gray' };
  });

  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Injection Compliance by Program</h3><div class="card-sub">Cumulative Actual vs Target, ${PLATFORM_LABEL[state.filters.platform]}</div></div>
      <div class="card-body"><div id="inj-bar" style="height:320px;"></div>${legendRow()}</div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>Daily Total Injection — All Programs</h3></div>
        <div class="card-body"><div id="inj-trend" style="height:300px;"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Compliance Table</h3></div>
        <div class="card-body">
          <table class="data-table"><thead><tr><th>Program</th><th>Target (L)</th><th>Actual (L)</th><th>Compliance</th><th>Status</th></tr></thead>
          <tbody>${rowsByProg.map(r => `<tr><td>${r.label}</td><td>${fmt.num(r.target)}</td><td>${fmt.num(r.actual)}</td><td>${r.pct!==null?fmt.pct(r.pct):'—'}</td><td>${statusPill(r.status)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
    </div>`;

  queueChart(() => {
    Plotly.newPlot('inj-bar', [
      { x: rowsByProg.map(r=>r.label), y: rowsByProg.map(r=>r.target), name:'Target', type:'bar', marker:{ color:'#DCE3EA' } },
      { x: rowsByProg.map(r=>r.label), y: rowsByProg.map(r=>r.actual), name:'Actual', type:'bar', marker:{ color:'#00649D' } }
    ], plotlyLayout({ barmode:'group' }), plotlyConfig);

    const dateMap = {};
    progKeys.forEach(pk => plats.forEach(p => {
      const sheet = AppData.programs[pk][p]; if (!sheet) return;
      filterRows(sheet.rows, currentFilters()).forEach(r => {
        dateMap[r.date] = dateMap[r.date] || { target:0, actual:0 };
        if (typeof r.total.target==='number') dateMap[r.date].target += r.total.target;
        if (typeof r.total.actual==='number') dateMap[r.date].actual += r.total.actual;
      });
    }));
    const dates = Object.keys(dateMap).sort();
    if (!dates.length) { document.getElementById('inj-trend').innerHTML = emptyState('No Data Available'); return; }
    Plotly.newPlot('inj-trend', [
      { x:dates, y:dates.map(d=>dateMap[d].target), name:'Target', type:'scatter', mode:'lines', line:{ color:'#9AA6B2', dash:'dot' } },
      { x:dates, y:dates.map(d=>dateMap[d].actual), name:'Actual', type:'scatter', mode:'lines', line:{ color:'#00649D', width:2 } }
    ], plotlyLayout({}), plotlyConfig);
  });
}

/* ============================================================ GENERIC PROGRAM PAGE */
function renderProgramPage(progKey) {
  const label = PROGRAM_LABEL[progKey];
  setSub(`${label} — Injection performance vs. target — ${periodLabel()}`);
  const plats = platformsToShow();
  const c = document.getElementById('page-content');
  const filters = currentFilters();

  let kpis = '';
  let chartCards = '';
  let tableSections = '';
  let usageTotal = 0, usageAny = false;
  const allLines = [];

  plats.forEach(p => {
    const sheet = AppData.programs[progKey][p];
    if (!sheet) { kpis += kpiCard(`${PLATFORM_LABEL[p]}`, 'No Data', '', 'Sheet not found in workbook', 'gray'); return; }
    const rows = filterRows(sheet.rows, filters);
    const cc = complianceOf(rows);
    const usage = sumRows(rows, r => r.usage);
    if (usage !== null) { usageTotal += usage; usageAny = true; }
    kpis += kpiCard(`${PLATFORM_LABEL[p]} Compliance`, cc.pct!==null?fmt.pct(cc.pct):'No Data', '', cc.target!==null?`${fmt.num(cc.actual)} / ${fmt.num(cc.target)} L`:'No records in filter range', cc.status);

    const trendId = nextChartId(), barId = nextChartId(), corrId = nextChartId();
    chartCards += `<div class="grid-2">
      <div class="card"><div class="card-head"><h3>${PLATFORM_LABEL[p]} — Daily Actual vs Target</h3></div><div class="card-body"><div id="${trendId}" style="height:280px;"></div></div></div>
      <div class="card"><div class="card-head"><h3>${PLATFORM_LABEL[p]} — Injection Point Comparison</h3><div class="card-sub">Cumulative for selected period</div></div><div class="card-body"><div id="${barId}" style="height:280px;"></div></div></div>
    </div>`;
    if (sheet.hasCorrosion) {
      chartCards += `<div class="card"><div class="card-head"><h3>${PLATFORM_LABEL[p]} — Corrosion Rate by Zone</h3><div class="card-sub">MPY, thresholds at 2 and 5</div></div><div class="card-body"><div id="${corrId}" style="height:280px;"></div></div></div>`;
    }

    queueChart(() => {
      if (!rows.length) { document.getElementById(trendId).innerHTML = emptyState('No Data Available'); document.getElementById(barId).innerHTML=''; return; }
      dailyTrendChart(trendId, rows, { unit:'L' });
      zoneBarChart(barId, rows, sheet.zones);
      if (sheet.hasCorrosion) corrosionTrendChart(corrId, rows, sheet.zones.filter(z => rows.some(r => r.corrosion[z] !== undefined && r.corrosion[z] !== null)));
    });

    const tableId = `tbl_${progKey}_${p}`;
    const cols = [{ key:'date', label:'Date' }, ...sheet.zones.flatMap(z => [{ key:`t_${z}`, label:`Target ${z}`, fmt: v=>fmt.num(v) }, { key:`a_${z}`, label:`Actual ${z}`, fmt: v=>fmt.num(v) }]), { key:'tt', label:'Total Target', fmt:v=>fmt.num(v) }, { key:'ta', label:'Total Actual', fmt:v=>fmt.num(v) }];
    const tblRows = rows.map(r => {
      const o = { date:r.date, tt:r.total.target, ta:r.total.actual };
      sheet.zones.forEach(z => { o[`t_${z}`] = r.zones[z]?.target ?? null; o[`a_${z}`] = r.zones[z]?.actual ?? null; });
      return o;
    });
    tableSections += `<div class="card"><div class="card-head"><h3>${PLATFORM_LABEL[p]} — Daily Injection Data</h3></div><div class="card-body"><div id="${tableId}"></div></div></div>`;
    queueChart(() => renderTable(tableId, cols, tblRows));
  });

  const lines = insightForProgram(progKey, AppData.programs[progKey], filters);

  c.innerHTML = `
    <div class="kpi-row">${kpis}${usageAny ? kpiCard('Chemical Usage', fmt.num(usageTotal), 'L', 'Sum, selected platforms & period', null) : ''}</div>
    ${aiPanel(`${label} — AI Engineering Insight`, lines)}
    ${chartCards}
    ${tableSections}
    ${progKey==='ppd' ? `<div class="card"><div class="card-body"><div class="empty-state" style="padding:20px;"><b>Note:</b> The source workbook does not include Operating Temperature or Wax Appearance Temperature (WAT) measurements for the PPD program, so Thermal Margin and Wax Risk cannot be calculated. This dashboard reports injection compliance only, which is fully supported by the source data.</div></div></div>` : ''}
  `;
}

/* ============================================================ H2S PAGE */
function renderH2SPage() {
  setSub(`H2S Scavenger — injection performance and gas-stream H2S monitoring — ${periodLabel()}`);
  const plats = platformsToShow();
  const filters = currentFilters();
  const c = document.getElementById('page-content');

  let kpis = '';
  let sections = '';

  plats.forEach(p => {
    const sheet = AppData.programs.h2s[p];
    if (!sheet) { kpis += kpiCard(`${PLATFORM_LABEL[p]} Injection`, 'No Data', '', 'Sheet not found', 'gray'); return; }
    const rows = filterRows(sheet.rows, filters);
    const cc = complianceOf(rows);
    kpis += kpiCard(`${PLATFORM_LABEL[p]} Injection Compliance`, cc.pct!==null?fmt.pct(cc.pct):'No Data', '', cc.target!==null?`${fmt.num(cc.actual)} / ${fmt.num(cc.target)} L`:'No records in range', cc.status);

    const trendId = nextChartId(), barId = nextChartId();
    sections += `<div class="grid-2">
      <div class="card"><div class="card-head"><h3>${PLATFORM_LABEL[p]} — Daily Injection</h3></div><div class="card-body"><div id="${trendId}" style="height:270px;"></div></div></div>
      <div class="card"><div class="card-head"><h3>${PLATFORM_LABEL[p]} — Injection Point Comparison</h3></div><div class="card-body"><div id="${barId}" style="height:270px;"></div></div></div>
    </div>`;
    queueChart(() => { if (rows.length) { dailyTrendChart(trendId, rows, { unit:'L' }); zoneBarChart(barId, rows, sheet.zones); } else { document.getElementById(trendId).innerHTML = emptyState('No Data Available'); } });

    // H2S ppm monitoring, if columns present
    const ppmKey = sheet.h2sKeys.find(k => /^Actual_H2S$/i.test(k));
    const streamKeys = sheet.h2sKeys.filter(k => /^H2S_/i.test(k));
    if (ppmKey || streamKeys.length) {
      const latest = rows.length ? rows[rows.length - 1] : null;
      const streams = [];
      if (ppmKey) streams.push({ name: 'Sales Gas H2S', key: ppmKey, type: 'salesgas' });
      streamKeys.forEach(k => {
        const name = k.replace(/^H2S_/, '');
        let type = 'gasline';
        if (/fuel/i.test(name)) type = 'fuelgas';
        else if (/oil/i.test(name)) type = 'oilline';
        streams.push({ name, key: k, type });
      });
      const gaugeId = nextChartId();
      sections += `<div class="card">
        <div class="card-head"><h3>${PLATFORM_LABEL[p]} — H2S Gas Stream Monitoring</h3><div class="card-sub">Latest reading vs specification limit, ppm (H2S-Category rules)</div></div>
        <div class="card-body">
          <div class="kpi-row">
          ${streams.map(s => {
            const v = latest ? latest.h2s[s.key] : null;
            const st = typeof v === 'number' ? RULES.h2sStatus(s.type, v) : 'gray';
            return kpiCard(s.name, typeof v==='number'?fmt.num(v,2):'No Data', 'ppm', latest?`As of ${latest.date}`:'', st);
          }).join('')}
          </div>${legendRow()}
        </div>
      </div>`;
    }
  });

  const injLines = insightForProgram('h2s', AppData.programs.h2s, filters) || [];
  const ppmLines = [];
  plats.forEach(p => {
    const sheet = AppData.programs.h2s[p]; if (!sheet) return;
    const rows = filterRows(sheet.rows, filters); if (!rows.length) return;
    const latest = rows[rows.length-1];
    const ppmKey = sheet.h2sKeys.find(k => /^Actual_H2S$/i.test(k));
    if (ppmKey && typeof latest.h2s[ppmKey] === 'number') {
      const st = RULES.h2sStatus('salesgas', latest.h2s[ppmKey]);
      if (st === 'red') ppmLines.push(`<b>${PLATFORM_LABEL[p]} Sales Gas H2S:</b> ${fmt.num(latest.h2s[ppmKey],2)} ppm exceeds the 16 ppm limit as of ${latest.date}.`);
      else if (st === 'yellow') ppmLines.push(`<b>${PLATFORM_LABEL[p]} Sales Gas H2S:</b> ${fmt.num(latest.h2s[ppmKey],2)} ppm is approaching the 16 ppm limit (14–16 ppm band) as of ${latest.date}.`);
    }
    sheet.h2sKeys.filter(k=>/^H2S_/i.test(k)).forEach(k => {
      const v = latest.h2s[k]; if (typeof v !== 'number') return;
      const name = k.replace(/^H2S_/,'');
      let type='gasline'; if (/fuel/i.test(name)) type='fuelgas'; else if (/oil/i.test(name)) type='oilline';
      const st = RULES.h2sStatus(type, v);
      if (st==='red') ppmLines.push(`<b>${PLATFORM_LABEL[p]} ${name}:</b> ${fmt.num(v,2)} ppm exceeds the specification limit as of ${latest.date}.`);
    });
  });
  const allLines = [...injLines, ...ppmLines];

  c.innerHTML = `<div class="kpi-row">${kpis}</div>${aiPanel('H2S Scavenger — AI Engineering Insight', allLines.length?allLines:null)}${sections}`;
}

/* ============================================================ CORROSION OVERVIEW */
function renderCorrosionPage() {
  setSub(`Consolidated corrosion monitoring — Gas CI and Liquid CI zones — ${periodLabel()}`);
  const plats = platformsToShow();
  const filters = currentFilters();
  const c = document.getElementById('page-content');
  let rowsFound = false;
  let cardsHtml = '';
  const statusRows = [];

  ['gasci', 'liquidci'].forEach(pk => {
    plats.forEach(p => {
      const sheet = AppData.programs[pk][p];
      if (!sheet || !sheet.hasCorrosion) return;
      const rows = filterRows(sheet.rows, filters);
      if (!rows.length) return;
      const zones = sheet.zones.filter(z => rows.some(r => typeof r.corrosion[z] === 'number'));
      if (!zones.length) return;
      rowsFound = true;
      const chartId = nextChartId();
      cardsHtml += `<div class="card"><div class="card-head"><h3>${PROGRAM_LABEL[pk]} — ${PLATFORM_LABEL[p]}</h3><div class="card-sub">Corrosion rate by zone, MPY</div></div><div class="card-body"><div id="${chartId}" style="height:280px;"></div>${legendRow()}</div></div>`;
      queueChart(() => corrosionTrendChart(chartId, rows, zones));
      zones.forEach(z => {
        const v = latestNonNull(rows, r => r.corrosion[z]);
        statusRows.push({ program: PROGRAM_LABEL[pk], platform: PLATFORM_LABEL[p], zone: z, value: v, status: v!==null?RULES.corrosionStatus(v):'gray' });
      });
    });
  });

  const insightLines = [];
  ['gasci','liquidci'].forEach(pk => { const l = insightForCorrosion(AppData.programs[pk], filters); if (l) insightLines.push(...l); });

  c.innerHTML = `
    ${aiPanel('Corrosion — AI Engineering Insight', insightLines.length?insightLines:null)}
    <div class="card">
      <div class="card-head"><h3>Latest Corrosion Status by Zone</h3></div>
      <div class="card-body">
        <table class="data-table"><thead><tr><th>Program</th><th>Platform</th><th>Zone / Pipeline</th><th>Latest MPY</th><th>Status</th></tr></thead>
        <tbody>${statusRows.length ? statusRows.map(r=>`<tr><td>${r.program}</td><td>${r.platform}</td><td>${r.zone}</td><td>${r.value!==null?fmt.num(r.value,2):'—'}</td><td>${statusPill(r.status)}</td></tr>`).join('') : `<tr><td colspan="5" style="text-align:center;color:#9AA6B2;padding:16px;">No corrosion data in current filter range</td></tr>`}</tbody></table>
        ${legendRow()}
      </div>
    </div>
    ${rowsFound ? `<div class="grid-2">${cardsHtml}</div>` : emptyState('No Data Available', 'No corrosion coupon/probe readings found for the selected filters.')}
  `;
}

/* ============================================================ BUDGET */
function renderBudgetPage() {
  setSub(`Planned vs. Expense chemical budget — ${periodLabel()}`);
  const plats = platformsToShow();
  const filters = currentFilters();
  const c = document.getElementById('page-content');
  const progKeys = Object.keys(PROGRAM_LABEL);

  const rows = [];
  let totalPlanned = 0, totalExpense = 0, any = false;
  progKeys.forEach(pk => plats.forEach(p => {
    const sheet = AppData.cost[pk] ? AppData.cost[pk][p] : null;
    if (!sheet || !sheet.hasBudget) { rows.push({ program: PROGRAM_LABEL[pk], platform: PLATFORM_LABEL[p], planned:null, expense:null, status:'gray' }); return; }
    const frows = filterRows(sheet.rows, filters);
    const pl = sumRows(frows, r => r.budget.planned), ex = sumRows(frows, r => r.budget.expense);
    if (pl !== null) { totalPlanned += pl; totalExpense += (ex||0); any = true; }
    rows.push({ program: PROGRAM_LABEL[pk], platform: PLATFORM_LABEL[p], planned: pl, expense: ex, status: pl!==null?RULES.costStatus(pl, ex):'gray' });
  }));

  const overallStatus = any ? RULES.costStatus(totalPlanned, totalExpense) : 'gray';
  const insightLines = [];
  progKeys.forEach(pk => { const l = insightForBudget(AppData.cost[pk] || {}, filters); if (l) insightLines.push(...l); });

  c.innerHTML = `
    <div class="kpi-row">
      ${kpiCard('Total Planned Budget', any?fmt.currency(totalPlanned):'No Data', '', 'Sum across programs & platforms', null)}
      ${kpiCard('Total Expense', any?fmt.currency(totalExpense):'No Data', '', '', null)}
      ${kpiCard('Variance', any&&totalPlanned? fmt.pct((totalExpense-totalPlanned)/totalPlanned*100):'—', '', '', overallStatus)}
      ${kpiCard('Overall Budget Status', STATUS_LABEL[overallStatus], '', '', overallStatus)}
    </div>
    ${aiPanel('Budget — AI Engineering Insight', insightLines.length?insightLines:null)}
    <div class="card">
      <div class="card-head"><h3>Planned vs Expense by Program</h3></div>
      <div class="card-body"><div id="budget-bar" style="height:320px;"></div>${legendRow()}</div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Budget Detail</h3></div>
      <div class="card-body">
        <table class="data-table"><thead><tr><th>Program</th><th>Platform</th><th>Planned</th><th>Expense</th><th>Variance</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.program}</td><td>${r.platform}</td><td>${r.planned!==null?fmt.currency(r.planned):'No Data'}</td><td>${r.expense!==null?fmt.currency(r.expense):'—'}</td><td>${r.planned?fmt.pct((r.expense-r.planned)/r.planned*100):'—'}</td><td>${statusPill(r.status)}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;

  queueChart(() => {
    const labels = rows.map(r => `${r.program} (${r.platform})`);
    Plotly.newPlot('budget-bar', [
      { x: labels, y: rows.map(r=>r.planned), name:'Planned', type:'bar', marker:{ color:'#DCE3EA' } },
      { x: labels, y: rows.map(r=>r.expense), name:'Expense', type:'bar', marker:{ color:'#F7921E' } }
    ], plotlyLayout({ barmode:'group', xaxis:{ tickangle:-30 } }), plotlyConfig);
  });
}

/* ============================================================ FACILITY / PRODUCTION (no data in workbook) */
function renderFacilityPage() {
  setSub('Facility process overview and production performance');
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="card">
      <div class="card-body">
        <div class="empty-state">
          <div class="es-ic">&#127981;</div>
          <h4>No Data Available</h4>
          <div>The uploaded workbook (<code>ChemicalUsage.xlsx</code>) contains chemical injection, corrosion, and cost data only. It does not include a P&amp;ID / equipment tag list, live process values (pressure, flowrate, temperature), or a daily oil / gas / water production dataset.</div>
          <div style="margin-top:10px;">Per the project's data-integrity rule, this dashboard will not fabricate an interactive process diagram or production KPIs. The Production-Rate status rule (Gas/Oil/Water vs. plan, Green ≥ plan, Yellow ≤5% below, Red &gt;5% below) is retained below and will activate automatically once a production dataset with matching Date/Platform/Actual/Target columns is added to the workbook.</div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Retained Rule Set — Production Rate (awaiting data)</h3></div>
      <div class="card-body">
        <table class="data-table"><thead><tr><th>Stream</th><th>Green</th><th>Yellow</th><th>Red</th></tr></thead>
        <tbody>
          <tr><td>Oil</td><td>Actual ≥ Target</td><td>Actual within 5% below Target</td><td>Actual &gt;5% below Target</td></tr>
          <tr><td>Gas</td><td>Actual ≥ Target</td><td>Actual within 5% below Target</td><td>Actual &gt;5% below Target</td></tr>
          <tr><td>Water</td><td>At/below plan</td><td>Within 5% above plan</td><td>&gt;5% above plan</td></tr>
        </tbody></table>
      </div>
    </div>`;
}
