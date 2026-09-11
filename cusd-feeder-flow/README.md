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
- **Every node carries its count and its share of the whole cohort, in parentheses after its
  name**, so the numbers in the flow add up with the headline rather than with each other. Hover a
  ribbon for the share of movers.
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
per category, and labels the fold *n others* — so hand it the unfolded field.

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

**Order matters: host first, test in Desktop second.** A `.trex` is only a pointer at the hosted
`index.html`. Desktop loads the extension's code from that URL, so until the folder is live on
Pages the Desktop test can only show a load error. (The one way to test before hosting is a local
web server and a dev copy of the manifest pointing at `http://localhost`.)

1. **Host it, and re-run the same block for every update.** Paste this whole block into Windows
   PowerShell, from any folder, exactly as it is. It needs nothing filled in: it clones what it
   needs into a temp folder, replaces the hosted folder with the vault's copy beside the library
   the other three carry, pushes a dated `feeder-flow-*` branch to Public-Extensions, and puts the
   manifest in your Documents folder for step 3. When the hosted copy already matches the vault it
   says so and pushes nothing. Git may open a browser sign-in for the private vault clone and for
   the push; finish it and paste again. After an update is merged, close and reopen the workbook in
   Desktop; on Cloud, hard-refresh the browser. The extension object does not need re-adding.

   ```powershell
   & {
     if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is not installed or not on PATH" }
     $work = Join-Path $env:TEMP "feeder-flow-hosting"
     if (Test-Path $work) { Remove-Item -Recurse -Force $work }
     New-Item -ItemType Directory $work | Out-Null
     Set-Location $work

     git clone --quiet --depth 1 --filter=blob:none --sparse https://github.com/woods-kenton/CUSD-Data-Vault vault
     if ($LASTEXITCODE) { throw "could not clone the vault; if a browser sign-in appeared, finish it and paste the block again" }
     git -C vault sparse-checkout set tableau-extensions/cusd-feeder-flow
     if ($LASTEXITCODE) { throw "sparse-checkout failed" }
     if (-not (Test-Path "$work\vault\tableau-extensions\cusd-feeder-flow\cusd-feeder-flow.trex")) { throw "the extension folder did not come down from the vault" }

     git clone --quiet --depth 1 https://github.com/CUSD-Research/Public-Extensions pub
     if ($LASTEXITCODE) { throw "could not clone Public-Extensions" }
     Set-Location "$work\pub"
     $branch = "feeder-flow-" + (Get-Date -Format "yyyyMMdd-HHmm")
     git checkout --quiet -b $branch
     if ($LASTEXITCODE) { throw "could not create the hosting branch" }

     # An update replaces the hosted folder outright, so removed files go too; lib/ is re-added below.
     if (Test-Path "$work\pub\cusd-feeder-flow") { Remove-Item -Recurse -Force "$work\pub\cusd-feeder-flow" }
     Copy-Item -Recurse -ErrorAction Stop "$work\vault\tableau-extensions\cusd-feeder-flow" "$work\pub\cusd-feeder-flow"
     New-Item -ItemType Directory "$work\pub\cusd-feeder-flow\lib" -ErrorAction Stop | Out-Null
     Copy-Item -ErrorAction Stop "$work\pub\cusd-excel-export\lib\tableau.extensions.1.latest.min.js" "$work\pub\cusd-feeder-flow\lib\"

     $trex = Join-Path $env:USERPROFILE "Documents\cusd-feeder-flow.trex"
     Copy-Item -ErrorAction Stop "$work\pub\cusd-feeder-flow\cusd-feeder-flow.trex" $trex

     git add -A cusd-feeder-flow
     if (-not (git status --porcelain cusd-feeder-flow)) { Write-Host "Nothing to update: the hosted copy already matches the vault. Manifest: $trex"; return }
     git commit --quiet -m "cusd-feeder-flow: host or update the feeder flow extension"
     if ($LASTEXITCODE) { throw "commit failed; if git asked for a name and email, set them with git config --global user.name and user.email, then paste the block again" }
     git push --quiet -u origin $branch
     if ($LASTEXITCODE) { throw "push failed; if a browser sign-in appeared, finish it and run: git -C $work\pub push -u origin $branch" }
     Write-Host ""
     Write-Host "Pushed. Merge it here: https://github.com/CUSD-Research/Public-Extensions/pull/new/$branch"
     Write-Host "Manifest for Tableau Desktop: $trex"
   }
   ```

2. **Merge the branch** on GitHub at the link the script prints. Pages serves `main`; allow a
   minute or two, then open
   `https://cusd-research.github.io/Public-Extensions/cusd-feeder-flow/index.html`. The pass is the
   sentence *"Feeder Flow could not start: This extension is not running inside an iframe, desktop,
   or popup window."* A blank page, a 404, or a page stuck on *Loading* means the folder or its
   `lib/` did not land.
3. **Test in Desktop** — no allow-list needed there. Open the feeder workbook, add the `Flow Data`
   sheet to the flow dashboard (it can sit behind the extension or be shrunk to a sliver; it only
   has to be on the dashboard), then, **on the Dashboard tab**, drag an **Extension** object from
   the *Objects* pane → *Access Local Extensions* → `Documents\cusd-feeder-flow.trex` → allow it →
   the object's drop-down → **Configure…** → pick `Flow Data` → Save. Not from a worksheet's
   Marks card: that menu (*Viz Extensions → Add Extension*) is where Tableau's own Sankey lives,
   and offering this manifest there fails with *"This extension is not a viz extension. Error
   Code: 93FB5DF9"*. This is a dashboard extension, so it is an object on a dashboard, not a
   mark type in a sheet.
   Check one school, one grade: the headline total should equal the `Cohort Header` total, and
   every right-hand count should match a bar on `Where They Went`.
4. **Publish**, then **View As** a principal at one site: the flow must show their school only.
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
