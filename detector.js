import { BOARD, CELL_COUNT, PIECES, PIECE_INFO } from './solver.js';
import { FEATURE_SIZE, FEATURE_SCALE, TEMPLATE_COUNTS, GLYPH_TEMPLATES, TYPE_NAMES, ICON_COLOR_HISTS, ICON_COLOR_MEANS, CLEAR_COLOR_HISTS, CLEAR_COLOR_MEANS, CLEAR_GLYPH_TEMPLATES } from './recognition-data.js';

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
const CLEAR_GLYPH_FEATURES = Object.freeze(Object.fromEntries(Object.entries(CLEAR_GLYPH_TEMPLATES).map(([name, templates]) => [name, templates.map((encoded) => decodeBase64(encoded, Int8Array))])));

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
  let centralGradient = 0;
  let centralCount = 0;
  for (let y = 1; y < FEATURE_SIZE - 1; y++) {
    for (let x = 1; x < FEATURE_SIZE - 1; x++) {
      const index = y * FEATURE_SIZE + x;
      if (!FEATURE_MASK[index]) continue;
      const normalized = (raw[index] - mean) / std;
      feature[index] = clamp(Math.round(normalized * FEATURE_SCALE), -127, 127);
      const dx = (gray[index + 1] - gray[index - 1]) * 0.5;
      const dy = (gray[index + FEATURE_SIZE] - gray[index - FEATURE_SIZE]) * 0.5;
      const radius = Math.hypot(x - (FEATURE_SIZE - 1) / 2, y - (FEATURE_SIZE - 1) / 2);
      if (radius < FEATURE_SIZE * 0.32) {
        centralGradient += Math.hypot(dx, dy);
        centralCount += 1;
      }
    }
  }

  return {
    feature,
    // Template matching deliberately normalises contrast. Occupancy cannot
    // use that normalised variance because every cell then scores about 1.
    // Central glyph-edge energy is stable after canonical resizing and gives
    // a real empty-vs-marble signal, including heavily faded symbols.
    occupancyScore: centralGradient / Math.max(1, centralCount),
    textureRms: std,
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

function signedShapeSimilarity(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  let weight = 0;
  for (let i = 0; i < a.length; i++) {
    if (!FEATURE_MASK[i]) continue;
    const av = a[i];
    const bv = b[i];
    const wa = Math.min(1, Math.abs(av) / 48);
    const wb = Math.min(1, Math.abs(bv) / 48);
    const w = wa * wb;
    if (w <= 0.02) continue;
    dot += Math.sign(av) * Math.sign(bv) * w;
    aa += w;
    bb += w;
    weight += w;
  }
  return weight ? dot / Math.sqrt(aa * bb) : 0;
}

function bestTemplateScore(feature, name) {
  let best = -Infinity;
  const banks = [TEMPLATE_FEATURES[name] || []];
  for (const bank of banks) {
    for (const template of bank) {
      const c = cosine(feature, template);
      const s = signedShapeSimilarity(feature, template);
      const score = 0.55 * c + 0.45 * ((s + 1) / 2);
      best = Math.max(best, score);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function bestClearGlyphScore(feature, name) {
  let best = -Infinity;
  for (const template of (CLEAR_GLYPH_FEATURES[name] || [])) {
    const c = cosine(feature, template);
    const s = signedShapeSimilarity(feature, template);
    const score = 0.55 * c + 0.45 * ((s + 1) / 2);
    best = Math.max(best, score);
  }
  return Number.isFinite(best) ? best : 0;
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


function findColoredBlobCenters(imageData) {
  const { width, height, data } = imageData;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 1200));
  const w = Math.ceil(width / step), h = Math.ceil(height / step);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.round((y + 0.5) * step));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.round((x + 0.5) * step));
      const i = (sy * width + sx) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max ? (max - min) / max : 0;
      if (sat > 0.18 && max > 65) mask[y * w + x] = 1;
    }
  }
  const seen = new Uint8Array(mask.length), queue = new Int32Array(mask.length), centers = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let head = 0, tail = 0, area = 0, sx = 0, sy = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const idx = queue[head++], x = idx % w, y = Math.floor(idx / w);
      area++; sx += x; sy += y; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] && !seen[ni]) { seen[ni] = 1; queue[tail++] = ni; }
      }
    }
    const bw = (maxX - minX + 1) * step, bh = (maxY - minY + 1) * step;
    const realArea = area * step * step;
    if (realArea >= 180 && realArea <= 50000 && bw >= 10 && bh >= 10 && bw <= 220 && bh <= 220) {
      centers.push({ x: (sx / area) * step, y: (sy / area) * step, area: realArea, width: bw, height: bh });
    }
  }
  return centers;
}

