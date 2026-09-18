import { BOARD, CELL_COUNT, PIECES, PIECE_INFO } from './solver.js';
import { FEATURE_SIZE, FEATURE_SCALE, TEMPLATE_COUNTS, GLYPH_TEMPLATES, TYPE_NAMES } from './reference-glyphs.js';

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

const STANDARD_TOTAL = TYPE_NAMES.reduce((sum, name) => sum + TEMPLATE_COUNTS[name], 0);
const BOARD_ASPECT = 11 * Math.sqrt(3) / 17;
const FRAME_PAD_X_PER_RADIUS = 0.8421416110;
const FRAME_PAD_Y_PER_RADIUS = 0.4736842105;
const FEATURE_MASK = makeFeatureMask(FEATURE_SIZE);
const GAUSSIAN_KERNEL = makeGaussianKernel(1.7, 5);
const TEMPLATE_FEATURES = Object.freeze(Object.fromEntries(
  TYPE_NAMES.map((name) => [name, GLYPH_TEMPLATES[name].map((encoded) => decodeBase64(encoded, Int8Array))]),
));

function decodeBase64(value, Type) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Type(bytes.buffer);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeFeatureMask(size) {
  const mask = new Uint8Array(size * size);
  const c = (size - 1) / 2;
  const radius = size * 0.43;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      if (dx * dx + dy * dy < radius * radius) mask[y * size + x] = 1;
    }
  }
  return mask;
}

function makeGaussianKernel(sigma, radius) {
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = value;
    sum += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

function pythonRound(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
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

function sampleCanonicalGray(imageData, center, hexSize) {
  const sourceSize = Math.max(18, pythonRound(hexSize * 1.8));
  const patch = new Float32Array(FEATURE_SIZE * FEATURE_SIZE);
  const x0 = pythonRound(center.x - sourceSize / 2);
  const y0 = pythonRound(center.y - sourceSize / 2);
  const scale = sourceSize / FEATURE_SIZE;

  // Area-average resize. This mirrors the reference extraction closely and is
  // much more stable than sampling one pixel at each output coordinate.
  for (let oy = 0; oy < FEATURE_SIZE; oy++) {
    const sy0 = oy * scale;
    const sy1 = (oy + 1) * scale;
    const iy0 = Math.floor(sy0);
    const iy1 = Math.ceil(sy1) - 1;
    for (let ox = 0; ox < FEATURE_SIZE; ox++) {
      const sx0 = ox * scale;
      const sx1 = (ox + 1) * scale;
      const ix0 = Math.floor(sx0);
      const ix1 = Math.ceil(sx1) - 1;
      let sum = 0;
      let weightSum = 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        const wy = Math.max(0, Math.min(sy1, iy + 1) - Math.max(sy0, iy));
        if (wy <= 0) continue;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = Math.max(0, Math.min(sx1, ix + 1) - Math.max(sx0, ix));
          if (wx <= 0) continue;
          sum += grayAt(imageData, x0 + ix, y0 + iy) * wx * wy;
          weightSum += wx * wy;
        }
      }
      patch[oy * FEATURE_SIZE + ox] = sum / Math.max(1e-9, weightSum);
    }
  }
  return patch;
}

function reflect101(index, size) {
  if (size <= 1) return 0;
  while (index < 0 || index >= size) index = index < 0 ? -index : 2 * size - index - 2;
  return index;
}

function gaussianBlur(source, size, kernel) {
  const radius = (kernel.length - 1) / 2;
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = reflect101(x + k, size);
        sum += source[y * size + xx] * kernel[k + radius];
      }
      horizontal[y * size + x] = sum;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = reflect101(y + k, size);
        sum += horizontal[yy * size + x] * kernel[k + radius];
      }
      output[y * size + x] = sum;
    }
  }
  return output;
}

