# CUSD Feeder Flow — Tableau dashboard extension

Draws where one school's students went the next school year, for the feeder-transition
dashboard built on `dw3_custom.dbo.TableauVizFeederTransition`.

## Why it exists

The question is "where did this school's students go", and the origin is one school, so a
Sankey here is not showing flow between many sources — it is a proportional breakdown drawn as
ribbons. In every cohort most students stay: 65% to 90%. Tableau's own Sankey spends that share
of the canvas on one ribbon that says "most stayed" and squeezes the students who actually moved
into slivers too thin to label. That is the problem this extension exists to fix:

- **Stayers become a headline** — a sentence and a proportional bar at the top — and the flow
  gives its whole height to the students who did not stay.
- **Every node carries its count and its share of the whole cohort**, so the numbers in the flow
  add up with the headline rather than with each other. Hover a ribbon for the share of movers.
- **Right-hand labels sit in a gutter with leader lines**, sorted by size, so a destination of two
  students still gets a readable line. Destinations fold into *Other* only when the labels
  physically cannot fit the height, or when the author caps them (*Destinations per category*).
- No third-party library: the layout and SVG are `flow-model.js`, about 400 lines, pure functions.

## Files

| File | Role |
|---|---|
| `cusd-feeder-flow.trex` | Manifest. Add to a dashboard via *Access Local Extensions*. |
| `index.html` | The in-dashboard view. |
| `feeder-flow.js` | Tableau side: settings, read the data sheet's summary data, render, re-render on filter change. |
| `flow-model.js` | Model, layout, SVG. No DOM, no Tableau — the harness tests it directly. |
| `configure.html` / `configure.js` | Author-only Configure dialog. |
| `mockup.html` | Double-click preview with synthetic data; renders the real `flow-model.js`. |
| `styles.css` | Styling. |
| `icon.svg` / `icon.png` / `make_icon.py` | Icon source, 70×70 render, and the script that splices it into the manifest. |
| `lib/` | Tableau Extensions API, **vendored at hosting time** (not in this repo). |

## The data sheet

Make a worksheet — call it `Flow Data` — with these four fields on **Detail** (or Rows) and
nothing else, so each summary row is one flow:

| Field | What it is |
|---|---|
| `schoolName` | origin school |
| `transitionCategory` | Stayed / Moved / Left / Graduated |
| `Destination` | the named school, or the exit reason — the raw calc, **not** `Destination Grouped` |
| `SUM(studentCount)` | students |

**Use `Destination`, not `Destination Grouped`.** The grouped calc folds everything outside the
workbook's Top 5 set into one bucket, and that set ranks school names and exit reasons together
(the `Destination` calc carries a reason for every student who left), so a leaver's reason outside
the top five would arrive here already mislabelled as a CUSD school. The extension folds by itself,
per category, and labels the fold *Other (n)* — so hand it the unfolded field.

Keep the same datasource filters as the rest of the workbook — `dataLevel = SCHOOL` and the
security condition — and apply the dashboard's School Year, School Name and Grade Level filters
to it. The sheet can be hidden behind the extension; it only needs to exist on the dashboard.

Columns are matched by caption automatically (`SUM(studentCount)`, `ATTR(schoolName)` and the
like are unwrapped). Configure lets you override any of the four.

## Setup

The vault keeps the source; GitHub Pages serves it from `CUSD-Research/Public-Extensions`, where
every extension is one folder carrying its own `lib/` copy of the Tableau library (checked against
the live repo 2026-09-11: `cusd-excel-export`, `cusd-help-request` and `cusd-kpi-table` each
carry `lib/tableau.extensions.1.latest.min.js`, and `.nojekyll` sits at the root). The manifest
already points at `https://cusd-research.github.io/Public-Extensions/cusd-feeder-flow/index.html`,
and that host is already allow-listed on the Tableau Cloud site for the Excel export, so nothing
new is needed there.

1. **Host it.** In a local clone of `Public-Extensions`, on a branch, copy this folder in and add
   the library beside it — the same file the other three folders carry. PowerShell, with the two
   clone paths set once:

   ```powershell
   $vault = "C:\path\to\CUSD-Data-Vault"        # this repo
   $pub   = "C:\path\to\Public-Extensions"      # the hosting repo
   cd $pub
   git checkout -b feeder-flow-hosting main
   Copy-Item -Recurse "$vault\tableau-extensions\cusd-feeder-flow" ".\cusd-feeder-flow"
   New-Item -ItemType Directory ".\cusd-feeder-flow\lib" | Out-Null
   Copy-Item ".\cusd-excel-export\lib\tableau.extensions.1.latest.min.js" ".\cusd-feeder-flow\lib\"
   git add cusd-feeder-flow
   git commit -m "cusd-feeder-flow: host the feeder flow extension"
   git push -u origin feeder-flow-hosting
   ```

   Open a **draft** PR from that branch. Pages serves from `main`, so the extension is live a
   minute or two after the merge — merge only after the Desktop test below passes. (A Claude
   session with push access to that repo can do this step itself; it is the one step that needs
   a repo outside the vault.)
