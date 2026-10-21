# Changelog

## 1.1.0 - 2026-10-21

- VET files: Excel export (Elements, Participant estimates, Goals, Settings with the full configuration) and import
  (own files and the reference tool's .xlsx) without a library; PNG and SVG of the current view; board files checked
  against `board.schema.json`; manual column and type mapping; a change summary before a configuration is applied.
- VET helpers: references (anchors, the nearest two while dragging), metrics and formulas with a safe expression
  language and RICE / Value-Effort / WSJF templates, manual override and "Back to formula", goals tree with "Why?",
  counts, sums, filters, weights and `.vet-goals.json`.
- VET: keyboard placement from the tray, aria values on the 2D plane, readable bucket labels, RTL layout, languages
  from the files in `locales/`, `vet.resize` in the bridge, indexed estimates (5000 elements stay fast), the list
  grows by chunks while scrolling.
- VSS: Escape cancels a drag, warnings before deleting flows with VET results, a preview and Retry for VET, Export SVG,
  PNG size choice, a migration wizard for older files, routing around converters, actions next to a selected converter.
- Both: a dark theme (`data-theme="dark"` or `"auto"` on the tool root; the package pages use "auto").
- Team kit: `team/reference_server.py` (reference backend) and `team/contract_tests.py` (31 contract rules);
  `tests/` with 28 core tests.

Not yet: WebSocket realtime, per-participant metric values.

## 1.0.0 - 2026-10-17

First downloadable release, the same code as https://aeilus.institute/tools/ on this date.

- VET: two scales with buckets, anti-value, 1D and 2D views, paste a list (with an example), sequence mode with keys
  1-9, autoscale, CSV / JSON import and export, configuration export, 20 interface languages, Undo / Redo.
- VET team mode (with a backend implementing `contracts/openapi.yaml`): links by role, open, blind and shared estimation,
  reveal, median and spread, discrepancies filter, fixed final values, close session, versions.
- VSS: converters, flows, element types and routing, external inputs and outputs, merge, legacy 2.x migration with a
  report, JSON and PNG export, help; "Estimate in VET" with the board snapshot kept in the schema.
- VSS server mode (with a backend): save, autosave, one editor at a time with conflict choice, versions, links.
- Contracts: `openapi.yaml`, `board.schema.json`, `vss.schema.json`, `vet-bridge.schema.json`.

Not yet: XLSX, PNG of VET, SVG of VSS, contract tests for third-party backends, a reference backend, WebSocket realtime.
