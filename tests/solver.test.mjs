import assert from 'node:assert/strict';
import { BOARD, CELL_COUNT, PIECES, solve, computeFreeMask, validateBoard, inferMetalOrder } from '../solver.js';

function blank() {
  const b = new Int8Array(CELL_COUNT);
  b.fill(-1);
  return b;
}
function put(b, index, type) { b[index] = type; }

// A single pair placed far apart. Both are free because off-board neighbors count.
{
  const b = blank();
  put(b, 0, PIECES.FIRE);
  put(b, 12, PIECES.FIRE);
  const r = solve(b);
  assert.equal(r.solved, true);
  assert.equal(r.steps.length, 1);
}

// Salt wildcard can clear two otherwise unmatched element colors.
{
  const b = blank();
  put(b, 0, PIECES.FIRE);
  put(b, 12, PIECES.SALT);
  const r = solve(b);
  assert.equal(r.solved, true);
}

// Mors/Vitae must match each other.
{
  const b = blank();
  put(b, 0, PIECES.MORS);
  put(b, 12, PIECES.VITAE);
  assert.equal(solve(b).solved, true);

  const bad = blank();
  put(bad, 0, PIECES.MORS);
  put(bad, 12, PIECES.MORS);
  assert.equal(solve(bad).solved, false);
}

// Metal order and Gold as a final single move.
{
  const b = blank();
  put(b, 0, PIECES.MERCURY);
  put(b, 12, PIECES.LEAD);
  put(b, 24, PIECES.MERCURY);
  put(b, 36, PIECES.TIN);
  put(b, 48, PIECES.MERCURY);
  put(b, 60, PIECES.IRON);
  put(b, 72, PIECES.MERCURY);
  put(b, 84, PIECES.COPPER);
  put(b, 5, PIECES.MERCURY);
  put(b, 17, PIECES.SILVER);
  put(b, 30, PIECES.GOLD);
  const result = solve(b);
  assert.equal(result.solved, true);
  const kinds = result.steps.map((s) => s.kind);
  assert.equal(kinds.at(-1), 'gold');
  assert.equal(inferMetalOrder(b), 0);
}

// Free mask must treat off-board neighbours as free and require three contiguous sides.
{
  const b = blank();
  put(b, 0, PIECES.AIR);
  put(b, 1, PIECES.AIR);
  const free = computeFreeMask(b);
  assert.equal(free[0], 1);
}

// Inventory validation catches impossible over-counts.
{
  const b = blank();
  for (const idx of [0,1,2,3,4]) b[idx] = PIECES.SALT;
  assert.equal(validateBoard(b).valid, false);

  const validEarth = blank();
  for (const idx of [0,1,2,3,4,5,6,7]) validEarth[idx] = PIECES.EARTH;
  assert.equal(validateBoard(validEarth).valid, true);
  validEarth[8] = PIECES.EARTH;
  assert.equal(validateBoard(validEarth).valid, false);
}


const METAL_ORDER_FOR_TEST = [PIECES.LEAD, PIECES.TIN, PIECES.IRON, PIECES.COPPER, PIECES.SILVER];

// Full 55-marble board from a published Sigmar's Garden solver example,
// remapped into this project's piece IDs and row order. The search should
// return a complete sequence, and every returned move must be legal when replayed.
{
  const rows = [
    [0,0,0,0,11,0],
    [3,6,2,2,5,1,0],
    [0,4,2,0,1,1,3,0],
    [0,5,5,0,4,0,0,12,0],
    [0,4,0,4,3,4,2,14,14,1],
    [0,2,9,0,2,13,1,0,7,14,0],
    [3,7,7,1,4,1,14,0,8,0],
    [0,10,0,0,14,0,6,3,0],
    [0,4,6,1,0,2,3,0],
    [0,4,5,7,3,6,3],
    [0,2,0,0,0,0],
  ];
  const map = {
    0: -1,
    1: PIECES.FIRE,
    2: PIECES.EARTH,
    3: PIECES.WATER,
    4: PIECES.AIR,
    5: PIECES.SALT,
    6: PIECES.VITAE,
    7: PIECES.MORS,
    8: PIECES.LEAD,
    9: PIECES.TIN,
    10: PIECES.IRON,
    11: PIECES.COPPER,
    12: PIECES.SILVER,
    13: PIECES.GOLD,
    14: PIECES.MERCURY,
  };
  const b = new Int8Array(CELL_COUNT);
  let cursor = 0;
  for (const row of rows) for (const value of row) b[cursor++] = map[value];
  assert.equal(validateBoard(b).valid, true);

  const result = solve(b, { timeLimitMs: 10000 });
  assert.equal(result.solved, true);
  assert.equal(result.steps.length, 28);

  let metalOrder = inferMetalOrder(b);
  const replay = new Int8Array(b);
  for (const step of result.steps) {
    const free = computeFreeMask(replay);
    assert.equal(free[step.a], 1, `move a ${step.a} was not free`);
    if (step.b >= 0) assert.equal(free[step.b], 1, `move b ${step.b} was not free`);

    const a = replay[step.a];
    const bb = step.b >= 0 ? replay[step.b] : -1;
    if (step.kind === 'metal') {
      assert.equal(a === PIECES.MERCURY || bb === PIECES.MERCURY, true);
      const metal = a === PIECES.MERCURY ? bb : a;
      assert.equal(metal, METAL_ORDER_FOR_TEST[metalOrder]);
      metalOrder += 1;
    } else if (step.kind === 'gold') {
      assert.equal(a, PIECES.GOLD);
      assert.equal(step.b, -1);
      assert.equal(metalOrder, 5);
    } else {
      assert.equal(isPairAllowedForTest(a, bb), true);
    }
    replay[step.a] = -1;
    if (step.b >= 0) replay[step.b] = -1;
  }
  assert.equal(replay.every((v) => v === -1), true);
}

function isPairAllowedForTest(a, b) {
  if (a === PIECES.SALT && b === PIECES.SALT) return true;
  if (a === PIECES.SALT && [PIECES.AIR, PIECES.FIRE, PIECES.WATER, PIECES.EARTH].includes(b)) return true;
  if (b === PIECES.SALT && [PIECES.AIR, PIECES.FIRE, PIECES.WATER, PIECES.EARTH].includes(a)) return true;
  if ([PIECES.AIR, PIECES.FIRE, PIECES.WATER, PIECES.EARTH].includes(a) && a === b) return true;
  if ((a === PIECES.MORS && b === PIECES.VITAE) || (a === PIECES.VITAE && b === PIECES.MORS)) return true;
  return false;
}

console.log(`PASS: ${CELL_COUNT}-cell geometry, rule, and full-board replay tests`);
