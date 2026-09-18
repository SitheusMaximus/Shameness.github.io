/*
 * Sigmar's Garden solver.
 *
 * The search model and original move rules are derived from the
 * Shameness/MarbleFinder project:
 * https://github.com/Shameness/Shameness.github.io
 *
 * This version keeps the same puzzle rules but uses an in-place
 * backtracking search, explicit metal-order state, and additional
 * dead-state pruning.
 */

export const PIECES = Object.freeze({
  SALT: 0,
  AIR: 1,
  FIRE: 2,
  WATER: 3,
  EARTH: 4,
  MERCURY: 5,
  LEAD: 6,
  TIN: 7,
  IRON: 8,
  COPPER: 9,
  SILVER: 10,
  GOLD: 11,
  MORS: 12,
  VITAE: 13,
});

export const PIECE_INFO = Object.freeze({
  [PIECES.SALT]: { name: 'Salt', short: 'Sa', color: '#e0e0e0', group: 'salt' },
  [PIECES.AIR]: { name: 'Air', short: 'Ai', color: '#73c2fb', group: 'element' },
  [PIECES.FIRE]: { name: 'Fire', short: 'Fi', color: '#fc6600', group: 'element' },
  [PIECES.WATER]: { name: 'Water', short: 'Wa', color: '#4f97a3', group: 'element' },
  [PIECES.EARTH]: { name: 'Earth', short: 'Ea', color: '#4cbb17', group: 'element' },
  [PIECES.MERCURY]: { name: 'Mercury', short: 'Hg', color: '#e0e0e0', group: 'mercury' },
  [PIECES.LEAD]: { name: 'Lead', short: 'Pb', color: '#4682b4', group: 'metal' },
  [PIECES.TIN]: { name: 'Tin', short: 'Sn', color: '#a9ba9d', group: 'metal' },
  [PIECES.IRON]: { name: 'Iron', short: 'Fe', color: '#702963', group: 'metal' },
  [PIECES.COPPER]: { name: 'Copper', short: 'Cu', color: '#ca3433', group: 'metal' },
  [PIECES.SILVER]: { name: 'Silver', short: 'Ag', color: '#696980', group: 'metal' },
  [PIECES.GOLD]: { name: 'Gold', short: 'Au', color: '#f9a602', group: 'gold' },
  [PIECES.MORS]: { name: 'Mors', short: 'M', color: '#222021', group: 'life' },
  [PIECES.VITAE]: { name: 'Vitae', short: 'V', color: '#fdb9c8', group: 'life' },
});

export const METAL_ORDER = Object.freeze([
  PIECES.LEAD,
  PIECES.TIN,
  PIECES.IRON,
  PIECES.COPPER,
  PIECES.SILVER,
]);

export const ELEMENTS = Object.freeze([
  PIECES.AIR,
  PIECES.FIRE,
  PIECES.WATER,
  PIECES.EARTH,
]);

export const BOARD_RADIUS = 5;

export function makeBoardGeometry(radius = BOARD_RADIUS) {
  const cells = [];
  const indexByAxial = new Map();

  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) {
        const index = cells.length;
        cells.push({ index, q, r });
        indexByAxial.set(`${q},${r}`, index);
      }
    }
  }

  const directions = [
    [1, 0], [1, -1], [0, -1],
    [-1, 0], [-1, 1], [0, 1],
  ];

  const neighbors = cells.map((cell) => directions.map(([dq, dr]) => {
    return indexByAxial.get(`${cell.q + dq},${cell.r + dr}`) ?? -1;
  }));

  return { cells, neighbors, indexByAxial };
}

export const BOARD = makeBoardGeometry();
export const CELL_COUNT = BOARD.cells.length;

