/* =========================================================================
   SEARAH CHEMICAL INJECTION ENGINEERING DASHBOARD
   engine.js — data loading, parsing, deterministic engineering rules
   Single source of truth: the uploaded Excel workbook. Nothing here
   invents, estimates, or interpolates a number. If a metric is not
   present in the workbook, the UI must show "No Data Available".
   ========================================================================= */

const SHEET_MAP = {
  ppd:      { A: 'PPD BTJT-A 2025',              B: 'PPD BTJT-B 2025' },
  scale:    { A: 'Scale Inhibitor BTJT-A 2025',  B: 'Scale Inhibitor BTJT-B 2023' },
  gasci:    { A: 'Gas CI BTJT-A 2025',           B: 'Gas CI BTJT-B 2025' },
  liquidci: { A: 'Liquid CI BTJT-A 2025',        B: 'Liquid CI BTJT-B 2025' },
  h2s:      { A: 'H2S Scavenger BTJT-A 2025',    B: 'H2S Scavenger BTJT-B 2025', FPSO: 'H2S Scavenger BTJT-B FPSO' }
};
const COST_SHEET_MAP = {
  ppd:      { A: 'Cost of PPD BTJT-A ',              B: 'Cost of PPD BTJT-B' },
  scale:    { A: 'Cost of Scale Inhibitor BTJT-A ',  B: 'Cost of Scale Inhibitor BTJT-B' },
  gasci:    { A: 'Cost of Gas CI BTJT-A',            B: 'Cost of Gas CI BTJT-B' },
  liquidci: { A: 'Cost of Liquid CI BTJT-A',         B: 'Cost of Liquid CI BTJT-B' },
  h2s:      { A: 'Cost of H2S Scavenger BTJT-A',     B: 'Cost of H2S Scavenger BTJT-B' }
};

const PROGRAM_LABEL = {
  ppd: 'PPD (Pour Point Depressant)',
  scale: 'Scale Inhibitor',
  gasci: 'Gas Corrosion Inhibitor',
  liquidci: 'Liquid Corrosion Inhibitor',
  h2s: 'H2S Scavenger'
};

/* -------------------------------------------------------------------------
   ENGINEERING THRESHOLD RULES
   Transcribed verbatim from the source rule files supplied with this
   project (Injection-limit, Corrosion-Rate, Cost, H2S-Category,
   Production-Rate). Where a source rule was ambiguous, the assumption
   made to render it as executable logic is documented inline.
   ------------------------------------------------------------------------- */
const RULES = {
  // Injection-limit.txt: ">5%=green, 5-10%=yellow, +10%=red"
  // ASSUMPTION: this bands the absolute deviation of Actual vs Target,
  // |Actual-Target|/Target. <5% deviation = Green, 5-10% = Yellow, >10% = Red.
  injectionStatus(target, actual) {
    if (target === null || target === undefined || actual === null || actual === undefined) return 'gray';
    if (target === 0) return actual === 0 ? 'gray' : 'yellow';
    const dev = Math.abs(actual - target) / Math.abs(target) * 100;
    if (dev > 10) return 'red';
    if (dev >= 5) return 'yellow';
    return 'green';
  },

  // Corrosion-Rate.txt: "<2 MPY green, 2-5 MPY yellow, >5 MPY red"
  corrosionStatus(mpy) {
    if (mpy === null || mpy === undefined || isNaN(mpy)) return 'gray';
    if (mpy > 5) return 'red';
    if (mpy >= 2) return 'yellow';
    return 'green';
  },

  // Cost.txt: "Exact number = Green, <=10% = Yellow, >10% = Merah(Red)"
  // Variance basis: |Expense-Planned|/Planned
  costStatus(planned, expense) {
    if (planned === null || planned === undefined || expense === null || expense === undefined) return 'gray';
    if (planned === 0) return expense === 0 ? 'green' : 'yellow';
    const dev = Math.abs(expense - planned) / Math.abs(planned) * 100;
    if (dev === 0) return 'green';
    if (dev <= 10) return 'yellow';
    return 'red';
  },

  // H2S-Category.txt — per-stream limits, values in ppm
  h2sStatus(stream, ppm) {
    if (ppm === null || ppm === undefined || isNaN(ppm)) return 'gray';
    const bands = {
      fuelgas:   [ [8, 'red'], [7, 'yellow'] ],   // >=8 red, 7-8 yellow, <=7 green
      salesgas:  [ [16.0001, null], [14, 'yellow'], [16, 'red'] ], // handled specially below
      oilline:   [ [40, 'red'], [30, 'yellow'] ],
      gasline:   [ [8, 'red'], [7, 'yellow'] ]
    };
    if (stream === 'salesgas') {
      if (ppm > 16) return 'red';
      if (ppm >= 14) return 'yellow';
      return 'green';
    }
    if (stream === 'oilline') {
      if (ppm > 40) return 'red';
      if (ppm >= 30) return 'yellow';
      return 'green';
    }
    // fuelgas / gasline share the same band
    if (ppm >= 8) return 'red';
    if (ppm >= 7) return 'yellow';
    return 'green';
  }
};

