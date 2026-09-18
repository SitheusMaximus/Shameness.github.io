# Sigmar's Garden Solver, enhanced

A local-first Sigmar's Garden solver derived from the Shameness MarbleFinder project.

Upstream project:
https://github.com/Shameness/Shameness.github.io

## What changed

- Responsive board editor built around a 91-cell radius-5 hex grid
- Manual placement with all 14 marble types
- Screenshot upload and clipboard paste
- Automatic board location from a screenshot
- Screenshot cell classification with an on-screen review step
- Salt/Mercury ambiguity handling for the two pale marble types
- Solver moved into a Web Worker so the UI remains usable while searching
- In-place backtracking with memoisation and several safe pruning rules
- Metal order handling and Gold's final single-piece rule
- Clickable move list with coordinates, Previous/Next, and playback
- No server-side processing and no screenshot upload
- Optional GitHub Pages deployment workflow

## Files

`index.html` is the page shell.

`styles.css` contains the UI.

`app.js` contains the UI, board editor, screenshot import, and solution viewer.

`solver.js` contains the puzzle model and search algorithm.

`solver.worker.js` runs the solver off the main browser thread.

`detector.js` contains screenshot board location and cell classification.

`tests/` contains Node-based solver tests and a browser-oriented detector test page.

## Put it into a fork

1. Fork the upstream repository.
2. Replace the fork's root `index.html` and `styles.css`.
3. Add `app.js`, `solver.js`, `solver.worker.js`, and `detector.js` to the root.
4. Replace the root `README.md` with this one, or merge its setup notes into yours.
5. Add the `tests/` directory and `package.json` if you want the local test suite.
6. Add `.github/workflows/pages.yml` if you want GitHub Actions to deploy the site.
7. The old `scripts.js` and `hexGridPageGenerator.py` can stay in the fork, but the new page does not depend on them. Remove them only when you no longer need the upstream implementation.

The site has no build step. GitHub Pages can serve the files directly.

## Run locally

Use a local HTTP server. ES modules and Web Workers are more reliable over HTTP than by opening `index.html` directly as a `file://` URL.

```bash
python3 -m http.server 8000
```

Open:

`http://localhost:8000/`

## Test locally

Node 18 or newer is recommended.

```bash
npm test
```

The test suite checks:

- 91-cell board geometry
- Free-cell detection rules
- Element, Salt, Mors/Vitae, metal, and Gold rules
- Inventory limits
- A complete published 55-marble example board
- Replay of the returned solution to confirm every move is legal
- Screenshot locator geometry
- Screenshot classification against a synthetic board

You can also open the detector test page from a local server:

`http://localhost:8000/tests/detector-test.html`

## Screenshot workflow

Use **Upload screenshot** or **Paste screenshot**. The image is decoded locally in the browser, the board is located, and all 91 cell positions are sampled.

The game uses two pale marble types, Salt and Mercury, so colour alone cannot always distinguish them. Pale cells are provisionally assigned from their expected counts and remain marked for review. Check amber-marked cells in the manual editor before solving.

The detector is designed as a screenshot assistant, not as a guarantee that every capture will be read correctly. Whole-board screenshots with little distortion give it the best starting point. Unusual scaling, heavy cropping, overlays, or a visual effect that strongly fades the marbles can require manual correction.

## GitHub Pages

The included workflow deploys the repository root when code is pushed to either `main` or `master`.

After pushing the files:

1. Open the repository's **Settings → Pages**.
2. Select **GitHub Actions** as the source.
3. Push to the configured branch or run the workflow manually.
4. GitHub will publish the resulting Pages URL in the workflow run.

For a fork that already uses branch-based Pages, you can skip the workflow and publish the root folder directly instead.

## Design notes

The original Shameness project already contains the core Sigmar's Garden solver. This version keeps the same game model while separating the solver from the UI and adding a screenshot pipeline. The solver uses a 91-cell hex model, stores empty cells explicitly as `-1`, and runs in a worker to avoid blocking the interface.

No screenshot leaves the browser. There is no backend in this project.

## Attribution

The solver rules and original search approach are based on Shameness's MarbleFinder implementation:
https://github.com/Shameness/Shameness.github.io

The enhanced interface, screenshot pipeline, worker architecture, and additional search/pruning code in this package are new additions.
