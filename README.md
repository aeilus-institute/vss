# ÆVRI value tools: VET and VSS

Open tools of the [Aeilus Value Research Institute (ÆVRI)](https://aeilus.institute/tools/) for working with value.

- **VET - Value Estimation Tool.** Put a list of elements (tasks, ideas, risks) on two scales: what each one gives
  (outgoing value) and what it takes (incoming value). The list is sorted by priority at once. Buckets from LOW to BIG,
  anti-value, a 2D board, paste from a spreadsheet, CSV and JSON import and export.
- **VSS - Value System Schema editor.** Draw how value moves through a system: converters (teams, services,
  subsystems), flows of value and anti-value, element types. Estimate any flow in VET and see the result on the flow.
  JSON and PNG export.

The same code runs on https://aeilus.institute/tools/ (with team mode on the institute server).

## Run

The tools are plain ES modules: no build step, no dependencies. Browsers do not load modules from `file://`, so serve
the folder with any static web server:

```bash
python -m http.server 8080
```

Then open http://localhost:8080/ . Language: the browser language, or `?lang=ru` (20 languages in `*/assets/locales`).
Your data stays in the browser tab. Export the board or the schema to keep it.

## Packages

| File | What is inside |
| --- | --- |
| `aevri-vet-editor-<v>.zip` | VET alone (`vet/`) |
| `aevri-vss-editor-<v>.zip` | VSS alone (`vss/`), without the VET buttons |
| `aevri-value-tools-<v>.zip` | VSS and VET together, plus the Team kit (`team/`, `contracts/openapi.yaml`) |

## Embed in your system

**A page of your own.** Copy `vet/` (or `vss/`) and put the container on any page:

```html
<link rel="stylesheet" href="/value-tools/vet/assets/vet.css">
<div id="vet" class="vet" data-share="off"></div>
<script type="module" src="/value-tools/vet/assets/vet-ui.js"></script>
```

Settings are `data-*` attributes of the container:

| Attribute | Tool | Meaning |
| --- | --- | --- |
| `data-share="off"` | VET | no "Share with a team" button (no backend) |
| `data-server="off"` | VSS | no "Save to Institute" (no backend) |
| `data-vet="<url>"` / `"off"` | VSS | the VET page used in the "Estimate in VET" dialog, or no VET |
| `data-embed="vss"` | VET | VET runs inside VSS and talks to it by `postMessage` |
| `data-api`, `data-signin`, `data-board`, `data-schema` | both | team mode, see `team/README.md` |

**VET inside your own host (iframe + postMessage).** Load `vet/embed.html` in an iframe from the same origin and talk
to it with the protocol `aevri.vet` version 1 (`contracts/vet-bridge.schema.json`):

```js
const frame = document.querySelector('iframe#vet');
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data;
  if (m.protocol !== 'aevri.vet' || m.version !== 1) return;
  if (m.type === 'vet.ready') frame.contentWindow.postMessage({ protocol: 'aevri.vet', version: 1, type: 'vss.open', requestId: 'r1',
    payload: { flowRef: { vssSchemaId: 's1', flowId: 'f1', flowLabel: 'Orders', sourceNode: { id: 'n1', name: 'Shop' }, targetNode: null }, items: [] } }, location.origin);
  if (m.type === 'vet.result') console.log('totals', m.payload.totals, 'items', m.payload.items);
  if (m.type === 'vet.cancel') frame.remove();
}, false);
```

**Files.** VET boards are `.vet.json` (`contracts/board.schema.json`), VSS schemas are `.vss.json`
(`contracts/vss.schema.json`). Item lists also go in and out as CSV with English headers.

## Licence

Apache License 2.0 (`LICENSE`). Keep the `NOTICE` file and the small "Created by Aeilus Institute" line when you
redistribute or embed the tools.