2. **Test in Desktop** — no allow-list needed there. Open the feeder workbook, add the `Flow Data`
   sheet to the flow dashboard (it can sit behind the extension or be shrunk to a sliver; it only
   has to be on the dashboard), then drag an **Extension** object → *Access Local Extensions* →
   this folder's `cusd-feeder-flow.trex` → allow it → **Configure…** → pick `Flow Data` → Save.
   Check one school, one grade: the headline total should equal the `Cohort Header` total, and
   every right-hand count should match a bar on `Where They Went`.
3. **Publish**, then **View As** a principal at one site: the flow must show their school only.
   It reads the sheet's summary data, so the row-level security is the sheet's.

## Configure options

| Option | Default | Effect |
|---|---|---|
| Worksheet | — | the data sheet |
| Origin / Category / Destination / Count | auto | column mapping, if the guess is wrong |
| "Stayed" category value | `Stayed at Same School` | which category becomes the headline |
| Keep stayers in the flow | No | Yes reproduces a standard Sankey |
| Destinations per category | 0 | 0 = everything the height allows; N = the N largest, rest into Other |
| Label for the fold | `Other` | |
| Title | origin school's name | |
| What is counted | `students` | the noun in the headline, tooltips and footer |
| Origins, plural | `schools` | the title when several origins are drawn: *3 schools* |
| Origin filter name | `School Name` | named in the message shown when more than eight origins are selected |
| Category order | blank | comma-separated, top to bottom; blank keeps the feeder preset, unlisted categories follow largest first |
| Category colours | blank | `Name = #hex; Name = #hex`; unlisted categories take a palette colour that stays with their name |

## Using it for another question

Nothing in the extension is tied to the feeder dashboard. Any question shaped *"where did X go"*
fits: where a graduating class went, where staff who left a site ended up, where students exited
a program to. It needs the same four columns, and the rest follows from the data:

- **Categories are data-driven.** The four feeder categories are only a *preset* (their order,
  short labels and colours). Any other category ranks after the configured order, largest first,
  and takes a Tableau 10 palette colour keyed to its name, so it keeps that colour across filter
  changes and sessions. Set *Category order* and *Category colours* in Configure to pin either.
- **The "Stayed" category is optional.** Whatever category name is in that Configure field is
  pulled out of the flow into the headline. If no category matches (a question with no notion of
  staying), nothing is pulled out, the whole population flows, and the wording drops *did not
  stay* on its own.
- **Words are options.** *What is counted* (students, graduates, teachers), *Origins, plural*
  (schools, cohorts, departments) and *Origin filter name* (what the viewer is told to pick when
  too many origins are selected).
- **Bad rows do not break it.** A blank category reads as *(blank)*, a blank destination falls
  back to its category, a count that is not a number is dropped, more than eight origins is a
  one-line message instead of a wall of labels, and destinations fold to fit the height.

Panel 4 of `mockup.html` is a post-graduation outcomes question drawn with no preset and no
stayers; the harness covers the same rules (`tests/test_feeder_flow_extension.js`, the
*another question entirely* block).

## What it does not do

- It does not render in PDF or PowerPoint exports — no dashboard extension does. Subscriptions
  deliver it only as an image. Keep a bar-chart sheet as the canonical printed view.
- It reads summary data only, so row-level security applies exactly as it does to the sheet.
  Nothing is sent anywhere; the drawing happens in the viewer's browser.

## Testing

`node tests/test_feeder_flow_extension.js` loads the shipped `flow-model.js` and `feeder-flow.js`
in a sandbox and asserts on the model (stayer exclusion, percent basis, grouping, folding), the
layout (one shared scale, labels never overlap, ribbons never twist), the column mapping, the
multi-school title, the guard that refuses to draw more than eight origins, and the rules that
make it work for another question (data-driven category order and colours, the configurable
words, blank-value fallbacks). It runs in `local_verify.sh` and `verify.yml`. `mockup.html` is the
visual check.

**Smoke test with the real library.** With `lib/tableau.extensions.1.latest.min.js` in place,
open `index.html` in a plain browser tab. The pass is the status line *"Feeder Flow could not
start: This extension is not running inside an iframe, desktop, or popup window. Initialization
failed."* — that text comes from the Tableau library itself, so it proves the library and both
scripts loaded and the bootstrap ran; only the Tableau host is missing. `configure.html` shows the
same sentence in its worksheet list. Anything else on screen, or a console error, is a defect.
Run 2026-09-11 in headless Chromium against the library copied from the live `cusd-excel-export`
folder: both pages reached exactly that state with no console errors.

## Licence

Extension code: CUSD Research and Data Analytics. The Tableau Extensions API keeps its own (MIT).
