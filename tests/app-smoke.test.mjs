import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const requiredIds = [
  'boardCanvas', 'screenshotInput', 'screenshotCanvas', 'solveBtn', 'clearBtn', 'undoBtn',
  'pasteBtn', 'screenshotBtn', 'editBtn', 'useDetectionBtn', 'trustSolveBtn', 'closeDetectBtn',
  'prevStepBtn', 'nextStepBtn', 'playBtn', 'stepLabel', 'pieceCounts', 'palette', 'zoomSlider',
  'reviewBanner', 'detectionStatus', 'diagnosticsPanel', 'diagnosticsOutput',
  'copyDiagnosticsBtn', 'downloadDiagnosticsBtn', 'clearDiagnosticsBtn'
];
for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `missing UI id: ${id}`);
assert.match(app, /from ['"]\.\/detector\.js['"]/);
assert.match(app, /from ['"]\.\/diagnostics\.js['"]/);
assert.match(app, /Trust interpretation &amp; solve|Trust interpretation/);
assert.match(app, /detail\?\.needsReview/);
assert.match(app, /manualCorrection/);
console.log('PASS: UI wiring, review-state hooks, trust path, and diagnostics controls are present');
