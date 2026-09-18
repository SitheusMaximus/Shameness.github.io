import { BOARD, CELL_COUNT, PIECES, PIECE_INFO } from './solver.js';
import { TEMPLATE_SIZE, TEMPLATE_COUNTS, COLOR_DATA, SHAPE_DATA } from './reference-templates.js';

const TYPE_NAMES = Object.freeze(Object.keys(TEMPLATE_COUNTS));
const TYPE_IDS = Object.freeze({
  Salt: PIECES.SALT,
  Air: PIECES.AIR,
  Fire: PIECES.FIRE,
  Water: PIECES.WATER,
  Earth: PIECES.EARTH,
  Mercury: PIECES.MERCURY,
  Iron: PIECES.IRON,
  Lead: PIECES.LEAD,
  Tin: PIECES.TIN,
  Copper: PIECES.COPPER,
  Silver: PIECES.SILVER,
  Gold: PIECES.GOLD,
  Mors: PIECES.MORS,
  Vitae: PIECES.VITAE,
});

const STANDARD_TOTAL = TYPE_NAMES.reduce((n, name) => n + TEMPLATE_COUNTS[name], 0);
const TEMPLATE_MASK = [];
const TEMPLATE_MASK_RADIUS = 10.5;
for (let y = 0; y < TEMPLATE_SIZE; y++) {
  for (let x = 0; x < TEMPLATE_SIZE; x++) {
    const dx = x - (TEMPLATE_SIZE - 1) / 2;
    const dy = y - (TEMPLATE_SIZE - 1) / 2;
    if (dx * dx + dy * dy < TEMPLATE_MASK_RADIUS * TEMPLATE_MASK_RADIUS) TEMPLATE_MASK.push(y * TEMPLATE_SIZE + x);
  }
}

const COLOR_TEMPLATES = Object.freeze(Object.fromEntries(
  TYPE_NAMES.map((name) => [name, COLOR_DATA[name].map((s) => decodeBase64(s, Uint8Array))]),
));
const SHAPE_TEMPLATES = Object.freeze(Object.fromEntries(
  TYPE_NAMES.map((name) => [name, SHAPE_DATA[name].map((s) => decodeBase64(s, Int8Array))]),
));

const BOARD_ASPECT = 11 * Math.sqrt(3) / 17.0;
const FRAME_PAD_X_PER_RADIUS = 0.8421416110;
const FRAME_PAD_Y_PER_RADIUS = 0.4736842105;

function decodeBase64(value, Type) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Type(bytes.buffer);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function boardPoint(center, hexSize, cell) {
  return {
    x: center.x + Math.sqrt(3) * hexSize * (cell.q + cell.r / 2),
    y: center.y + 1.5 * hexSize * cell.r,
  };
}

function grayAt(imageData, x, y) {
  const { width, height, data } = imageData;
  x = clamp(x, 0, width - 1);
  y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const g00 = 0.299 * data[i00] + 0.587 * data[i00 + 1] + 0.114 * data[i00 + 2];
  const g10 = 0.299 * data[i10] + 0.587 * data[i10 + 1] + 0.114 * data[i10 + 2];
  const g01 = 0.299 * data[i01] + 0.587 * data[i01 + 1] + 0.114 * data[i01 + 2];
  const g11 = 0.299 * data[i11] + 0.587 * data[i11 + 1] + 0.114 * data[i11 + 2];
  return g00 * (1 - dx) * (1 - dy) + g10 * dx * (1 - dy) + g01 * (1 - dx) * dy + g11 * dx * dy;
}

function rgbAt(imageData, x, y) {
  const { width, height, data } = imageData;
  x = clamp(x, 0, width - 1);
  y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out = new Array(3);
  for (let c = 0; c < 3; c++) {
    out[c] = data[i00 + c] * (1 - dx) * (1 - dy) +
      data[i10 + c] * dx * (1 - dy) +
      data[i01 + c] * (1 - dx) * dy +
      data[i11 + c] * dx * dy;
  }
  return out;
}

