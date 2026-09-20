import { BOARD, CELL_COUNT, PIECES, PIECE_INFO, ELEMENTS, solve, validateBoard, computeFreeMask } from './solver.js';
import { locateBoard, classifyBoard, boardPoint } from './detector.js';
import { GAME_ICONS } from './game-icons.js';
import { logEvent, clearDiagnostics, copyDiagnostics, downloadDiagnostics, diagnosticsJSON } from './diagnostics.js';

const canvas = document.getElementById('boardCanvas');
const ctx = canvas.getContext('2d');
const boardWrap = document.getElementById('boardWrap');
const screenshotInput = document.getElementById('screenshotInput');
const screenshotCanvas = document.getElementById('screenshotCanvas');
const screenshotCtx = screenshotCanvas.getContext('2d', { willReadFrequently: true });
const detectionStatus = document.getElementById('detectionStatus');
const solutionSteps = document.getElementById('solutionSteps');
const statusLine = document.getElementById('statusLine');
const countLine = document.getElementById('countLine');
const solveBtn = document.getElementById('solveBtn');
const clearBtn = document.getElementById('clearBtn');
const undoBtn = document.getElementById('undoBtn');
const pasteBtn = document.getElementById('pasteBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const editBtn = document.getElementById('editBtn');
const useDetectionBtn = document.getElementById('useDetectionBtn');
const trustSolveBtn = document.getElementById('trustSolveBtn');
const closeDetectBtn = document.getElementById('closeDetectBtn');
const prevBtn = document.getElementById('prevStepBtn');
const nextBtn = document.getElementById('nextStepBtn');
const playBtn = document.getElementById('playBtn');
const stepLabel = document.getElementById('stepLabel');
const pieceCounts = document.getElementById('pieceCounts');
const palette = document.getElementById('palette');
const zoomSlider = document.getElementById('zoomSlider');
const reviewBanner = document.getElementById('reviewBanner');
const diagnosticsPanel = document.getElementById('diagnosticsPanel');
const diagnosticsOutput = document.getElementById('diagnosticsOutput');
const copyDiagnosticsBtn = document.getElementById('copyDiagnosticsBtn');
const downloadDiagnosticsBtn = document.getElementById('downloadDiagnosticsBtn');
const clearDiagnosticsBtn = document.getElementById('clearDiagnosticsBtn');
const REVIEW_CONFIDENCE = 0.48;

const state = {
  board: new Int8Array(CELL_COUNT),
  history: [],
  selectedPiece: PIECES.AIR,
  editing: true,
  solution: null,
  solutionIndex: -1,
  detectedBoard: null,
  detectedDetails: null,
  located: null,
  boardView: { center: { x: 0, y: 0 }, hexSize: 50 },
  dragging: false,
  playing: false,
  detectionTrusted: false,
};
state.board.fill(-1);

const PIECE_IDS = [PIECES.AIR, PIECES.WATER, PIECES.FIRE, PIECES.EARTH, PIECES.SALT, PIECES.MERCURY, PIECES.LEAD, PIECES.TIN, PIECES.IRON, PIECES.COPPER, PIECES.SILVER, PIECES.GOLD, PIECES.MORS, PIECES.VITAE];
const GAME_ICON_IMAGES = new Map();
if (typeof Image !== 'undefined') {
  for (const type of PIECE_IDS) {
    const image = new Image();
    image.decoding = 'async';
    image.src = GAME_ICONS[type];
    image.addEventListener('load', () => drawBoard());
    GAME_ICON_IMAGES.set(type, image);
  }
}


function setStatus(text, tone = '') {
  statusLine.textContent = text;
  statusLine.dataset.tone = tone;
}

function resizeCanvas() {
  const rect = boardWrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssHeight = Math.max(1, rect.height);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBoard();
}

function boardGeometryForView() {
  const rect = boardWrap.getBoundingClientRect();
  const zoom = Number(zoomSlider.value) / 100;
  // The radius-5 pointy-top board occupies 16*sqrt(3) hex radii wide and 17 high.
  // Fit the complete 91-cell board inside the editor at every window size.
  const hexSize = Math.min(rect.width / (16 * Math.sqrt(3)), rect.height / 17) * zoom * 0.92;
  return { center: { x: rect.width / 2, y: rect.height / 2 }, hexSize };
}

function pointForIndex(index, view = state.boardView) {
  return boardPoint(view.center, view.hexSize, BOARD.cells[index]);
}

function polygonPoints(p, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + i * Math.PI / 3;
    pts.push([p.x + size * Math.cos(a), p.y + size * Math.sin(a)]);
  }
  return pts;
}