function extractGlyphFeature(imageData, center, hexSize) {
  const gray = sampleCanonicalGray(imageData, center, hexSize);
  const blur = gaussianBlur(gray, FEATURE_SIZE, GAUSSIAN_KERNEL);
  const raw = new Float32Array(gray.length);
  let mean = 0;
  let count = 0;

  for (let i = 0; i < raw.length; i++) {
    if (!FEATURE_MASK[i]) continue;
    raw[i] = gray[i] - blur[i];
    mean += raw[i];
    count += 1;
  }
  mean /= Math.max(1, count);

  let variance = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!FEATURE_MASK[i]) continue;
    const delta = raw[i] - mean;
    variance += delta * delta;
  }
  const std = Math.sqrt(variance / Math.max(1, count)) || 1;

  const feature = new Int8Array(raw.length);
  let energy = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!FEATURE_MASK[i]) continue;
    const normalized = (raw[i] - mean) / std;
    feature[i] = clamp(Math.round(normalized * FEATURE_SCALE), -127, 127);
    energy += normalized * normalized;
  }

  return {
    feature,
    occupancyScore: Math.sqrt(energy / Math.max(1, count)),
  };
}

function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!FEATURE_MASK[i]) continue;
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    aa += av * av;
    bb += bv * bv;
  }
  return dot / (Math.sqrt(aa * bb) || 1);
}

function bestTemplateScore(feature, name) {
  let best = -Infinity;
  for (const template of TEMPLATE_FEATURES[name]) best = Math.max(best, cosine(feature, template));
  return best;
}

function beigePixel(r, g, b) {
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
  const hexSize = (fromWidth + fromHeight) / 2;
  return { center, hexSize, bbox: { x, y, width: w, height: h }, touchesEdge };
}

function fallbackGeometry(imageData) {
  const center = { x: imageData.width / 2, y: imageData.height / 2 };
  const hexSize = Math.min(imageData.width / (11 * Math.sqrt(3)), imageData.height / 17) * 0.95;
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
        const candidateCenter = {
          x: seed.center.x + imageData.width * dx,
          y: seed.center.y + imageData.height * dy,
        };
        const quality = geometryQuality(imageData, candidateCenter, radius);
        const prior = 0.08 * (dx / 0.025) ** 2 + 0.08 * (dy / 0.025) ** 2 + 0.05 * (radiusDelta / 0.03) ** 2;
        const adjusted = quality - prior;
        if (adjusted > best.quality) best = { ...seed, center: candidateCenter, hexSize: radius, quality: adjusted };
      }
    }
  }
  return best;
}

function locateBoard(imageData) {
  const raster = findBoardMask(imageData);
  const components = findComponents(raster);
  const candidates = components.map((component) => {
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
  }).filter(Boolean).sort((a, b) => b.rank - a.rank);

  const seed = candidates[0] || fallbackGeometry(imageData);
  if (candidates[0] && !candidates[0].touchesEdge) return candidates[0];
  return refineGeometry(imageData, seed);
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

  // Reconstruct from p[j] just as in the original solver-side implementation.
  const assignment = new Int32Array(n);
  for (let j = 1; j <= m; j++) if (p[j] !== 0) assignment[p[j] - 1] = j - 1;
  return Array.from(assignment);
}