function boxBlur(source, size, kernel) {
  const out = new Float32Array(source.length);
  const radius = Math.floor(kernel / 2);
  for (let y = 0; y < size; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(size - 1, y + radius);
    for (let x = 0; x < size; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(size - 1, x + radius);
      let sum = 0;
      let count = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          sum += source[yy * size + xx];
          count += 1;
        }
      }
      out[y * size + x] = sum / count;
    }
  }
  return out;
}

function sampleCanonical(imageData, center, hexSize) {
  const sourceSize = Math.max(8, Math.round(hexSize * 0.78));
  const patch = new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE * 3);
  const left = center.x - sourceSize / 2;
  const top = center.y - sourceSize / 2;

  for (let y = 0; y < TEMPLATE_SIZE; y++) {
    const sy = (y + 0.5) * sourceSize / TEMPLATE_SIZE - 0.5;
    for (let x = 0; x < TEMPLATE_SIZE; x++) {
      const sx = (x + 0.5) * sourceSize / TEMPLATE_SIZE - 0.5;
      const rgb = rgbAt(imageData, left + sx, top + sy);
      const i = (y * TEMPLATE_SIZE + x) * 3;
      patch[i] = rgb[0];
      patch[i + 1] = rgb[1];
      patch[i + 2] = rgb[2];
    }
  }
  return patch;
}

function extractFeature(imageData, center, hexSize) {
  const rgb = sampleCanonical(imageData, center, hexSize);
  const gray = new Float32Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  const color = new Uint8Array(TEMPLATE_SIZE * TEMPLATE_SIZE * 3);

  for (let i = 0; i < TEMPLATE_SIZE * TEMPLATE_SIZE; i++) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const sum = r + g + b + 1e-3;
    color[i * 3] = clamp(Math.round((r / sum) * 255), 0, 255);
    color[i * 3 + 1] = clamp(Math.round((g / sum) * 255), 0, 255);
    color[i * 3 + 2] = clamp(Math.round((b / sum) * 255), 0, 255);
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const blur3 = boxBlur(gray, TEMPLATE_SIZE, 3);
  const blur7 = boxBlur(gray, TEMPLATE_SIZE, 7);
  const high = new Float32Array(gray.length);
  for (let i = 0; i < high.length; i++) high[i] = blur3[i] - blur7[i];

  let mean = 0;
  for (const index of TEMPLATE_MASK) mean += high[index];
  mean /= TEMPLATE_MASK.length;
  let variance = 0;
  for (const index of TEMPLATE_MASK) variance += (high[index] - mean) ** 2;
  const std = Math.sqrt(variance / TEMPLATE_MASK.length) || 1;

  const shape = new Int8Array(TEMPLATE_SIZE * TEMPLATE_SIZE);
  for (const index of TEMPLATE_MASK) {
    shape[index] = clamp(Math.round(((high[index] - mean) / std) * 32), -127, 127);
  }

  let occupancyVariance = 0;
  for (const index of TEMPLATE_MASK) occupancyVariance += high[index] ** 2;
  const occupancyScore = Math.sqrt(occupancyVariance / TEMPLATE_MASK.length);

  return { color, shape, occupancyScore };
}

function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (const index of TEMPLATE_MASK) {
    const av = a[index];
    const bv = b[index];
    dot += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  return dot / (Math.sqrt(aa * bb) || 1);
}

function colorSimilarity(a, b) {
  let error = 0;
  for (const index of TEMPLATE_MASK) {
    const base = index * 3;
    error += Math.abs(a[base] - b[base]);
    error += Math.abs(a[base + 1] - b[base + 1]);
    error += Math.abs(a[base + 2] - b[base + 2]);
  }
  const meanError = error / (TEMPLATE_MASK.length * 3);
  return clamp(1 - meanError * 4.5 / 255, 0, 1);
}

function scoreFeature(feature, name) {
  let best = -Infinity;
  for (let i = 0; i < COLOR_TEMPLATES[name].length; i++) {
    const color = colorSimilarity(feature.color, COLOR_TEMPLATES[name][i]);
    const shape = cosine(feature.shape, SHAPE_TEMPLATES[name][i]);
    const score = 0.5 * color + 0.5 * shape;
    if (score > best) best = score;
  }
  return best;
}