function hexClickIndex(x, y) {
  let best = { index: -1, d: Infinity };
  for (const cell of BOARD.cells) {
    const p = pointForIndex(cell.index);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < best.d && d < state.boardView.hexSize * 0.75) best = { index: cell.index, d };
  }
  return best.index;
}

function drawBoard() {
  state.boardView = boardGeometryForView();
  const rect = boardWrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  const bg = ctx.createLinearGradient(0, 0, 0, rect.height);
  bg.addColorStop(0, '#12161d');
  bg.addColorStop(1, '#090c10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const displayBoard = getSolutionDisplayBoard();
  const freeMask = computeFreeMask(displayBoard);
  const solutionMove = state.solution && state.solutionIndex >= 0 && state.solutionIndex < state.solution.steps.length
    ? state.solution.steps[state.solutionIndex]
    : null;

  for (const cell of BOARD.cells) {
    const p = pointForIndex(cell.index);
    const occupied = displayBoard[cell.index] >= 0;
    const pts = polygonPoints(p, state.boardView.hexSize - 2.5);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = occupied ? '#c5b895' : '#4d535d';
    ctx.globalAlpha = occupied ? 1 : 0.38;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = freeMask[cell.index] ? '#ddd2b1' : '#777066';
    ctx.lineWidth = freeMask[cell.index] ? 2.2 : 1.1;
    ctx.stroke();

    if (occupied) {
      const type = displayBoard[cell.index];
      const info = PIECE_INFO[type];
      const icon = GAME_ICON_IMAGES.get(type);
      const r = state.boardView.hexSize * 0.56;
      const diameter = r * 2;
      if (icon?.complete && icon.naturalWidth > 0) {
        ctx.drawImage(icon, p.x - r, p.y - r, diameter, diameter);
      } else {
        ctx.beginPath();
        ctx.fillStyle = info.color;
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.max(10, state.boardView.hexSize * 0.25)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info.short, p.x, p.y + 1);
      }

      ctx.strokeStyle = freeMask[cell.index] ? '#fff7d2' : '#4c453b';
      ctx.lineWidth = solutionMove && (solutionMove.a === cell.index || solutionMove.b === cell.index) ? 4.5 : 1.6;
      if (solutionMove && (solutionMove.a === cell.index || solutionMove.b === cell.index)) ctx.strokeStyle = '#f4c95d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (state.detectedDetails) {
      const detail = state.detectedDetails?.[cell.index];
      if (detail?.needsReview && displayBoard[cell.index] >= 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3;
        ctx.arc(p.x, p.y, state.boardView.hexSize * 0.67, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function lighten(hex, amount) {
  const value = hex.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const n = (v) => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${n(r)}${n(g)}${n(b)}`;
}

function luminance(hex) {
  const v = hex.slice(1);
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildPalette() {
  palette.innerHTML = '';
  for (const type of PIECE_IDS) {
    const info = PIECE_INFO[type];
    const button = document.createElement('button');
    button.className = 'pieceButton';
    button.dataset.type = String(type);
    button.title = info.name;
    button.innerHTML = `<img class="pieceGameIcon" src="${GAME_ICONS[type]}" alt="" aria-hidden="true"><span>${info.name}</span>`;
    button.addEventListener('click', () => {
      state.selectedPiece = type;
      document.querySelectorAll('.pieceButton').forEach((b) => b.classList.toggle('selected', b === button));
    });
    palette.appendChild(button);
  }
  palette.querySelector('.pieceButton')?.classList.add('selected');
}

function updateCounts() {
  const counts = new Uint16Array(14);
  const displayBoard = getSolutionDisplayBoard();
  for (const value of displayBoard) if (value >= 0) counts[value] += 1;
  const occupied = counts.reduce((n, v) => n + v, 0);
  countLine.textContent = `${occupied} / ${CELL_COUNT} board cells occupied`;
  pieceCounts.innerHTML = PIECE_IDS.map((type) => {
    const info = PIECE_INFO[type];
    return `<span class="countChip"><img src="${GAME_ICONS[type]}" alt="" aria-hidden="true">${info.name} ${counts[type]}</span>`;
  }).join('');
}

function pushHistory() {
  state.history.push({
    board: new Int8Array(state.board),
    review: state.detectedDetails ? Object.values(state.detectedDetails).map((d) => d ? { index: d.index, needsReview: Boolean(d.needsReview), confidence: d.confidence, type: d.type } : null) : null,
  });
  if (state.history.length > 80) state.history.shift();
}

function getReviewIndices() {
  if (!state.detectedDetails) return [];
  return Object.values(state.detectedDetails).filter((d) => d?.type >= 0 && d.needsReview).map((d) => d.index);
}

function updateReviewUI() {
  const review = getReviewIndices();
  if (!state.detectedDetails) {
    reviewBanner.classList.remove('visible');
    reviewBanner.textContent = '';
  } else if (review.length) {
    reviewBanner.classList.add('visible');
    reviewBanner.textContent = `${review.length} screenshot cells need verification. Fix them or use “Trust interpretation & solve”. Amber rings stay until each flagged cell is resolved.`;
  } else {
    reviewBanner.classList.add('visible');
    reviewBanner.textContent = 'All flagged screenshot cells have been manually verified. The board is ready to solve.';
  }
  solveBtn.disabled = countOccupied() === 0 || review.length > 0;
}

function setCell(index, type) {
  if (index < 0) return;
  pushHistory();
  const oldType = state.board[index];
  state.board[index] = type;
  state.solution = null;
  state.solutionIndex = -1;
  if (state.detectedDetails?.[index]) {
    state.detectedDetails[index].type = type;
    state.detectedDetails[index].needsReview = false;
    state.detectedDetails[index].confidence = 1;
    state.detectedDetails[index].manualCorrection = true;
  }
  logEvent('manual_correction', { index, from: oldType, to: type, remainingReview: getReviewIndices().length });
  renderAll();
}

canvas.addEventListener('click', (event) => {
  if (!state.editing) return;
  const rect = canvas.getBoundingClientRect();
  const index = hexClickIndex(event.clientX - rect.left, event.clientY - rect.top);
  if (index < 0) return;
  if (state.board[index] === state.selectedPiece) {
    pushHistory();
    const oldType = state.board[index];
    state.board[index] = -1;
    if (state.detectedDetails?.[index]) {
      state.detectedDetails[index].type = -1;
      state.detectedDetails[index].needsReview = false;
      state.detectedDetails[index].confidence = 1;
      state.detectedDetails[index].manualCorrection = true;
    }
    logEvent('manual_correction', { index, from: oldType, to: -1, remainingReview: getReviewIndices().length });
  } else {
    setCell(index, state.selectedPiece);
    return;
  }
  renderAll();
});

undoBtn.addEventListener('click', () => {
  const last = state.history.pop();
  if (!last) return;
  state.board.set(last.board || last);
  if (last.review && state.detectedDetails) {
    for (const item of last.review) if (item && state.detectedDetails[item.index]) {
      state.detectedDetails[item.index].needsReview = item.needsReview;
      state.detectedDetails[item.index].confidence = item.confidence;
      state.detectedDetails[item.index].type = item.type;
    }
  }
  state.solution = null;
  state.solutionIndex = -1;
  renderAll();
});

clearBtn.addEventListener('click', () => {
  pushHistory();
  state.board.fill(-1);
  state.solution = null;
  state.solutionIndex = -1;
  state.detectedDetails = null;
  state.detectedBoard = null;
  state.detectionTrusted = false;
  reviewBanner.classList.remove('visible');
  renderAll();
});

function renderAll() {
  drawBoard();
  updateCounts();
  updateStepUI();
  undoBtn.disabled = state.history.length === 0;
  updateReviewUI();
}

function countOccupied() {
  let n = 0;
  for (const v of state.board) if (v >= 0) n += 1;
  return n;
}

function getSolutionDisplayBoard() {
  if (!state.solution?.initialBoard) return state.board;
  const board = new Int8Array(state.solution.initialBoard);
  const stepsApplied = Math.max(0, Math.min(state.solutionIndex, state.solution.steps.length));
  for (let i = 0; i < stepsApplied; i++) {
    const step = state.solution.steps[i];
    if (step?.a >= 0) board[step.a] = -1;
    if (step?.b >= 0) board[step.b] = -1;
  }
  return board;
}

async function solveCurrent() {
  if (!countOccupied()) return;
  const review = getReviewIndices();
  if (review.length && !state.detectionTrusted) {
    setStatus(`${review.length} detected cells still need verification.`, 'error');
    return;
  }
  setStatus('Solving...', 'working');
  logEvent('solve_start', { occupied: countOccupied(), reviewRemaining: getReviewIndices().length, trusted: state.detectionTrusted });
  solveBtn.disabled = true;
  state.editing = false;
  try {
    const worker = new Worker('./solver.worker.js', { type: 'module' });
    const id = Date.now();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Solver timed out after 60 seconds')); }, 60000);
      worker.onmessage = (event) => {
        if (event.data.id !== id) return;
        clearTimeout(timer);
        worker.terminate();
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error));
      };
      worker.postMessage({ id, board: Array.from(state.board), timeLimitMs: 55000 });
    });
    if (!result.solved) {
      state.solution = null;
      state.solutionIndex = -1;
      setStatus(`No solution found. ${result.stats.exploredStates.toLocaleString()} dead states checked.`, 'error');
      logEvent('solve_complete', { solved: false, stats: result.stats });
      state.editing = true;
    } else {
      state.solution = {
        ...result,
        initialBoard: new Int8Array(state.board),
      };
      state.solutionIndex = 0;
      setStatus(`Solved in ${result.steps.length} moves · ${result.stats.elapsedMs} ms · ${result.stats.nodes.toLocaleString()} search nodes`, 'ok');
      logEvent('solve_complete', { solved: true, moves: result.steps.length, stats: result.stats });
    }
  } catch (error) {
    logEvent('solve_error', { message: error.message });
    setStatus(error.message, 'error');
    state.editing = true;
  }
  renderAll();
}

solveBtn.addEventListener('click', solveCurrent);
editBtn.addEventListener('click', () => {
  state.editing = true;
  state.solution = null;
  state.solutionIndex = -1;
  setStatus('Manual edit mode', '');
  renderAll();
});

function updateStepUI() {
  if (!state.solution) {
    stepLabel.textContent = 'No solution loaded';
    solutionSteps.innerHTML = '<div class="emptyState">Solve a board to see the move list.</div>';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    playBtn.disabled = true;
    return;
  }
  const total = state.solution.steps.length;
  const index = Math.max(0, Math.min(state.solutionIndex, total));
  state.solutionIndex = index;
  stepLabel.textContent = index >= total ? 'Complete' : `Move ${index + 1} of ${total}`;
  const initialBoard = state.solution.initialBoard || state.board;
  solutionSteps.innerHTML = state.solution.steps.map((step, i) => {
    const a = BOARD.cells[step.a];
    const b = step.b >= 0 ? BOARD.cells[step.b] : null;
    const aType = initialBoard[step.a];
    const bType = b ? initialBoard[step.b] : -1;
    const aName = PIECE_INFO[aType]?.name || 'Marble';
    const bName = b ? (PIECE_INFO[bType]?.name || 'Marble') : '';
    const aIcon = GAME_ICONS[aType];
    const bIcon = b ? GAME_ICONS[bType] : '';
    return `<button class="solutionRow ${i === index ? 'active' : ''} ${i < index ? 'completed' : ''}" data-index="${i}"><span>${String(i + 1).padStart(2, '0')}</span><strong><img src="${aIcon}" alt="" aria-hidden="true"><b>${aName}</b>${b ? `<span class="solutionPlus">+</span><img src="${bIcon}" alt="" aria-hidden="true"><b>${bName}</b>` : ''}</strong><em>${formatCoord(a)}${b ? ` · ${formatCoord(b)}` : ''}</em></button>`;
  }).join('');
  solutionSteps.querySelectorAll('.solutionRow').forEach((row) => row.addEventListener('click', () => {
    state.solutionIndex = Number(row.dataset.index);
    drawBoard();
    updateStepUI();
  }));
  prevBtn.disabled = index <= 0;
  nextBtn.disabled = index >= total;
  playBtn.disabled = index >= total;
}

function formatCoord(cell) {
  return `[${cell.q}, ${cell.r}]`;
}

prevBtn.addEventListener('click', () => {
  state.solutionIndex = Math.max(0, state.solutionIndex - 1);
  drawBoard();
  updateStepUI();
});
nextBtn.addEventListener('click', () => {
  state.solutionIndex = Math.min(state.solution.steps.length, state.solutionIndex + 1);
  drawBoard();
  updateStepUI();
});
playBtn.addEventListener('click', async () => {
  if (!state.solution || state.playing) return;
  state.playing = true;
  playBtn.textContent = 'Playing…';
  const total = state.solution.steps.length;
  for (let i = state.solutionIndex; i <= total && state.playing; i++) {
    state.solutionIndex = i;
    drawBoard();
    updateStepUI();
    if (i < total) await new Promise((resolve) => setTimeout(resolve, 650));
  }
  state.playing = false;
  playBtn.textContent = 'Play solution';
});

async function decodeScreenshotFile(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the HTMLImageElement path. Some browsers expose
      // createImageBitmap but reject screenshots from particular file types.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The selected image could not be decoded by the browser.'));
      element.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadScreenshot(file) {
  // Each screenshot starts a fresh detection transaction. Never leave a prior
  // successful interpretation armed if the new image fails to parse.
  state.detectedBoard = null;
  state.detectedDetails = null;
  state.detectionTrusted = false;
  useDetectionBtn.disabled = true;
  trustSolveBtn.disabled = true;
  // Open the detection UI before any image decoding or CPU-heavy analysis so
  // the user always gets visual feedback even if a browser takes a while to
  // decode or process a large screenshot.
  document.getElementById('detectModal').classList.add('open');
  detectionStatus.textContent = 'Reading screenshot…';
  const image = await decodeScreenshotFile(file);
  const maxW = 4096;
  const scale = Math.min(1, maxW / image.width);
  screenshotCanvas.width = Math.round(image.width * scale);
  screenshotCanvas.height = Math.round(image.height * scale);
  screenshotCtx.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  screenshotCtx.drawImage(image, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
  const imageData = screenshotCtx.getImageData(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  if (typeof image.close === 'function') image.close();
  logEvent('screenshot_loaded', { width: imageData.width, height: imageData.height, fileType: file.type || 'image' });
  detectionStatus.textContent = 'Finding the hex board…';

  await new Promise((r) => requestAnimationFrame(r));
  const located = locateBoard(imageData);
  logEvent('board_located', located ? { center: located.center, hexSize: located.hexSize, source: located.source || 'beige-grid', bbox: located.bbox } : { found: false });
  if (!located) {
    detectionStatus.textContent = 'Could not locate the board automatically. Use the editor instead.';
    state.detectedBoard = null;
    state.detectedDetails = null;
    useDetectionBtn.disabled = true;
    return;
  }
  // Show the located board immediately. Recognition runs in a worker so the
  // modal stays responsive instead of freezing the page while all 91 cells
  // are classified.
  state.located = located;
  drawDetectionOverlay();
  detectionStatus.textContent = 'Reading marble positions and symbols…';
  await new Promise((r) => requestAnimationFrame(r));

  const detectionId = Date.now();
  const detected = await new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker('./detector.worker.js?v=20260920-5', { type: 'module' });
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error('Screenshot recognition timed out after 90 seconds.'));
    }, 90000);
    worker.onmessage = (event) => {
      if (event.data?.id !== detectionId) return;
      if (event.data.progress) {
        const { done, total, stage } = event.data.progress;
        detectionStatus.textContent = stage === 'assigning'
          ? 'Finishing recognition and matching inventory…'
          : 'Reading marble positions and symbols… ' + done + '/' + total;
        return;
      }
      if (event.data.ok) {
        finish(resolve, event.data.result);
      } else {
        const error = new Error(event.data.error || 'Screenshot recognition failed.');
        if (event.data.stack) error.stack = event.data.stack;
        finish(reject, error);
      }
    };
    worker.onerror = (event) => {
      finish(reject, new Error(event.message || 'The screenshot recognition worker failed.'));
    };
    worker.postMessage({
      id: detectionId,
      image: { width: imageData.width, height: imageData.height, data: imageData.data.buffer },
      located,
    }, [imageData.data.buffer]);
  });
  logEvent('board_classified', { detected: detected.detected, review: detected.reviewIndices, counts: detected.counts, stats: detected.stats });
  state.located = located;
  state.detectedBoard = detected.cells;
  state.detectedDetails = Object.fromEntries(detected.details.map((d) => [d.index, d]));
  detectionStatus.innerHTML = `<strong>${detected.summary}</strong><br>Board estimate: ${Math.round(located.center.x)}, ${Math.round(located.center.y)} · cell radius ${Math.round(located.hexSize)} px<br>${detected.ambiguous ? 'Some cells have weaker visual matches. Review the amber-marked cells before solving.' : 'Detection looks clean.'}`;
  useDetectionBtn.disabled = detected.detected === 0;
  trustSolveBtn.disabled = detected.detected === 0;
  drawDetectionOverlay();

  // Put the interpretation onto the main board immediately, but keep the
  // review modal open. The user can either accept it for manual review or
  // trust it completely and solve without another confirmation step.
  if (detected.detected > 0) {
    pushHistory();
    state.board.set(detected.cells);
    state.solution = null;
    state.solutionIndex = -1;
    state.editing = true;
    reviewBanner.classList.add('visible');
    setStatus(`${detected.detected} pieces detected and placed on the board. Review before solving.`, 'ok');
    renderAll();
  }
}

function drawDetectionOverlay() {
  if (!state.located) return;
  const dpr = window.devicePixelRatio || 1;
  const w = screenshotCanvas.width;
  const h = screenshotCanvas.height;
  screenshotCtx.save();
  screenshotCtx.strokeStyle = '#f4c95d';
  screenshotCtx.lineWidth = 2;
  for (const cell of BOARD.cells) {
    const p = boardPoint(state.located.center, state.located.hexSize, cell);
    const detail = state.detectedDetails?.[cell.index];
    screenshotCtx.beginPath();
    screenshotCtx.arc(p.x, p.y, Math.max(3, state.located.hexSize * 0.12), 0, Math.PI * 2);
    screenshotCtx.strokeStyle = detail?.needsReview ? '#f59e0b' : '#5eead4';
    screenshotCtx.stroke();
  }
  screenshotCtx.restore();
}

screenshotInput.addEventListener('change', () => {
  const file = screenshotInput.files?.[0];
  // Reset the input so selecting the same screenshot twice still fires change.
  screenshotInput.value = '';
  if (!file) return;
  loadScreenshot(file).catch((error) => {
    console.error('Sigmar screenshot import failed:', error);
    logEvent('screenshot_error', {
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    document.getElementById('detectModal').classList.add('open');
    detectionStatus.innerHTML = '<strong>Screenshot import failed.</strong><br>' +
      (error?.message || 'The image could not be processed.') +
      '<br><span class="muted">Open Diagnostics for the recorded error.</span>';
    useDetectionBtn.disabled = true;
    trustSolveBtn.disabled = true;
    setStatus('Screenshot import failed. See the detection window or Diagnostics.', 'error');
  });
});
screenshotBtn.addEventListener('click', () => screenshotInput.click());
pasteBtn.addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        try {
          await loadScreenshot(blob);
        } catch (error) {
          console.error('Sigmar pasted screenshot import failed:', error);
          logEvent('screenshot_error', { message: error?.message || String(error) });
          document.getElementById('detectModal').classList.add('open');
          detectionStatus.innerHTML = '<strong>Screenshot import failed.</strong><br>' +
            (error?.message || 'The image could not be processed.');
          useDetectionBtn.disabled = true;
          trustSolveBtn.disabled = true;
          setStatus('Screenshot import failed. See the detection window or Diagnostics.', 'error');
        }
        return;
      }
    }
    setStatus('No image found on the clipboard.', 'error');
  } catch {
    setStatus('Clipboard image access was blocked by the browser. Use Upload screenshot instead.', 'error');
  }
});

function acceptDetectedBoard() {
  if (!state.detectedBoard) return;
  document.getElementById('detectModal').classList.remove('open');
  state.editing = true;
  state.detectionTrusted = false;
  updateReviewUI();
  setStatus(getReviewIndices().length ? 'Screenshot interpretation accepted. Review the amber-marked cells.' : 'Screenshot interpretation accepted. Board is ready to solve.', 'ok');
  renderAll();
}

useDetectionBtn.addEventListener('click', acceptDetectedBoard);
trustSolveBtn.addEventListener('click', async () => {
  if (!state.detectedBoard) return;
  state.detectionTrusted = true;
  logEvent('detection_trusted', { reviewSkipped: getReviewIndices().length });
  document.getElementById('detectModal').classList.remove('open');
  await solveCurrent();
});
closeDetectBtn.addEventListener('click', () => { document.getElementById('detectModal').classList.remove('open'); if (state.detectedBoard) { updateReviewUI(); setStatus(getReviewIndices().length ? 'Detection remains on the board. Review the amber-marked cells.' : 'Detection verified. Ready to solve.', 'ok'); renderAll(); } });

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const idx = hexClickIndex(event.clientX - rect.left, event.clientY - rect.top);
  canvas.style.cursor = state.editing && idx >= 0 ? 'pointer' : 'default';
});

zoomSlider.addEventListener('input', drawBoard);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('paste', async (event) => {
  const items = event.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) await loadScreenshot(file);
      break;
    }
  }
});

function refreshDiagnosticsPanel() {
  if (!diagnosticsOutput) return;
  diagnosticsOutput.value = diagnosticsJSON({ board: { occupied: countOccupied(), review: getReviewIndices() } });
}
copyDiagnosticsBtn?.addEventListener('click', async () => { try { await copyDiagnostics({ board: { occupied: countOccupied(), review: getReviewIndices() } }); setStatus('Diagnostics copied.', 'ok'); } catch (e) { setStatus(`Could not copy diagnostics: ${e.message}`, 'error'); } });
downloadDiagnosticsBtn?.addEventListener('click', () => downloadDiagnostics({ board: { occupied: countOccupied(), review: getReviewIndices() } }));
clearDiagnosticsBtn?.addEventListener('click', () => { clearDiagnostics(); refreshDiagnosticsPanel(); });
diagnosticsPanel?.addEventListener('toggle', refreshDiagnosticsPanel);
window.addEventListener('sigmar:diagnostic', refreshDiagnosticsPanel);
window.addEventListener('sigmar:diagnostic:clear', refreshDiagnosticsPanel);

buildPalette();
renderAll();
setStatus('Ready. The board is blank. Import a screenshot or edit it manually.');
refreshDiagnosticsPanel();
resizeCanvas();

window.__SIGMAR__ = { state, BOARD, PIECES, solve, validateBoard, locateBoard, classifyBoard, boardPoint };