function assignToInventory(scored) {
  const slots = [];
  for (const name of TYPE_NAMES) {
    for (let i = 0; i < TEMPLATE_COUNTS[name]; i++) slots.push(name);
  }
  const indexByName = Object.fromEntries(TYPE_NAMES.map((name, i) => [name, i]));
  const cost = scored.map((item) => slots.map((name) => -item.scores[indexByName[name]]));
  const assignment = hungarianMin(cost);
  return scored.map((item, row) => {
    const name = slots[assignment[row]];
    const index = indexByName[name];
    return { ...item, typeName: name, type: TYPE_IDS[name], assignedScore: item.scores[index] };
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
    const offsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2,0],[-2,0],[0,2],[0,-2],[2,2],[2,-2],[-2,2],[-2,-2]];
    const variants = offsets.map(([dx,dy]) => extractGlyphFeature(imageData, {x:center.x + dx, y:center.y + dy}, located.hexSize));
    const variantFeatures = variants.map(v => v.feature);
    const glyphEnergy = Math.max(...variants.map(v => v.occupancyScore));
    const scores = TYPE_NAMES.map((name) => { let best = -Infinity; for (const f of variantFeatures) best = Math.max(best, bestTemplateScore(f, name)); return best; });
    const ranked = scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    scored.push({
      index: cell.index,
      x: center.x,
      y: center.y,
      occupancyScore: quickOccupancyScore(imageData, located.center, located.hexSize, cell.index),
      glyphEnergy,
      templateScore: Math.max(...scores),
      scores,
      candidates: ranked.slice(0, 3).map(({ index }) => PIECE_INFO[TYPE_IDS[TYPE_NAMES[index]]].name),
    });
  }

  const occupancyScores = scored.map((item) => item.templateScore);
  // Occupancy is now driven primarily by whether the cell contains a glyph that
  // resembles one of the real piece references. The old brightness-based test
  // was too sensitive to faded marbles and to screenshot scaling.
  const threshold = clamp(otsuThreshold(occupancyScores), 0.72, 0.965);
  let occupied = scored.filter((item) => item.templateScore >= threshold);
  if (occupied.length > STANDARD_TOTAL) {
    occupied.sort((a, b) => b.templateScore - a.templateScore);
    occupied = occupied.slice(0, STANDARD_TOTAL);
  }

  const assigned = assignToInventory(occupied);
  const cells = new Int8Array(CELL_COUNT);
  cells.fill(-1);
  const details = Array.from({ length: CELL_COUNT }, () => null);
  const occupiedSet = new Set(occupied.map((item) => item.index));

  for (const item of scored) {
    details[item.index] = {
      index: item.index,
      x: item.x,
      y: item.y,
      type: -1,
      confidence: occupiedSet.has(item.index)
        ? 0.45
        : clamp(0.55 + Math.abs(item.occupancyScore - threshold) / Math.max(1.2, threshold), 0, 1),
      candidates: item.candidates,
      reason: 'empty',
      occupancyScore: item.occupancyScore,
      glyphEnergy: item.glyphEnergy,
      templateScore: item.templateScore,
    };
  }

  for (const item of assigned) {
    const assignedIndex = TYPE_NAMES.indexOf(item.typeName);
    const alternatives = item.scores
      .map((score, index) => ({ score, index }))
      .filter((entry) => entry.index !== assignedIndex)
      .sort((a, b) => b.score - a.score);
    const alternative = alternatives[0];
    const typeMargin = item.assignedScore - (alternative?.score ?? -1);
    const occupancyConfidence = clamp(0.55 + (item.templateScore - threshold) / Math.max(0.25, 1 - threshold), 0, 1);
    const typeConfidence = clamp(0.6 + typeMargin * 2.0, 0, 1);
    const confidence = Math.min(occupancyConfidence, typeConfidence);
    cells[item.index] = item.type;
    details[item.index] = {
      index: item.index,
      x: item.x,
      y: item.y,
      type: item.type,
      confidence,
      candidates: item.candidates,
      reason: 'glyph',
      similarity: item.assignedScore,
      typeMargin,
      occupancyScore: item.occupancyScore,
      glyphEnergy: item.glyphEnergy,
      templateScore: item.templateScore,
    };
  }

  // For a full untouched starting board, all 55 pieces are expected. For later
  // states the board may legitimately contain fewer pieces, so do not invent them.
  const lowConfidence = details.filter((detail) => detail?.type >= 0 && (detail.similarity < 0.87 || (detail.typeMargin < 0.015 && detail.similarity < 0.995))).length;
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

function debugCell(imageData, located, index) {
  const cell = BOARD.cells[index];
  const center = boardPoint(located.center, located.hexSize, cell);
  const feature = extractGlyphFeature(imageData, center, located.hexSize);
  const scores = TYPE_NAMES.map((name) => bestTemplateScore(feature.feature, name));
  return { center, feature: Array.from(feature.feature), scores, candidates: scores.map((score, i) => ({ name: TYPE_NAMES[i], score })).sort((a, b) => b.score - a.score) };
}

export { boardPoint, locateBoard, classifyBoard, debugCell };