function beigePixel(r, g, b) {
  // The board uses a warm beige palette. RGB thresholds are more stable
  // here than a hue-only test because many faded marbles are nearly neutral.
  return r >= 120 && g >= 105 && b >= 80 && r - g >= -4 && g - b >= 5;
}

function findBoardMask(imageData) {
  const maxDimension = Math.max(imageData.width, imageData.height);
  const step = Math.max(1, Math.ceil(maxDimension / 900));
  const width = Math.ceil(imageData.width / step);
  const height = Math.ceil(imageData.height / step);
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const sy = Math.min(imageData.height - 1, Math.round((y + 0.5) * step));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(imageData.width - 1, Math.round((x + 0.5) * step));
      const i = (sy * imageData.width + sx) * 4;
      if (beigePixel(imageData.data[i], imageData.data[i + 1], imageData.data[i + 2])) mask[y * width + x] = 1;
    }
  }
  return { mask, width, height, step };
}

function findComponents(raster) {
  const { mask, width, height } = raster;
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          queue[tail++] = ni;
        }
      }
    }

    if (area >= 80) components.push({ area, minX, minY, maxX, maxY });
  }
  return components;
}

function candidateGeometryFromComponent(component, raster, imageData) {
  const x = component.minX * raster.step;
  const y = component.minY * raster.step;
  const w = (component.maxX - component.minX + 1) * raster.step;
  const h = (component.maxY - component.minY + 1) * raster.step;
  const center = { x: x + w / 2, y: y + h / 2 };
  const touchesEdge = x <= raster.step || y <= raster.step || x + w >= imageData.width - raster.step || y + h >= imageData.height - raster.step;

  const fromWidth = w / (11 * Math.sqrt(3) + 2 * FRAME_PAD_X_PER_RADIUS);
  const fromHeight = h / (17 + 2 * FRAME_PAD_Y_PER_RADIUS);
  let hexSize = (fromWidth + fromHeight) / 2;

  return { center, hexSize, bbox: { x, y, width: w, height: h }, touchesEdge };
}

function fallbackGeometry(imageData) {
  const center = { x: imageData.width / 2, y: imageData.height / 2 };
  const hexSize = Math.min(
    imageData.width / (11 * Math.sqrt(3)),
    imageData.height / 17,
  ) * 0.95;
  return { center, hexSize, bbox: null, touchesEdge: true };
}

function quickOccupancyScore(imageData, center, hexSize, cellIndex) {
  const p = boardPoint(center, hexSize, BOARD.cells[cellIndex]);
  const size = Math.max(12, Math.round(hexSize * 0.55));
  const half = size / 2;
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  let ringSum = 0;
  let ringCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const rr = dx * dx + dy * dy;
      const g = grayAt(imageData, p.x - half + x + 0.5, p.y - half + y + 0.5);
      if (rr < 0.55) {
        sum += g;
        sumSq += g * g;
        count += 1;
      } else if (rr < 0.95) {
        ringSum += g;
        ringCount += 1;
      }
    }
  }
  const mean = sum / Math.max(1, count);
  const variance = Math.max(0, sumSq / Math.max(1, count) - mean * mean);
  const ringMean = ringSum / Math.max(1, ringCount);
  return Math.sqrt(variance) + 0.22 * Math.abs(mean - ringMean);
}

function geometryQuality(imageData, center, hexSize) {
  if (hexSize <= 3) return -Infinity;
  for (const cell of BOARD.cells) {
    const p = boardPoint(center, hexSize, cell);
    if (p.x < -hexSize || p.x > imageData.width + hexSize || p.y < -hexSize || p.y > imageData.height + hexSize) return -Infinity;
  }

  const scores = [];
  for (let i = 0; i < BOARD.cells.length; i++) scores.push(quickOccupancyScore(imageData, center, hexSize, i));
  scores.sort((a, b) => a - b);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  let totalVar = 0;
  for (const s of scores) totalVar += (s - mean) ** 2;
  if (totalVar <= 1e-6) return 0;

  let bestBetween = 0;
  let sumLeft = 0;
  for (let i = 0; i < scores.length - 1; i++) {
    sumLeft += scores[i];
    const nLeft = i + 1;
    const nRight = scores.length - nLeft;
    if (nLeft < 8 || nRight < 8) continue;
    const meanLeft = sumLeft / nLeft;
    const meanRight = (mean * scores.length - sumLeft) / nRight;
    const between = (nLeft * nRight * (meanLeft - meanRight) ** 2) / (scores.length * scores.length);
    if (between > bestBetween) bestBetween = between;
  }
  return bestBetween / totalVar;
}

