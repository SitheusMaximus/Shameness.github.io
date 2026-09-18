import { BOARD, CELL_COUNT, PIECES, PIECE_INFO, ELEMENTS, solve, validateBoard, computeFreeMask } from './solver.js';
import { locateBoard, classifyBoard, boardPoint } from './detector.js';

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
const closeDetectBtn = document.getElementById('closeDetectBtn');
const prevBtn = document.getElementById('prevStepBtn');
const nextBtn = document.getElementById('nextStepBtn');
const playBtn = document.getElementById('playBtn');
const stepLabel = document.getElementById('stepLabel');
const pieceCounts = document.getElementById('pieceCounts');
const palette = document.getElementById('palette');
const zoomSlider = document.getElementById('zoomSlider');
const reviewBanner = document.getElementById('reviewBanner');
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
};
state.board.fill(-1);

const PIECE_IDS = [PIECES.AIR, PIECES.WATER, PIECES.FIRE, PIECES.EARTH, PIECES.SALT, PIECES.MERCURY, PIECES.LEAD, PIECES.TIN, PIECES.IRON, PIECES.COPPER, PIECES.SILVER, PIECES.GOLD, PIECES.MORS, PIECES.VITAE];

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
  // The 91-cell board spans 11*sqrt(3) hex radii horizontally and 17 vertically.
  // Fit the whole puzzle instead of letting the canvas crop the outer cells.
  const hexSize = Math.min(rect.width / (11 * Math.sqrt(3)), rect.height / 17) * zoom * 0.96;
  return { center: { x: rect.width / 2, y: rect.height / 2 }, hexSize };
}