function fitGridFromBlobs(imageData) {
  const blobs = findColoredBlobCenters(imageData);
  if (blobs.length < 8) return null;
  const distances = [];
  for (let i = 0; i < blobs.length; i++) {
    let best = Infinity;
    for (let j = 0; j < blobs.length; j++) {
      if (i === j) continue;
      const dx = blobs[i].x - blobs[j].x, dy = blobs[i].y - blobs[j].y;
      const d = Math.hypot(dx, dy);
      if (d > 20) best = Math.min(best, d);
    }
    if (Number.isFinite(best)) distances.push(best);
  }
  distances.sort((a, b) => a - b);
  const medianNearest = distances[Math.floor(distances.length / 2)] || 70;
  const seedSize = clamp(medianNearest / Math.sqrt(3), 12, Math.min(imageData.width, imageData.height) / 12);
  const meanX = blobs.reduce((n, p) => n + p.x, 0) / blobs.length;
  const meanY = blobs.reduce((n, p) => n + p.y, 0) / blobs.length;
  const seeds = [
    { x: imageData.width / 2, y: imageData.height / 2 },
    { x: meanX, y: meanY },
  ];
  let best = null;
  for (const seedCenter of seeds) {
    for (let scale = 0.88; scale <= 1.16; scale += 0.02) {
      const hexSize = seedSize * scale;
      for (let dx = -0.08; dx <= 0.0801; dx += 0.02) for (let dy = -0.08; dy <= 0.0801; dy += 0.02) {
        const center = { x: seedCenter.x + imageData.width * dx, y: seedCenter.y + imageData.height * dy };
        let hits = 0;
        let error = 0;
        for (const blob of blobs) {
          let minD = Infinity;
          for (const cell of BOARD.cells) {
            const p = boardPoint(center, hexSize, cell);
            minD = Math.min(minD, Math.hypot(blob.x - p.x, blob.y - p.y));
          }
          if (minD < hexSize * 0.42) { hits++; error += minD; }
        }
        const score = hits * 10 - error / Math.max(1, hits);
        if (!best || score > best.score) best = { center, hexSize, score, blobCount: blobs.length, hits };
      }
    }
  }
  if (!best || best.hits < Math.min(10, blobs.length * 0.35)) return null;
  const occupiedIndices = new Set();
  for (const blob of blobs) {
    let bestIndex = -1, bestDistance = Infinity;
    for (const cell of BOARD.cells) {
      const p = boardPoint(best.center, best.hexSize, cell);
      const d = Math.hypot(blob.x - p.x, blob.y - p.y);
      if (d < bestDistance) { bestDistance = d; bestIndex = cell.index; }
    }
    if (bestDistance < best.hexSize * 0.46) occupiedIndices.add(bestIndex);
  }
  return { ...best, bbox: null, touchesEdge: true, source: 'blob-grid', occupiedIndices: Array.from(occupiedIndices) };
}