const STATUS_COLOR = {
  green:  '#2E8B57',
  yellow: '#FFC107',
  red:    '#D32F2F',
  gray:   '#9AA6B2'
};
const STATUS_LABEL = { green: 'Normal', yellow: 'Warning', red: 'Critical', gray: 'No Data' };

/* -------------------------------------------------------------------------
   GENERIC SHEET PARSER
   Groups Target_X / Actual_X column pairs into zones, captures Corrosion
   Rate_X columns, Planned_Budget/Expense_Budget, Chemical Usage, and any
   H2S-specific measurement columns, purely from header text — no
   sheet-specific hardcoding of values.
   ------------------------------------------------------------------------- */
function cleanKey(s) {
  return String(s).trim().replace(/^_+|_+$/g, '');
}

function excelDateToStr(v) {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    // Excel serial date fallback
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  return null;
}

function parseSheet(ws, opts = {}) {
  if (!ws) return null;
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!json.length) return { zones: [], rows: [] };
  const headerRow = json[0].map(h => (h === null ? '' : String(h)));

  // classify columns
  const zoneCols = {};      // zoneName -> {targetCol, actualCol}
  const corrCols = {};      // zoneName -> col
  let totalTargetCol = null, totalActualCol = null;
  let platformCol = null, usageCol = null;
  let plannedCol = null, expenseCol = null;
  const h2sCols = []; // { key, col }

  headerRow.forEach((raw, idx) => {
    const h = cleanKey(raw);
    if (!h) return;
    let m;
    if ((m = h.match(/^Target[_ ]+(.+)$/i))) {
      const zone = cleanKey(m[1]);
      if (/^total$/i.test(zone)) { totalTargetCol = idx; return; }
      zoneCols[zone] = zoneCols[zone] || {};
      zoneCols[zone].targetCol = idx;
    } else if ((m = h.match(/^Actual[_ ]+(.+)$/i))) {
      const zone = cleanKey(m[1]);
      if (/^total$/i.test(zone)) { totalActualCol = idx; return; }
      if (/^h2s$/i.test(zone)) { h2sCols.push({ key: 'Actual_H2S', col: idx }); return; }
      zoneCols[zone] = zoneCols[zone] || {};
      zoneCols[zone].actualCol = idx;
    } else if (/^Total_Target$/i.test(h)) totalTargetCol = idx;
    else if (/^Total_Actual$/i.test(h)) totalActualCol = idx;
    else if (/^Platform$/i.test(h)) platformCol = idx;
    else if (/^Chemical Usage$/i.test(h)) usageCol = idx;
    else if (/^Planned[_ ]*Budget$/i.test(h)) plannedCol = idx;
    else if (/^Expense[_ ]*Budget$/i.test(h)) expenseCol = idx;
    else if ((m = h.match(/^Corrosion Rate[_ ]+(.+)$/i))) corrCols[cleanKey(m[1])] = idx;
    else if (/H2S|Limit_|Gas Compressed|Dosage|Under_H2S/i.test(h)) h2sCols.push({ key: h, col: idx });
  });

  const zoneNames = Object.keys(zoneCols).filter(z => zoneCols[z].targetCol !== undefined || zoneCols[z].actualCol !== undefined);

  const rows = [];
  for (let r = 1; r < json.length; r++) {
    const row = json[r];
    if (!row) continue;
    const dateStr = excelDateToStr(row[0]);
    if (!dateStr) continue;
    const zones = {};
    zoneNames.forEach(z => {
      const t = zoneCols[z].targetCol !== undefined ? row[zoneCols[z].targetCol] : null;
      const a = zoneCols[z].actualCol !== undefined ? row[zoneCols[z].actualCol] : null;
      zones[z] = { target: (typeof t === 'number' ? t : null), actual: (typeof a === 'number' ? a : null) };
    });
    const corrosion = {};
    Object.keys(corrCols).forEach(z => {
      const v = row[corrCols[z]];
      corrosion[z] = (typeof v === 'number' ? v : null);
    });
    const h2s = {};
    h2sCols.forEach(({ key, col }) => {
      const v = row[col];
      h2s[key] = (typeof v === 'number' ? v : v);
    });
    rows.push({
      date: dateStr,
      zones,
      total: {
        target: totalTargetCol !== null && typeof row[totalTargetCol] === 'number' ? row[totalTargetCol] : null,
        actual: totalActualCol !== null && typeof row[totalActualCol] === 'number' ? row[totalActualCol] : null
      },
      platform: platformCol !== null ? row[platformCol] : opts.platformFallback || null,
      usage: usageCol !== null && typeof row[usageCol] === 'number' ? row[usageCol] : null,
      corrosion,
      budget: {
        planned: plannedCol !== null && typeof row[plannedCol] === 'number' ? row[plannedCol] : null,
        expense: expenseCol !== null && typeof row[expenseCol] === 'number' ? row[expenseCol] : null
      },
      h2s
    });
  }
  return { zones: zoneNames, rows, hasCorrosion: Object.keys(corrCols).length > 0, hasBudget: plannedCol !== null, h2sKeys: h2sCols.map(c => c.key) };
}