function hasThreeConsecutiveFree(board, neighbors) {
  let run = 0;
  for (let i = 0; i < neighbors.length * 2; i++) {
    const neighborIndex = neighbors[i % neighbors.length];
    const free = neighborIndex === -1 || board[neighborIndex] === -1;
    if (free) {
      run += 1;
      if (run >= 3) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

export function computeFreeMask(board) {
  const free = new Uint8Array(board.length);
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== -1 && hasThreeConsecutiveFree(board, BOARD.neighbors[i])) {
      free[i] = 1;
    }
  }
  return free;
}

export function isPairAllowed(a, b) {
  if (a === PIECES.SALT && b === PIECES.SALT) return true;
  if (a === PIECES.SALT && ELEMENTS.includes(b)) return true;
  if (b === PIECES.SALT && ELEMENTS.includes(a)) return true;
  if (ELEMENTS.includes(a) && a === b) return true;
  if ((a === PIECES.MORS && b === PIECES.VITAE) || (a === PIECES.VITAE && b === PIECES.MORS)) return true;
  return false;
}

export function inferMetalOrder(board) {
  for (let i = 0; i < METAL_ORDER.length; i++) {
    if (board.includes(METAL_ORDER[i])) return i;
  }
  return METAL_ORDER.length;
}

function countPieces(board) {
  const counts = new Uint16Array(14);
  for (const value of board) {
    if (value >= 0) counts[value] += 1;
  }
  return counts;
}

function necessaryPrune(board, metalOrder) {
  const counts = countPieces(board);
  const oddElements = ELEMENTS.reduce((n, id) => n + (counts[id] % 2), 0);
  const salts = counts[PIECES.SALT];
  if (oddElements > salts) return true;
  if ((salts - oddElements) % 2 !== 0) return true;

  if (counts[PIECES.MORS] !== counts[PIECES.VITAE]) return true;

  let remainingBaseMetals = 0;
  for (let i = metalOrder; i < METAL_ORDER.length; i++) {
    if (counts[METAL_ORDER[i]]) remainingBaseMetals += 1;
  }
  if (remainingBaseMetals > counts[PIECES.MERCURY]) return true;

  return false;
}

function encodeState(board, metalOrder) {
  let key = String.fromCharCode(65 + metalOrder);
  for (let i = 0; i < board.length; i++) {
    key += String.fromCharCode(board[i] + 1);
  }
  return key;
}

function metalIsPresent(board, metalId) {
  return board.includes(metalId);
}

function generateMoves(board, freeMask, metalOrder) {
  const moves = [];
  const freeIndices = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== -1 && freeMask[i]) freeIndices.push(i);
  }

  // Metals are strongly constrained, so try the current metal first.
  if (metalOrder < METAL_ORDER.length) {
    const target = METAL_ORDER[metalOrder];
    if (metalIsPresent(board, target)) {
      const targetIndex = freeIndices.find((i) => board[i] === target);
      if (targetIndex !== undefined) {
        for (const mercuryIndex of freeIndices) {
          if (board[mercuryIndex] === PIECES.MERCURY) {
            moves.push({ a: targetIndex, b: mercuryIndex, kind: 'metal' });
          }
        }
      }
    }
  }

  // Life/death is another constrained pair, so try it early.
  for (let i = 0; i < freeIndices.length; i++) {
    for (let j = i + 1; j < freeIndices.length; j++) {
      const a = board[freeIndices[i]];
      const b = board[freeIndices[j]];
      if ((a === PIECES.MORS && b === PIECES.VITAE) || (a === PIECES.VITAE && b === PIECES.MORS)) {
        moves.push({ a: freeIndices[i], b: freeIndices[j], kind: 'life' });
      }
    }
  }

  // Element pairs. Same-element moves are preferred to spending salt.
  for (const element of ELEMENTS) {
    const cells = freeIndices.filter((i) => board[i] === element);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        moves.push({ a: cells[i], b: cells[j], kind: 'element' });
      }
    }
  }

  // Salt as a wildcard. Put these after same-element moves.
  const saltCells = freeIndices.filter((i) => board[i] === PIECES.SALT);
  for (const saltIndex of saltCells) {
    for (const element of ELEMENTS) {
      for (const elementIndex of freeIndices) {
        if (board[elementIndex] === element && saltIndex !== elementIndex) {
          moves.push({ a: saltIndex, b: elementIndex, kind: 'salt-wildcard' });
        }
      }
    }
  }

  for (let i = 0; i < saltCells.length; i++) {
    for (let j = i + 1; j < saltCells.length; j++) {
      moves.push({ a: saltCells[i], b: saltCells[j], kind: 'salt-salt' });
    }
  }

  // Gold is a single-cell move and should normally be considered last.
  if (metalOrder >= METAL_ORDER.length) {
    for (const index of freeIndices) {
      if (board[index] === PIECES.GOLD) {
        moves.push({ a: index, b: -1, kind: 'gold' });
      }
    }
  }

  return moves;
}