function isDarkBoardCrop(imageData) {
  const { width, height, data } = imageData;
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 20)), stepY = Math.max(1, Math.floor(height / 20));
  for (let y = Math.floor(stepY / 2); y < height; y += stepY) for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
    const i = (y * width + x) * 4;
    samples.push((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.35)] < 85;
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
  const blobGrid = fitGridFromBlobs(imageData);
  if (blobGrid && (isDarkBoardCrop(imageData) || !candidates[0])) return blobGrid;
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
      if (!Number.isFinite(delta) || j1 === 0) {
        throw new Error('Recognition assignment encountered a non-finite cost.');
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
  // Treat the standard inventory as a set of capacity-constrained labels.
  // For a fresh 55-piece board this becomes an exact assignment. For a
  // mid-game screenshot it remains a max-count assignment, so we never
  // manufacture pieces just to fill the starting inventory.
  const slots = [];
  for (const name of TYPE_NAMES) {
    for (let i = 0; i < TEMPLATE_COUNTS[name]; i++) slots.push(name);
  }
  const indexByName = Object.fromEntries(TYPE_NAMES.map((name, i) => [name, i]));
  const cost = scored.map((item) => slots.map((name) => {
    const score = item.scores[indexByName[name]];
    return Number.isFinite(score) ? -score : 0;
  }));
  if (scored.length > slots.length) {
    scored = [...scored]
      .sort((a, b) => (b.occupancyScore ?? 0) - (a.occupancyScore ?? 0))
      .slice(0, slots.length);
  }
  let assignment;
  try {
    assignment = hungarianMin(cost.slice(0, scored.length));
  } catch {
    // Recognition must never hang or fail solely because one score became
    // unusable. Fall back to a deterministic capacity-constrained assignment.
    const available = slots.map((name, index) => ({ name, index }));
    const rows = scored.map((item, row) => {
      const ranked = item.scores.map((score, index) => ({ score: Number.isFinite(score) ? score : -1e9, index }))
        .sort((a, b) => b.score - a.score);
      return { item, row, ranked, margin: ranked[0].score - (ranked[1]?.score ?? -1e9) };
    }).sort((a, b) => b.margin - a.margin);
    assignment = new Int32Array(scored.length);
    for (const entry of rows) {
      let pick = 0, best = -Infinity;
      for (let j = 0; j < available.length; j++) {
        const score = entry.item.scores[indexByName[available[j].name]];
        if (Number.isFinite(score) && score > best) { best = score; pick = j; }
      }
      assignment[entry.row] = available[pick].index;
      available.splice(pick, 1);
    }
    assignment = Array.from(assignment);
  }
  return scored.map((item, row) => {
    const name = slots[assignment[row]];
    const index = indexByName[name];
    return {
      ...item,
      typeName: name,
      type: TYPE_IDS[name],
      assignedScore: Number.isFinite(item.scores[index]) ? item.scores[index] : 0,
      inventoryAdjusted: item.rawBestType !== index,
    };
  });
}

function adaptivePrototypeScore(feature, prototype) {
  if (!feature || !prototype) return 0;
  const c = cosine(feature, prototype);
  const s = signedShapeSimilarity(feature, prototype);
  return 0.55 * c + 0.45 * ((s + 1) / 2);
}

function buildAdaptivePrototypes(scored) {
  const prototypes = new Array(TYPE_NAMES.length).fill(null);
  for (let type = 0; type < TYPE_NAMES.length; type++) {
    const seeds = scored.filter((item) =>
      item.rawBestType === type &&
      item.prototypeFeature &&
      item.occupancyScore >= 2.2 &&
      item.rawBestScore >= 0.84 &&
      (item.rawBestScore - item.rawSecondScore) >= 0.012
    );
    if (seeds.length < 2) continue;

    let bestSeed = seeds[0];
    let bestTotal = -Infinity;
    for (const candidate of seeds) {
      let total = 0;
      for (const other of seeds) {
        if (candidate !== other) total += adaptivePrototypeScore(candidate.prototypeFeature, other.prototypeFeature);
      }
      if (total > bestTotal) {
        bestTotal = total;
        bestSeed = candidate;
      }
    }
    prototypes[type] = bestSeed.prototypeFeature;
  }
  return prototypes;
}

function applyAdaptivePrototypes(scored) {
  const prototypes = buildAdaptivePrototypes(scored);
  for (const item of scored) {
    if (!item.prototypeFeature) continue;
    for (let type = 0; type < TYPE_NAMES.length; type++) {
      if (!prototypes[type]) continue;
      const learned = adaptivePrototypeScore(item.prototypeFeature, prototypes[type]);
      item.scores[type] = 0.82 * item.scores[type] + 0.18 * learned;
    }
    const ranked = item.scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    item.rawBestType = ranked[0]?.index ?? -1;
    item.rawBestScore = ranked[0]?.score ?? 0;
    item.rawSecondScore = ranked[1]?.score ?? -1;
    item.candidates = ranked.slice(0, 4).map(({ index }) => PIECE_INFO[TYPE_IDS[TYPE_NAMES[index]]].name);
  }
}

