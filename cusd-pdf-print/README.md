# CUSD PDF Print — Tableau Dashboard Extension

A **PDF** button for CUSD dashboards that produces a PDF **with the dashboard's
extensions in it**. Tableau's own PDF export leaves every extension blank.

Built and maintained by **Chandler Unified School District — Research & Data
Analytics**. The button uses the same PDF icon already on CUSD dashboards
(`reference/assets/tableau-icons/Grey Modern/PDF Icon.png`), so it sits with the
Filters / Close / Excel / Help set.

---

## Why it exists

Tableau's PDF export — *Download > PDF*, the Download object, and subscription
attachments — is rendered **server-side**, and the server renderer does not run
dashboard extensions at all. Every extension object comes out blank. That is
documented Tableau behaviour, not a bug we can patch: on Tableau Cloud only
Tableau-governed "trusted" extensions and Pulse objects are included in exports,
and PDF and PowerPoint exclude even those. (Image export on Cloud gained
extension support in 2026.1; PDF did not.)

The **browser's** own print path is different. It prints the live page, and a
live page renders its iframes — extensions included. That is exactly why Ctrl+P
looks right and the PDF button does not.

So this extension does not try to fix Tableau's exporter. It routes the click to
the browser print path instead.

## Why it needs a separate window

The obvious implementation, `window.top.print()`, is impossible. An extension
runs in a **cross-origin** iframe — served from our host, not Tableau's — and the
same-origin policy does not expose `print()` on a cross-origin parent. The
Extensions API has no printing call either.

What an extension *can* do is open a window on its **own** origin. That window is
same-origin, so it is allowed to print itself, and what it prints includes
whatever it has framed:

```
dashboard ──click──► PDF button ──opens──► print.html  (our origin: it can print itself)
                         │                     └─ iframe: the same view, :embed=y,
                         └─ hands over the             same filters, same pixel size
                            current filters,           — extensions and all
                            parameters and size
```