/* -------------------------------------------------------------------------
   WORKBOOK -> APP DATA
   ------------------------------------------------------------------------- */
const AppData = {
  loaded: false,
  programs: {},   // programs[prog][platformKey] = parsed sheet
  cost: {},       // cost[prog][platformKey] = parsed sheet
  meta: { minDate: null, maxDate: null }
};

function loadWorkbook(workbook) {
  AppData.programs = {};
  AppData.cost = {};
  let minDate = null, maxDate = null;

  Object.keys(SHEET_MAP).forEach(prog => {
    AppData.programs[prog] = {};
    Object.keys(SHEET_MAP[prog]).forEach(plat => {
      const sheetName = SHEET_MAP[prog][plat];
      const ws = workbook.Sheets[sheetName];
      const parsed = parseSheet(ws, { platformFallback: plat });
      AppData.programs[prog][plat] = parsed;
      if (parsed) parsed.rows.forEach(r => {
        if (!minDate || r.date < minDate) minDate = r.date;
        if (!maxDate || r.date > maxDate) maxDate = r.date;
      });
    });
  });

  Object.keys(COST_SHEET_MAP).forEach(prog => {
    AppData.cost[prog] = {};
    Object.keys(COST_SHEET_MAP[prog]).forEach(plat => {
      const sheetName = COST_SHEET_MAP[prog][plat];
      const ws = workbook.Sheets[sheetName];
      AppData.cost[prog][plat] = ws ? parseSheet(ws, { platformFallback: plat }) : null;
    });
  });

  AppData.meta.minDate = minDate;
  AppData.meta.maxDate = maxDate;
  AppData.loaded = true;
}

/* Filter rows of a parsed sheet by the global filter state */
function filterRows(rows, filters) {
  if (!rows) return [];
  return rows.filter(r => {
    if (filters.dateFrom && r.date < filters.dateFrom) return false;
    if (filters.dateTo && r.date > filters.dateTo) return false;
    if (filters.months && filters.months.length) {
      const m = parseInt(r.date.slice(5, 7), 10);
      if (!filters.months.includes(m)) return false;
    }
    if (filters.years && filters.years.length) {
      const y = parseInt(r.date.slice(0, 4), 10);
      if (!filters.years.includes(y)) return false;
    }
    return true;
  });
}

function sumRows(rows, path) {
  // path: function(row) -> number|null
  let sum = 0, any = false;
  rows.forEach(r => { const v = path(r); if (typeof v === 'number') { sum += v; any = true; } });
  return any ? sum : null;
}

function latestNonNull(rows, path) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = path(rows[i]);
    if (typeof v === 'number') return v;
  }
  return null;
}