function adaptiveOccupancyThreshold(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let bestGap = -Infinity;
  let bestIndex = -1;
  for (let i = 0; i < sorted.length - 1; i++) {
    const leftCount = i + 1;
    const rightCount = sorted.length - leftCount;
    if (leftCount < 10 || rightCount < 10) continue;
    const lower = sorted[i];
    const upper = sorted[i + 1];
    if (lower < 0.8 || upper > 8.0) continue;
    const gap = upper - lower;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  if (bestIndex >= 0 && bestGap >= 0.45) {
    return clamp((sorted[bestIndex] + sorted[bestIndex + 1]) * 0.5, 1.8, 3.4);
  }
  return 2.2;
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


function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 30;
    if (h < 0) h += 180;
  }
  return [h, max ? d / max * 255 : 0, max * 255];
}

function colorFeature(imageData, center, hexSize) {
  const radius = Math.max(8, Math.round(hexSize * 0.60));
  const binsH = 18, binsS = 8;
  const hist = new Float32Array(binsH * binsS);
  let total = 0, graySum = 0, graySq = 0, ringSum = 0, ringCount = 0;
  const { width, height, data } = imageData;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const rr = Math.hypot(dx, dy);
      if (rr > radius * 0.88) continue;
      const x = Math.round(center.x + dx), y = Math.round(center.y + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const [h, sat, val] = rgbToHsv(r, g, b);
      const binH = Math.min(binsH - 1, Math.floor(h / 180 * binsH));
      const binS = Math.min(binsS - 1, Math.floor(sat / 256 * binsS));
      hist[binH * binsS + binS] += 1;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      graySum += gray; graySq += gray * gray; total += 1;
      if (rr > radius * 0.70 && rr < radius * 0.86) { ringSum += gray; ringCount++; }
    }
  }
  if (!total) {
    return { hist, meanHsv: [0, 0, 0], meanGray: 0, variance: 0, ringDelta: 0, meanSat: 0 };
  }
  for (let i = 0; i < hist.length; i++) hist[i] /= total;
  let meanSat = 0;
  for (let i = 0; i < hist.length; i++) meanSat += hist[i] * ((Math.floor(i / binsS) + 0.5) / binsH * 180);
  const meanGray = graySum / total;
  let meanH = 0, meanS = 0, meanV = 0, hsvCount = 0;
  // Re-scan only the central region for a stable mean HSV signature.
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (Math.hypot(dx, dy) > radius * 0.88) continue;
    const x = Math.round(center.x + dx), y = Math.round(center.y + dy);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = (y * width + x) * 4; const [h, sat, val] = rgbToHsv(data[i], data[i+1], data[i+2]);
    if (sat < 25) continue;
    meanH += h; meanS += sat; meanV += val; hsvCount++;
  }
  return {
    hist,
    meanHsv: [meanH / Math.max(1, hsvCount), meanS / Math.max(1, hsvCount), meanV / Math.max(1, hsvCount)],
    meanGray,
    variance: Math.max(0, graySq / total - meanGray * meanGray),
    ringDelta: Math.abs(meanGray - ringSum / Math.max(1, ringCount)),
    meanSat,
  };
}

function localColorResidual(imageData, center, hexSize) {
  const radius = Math.max(10, hexSize);
  const innerRadius = radius * 0.55;
  const ringMin = radius * 0.72;
  const ringMax = radius * 0.90;
  let innerR = 0, innerG = 0, innerB = 0, innerN = 0;
  let ringR = 0, ringG = 0, ringB = 0, ringN = 0;
  const { width, height, data } = imageData;
  for (let dy = -Math.ceil(ringMax); dy <= Math.ceil(ringMax); dy++) for (let dx = -Math.ceil(ringMax); dx <= Math.ceil(ringMax); dx++) {
    const rr = Math.hypot(dx, dy);
    if (rr > ringMax) continue;
    const x = Math.round(center.x + dx), y = Math.round(center.y + dy);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    if (rr < innerRadius) { innerR += r; innerG += g; innerB += b; innerN++; }
    else if (rr >= ringMin) { ringR += r; ringG += g; ringB += b; ringN++; }
  }
  return [
    innerR / Math.max(1, innerN) - ringR / Math.max(1, ringN),
    innerG / Math.max(1, innerN) - ringG / Math.max(1, ringN),
    innerB / Math.max(1, innerN) - ringB / Math.max(1, ringN),
  ];
}