function refineGeometry(imageData, seed) {
  let best = { ...seed, quality: geometryQuality(imageData, seed.center, seed.hexSize) };
  const radiusSteps = [-0.03, -0.015, 0, 0.015, 0.03];
  const offsetSteps = [-0.025, -0.0125, 0, 0.0125, 0.025];

  for (const radiusDelta of radiusSteps) {
    const radius = seed.hexSize * (1 + radiusDelta);
    for (const dx of offsetSteps) {
      for (const dy of offsetSteps) {
        const center = {
          x: seed.center.x + imageData.width * dx,
          y: seed.center.y + imageData.height * dy,
        };
        const quality = geometryQuality(imageData, center, radius);
        // Keep the seed's dimensions as a weak prior. This prevents a crop with
        // a noisy border from pulling the solution onto an unrelated pattern.
        const prior = 0.08 * (dx / 0.025) ** 2 + 0.08 * (dy / 0.025) ** 2 + 0.05 * (radiusDelta / 0.03) ** 2;
        const adjusted = quality - prior;
        if (adjusted > best.quality) best = { ...seed, center, hexSize: radius, quality: adjusted };
      }
    }
  }
  return best;
}

function locateBoard(imageData) {
  const raster = findBoardMask(imageData);
  const components = findComponents(raster);
  const imageArea = imageData.width * imageData.height;
  const candidates = components
    .map((component) => {
      const w = (component.maxX - component.minX + 1) * raster.step;
      const h = (component.maxY - component.minY + 1) * raster.step;
      const aspect = w / Math.max(1, h);
      const areaFraction = component.area / Math.max(1, raster.width * raster.height);
      if (aspect < 0.88 || aspect > 1.32 || areaFraction < 0.02) return null;
      const geometry = candidateGeometryFromComponent(component, raster, imageData);
      const aspectScore = Math.exp(-(((aspect - BOARD_ASPECT) / 0.12) ** 2));
      const areaScore = Math.min(2.0, component.area / Math.max(1, raster.width * raster.height * 0.12));
      const centrality = 1 - Math.min(1, Math.hypot(geometry.center.x - imageData.width / 2, geometry.center.y - imageData.height / 2) / (Math.hypot(imageData.width, imageData.height) * 0.55));
      return { ...geometry, component, rank: aspectScore * 5 + areaScore * 2 + centrality * 0.5 };
    })
    .filter(Boolean)
    .sort((a, b) => b.rank - a.rank);

  const seed = candidates[0] || fallbackGeometry(imageData);
  return candidates[0] ? seed : refineGeometry(imageData, seed);
}

function hungarianMin(cost) {
  const n = cost.length;
  const m = cost[0]?.length || 0;
  if (n === 0 || m === 0) return [];
  if (n > m) throw new Error('Hungarian assignment requires columns >= rows');

  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1);
    minv.fill(Infinity);
    const used = new Uint8Array(m + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Int32Array(n);
  for (let j = 1; j <= m; j++) if (p[j] !== 0) assignment[p[j] - 1] = j - 1;
  return Array.from(assignment);
}

function assignToInventory(scored) {
  const slots = [];
  for (const name of TYPE_NAMES) {
    for (let i = 0; i < TEMPLATE_COUNTS[name]; i++) slots.push(name);
  }
  const cost = scored.map((item) => slots.map((name) => -item.scores[TYPE_NAMES.indexOf(name)]));
  const assignment = hungarianMin(cost);
  return scored.map((item, row) => {
    const name = slots[assignment[row]];
    const index = TYPE_NAMES.indexOf(name);
    return {
      ...item,
      typeName: name,
      type: TYPE_IDS[name],
      assignedScore: item.scores[index],
    };
  });
}