function applyMove(board, move) {
  const previousA = board[move.a];
  const previousB = move.b >= 0 ? board[move.b] : -1;
  board[move.a] = -1;
  if (move.b >= 0) board[move.b] = -1;
  return { previousA, previousB };
}

function undoMove(board, move, previous) {
  board[move.a] = previous.previousA;
  if (move.b >= 0) board[move.b] = previous.previousB;
}

function search(board, metalOrder, seen, stats, options, startTime, path) {
  stats.nodes += 1;
  if ((stats.nodes & 2047) === 0) {
    if (options.signal?.aborted) throw new Error('Solver cancelled');
    if (options.timeLimitMs && performance.now() - startTime > options.timeLimitMs) {
      throw new Error('Solver time limit reached');
    }
  }

  let remaining = 0;
  for (const value of board) if (value !== -1) remaining += 1;
  if (remaining === 0) return true;

  if (necessaryPrune(board, metalOrder)) {
    stats.pruned += 1;
    return false;
  }

  const key = encodeState(board, metalOrder);
  if (seen.has(key)) {
    stats.memoHits += 1;
    return false;
  }

  const freeMask = computeFreeMask(board);
  const moves = generateMoves(board, freeMask, metalOrder);
  if (moves.length === 0) {
    seen.add(key);
    return false;
  }

  // Prefer moves that expose currently constrained metals.
  moves.sort((m1, m2) => {
    const rank = { metal: 0, life: 1, element: 2, 'salt-salt': 3, 'salt-wildcard': 4, gold: 5 };
    return rank[m1.kind] - rank[m2.kind];
  });

  for (const move of moves) {
    const previous = applyMove(board, move);
    const nextMetalOrder = move.kind === 'metal' ? metalOrder + 1 : metalOrder;
    path.push(move);

    if (search(board, nextMetalOrder, seen, stats, options, startTime, path)) return true;

    path.pop();
    undoMove(board, move, previous);
  }

  seen.add(key);
  return false;
}

function normaliseBoard(input) {
  const board = input instanceof Int16Array ? new Int16Array(input) : Int16Array.from(input);
  if (board.length !== CELL_COUNT) throw new Error(`Expected ${CELL_COUNT} cells, got ${board.length}`);
  return board;
}

export function validateBoard(board) {
  const counts = countPieces(board);
  const maxAllowed = [4,8,8,8,8,5,1,1,1,1,1,1,4,4];
  const errors = [];
  for (let i = 0; i < maxAllowed.length; i++) {
    if (counts[i] > maxAllowed[i]) {
      errors.push(`${PIECE_INFO[i].name}: ${counts[i]} found, max ${maxAllowed[i]}`);
    }
  }
  return { valid: errors.length === 0, errors, counts };
}

export function solve(input, options = {}) {
  const board = normaliseBoard(input);
  const validation = validateBoard(board);
  if (!validation.valid) throw new Error(validation.errors.join('; '));

  const metalOrder = inferMetalOrder(board);
  const path = [];
  const stats = { nodes: 0, pruned: 0, memoHits: 0 };
  const seen = new Set();
  const startTime = performance.now();

  const solved = search(board, metalOrder, seen, stats, options, startTime, path);
  return {
    solved,
    steps: solved ? path.map((move) => ({ ...move })) : [],
    stats: {
      ...stats,
      elapsedMs: Math.round(performance.now() - startTime),
      initialPieces: validation.counts.reduce((n, c) => n + c, 0),
      exploredStates: seen.size,
    },
  };
}

export function boardToInput(board) {
  const input = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== -1) {
      const cell = BOARD.cells[i];
      input.push({ type: board[i], q: cell.q, r: cell.r, index: i });
    }
  }
  return input;
}