function histogramCorrelation(a, b) {
  let am = 0, bm = 0;
  for (let i = 0; i < a.length; i++) { am += a[i]; bm += b[i]; }
  am /= a.length; bm /= b.length;
  let num = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - am, db = b[i] - bm;
    num += da * db; aa += da * da; bb += db * db;
  }
  return num / (Math.sqrt(aa * bb) || 1);
}

function classifyByColor(feature, clearMode = false) {
  const templates = clearMode ? CLEAR_COLOR_HISTS : ICON_COLOR_HISTS;
  return templates.map((template, type) => ({ type, score: histogramCorrelation(feature.hist, template) }))
    .sort((a, b) => b.score - a.score);
}

function hsvMeanScore(feature, type, clearMode = false) {
  const means = clearMode ? CLEAR_COLOR_MEANS : ICON_COLOR_MEANS;
  const target = Array.isArray(means) ? means[type] : null;
  const meanHsv = Array.isArray(feature?.meanHsv) ? feature.meanHsv : [0, 0, 0];
  if (!Array.isArray(target) || target.length < 3 ||
      !Number.isFinite(target[0]) || !Number.isFinite(target[1]) || !Number.isFinite(target[2])) {
    return 0;
  }
  const dh = Math.min(Math.abs(meanHsv[0] - target[0]), 180 - Math.abs(meanHsv[0] - target[0])) / 90;
  const ds = Math.abs(meanHsv[1] - target[1]) / 255;
  const dv = Math.abs(meanHsv[2] - target[2]) / 255;
  return clamp(1 - Math.sqrt(dh * dh * 0.50 + ds * ds * 0.25 + dv * dv * 0.25), 0, 1);
}

