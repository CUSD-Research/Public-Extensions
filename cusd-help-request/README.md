# CUSD Request Help — Tableau Dashboard Extension

A single **Request help** button for Tableau dashboards. When a viewer clicks it,
their email app opens **pre-filled** with the context a support request needs —
the dashboard name, the current filter & parameter selections, the Tableau
environment, and a timestamp — addressed to the team inbox the dashboard author
configured. The viewer types their question and sends it from their own mailbox.

Built and maintained by **Chandler Unified School District — Research & Data
Analytics**.

---

## Why it exists

Help requests about a dashboard usually start with a round-trip: *what dashboard?
what's the URL? what were you filtered to? who are you?* This button captures that
context up front so the request lands in the inbox ready to triage. Because the
email is sent from the viewer's own mailbox, you also get a real reply-to and the
sender's identity for free.

## What it does

- **One button → one pre-filled email.** Opens the viewer's default mail client
  (Outlook, etc.) via a `mailto:` link, addressed to the configured inbox.
- **Captures dashboard context automatically:** dashboard name, worksheet names,
  current filter values, parameter values, Tableau environment (Desktop vs
  Server/Cloud + version), and a local timestamp.
- **Optional author-set extras:** a workbook label and a link back to the
  published view (so the team can open exactly what the viewer was looking at).
- **Runs entirely in the browser, with no backend.** The message is assembled
  locally and handed to the OS mail client. The extension makes **no network
  calls of its own** and stores nothing on the host.

## What it does NOT do

- **No worksheet data is read.** It reads only dashboard *metadata* (names,
  filter/parameter selections, environment) — never `getSummaryData` or
  underlying rows — so no student/employee rows can ride along in the email.
  Aggregate context only.
- **No "full data" permission** is requested, so viewers get no data-access
  consent prompt. *(If a future Tableau build requires that permission to read
  filter values, see the comment in the `.trex`.)*
- **No secrets.** There is no recipient address, credential, or connection string
  in this repo — the recipient is set per-workbook in **Configure…**.

## How it works

```
Tableau dashboard (in the viewer's browser)
        │   the extension reads dashboard metadata (names, filters, parameters)
        ▼
  help-request.js  ──builds a mailto: link──►  the viewer's mail app opens, pre-filled
```

The extension is a small static web app (HTML/CSS/JS) that Tableau loads inside
the dashboard. **The host (e.g. GitHub Pages) only serves the code — no viewer
data ever passes through it, and the extension never sends anything itself.**

## Files

| File | Purpose |
|------|---------|
| `cusd-help-request.trex` | The manifest you add to a dashboard. Its `<url>` points at the hosted `index.html`. |
| `index.html` | The in-dashboard view (the button). |
| `help-request.js` | Button logic: gather context → build the `mailto:` → open the mail client. |
| `configure.html` / `configure.js` | The author-only **Configure…** dialog (recipient + optional workbook name / view URL). |
| `styles.css` | Minimal styling. |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon source (SVG) + rendered PNG + a small script that re-renders the PNG and embeds it in the `.trex`. |
| `lib/` | Tableau Extensions API (vendored at deploy time — see below). |

## Deploy

The extension is just static files on an **HTTPS** origin, plus a one-time
allow-list entry on your Tableau Cloud site.

1. **Host the files** alongside a `lib/` folder containing the vendored Tableau
   Extensions API (`tableau.extensions.1.latest.min.js`). On GitHub Pages, drop
   this folder into the **`CUSD-Research/Public-Extensions`** repo as
   `cusd-help-request/`, and keep the repo-root **`.nojekyll`** file so the
   `lib/` folder isn't dropped by Jekyll.
2. **Point the manifest** at your host: the `<url>` is already set to
   `https://cusd-research.github.io/Public-Extensions/cusd-help-request/index.html`
   — change it if you host elsewhere.
3. **Allow-list the host on Tableau Cloud** (site admin, one time):
   *Settings → Extensions →* add the host (scheme + domain) with **Allow**.
   This extension requests **no full-data access**, so the full-data toggle is not
   required. *If you already allow-listed `https://cusd-research.github.io` for the
   Excel-export extension, this one is covered by the same entry.*
4. **Add it to a dashboard:** drag an **Extension** object in → **Access Local
   Extensions** → choose the `.trex` → **Configure…** (set the recipient) → publish.
   The recipient + options bake into the workbook.

**Tableau Desktop note:** you can test the extension in **Tableau Desktop**
without the Cloud allow-list — Desktop simply prompts you to allow it. Validate
end-to-end in Desktop before involving the Cloud admin.

## Configure options

In the **Configure…** dialog the author sets:

- **Team inbox** *(required)* — where the `mailto:` is addressed.
- **Workbook name** *(optional)* — a label included in the subject + body.
- **View URL** *(optional)* — a link back to the published view, included in the body.

## Privacy & security

- **Nothing leaves the host, and the extension sends nothing itself.** It builds a
  `mailto:` link the viewer's own mail client opens; the viewer reviews and sends.
- **No data rows.** Only dashboard metadata + the viewer's own filter/parameter
  selections are included — never worksheet data.
- **No secrets in this repo** — no credentials, connection strings, or personal
  data; only application code and (at deploy time) the open-source Tableau API.

## Licenses

The Tableau Extensions API keeps its own license (MIT). The CUSD-authored code
here is provided as-is; add a license file if you intend to redistribute it.

## Limitations / ideas

- The viewer must have a desktop mail client (or a browser `mailto:` handler)
  configured — the button opens a draft, it does not send on its own.
- **v2 idea:** swap the `mailto:` for a direct "file to Asana (Research Team
  Tasks)" call so a dashboard observation becomes a tracked task. That is a
  network-enabled change (needs a secured endpoint / token), so it carries a
  different trust boundary than this no-backend v1.
- To change the icon, edit `icon.svg` then run `python3 make_icon.py`
  (needs `pip install Pillow`; will also use `cairosvg` if installed).
