# Searah Chemical Injection Engineering Dashboard

A static, client-side engineering dashboard that reads the chemical usage
workbook directly in the browser (via SheetJS) and renders injection
compliance, corrosion, H2S monitoring, and chemical budget performance.
No backend, no database — every number on screen is parsed live from
`data/ChemicalUsage.xlsx`.

## What is implemented (with real data from the workbook)

| Page | Source sheets |
|---|---|
| Executive Summary | Roll-up of all program sheets below |
| Chemical Injection (overview) | All 5 program sheets, combined |
| PPD | `PPD BTJT-A 2025`, `PPD BTJT-B 2025` |
| Liquid CI | `Liquid CI BTJT-A 2025`, `Liquid CI BTJT-B 2025` (+ corrosion rate columns) |
| Gas CI | `Gas CI BTJT-A 2025`, `Gas CI BTJT-B 2025` (+ corrosion rate columns) |
| Scale Inhibitor | `Scale Inhibitor BTJT-A 2025`, `Scale Inhibitor BTJT-B 2023` |
| H2S Scavenger | `H2S Scavenger BTJT-A/B 2025`, `H2S Scavenger BTJT-B FPSO` (+ H2S ppm columns where present) |
| Corrosion Overview | Consolidated `Corrosion Rate_*` columns from Gas CI and Liquid CI sheets |
| Chemical Budget | All `Cost of *` sheets (`Planned_Budget` / `Expense_Budget`) |

## What is intentionally **not** fabricated

The original brief also called for a Production Dashboard and an
interactive Facility Process Overview (P&ID). The uploaded workbook
contains **no** production (oil/gas/water) dataset and **no** equipment
tag / P&ID data — only chemical injection, corrosion, and cost sheets.
Per the project's data-integrity rule ("never invent numbers, never
create placeholder KPIs"), the **Facility & Production** page shows
"No Data Available" rather than inventing figures or a mock process
diagram. The Production-Rate status rule is retained in the code
(`RULES` object is easy to extend) so it activates automatically once a
matching dataset is supplied.

Similarly, the PPD page reports injection compliance only — the
workbook has no Operating Temperature / Wax Appearance Temperature
columns, so Thermal Margin and Wax Risk are not calculated.

## Engineering rules used (transcribed from the supplied rule files)

- **Injection compliance** (`Injection-limit.txt`): the source rule gives
  three deviation bands (`>5%` green, `5–10%` yellow, `+10%` red) without
  stating the basis explicitly. This app applies it to
  `|Actual − Target| / Target`, i.e. **<5% deviation = Green, 5–10% =
  Yellow, >10% = Red**. This is stated as an assumption in `js/engine.js`
  — confirm it matches your intended compliance basis before relying on
  it for reporting.
- **Corrosion rate** (`Corrosion-Rate.txt`): <2 MPY Green, 2–5 MPY
  Yellow, >5 MPY Red.
- **Chemical budget** (`Cost.txt`): exact match Green, ≤10% variance
  Yellow, >10% variance Red (basis: `|Expense − Planned| / Planned`).
- **H2S ppm** (`H2S-Category.txt`): separate bands per stream (Fuel Gas,
  Sales Gas, Oil Line, Gas Line) as given in the source file. Streams in
  the FPSO sheet without an explicit category (e.g. "COT Vent Header")
  default to the Gas Line band as the closest match — flagged in code.

All thresholds live in the `RULES` object in `js/engine.js` so they can
be corrected in one place if any assumption above doesn't match actual
engineering intent.

## Running locally / deploying to GitHub Pages

```
chemical-injection-dashboard/
├── index.html
├── css/style.css
├── js/engine.js   (data parsing + rules)
├── js/app.js      (filters, navigation, chart/table helpers)
├── js/pages.js    (page renderers)
├── data/ChemicalUsage.xlsx
└── .github/workflows/deploy.yml
```

1. Push this folder to a GitHub repository.
2. Enable GitHub Pages → Source: GitHub Actions (the included workflow
   deploys on every push to `main`).
3. The app fetches `data/ChemicalUsage.xlsx` automatically on load. To
   refresh the data, replace that file and push.

**Opening `index.html` directly from disk (file://), or previewing it
in a sandboxed viewer**, browsers block `fetch()` of local files, so the
app automatically falls back to a drag-and-drop / file-picker loader —
select the same workbook there and the dashboard renders identically.

## Filters

- **Year** and **Month** are multi-select. Selecting several months
  shows daily data across the union of those months (not aggregated),
  per the brief.
- **Platform** switches between BTJT-A, BTJT-B, BTJT-B FPSO (H2S only),
  or both main platforms combined.

## Known simplifications vs. the original 11-page brief

To keep every figure traceable to the workbook, this build consolidates
the originally-specified page list into the 10 pages above and does not
include: a well-level drill-down (no well-tagged data in the workbook,
only zone/pipeline-tagged), a live SVG P&ID (no equipment/tag data), and
PDF export of tables (CSV export is implemented). These can be added
once the corresponding source data is available.
