# Changelog

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