**No district data passes through the host.** The framed copy is fetched by the
viewer's own browser from Tableau, under the viewer's own session, so row-level
security applies to the printout exactly as it does on screen. The extension
itself reads only metadata (filter and parameter selections, the dashboard's name
and its objects' sizes) — never `getSummaryDataAsync`, never underlying data.

## What it does

- **One click → the browser print dialog**, with the dashboard already scaled onto
  the page.
- **Carries the viewer's current filters and parameters** into the printed copy,
  so the PDF is of what is on screen, not of the view's saved defaults.
- **Names anything it could not carry**, in the print window, before printing. A
  range filter, a relative-date filter and a hierarchical filter cannot be
  expressed in a Tableau view URL at all; the copy falls back to the published
  view's own setting for those, and the print window says so rather than letting
  an authoritative-looking PDF go out quietly filtered wrong.
- **Measures, then scales.** The dashboard's real pixel size is measured from its
  own objects and reduced to fit the chosen paper — never a guessed number, and
  never upscaled (a small dashboard prints at its natural size).
- **Says when the reduction has gone too far.** Past 40% the print window tells
  the operator to pick a bigger sheet instead of printing something illegible.
- **Lets the viewer change paper in the print window** — Letter, Legal or Tabloid,
  landscape or portrait — without going back to Configure.
- **Pins the desktop layout** (`:device=desktop`), so a dashboard with
  device-specific layouts does not re-pick one and print a different dashboard.
- **Hides itself in the printed copy.** The framed dashboard's own instance of
  this extension renders nothing, so the PDF does not contain a "make a PDF"
  button.

## Files

| File | Purpose |
|------|---------|
| `cusd-pdf-print.trex` | The manifest you add to a dashboard. Its `<url>` points at the hosted `index.html`. |
| `index.html` | The in-dashboard view (the button). |
| `pdf-print.js` | Button logic: read the dashboard's state → build the print URL → open and feed the print window. |
| `print.html` / `print.js` / `print.css` | The print window: frames the view, scales it onto the paper, prints. |
| `print-url.js` | The pure logic — URL assembly, filter encoding, dashboard measurement, the fit arithmetic. Shared by all three pages and by the tests. |
| `configure.html` / `configure.js` | The author-only **Configure…** dialog. |
| `styles.css` | Styling for the button and the Configure dialog. |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon source (a trace of the Grey Modern PDF icon) + rendered 70x70 PNG + the script that re-renders it and embeds it in the `.trex`. |
| `lib/` | Tableau Extensions API, **vendored** at hosting time (no runtime CDN). |
| `../../tests/test_pdf_print_extension.js` | Offline harness for the URL, filter and fit logic. |
| `../../tests/test_pdf_print_fit.py` | Prints probe pages headless and asserts one page on the right paper. |

There is no third-party library at all — only the Tableau API.

## Configure…

| Setting | Default | Notes |
|---|---|---|
| **Published view URL** | *(required)* | The Extensions API does not expose the view's own URL, so the author pastes it once. Copy the address bar on Tableau Cloud, or use Share > Copy Link. Paste the plain view URL; the extension adds the embed and filter parameters itself. |
| **Paper size** | Letter, landscape | The viewer can change this in the print window. |
| **Page margin** | 0.35 in | Smaller margin, larger dashboard. |
| **Render wait** | 4000 ms | How long the framed copy gets to draw before printing. Raise it for a heavy dashboard. |
| **Open the print dialog automatically** | on | Off means the viewer checks the copy first, then clicks Print. |
| **Carry the current filters and parameters** | on | Off prints the view's own saved state. |

The dialog warns if the pasted URL's host differs from the host actually serving
the dashboard — a URL copied from a different Tableau site would otherwise print
somebody else's dashboard with no sign anything was wrong.

## Deploy

🛑 **Host FIRST, then test in Desktop.** A `.trex` is a pointer at the hosted
`index.html`; until the folder is live, a Desktop test can only show a load
error.

1. **Host the folder** in `CUSD-Research/Public-Extensions` under
   `cusd-pdf-print/`, adding `lib/tableau.extensions.1.latest.min.js`. Confirm the
   repo root has `.nojekyll` (without it GitHub's Jekyll build can drop folders).
2. **Check `<url>`** in `cusd-pdf-print.trex` points at the hosted `index.html`.
3. **Safe-list it on Tableau Cloud.** *Settings → Extensions →* add
   `https://cusd-research.github.io` with **Allow / full data**. The host being
   allow-listed already for `cusd-excel-export` is **not** enough — the safe-list
   step is per extension (Kent, 2026-09-11; the skill text for this is on PR
   [#1087](https://github.com/woods-kenton/cusd-data-vault/pull/1087)).
4. **Add it to the dashboard:** Dashboard → drag an **Extension** object → *Access
   Local Extensions* → pick the `.trex` → **Configure…** → paste the view URL →
   publish.
5. **Updating code:** push to the repo, Pages redeploys, Tableau pulls the new code
   on next load. No need to re-add or re-publish.

**This extension must be network-enabled** (hosted by us), not sandboxed. Its
whole mechanism is opening a window on its own origin so that window can print
itself; a sandboxed extension is hosted by Tableau and cannot do that.

## Known limitations

Read these before promising anyone a pixel-perfect PDF.

1. **The framed copy loads Tableau in a third-party context.** Chrome and Edge
   allow this by default, so the copy authenticates on the viewer's existing
   Tableau session. A browser that blocks third-party cookies — Safari, or a
   hardened profile — will show a Tableau sign-in prompt inside the frame instead
   of the dashboard. The print window's **Open in a new tab** button is the escape
   hatch: there the view loads first-party on Tableau's own origin and always
   authenticates, and the viewer prints with Ctrl+P. **This is the single most
   likely thing to need attention on rollout**, and it is the one thing that could
   not be tested from the build environment.
2. **Background graphics.** The dashboard's coloured panels print white unless
   *Background graphics* is ticked in the browser's print dialog. We cannot set it
   from outside a cross-origin frame; the print window says so on screen.
3. **Filters that cannot round-trip.** Range, relative-date and hierarchical
   filters have no Tableau view-URL form. They are listed in the print window and
   the copy uses the published view's setting for them.
4. **A filter set to (All).** If Tableau does not expose the value list for a
   filter showing *(All)*, it is reported as uncarried rather than guessed.
5. **The copy is a fresh render.** If the extract refreshed between the viewer
   loading the dashboard and clicking PDF, the printout reflects the newer data.
6. **Tableau Desktop.** There is no published view URL to frame, so the button
   cannot work in Desktop. It is a Cloud/Server feature.
7. **The nested-copy guard is a heuristic.** The button hides itself when it
   detects it is two frames deep, which is the print window's framed copy. If CUSD
   ever embeds a dashboard in an intranet portal page, that is also two deep and
   the button would hide there too.
8. **Other extensions on the dashboard re-initialise in the framed copy.** Ones
   that render (a KPI table, a feeder flow) draw normally — that is the point. Any
   that act on load would act again.

## Testing

```bash
node tests/test_pdf_print_extension.js    # URL, filter encoding, measurement, fit
python3 tests/test_pdf_print_fit.py       # prints probes headless, asserts 1 page
```

Both are wired into `verify.yml` and `local_verify.sh`. The fit gate skips itself
cleanly where node or a Chromium-family browser is missing.

An extension cannot be exercised without publishing and clicking, so everything
that can be **silently** wrong lives in `print-url.js` as pure functions and is
asserted against the shipped file. The three silent failures under guard:

- Filter parameters appended to the document query instead of inside the URL
  fragment. A Tableau Cloud URL keeps the view path in the fragment, so the wrong
  placement loads the right dashboard and ignores every filter.
- A dashboard size read off `Sheet.size`, which is a sizing **rule**
  (`{behavior, maxSize, minSize}`) and not `{width, height}`. Reading `.width`
  yields `undefined`, which scales to 100% and clips every wide dashboard.
- A print scale that does not fit the paper it was computed against.

`node --check` proves the files parse, not that they are right.

The fit gate earned itself on the first run: it caught an `overflow: visible` in
the print stylesheet that let the un-scaled iframe's layout box extend the print
flow, so every dashboard printed to a second, blank page. Nothing in the HTML
showed it — which is the whole argument of
[[.claude/skills/cusd-pdf-builder/SKILL|cusd-pdf-builder]].

## Related

- [[.claude/skills/cusd-tableau-extensions/SKILL|cusd-tableau-extensions]] — how CUSD builds and hosts extensions
- [[.claude/skills/cusd-pdf-builder/SKILL|cusd-pdf-builder]] — the page-box and fit doctrine
- [[tableau-extensions/cusd-excel-export/README]] — the reference extension