function classifyBoard(imageData, located, onProgress = null) {
  if (!located) throw new Error('Board could not be located');

  const clearMode = located.source === 'blob-grid';
  const scored = [];
  // Keep a small positional search around the located centre. The old 17-point
  // search multiplied the most expensive part of recognition enough to lock
  // the browser for minutes on normal screenshots. These five samples cover
  // the useful sub-pixel drift without making import unusably slow.
  const offsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];

  for (const cell of BOARD.cells) {
    const center = boardPoint(located.center, located.hexSize, cell);
    const color = colorFeature(imageData, center, located.hexSize);
    const colorResidual = localColorResidual(imageData, center, located.hexSize);
    const variants = offsets.map(([dx,dy]) => extractGlyphFeature(imageData, { x: center.x + dx, y: center.y + dy }, located.hexSize));
    const glyphEnergy = Math.max(...variants.map(v => v.textureRms ?? 0));
    const centralGlyphEdge = Math.max(...variants.map(v => v.occupancyScore ?? 0));
    const glyphScores = TYPE_NAMES.map((name) => {
      let best = -Infinity;
      for (const variant of variants) best = Math.max(best, bestTemplateScore(variant.feature, name));
      return best;
    });
    // Keep separate template banks for the two visual states. The game uses
    // the same symbols in a bright/free state and a heavily faded/locked
    // state, so either bank can provide the occupancy evidence.
    const clearGlyphScores = TYPE_NAMES.map((name) => Math.max(...variants.map((variant) => bestClearGlyphScore(variant.feature, name))));
    const clearGlyphEnergy = Math.max(...clearGlyphScores);
    const colorRanked = classifyByColor(color, clearMode);
    const colorScores = colorRanked.map((entry) => entry.score);
    const colorByType = new Float32Array(TYPE_NAMES.length);
    for (const entry of colorRanked) colorByType[entry.type] = entry.score;
    const meanByType = TYPE_NAMES.map((_, type) => hsvMeanScore(color, type, clearMode));

    const combined = TYPE_NAMES.map((_, type) => {
      if (clearMode) return 0.48 * colorByType[type] + 0.52 * meanByType[type];

      // The glyph itself is rendered in two useful states. Keep both template
      // banks in the type score instead of forcing the faded bank to explain
      // bright marbles or vice versa. Colour remains a secondary signal
      // because the board lighting varies by position.
      const colour = 0.55 * colorByType[type] + 0.45 * meanByType[type];
      return 0.58 * glyphScores[type] + 0.20 * clearGlyphScores[type] + 0.22 * colour;
    });
    if (!clearMode && located.hexSize >= 34) {
      const waterIndex = TYPE_NAMES.indexOf('Water');
      const earthIndex = TYPE_NAMES.indexOf('Earth');
      const pairGap = Math.abs(glyphScores[waterIndex] - glyphScores[earthIndex]);
      if (pairGap < 0.011) {
        const [, residualGreen, residualBlue] = colorResidual;
        const waterSignal = clamp((residualBlue - 0.5 * residualGreen) / 12, -1, 1);
        const tieBreak = 0.04 * waterSignal;
        combined[waterIndex] += tieBreak;
        combined[earthIndex] -= tieBreak;
      }
    }
    if (clearMode) {
      const colorTop = colorRanked[0]?.type ?? -1;
      const saltIndex = TYPE_NAMES.indexOf('Salt'), mercuryIndex = TYPE_NAMES.indexOf('Mercury');
      if (colorTop === saltIndex || colorTop === mercuryIndex) {
        combined[saltIndex] = 0.75 * colorByType[saltIndex] + 0.25 * meanByType[saltIndex];
        combined[mercuryIndex] = 0.75 * colorByType[mercuryIndex] + 0.25 * meanByType[mercuryIndex];
        if (Math.max(clearGlyphScores[saltIndex], clearGlyphScores[mercuryIndex]) > 0.18) {
          const clearTotalSalt = combined[saltIndex] + 0.18 * clearGlyphScores[saltIndex];
          const clearTotalMercury = combined[mercuryIndex] + 0.18 * clearGlyphScores[mercuryIndex];
          combined[saltIndex] = clearTotalSalt;
          combined[mercuryIndex] = clearTotalMercury;
        }
      }
    }
    const ranked = combined.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
    const rawBestType = ranked[0]?.index ?? -1;
    let prototypeFeature = null;
    if (rawBestType >= 0) {
      let bestVariant = null;
      for (const variant of variants) {
        const score = bestTemplateScore(variant.feature, TYPE_NAMES[rawBestType]);
        if (!bestVariant || score > bestVariant.score) bestVariant = { score, feature: variant.feature };
      }
      prototypeFeature = bestVariant?.feature ?? null;
    }
    if (!clearMode) {
      // Faded captures lose much of the glyph contrast. For the pairs that
      // are visually closest in the faded state, use the marble's colour
      // signature as a tie-breaker rather than allowing a generic glyph
      // correlation to win by a tiny margin.
      const colourPairs = [
        ['Salt', 'Air'],
        ['Vitae', 'Mercury'],
        ['Copper', 'Salt'],
        ['Water', 'Earth'],
        ['Mercury', 'Copper'],
      ];
      const topTwo = new Set([ranked[0]?.index, ranked[1]?.index]);
      for (const [leftName, rightName] of colourPairs) {
        const left = TYPE_NAMES.indexOf(leftName);
        const right = TYPE_NAMES.indexOf(rightName);
        if (!topTwo.has(left) || !topTwo.has(right)) continue;
        const glyphGap = Math.abs(glyphScores[left] - glyphScores[right]);
        if (glyphGap > 0.075) continue;
        const colourDelta =
          0.65 * (meanByType[left] - meanByType[right]) +
          0.35 * (colorByType[left] - colorByType[right]);
        const tieBreak = clamp(colourDelta * 0.12, -0.055, 0.055);
        combined[left] += tieBreak;
        combined[right] -= tieBreak;
      }
    }

    const topColor = colorRanked[0]?.score ?? 0;
    // Occupancy must be independent from the type score. A faint marble can
    // be a poor colour/type match while still being an excellent icon match.
    // Conversely, empty beige cells can produce surprisingly plausible glyph
    // correlations. The two-state icon banks therefore vote on occupancy
    // first, while the type classifier runs afterwards.
    const fadedOccupancy = Math.max(...glyphScores);
    const clearOccupancy = clearGlyphEnergy;
    const occupancy = clearMode
      ? (color.ringDelta + Math.sqrt(color.variance) * 0.20 + color.meanSat * 0.04)
      : centralGlyphEdge;

    scored.push({
      index: cell.index,
      x: center.x,
      y: center.y,
      occupancyScore: occupancy,
      ringDelta: color.ringDelta,
      colorMeanSat: color.meanSat,
      glyphEnergy,
      centralGlyphEdge,
      templateScore: ranked[0]?.score ?? 0,
      scores: Array.from(combined),
      glyphScores,
      prototypeFeature,
      colorScores,
      meanScores: meanByType,
      rawBestType: ranked[0]?.index ?? -1,
      rawBestScore: ranked[0]?.score ?? 0,
      rawSecondScore: ranked[1]?.score ?? -1,
      colorTopScore: topColor,
      fadedOccupancy,
      clearOccupancy,
      candidates: ranked.slice(0, 4).map(({ index }) => PIECE_INFO[TYPE_IDS[TYPE_NAMES[index]]].name),
    });
    if (onProgress) onProgress(scored.length, BOARD.cells.length, 'reading');
  }

  if (onProgress) onProgress(scored.length, BOARD.cells.length, 'assigning');
  let occupied;
  if (clearMode) {
    // Dark, manually cropped boards have a very clean separation between the
    // empty charcoal cells and the circular marble rims. This avoids assuming
    // that the board contains the initial 55 pieces.
    const blobOccupied = located.occupiedIndices ? new Set(located.occupiedIndices) : new Set();
    occupied = scored.filter((item) => blobOccupied.has(item.index));
  } else {
    const scores = scored.map((item) => item.occupancyScore);
    const threshold = adaptiveOccupancyThreshold(scores);
    occupied = scored.filter((item) => item.occupancyScore >= threshold);

    // Do not fill to the starting inventory just because recognition is weak.
    // That behaviour was creating false marbles in empty beige cells. A real
    // starting board naturally lands on the occupied/empty gap; a mid-game
    // screenshot keeps its actual population.
    if (occupied.length === 0 && scored.length) {
      const best = [...scored].sort((a, b) => b.occupancyScore - a.occupancyScore)[0];
      if (best.occupancyScore >= 1.8) occupied = [best];
    }
    if (occupied.length > STANDARD_TOTAL) {
      occupied.sort((a, b) => b.occupancyScore - a.occupancyScore);
      occupied = occupied.slice(0, STANDARD_TOTAL);
    }
  }

  if (occupied.length > STANDARD_TOTAL) { occupied.sort((a, b) => b.templateScore - a.templateScore); occupied = occupied.slice(0, STANDARD_TOTAL); }

  if (!clearMode) applyAdaptivePrototypes(occupied);

  const assigned = clearMode
    ? occupied.map((item) => ({ ...item, typeName: TYPE_NAMES[item.rawBestType], type: TYPE_IDS[TYPE_NAMES[item.rawBestType]], assignedScore: item.rawBestScore, inventoryAdjusted: false }))
    : assignToInventory(occupied);
  const cells = new Int8Array(CELL_COUNT); cells.fill(-1);
  const details = Array.from({ length: CELL_COUNT }, () => null);
  const occupiedSet = new Set(occupied.map((item) => item.index));

  for (const item of scored) {
    details[item.index] = {
      index: item.index, x: item.x, y: item.y, type: -1,
      confidence: occupiedSet.has(item.index) ? 0.45 : 1,
      candidates: item.candidates, reason: 'empty',
      occupancyScore: item.occupancyScore, ringDelta: item.ringDelta,
      colorMeanSat: item.colorMeanSat, glyphEnergy: item.glyphEnergy,
      centralGlyphEdge: item.centralGlyphEdge ?? null,
      templateScore: item.templateScore, fadedOccupancy: item.fadedOccupancy ?? null,
      clearOccupancy: item.clearOccupancy ?? null, rawBestType: item.rawBestType,
      rawBestName: item.rawBestType >= 0 ? TYPE_NAMES[item.rawBestType] : null,
    };
  }

  for (const item of assigned) {
    const assignedIndex = TYPE_NAMES.indexOf(item.typeName);
    const alternatives = item.scores.map((score, index) => ({ score, index }))
      .filter((entry) => entry.index !== assignedIndex).sort((a, b) => b.score - a.score);
    const alternative = alternatives[0];
    const typeMargin = item.assignedScore - (alternative?.score ?? -1);
    const baseScore = item.rawBestScore;
    const confidence = clearMode
      ? clamp(0.5 + (item.colorTopScore - (colorMargin(item) || 0)) * 2.0 + Math.max(0, typeMargin) * 1.5, 0, 1)
      : clamp(0.5 + typeMargin * 7.5, 0, 1);
    const forcedByInventory = Boolean(item.inventoryAdjusted);
    const inventoryPenalty = forcedByInventory ? Math.max(0, item.rawBestScore - item.assignedScore) : 0;
    const inventoryConflict = forcedByInventory && inventoryPenalty > 0.035;
    const needsReview = inventoryConflict || (clearMode
      ? (baseScore < 0.55 || typeMargin < 0.035)
      : (item.occupancyScore < 2.8 || baseScore < 0.86 || typeMargin < 0.010));
    cells[item.index] = item.type;
    details[item.index] = {
      index: item.index, x: item.x, y: item.y, type: item.type,
      confidence, candidates: item.candidates, reason: clearMode ? 'color+glyph' : 'glyph',
      similarity: item.assignedScore, typeMargin, occupancyScore: item.occupancyScore,
      ringDelta: item.ringDelta, colorMeanSat: item.colorMeanSat, glyphEnergy: item.glyphEnergy,
      centralGlyphEdge: item.centralGlyphEdge ?? null,
      templateScore: item.templateScore, rawBestType: item.rawBestType,
      rawBestName: item.rawBestType >= 0 ? TYPE_NAMES[item.rawBestType] : null,
      forcedByInventory, inventoryPenalty, inventoryConflict, needsReview,
    };
  }

  const reviewIndices = details.filter((detail) => detail?.type >= 0 && detail.needsReview).map((detail) => detail.index);
  const counts = Object.fromEntries(TYPE_NAMES.map((name) => [name, 0]));
  for (const value of cells) if (value >= 0) counts[PIECE_INFO[value].name] += 1;

  return {
    cells, details, detected: assigned.length, lowConfidence: reviewIndices.length,
    ambiguous: reviewIndices.length, reviewIndices, threshold: clearMode ? null : clamp(otsuThreshold(scored.map((item) => item.templateScore)), 0.72, 0.965),
    counts,
    stats: {
      candidates: scored.length, occupiedCandidates: occupied.length, mode: clearMode ? 'bright-crop' : 'faded-board',
      reviewedCells: reviewIndices.length, forcedByInventory: assigned.filter((item) => item.inventoryAdjusted).length, inventoryConflicts: reviewIndices.filter((index) => details[index]?.inventoryConflict).length,
    },
    summary: `${assigned.length}/${CELL_COUNT} cells detected${reviewIndices.length ? `, ${reviewIndices.length} need review` : ''}`,
  };
}

function colorMargin(item) {
  if (!item.colorScores?.length) return 0;
  const sorted = [...item.colorScores].sort((a, b) => b - a);
  return sorted.length > 1 ? sorted[1] : 0;
}

function debugCell(imageData, located, index) {
  const cell = BOARD.cells[index];
  const center = boardPoint(located.center, located.hexSize, cell);
  const feature = extractGlyphFeature(imageData, center, located.hexSize);
  const scores = TYPE_NAMES.map((name) => bestTemplateScore(feature.feature, name));
  return { center, feature: Array.from(feature.feature), scores, candidates: scores.map((score, i) => ({ name: TYPE_NAMES[i], score })).sort((a, b) => b.score - a.score) };
}

export { boardPoint, locateBoard, classifyBoard, debugCell, colorFeature, hsvMeanScore, classifyByColor };