function otsuThreshold(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (max - min < 1e-6) return min;

  let total = 0;
  for (const value of values) total += value;
  let leftWeight = 0;
  let leftSum = 0;
  let bestScore = -Infinity;
  let bestIndex = Math.floor(values.length / 2);
  for (let i = 0; i < sorted.length - 1; i++) {
    leftWeight += 1;
    leftSum += sorted[i];
    const rightWeight = values.length - leftWeight;
    if (leftWeight < 4 || rightWeight < 4) continue;
    const meanLeft = leftSum / leftWeight;
    const meanRight = (total - leftSum) / rightWeight;
    const score = leftWeight * rightWeight * (meanLeft - meanRight) ** 2;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return (sorted[bestIndex] + sorted[bestIndex + 1]) / 2;
}

function classifyBoard(imageData, located) {
  if (!located) throw new Error('Board could not be located');

  const scored = [];
  for (const cell of BOARD.cells) {
    const center = boardPoint(located.center, located.hexSize, cell);
    const feature = extractFeature(imageData, center, located.hexSize);
    const scores = TYPE_NAMES.map((name) => scoreFeature(feature, name));
    const sorted = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    scored.push({
      index: cell.index,
      x: center.x,
      y: center.y,
      occupancyScore: feature.occupancyScore,
      scores,
      candidates: sorted.slice(0, 3).map((item) => PIECE_INFO[TYPE_IDS[TYPE_NAMES[item.index]]].name),
    });
  }

  const occupancyScores = scored.map((item) => item.occupancyScore);
  const threshold = clamp(otsuThreshold(occupancyScores), 0.75, 1.5);
  let occupied = scored.filter((item) => item.occupancyScore >= threshold);

  if (occupied.length > STANDARD_TOTAL) {
    occupied.sort((a, b) => b.occupancyScore - a.occupancyScore);
    occupied = occupied.slice(0, STANDARD_TOTAL);
  }

  // If the crop is a normal untouched starting board, the score separation is
  // very strong. For a partially played board, keep the threshold result rather
  // than inventing missing marbles.
  const assigned = assignToInventory(occupied);
  const cells = new Int8Array(CELL_COUNT);
  cells.fill(-1);
  const details = Array.from({ length: CELL_COUNT }, () => null);

  for (const item of scored) {
    details[item.index] = {
      index: item.index,
      x: item.x,
      y: item.y,
      type: -1,
      confidence: clamp(0.5 + Math.abs(item.occupancyScore - threshold) / Math.max(1.2, threshold), 0, 1),
      candidates: item.candidates,
      reason: 'empty',
      occupancyScore: item.occupancyScore,
    };
  }

  for (const item of assigned) {
    const assignedIndex = TYPE_NAMES.indexOf(item.typeName);
    const alternative = item.scores
      .map((score, index) => ({ score, index }))
      .filter((entry) => entry.index !== assignedIndex)
      .sort((a, b) => b.score - a.score)[0];
    const typeMargin = item.assignedScore - (alternative?.score ?? 0);
    const occupancyConfidence = clamp(0.6 + (item.occupancyScore - threshold) / Math.max(1.5, threshold), 0, 1);
    const typeConfidence = clamp(0.45 + typeMargin * 1.9, 0, 1);
    const confidence = Math.min(occupancyConfidence, typeConfidence);
    cells[item.index] = item.type;
    details[item.index] = {
      index: item.index,
      x: item.x,
      y: item.y,
      type: item.type,
      confidence,
      candidates: item.candidates,
      reason: 'template',
      similarity: item.assignedScore,
      typeMargin,
      occupancyScore: item.occupancyScore,
    };
  }

  const lowConfidence = details.filter((d) => d?.type >= 0 && d.confidence < 0.48).length;
  const counts = Object.fromEntries(TYPE_NAMES.map((name) => [name, 0]));
  for (const value of cells) if (value >= 0) counts[PIECE_INFO[value].name] += 1;

  return {
    cells,
    details,
    detected: assigned.length,
    lowConfidence,
    ambiguous: lowConfidence,
    threshold,
    counts,
    summary: `${assigned.length}/${CELL_COUNT} cells detected${lowConfidence ? `, ${lowConfidence} need review` : ''}`,
  };
}

export { boardPoint, locateBoard, classifyBoard };
