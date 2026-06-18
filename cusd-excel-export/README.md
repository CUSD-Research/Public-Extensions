# CUSD Excel Export — Tableau Dashboard Extension

A one-click **Download to Excel** button for Tableau dashboards. The dashboard
author chooses *which worksheet(s) the button may export*; viewers click once and
get an `.xlsx` — **with no "which sheet?" prompt.**

Built and maintained by **Chandler Unified School District — Research & Data
Analytics**.

---

## Why it exists

Tableau's native crosstab download always asks the user to pick a sheet, and the
built-in "Download" object still prompts when a dashboard has more than one
sheet — with no way to pre-set that choice. This extension replaces the prompt
with a single button whose target sheets are fixed by the dashboard author.

## What it does

- **One button → one workbook**, with one tab per allowed worksheet.
- The author selects the allowed sheets in **Configure…**; nothing else can be exported.
- Exports the **summary (aggregated) data shown on screen** — not row-level underlying data.
- **Respects row-level security (RLS):** a viewer only ever exports the rows they
  are already permitted to see.
- Optional **"About this export"** tab — the standard FERPA / data-handling
  notice, a confidentiality note, the source dashboard, and a timestamp.
- **Runs entirely in the browser** — the workbook is built client-side with
  SheetJS; no data is sent to any server.

## How it works

```
Tableau dashboard (in the viewer's browser)
        │   the extension reads the worksheet's *summary* data via the Tableau API
        ▼
  excel-export.js  ──builds the .xlsx in the browser (SheetJS)──►  file downloads to the user's computer
```

The extension is a small static web app (HTML/CSS/JS) that Tableau loads inside
the dashboard. It reads the rendered viz data through the Tableau Extensions API
and writes an Excel file locally. **The host (e.g. GitHub Pages) only serves the
code — no viewer data ever passes through it.**

## Files

| File | Purpose |
|------|---------|
| `cusd-excel-export.trex` | The manifest you add to a dashboard. Its `<url>` points at the hosted `index.html`. |
| `index.html` | The in-dashboard view (the button). |
| `excel-export.js` | Button logic: read allowed sheets → build `.xlsx` → download. |
| `configure.html` / `configure.js` | The author-only **Configure…** dialog (choose sheets + options). |
| `styles.css` | Minimal styling. |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon source (SVG) + rendered PNG + a small script that re-renders the PNG and embeds it in the `.trex`. |
| `lib/` | Tableau Extensions API (vendored). |
| `vendor/` | SheetJS / `xlsx` (vendored). |

Both libraries are included in this repo (vendored), so nothing is fetched from a
CDN at runtime.

## Deploy

The extension is just static files on an **HTTPS** origin, plus a one-time
allow-list entry on your Tableau Cloud site.

1. **Host the files** on any HTTPS origin — GitHub Pages, or an internal web
   server your IT controls. Keep `lib/` and `vendor/` alongside the rest.
2. **Point the manifest** at your host: set `<url>` in `cusd-excel-export.trex`
   to your hosted `index.html`.
3. **Allow-list the host on Tableau Cloud** (site admin, one time):
   *Settings → Extensions →* turn on extensions, then add your host (scheme +
   domain) with **Allow / full data**.
4. **Add it to a dashboard:** drag an **Extension** object in → **Access Local
   Extensions** → choose the `.trex` → **Configure…** the allowed sheets → publish.

> Hosting isn't a one-way door: switching hosts is just re-hosting the same files,
> changing the one `<url>`, and allow-listing the new host. No code changes.

**Tableau Desktop note:** you can test the extension in **Tableau Desktop**
without the Cloud allow-list — Desktop simply prompts you to allow it. The
allow-list is only required for Tableau Cloud / published workbooks.

## Configure options

In the **Configure…** dialog the author sets:

- **Allowed sheets** — only these can be exported.
- **File-name prefix** — the file downloads as `PREFIX_YYYYMMDD.xlsx`.
- **"About this export" tab** — toggle on/off, plus an editable confidentiality
  note. (The standard FERPA / data-handling notice is always included on the tab.)
- **Button tooltip** — hover text (the button itself is the icon).

## Privacy & security

- **No data leaves the browser.** Data flows Tableau → the viewer's browser → a
  local file. The host only serves static code.
- **RLS-respecting and allow-listed.** Only the author-approved (aggregate)
  sheets are exportable, and only the rows the viewer can already see.
- **No secrets in this repo** — no credentials, connection strings, or personal
  data; only application code and two open-source libraries.

## Licenses

The bundled libraries keep their own licenses (Tableau Extensions API — MIT;
SheetJS / `xlsx` — Apache-2.0). The CUSD-authored code here is provided as-is;
add a license file if you intend to redistribute it.

## Limitations / ideas

- Summary data only (by design) — no underlying-row export.
- One tab per allowed sheet; no per-sheet column picker yet.
- File name is `prefix + date`; pulling a field value into the name is a possible enhancement.
- To change the icon, edit `icon.svg` then run `python3 make_icon.py`
  (needs `pip install cairosvg Pillow`).