function pointForIndex(index, view = state.boardView) {
  return boardPoint(view, view.hexSize, BOARD.cells[index]);
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

  const freeMask = computeFreeMask(state.board);
  const solutionMove = state.solution && state.solutionIndex >= 0 ? state.solution.steps[state.solutionIndex] : null;

  for (const cell of BOARD.cells) {
    const p = pointForIndex(cell.index);
    const occupied = state.board[cell.index] >= 0;
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
      const type = state.board[cell.index];
      const info = PIECE_INFO[type];
      const r = state.boardView.hexSize * 0.56;
      const gradient = ctx.createRadialGradient(p.x - r * 0.25, p.y - r * 0.3, r * 0.15, p.x, p.y, r);
      gradient.addColorStop(0, lighten(info.color, 0.25));
      gradient.addColorStop(1, info.color);
      ctx.beginPath();
      ctx.fillStyle = gradient;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = freeMask[cell.index] ? '#fff7d2' : '#4c453b';
      ctx.lineWidth = solutionMove && (solutionMove.a === cell.index || solutionMove.b === cell.index) ? 4.5 : 2;
      if (solutionMove && (solutionMove.a === cell.index || solutionMove.b === cell.index)) ctx.strokeStyle = '#f4c95d';
      ctx.stroke();
      ctx.fillStyle = luminance(info.color) > 155 ? '#2a241c' : '#f8f3e7';
      ctx.font = `600 ${Math.max(10, state.boardView.hexSize * 0.25)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.short, p.x, p.y + 1);
    }

    if (state.detectedDetails) {
      const detail = state.detectedDetails[cell.index];
      if (detail?.confidence !== undefined && detail.confidence < REVIEW_CONFIDENCE && detail.type >= 0) {
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
    button.innerHTML = `<span class="pieceSwatch" style="--piece:${info.color}">${info.short}</span><span>${info.name}</span>`;
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
  for (const value of state.board) if (value >= 0) counts[value] += 1;
  const occupied = counts.reduce((n, v) => n + v, 0);
  countLine.textContent = `${occupied} / ${CELL_COUNT} board cells occupied`;
  pieceCounts.innerHTML = PIECE_IDS.map((type) => {
    const info = PIECE_INFO[type];
    return `<span class="countChip"><i style="background:${info.color}"></i>${info.name} ${counts[type]}</span>`;
  }).join('');
}

function pushHistory() {
  state.history.push(new Int8Array(state.board));
  if (state.history.length > 80) state.history.shift();
}

function setCell(index, type) {
  if (index < 0) return;
  pushHistory();
  state.board[index] = type;
  state.solution = null;
  state.solutionIndex = -1;
  state.detectedDetails = null;
  renderAll();
}

canvas.addEventListener('click', (event) => {
  if (!state.editing) return;
  const rect = canvas.getBoundingClientRect();
  const index = hexClickIndex(event.clientX - rect.left, event.clientY - rect.top);
  if (index < 0) return;
  if (state.board[index] === state.selectedPiece) {
    pushHistory();
    state.board[index] = -1;
  } else {
    setCell(index, state.selectedPiece);
    return;
  }
  renderAll();
});

undoBtn.addEventListener('click', () => {
  const last = state.history.pop();
  if (!last) return;
  state.board.set(last);
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
  renderAll();
});

function renderAll() {
  drawBoard();
  updateCounts();
  updateStepUI();
  undoBtn.disabled = state.history.length === 0;
  solveBtn.disabled = countOccupied() === 0;
}

function countOccupied() {
  let n = 0;
  for (const v of state.board) if (v >= 0) n += 1;
  return n;
}

async function solveCurrent() {
  if (!countOccupied()) return;
  setStatus('Solving...', 'working');
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
      state.editing = true;
    } else {
      state.solution = result;
      state.solutionIndex = 0;
      setStatus(`Solved in ${result.steps.length} moves · ${result.stats.elapsedMs} ms · ${result.stats.nodes.toLocaleString()} search nodes`, 'ok');
    }
  } catch (error) {
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
  const index = Math.max(0, Math.min(state.solutionIndex, total - 1));
  state.solutionIndex = index;
  stepLabel.textContent = `Move ${index + 1} of ${total}`;
  solutionSteps.innerHTML = state.solution.steps.map((step, i) => {
    const a = BOARD.cells[step.a];
    const b = step.b >= 0 ? BOARD.cells[step.b] : null;
    const aName = PIECE_INFO[state.board[step.a]]?.name || 'Marble';
    const bName = b ? (PIECE_INFO[state.board[step.b]]?.name || 'Marble') : '';
    return `<button class="solutionRow ${i === index ? 'active' : ''}" data-index="${i}"><span>${String(i + 1).padStart(2, '0')}</span><strong>${aName}${bName ? ` + ${bName}` : ' →'}</strong><em>${formatCoord(a)}${b ? ` · ${formatCoord(b)}` : ''}</em></button>`;
  }).join('');
  solutionSteps.querySelectorAll('.solutionRow').forEach((row) => row.addEventListener('click', () => {
    state.solutionIndex = Number(row.dataset.index);
    drawBoard();
    updateStepUI();
  }));
  prevBtn.disabled = index <= 0;
  nextBtn.disabled = index >= total - 1;
  playBtn.disabled = false;
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
  state.solutionIndex = Math.min(state.solution.steps.length - 1, state.solutionIndex + 1);
  drawBoard();
  updateStepUI();
});
playBtn.addEventListener('click', async () => {
  if (!state.solution || state.playing) return;
  state.playing = true;
  playBtn.textContent = 'Playing…';
  for (let i = state.solutionIndex; i < state.solution.steps.length && state.playing; i++) {
    state.solutionIndex = i;
    drawBoard();
    updateStepUI();
    await new Promise((resolve) => setTimeout(resolve, 650));
  }
  state.playing = false;
  playBtn.textContent = 'Play solution';
});

async function loadScreenshot(file) {
  const image = await createImageBitmap(file);
  const maxW = 4096;
  const scale = Math.min(1, maxW / image.width);
  screenshotCanvas.width = Math.round(image.width * scale);
  screenshotCanvas.height = Math.round(image.height * scale);
  screenshotCtx.clearRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  screenshotCtx.drawImage(image, 0, 0, screenshotCanvas.width, screenshotCanvas.height);
  const imageData = screenshotCtx.getImageData(0, 0, screenshotCanvas.width, screenshotCanvas.height);
  detectionStatus.textContent = 'Finding the hex board…';
  document.getElementById('detectModal').classList.add('open');

  await new Promise((r) => requestAnimationFrame(r));
  const located = locateBoard(imageData);
  if (!located) {
    detectionStatus.textContent = 'Could not locate the board automatically. Use the editor instead.';
    state.detectedBoard = null;
    state.detectedDetails = null;
    useDetectionBtn.disabled = true;
    return;
  }
  const detected = classifyBoard(imageData, located);
  state.located = located;
  state.detectedBoard = detected.cells;
  state.detectedDetails = Object.fromEntries(detected.details.map((d) => [d.index, d]));
  detectionStatus.innerHTML = `<strong>${detected.summary}</strong><br>Board estimate: ${Math.round(located.center.x)}, ${Math.round(located.center.y)} · cell radius ${Math.round(located.hexSize)} px<br>${detected.ambiguous ? 'Some cells have weaker visual matches. Review the amber-marked cells before solving.' : 'Detection looks clean.'}`;
  useDetectionBtn.disabled = detected.detected === 0;
  drawDetectionOverlay();

  // Apply a successful detection immediately. The earlier version only populated
  // the board after the user pressed a second button, which made a successful
  // screenshot import look like it had detected nothing.
  if (detected.detected > 0) {
    pushHistory();
    state.board.set(detected.cells);
    state.solution = null;
    state.solutionIndex = -1;
    state.editing = true;
    reviewBanner.classList.toggle('visible', Boolean(state.detectedDetails && Object.values(state.detectedDetails).some((d) => d?.confidence < REVIEW_CONFIDENCE && d.type >= 0)));
    document.getElementById('detectModal').classList.remove('open');
    setStatus(`${detected.detected} pieces imported from screenshot. Review the board, then solve.`, 'ok');
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
    const detail = state.detectedDetails[cell.index];
    screenshotCtx.beginPath();
    screenshotCtx.arc(p.x, p.y, Math.max(3, state.located.hexSize * 0.12), 0, Math.PI * 2);
    screenshotCtx.strokeStyle = detail?.confidence < REVIEW_CONFIDENCE ? '#f59e0b' : '#5eead4';
    screenshotCtx.stroke();
  }
  screenshotCtx.restore();
}

screenshotInput.addEventListener('change', () => {
  const file = screenshotInput.files?.[0];
  if (file) loadScreenshot(file).catch((e) => { detectionStatus.textContent = e.message; });
});
screenshotBtn.addEventListener('click', () => screenshotInput.click());
pasteBtn.addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        await loadScreenshot(blob);
        return;
      }
    }
    setStatus('No image found on the clipboard.', 'error');
  } catch {
    setStatus('Clipboard image access was blocked by the browser. Use Upload screenshot instead.', 'error');
  }
});

useDetectionBtn.addEventListener('click', () => {
  if (!state.detectedBoard) return;
  pushHistory();
  state.board.set(state.detectedBoard);
  state.solution = null;
  state.solutionIndex = -1;
  state.editing = true;
  document.getElementById('detectModal').classList.remove('open');
  reviewBanner.classList.toggle('visible', Boolean(state.detectedDetails && Object.values(state.detectedDetails).some((d) => d.confidence < REVIEW_CONFIDENCE && d.type >= 0)));
  setStatus('Screenshot imported. Review amber-marked cells before solving.', 'ok');
  renderAll();
});
closeDetectBtn.addEventListener('click', () => document.getElementById('detectModal').classList.remove('open'));

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

buildPalette();
renderAll();
setStatus('Ready. Import a screenshot or edit the board manually.');
resizeCanvas();

window.__SIGMAR__ = { state, BOARD, PIECES, solve, validateBoard, locateBoard, classifyBoard, boardPoint };
