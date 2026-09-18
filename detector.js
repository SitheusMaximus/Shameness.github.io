import { BOARD, CELL_COUNT, PIECES, PIECE_INFO } from './solver.js';

const PROTOTYPES = [
  [PIECES.AIR, '#73c2fb'], [PIECES.FIRE, '#fc6600'], [PIECES.WATER, '#4f97a3'],
  [PIECES.EARTH, '#4cbb17'], [PIECES.LEAD, '#4682b4'], [PIECES.TIN, '#a9ba9d'],
  [PIECES.IRON, '#702963'], [PIECES.COPPER, '#ca3433'], [PIECES.SILVER, '#696980'],
  [PIECES.GOLD, '#f9a602'], [PIECES.MORS, '#222021'], [PIECES.VITAE, '#fdb9c8'],
].map(([type, hex]) => ({ type, rgb: hexToRgb(hex) }));

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sample(imageData, x, y, radius = 2) {
  const { width, height, data } = imageData;
  let r = 0, g = 0, b = 0, n = 0;
  const left = clamp(Math.floor(x - radius), 0, width - 1);
  const right = clamp(Math.ceil(x + radius), 0, width - 1);
  const top = clamp(Math.floor(y - radius), 0, height - 1);
  const bottom = clamp(Math.ceil(y + radius), 0, height - 1);
  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const i = (py * width + px) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

function pixel(imageData, x, y) {
  const px = clamp(Math.round(x), 0, imageData.width - 1);
  const py = clamp(Math.round(y), 0, imageData.height - 1);
  const i = (py * imageData.width + px) * 4;
  const d = imageData.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2] };
}

function meanSamples(samples) {
  const n = samples.length || 1;
  return samples.reduce((acc, p) => ({ r: acc.r + p.r / n, g: acc.g + p.g / n, b: acc.b + p.b / n }), { r: 0, g: 0, b: 0 });
}

function boardPoint(center, hexSize, cell) {
  // Match the geometry used by the original Shameness generator:
  // horizontal step = sqrt(3) * radius, vertical step = 1.5 * radius.
  return {
    x: center.x + Math.sqrt(3) * hexSize * (cell.q + cell.r / 2),
    y: center.y + 1.5 * hexSize * cell.r,
  };
}

function scoreCandidate(imageData, center, hexSize) {
  const representative = [0, 1, 2, 4, 8, 14, 22, 30, 40, 50, 60, 68, 76, 84, 90];
  let score = 0;
  for (const index of representative) {
    const p = boardPoint(center, hexSize, BOARD.cells[index]);
    if (p.x < 2 || p.x >= imageData.width - 2 || p.y < 2 || p.y >= imageData.height - 2) return -Infinity;
    const centerColor = pixel(imageData, p.x, p.y);
    const edge = meanSamples([30, 90, 150, 210, 270, 330].map((degrees) => {
      const a = degrees * Math.PI / 180;
      return pixel(imageData, p.x + Math.cos(a) * hexSize * 0.72, p.y + Math.sin(a) * hexSize * 0.72);
    }));
    const contrast = rgbDistance(centerColor, edge);
    const beige = Math.max(0, 1 - (Math.abs(edge.r - 200) + Math.abs(edge.g - 195) + Math.abs(edge.b - 165)) / 240);
    score += beige * 2 + (contrast < 12 ? 1.4 : contrast < 30 ? .4 : 0);
  }

  // A candidate that is too small can place all 91 sampled cells inside the
  // board while still scoring well. Check just beyond the six outer corners.
  // For a radius-5 pointy hex board the outer vertex is about 9.54 cell radii
  // from the center.
  const outerRadius = hexSize * 10.05;
  for (const degrees of [30, 90, 150, 210, 270, 330]) {
    const angle = degrees * Math.PI / 180;
    const p = { x: center.x + Math.cos(angle) * outerRadius, y: center.y + Math.sin(angle) * outerRadius };
    if (boardLike(pixel(imageData, p.x, p.y))) score -= 5;
    else score += 0.8;
  }
  return score;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function boardLike(color) {
  const hsv = rgbToHsv(color.r, color.g, color.b);
  return hsv.h >= 22 && hsv.h <= 58 && hsv.s < 0.48 && hsv.v > 0.42;
}

function findBoardColorComponent(imageData) {
  const block = Math.max(4, Math.floor(Math.min(imageData.width, imageData.height) / 120));
  const w = Math.ceil(imageData.width / block);
  const h = Math.ceil(imageData.height / block);
  const mask = new Uint8Array(w * h);

  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      const cx = Math.min(imageData.width - 1, bx * block + Math.floor(block / 2));
      const cy = Math.min(imageData.height - 1, by * block + Math.floor(block / 2));
      const p = pixel(imageData, cx, cy);
      if (boardLike(p)) mask[by * w + bx] = 1;
    }
  }

  // One-cell dilation bridges the thin outlines between neighbouring board tiles.
  const dilated = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -2; dy <= 2 && !hit; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[yy * w + xx]) { hit = 1; break; }
        }
      }
      dilated[y * w + x] = hit;
    }
  }

  const seen = new Uint8Array(mask.length);
  let best = null;
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const start = y0 * w + x0;
      if (!dilated[start] || seen[start]) continue;
      const queue = [start];
      seen[start] = 1;
      let head = 0, count = 0;
      let minX = x0, maxX = x0, minY = y0, maxY = y0;
      while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % w, y = Math.floor(idx / w);
        count += 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
            const ni = yy * w + xx;
            if (dilated[ni] && !seen[ni]) { seen[ni] = 1; queue.push(ni); }
          }
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      const aspect = bw / bh;
      const score = count * (aspect >= 1.18 && aspect <= 1.82 ? 1.6 : 0.45);
      if (!best || score > best.score) best = { minX, maxX, minY, maxY, count, score, block };
    }
  }
  return best;
}


function estimateHexSizeFromRays(imageData, center, fallback) {
  const angles = [30, 90, 150, 210, 270, 330].map((deg) => deg * Math.PI / 180);
  const estimates = [];
  const maxRadius = Math.min(imageData.width, imageData.height) * 0.6;
  for (const angle of angles) {
    let lastGood = 0;
    for (let radius = 0; radius <= maxRadius; radius += 2) {
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const px = -uy, py = ux;
      let good = 0;
      for (let off = -5; off <= 5; off += 5) {
        if (boardLike(pixel(imageData, center.x + ux * radius + px * off, center.y + uy * radius + py * off))) good += 1;
      }
      if (good >= 2) lastGood = radius;
    }
    if (lastGood > 0) estimates.push(lastGood / 9.54);
  }
  if (estimates.length < 3) return fallback;
  estimates.sort((a,b) => a-b);
  return estimates[Math.floor(estimates.length / 2)];
}

export function locateBoard(imageData) {
  const component = findBoardColorComponent(imageData);
  if (!component) return null;

  const center = {
    x: ((component.minX + component.maxX + 1) / 2) * component.block,
    y: ((component.minY + component.maxY + 1) / 2) * component.block,
  };
  const bboxWidth = (component.maxX - component.minX + 1) * component.block;
  // A radius-5 axial board spans 10*sqrt(3) cell-center widths plus two
  // cell radii across its bounding box.
  const fallback = bboxWidth / (10 * Math.sqrt(3) + 2);
  // Colour-mask edges are deliberately conservative, so the geometric
  // bounding-box estimate is more stable than ray scans across marble gaps.
  const raySize = fallback;
  let best = null;

  for (let sMul = 0.90; sMul <= 1.10; sMul += 0.025) {
    const hexSize = raySize * sMul;
    for (let oy = -0.035; oy <= 0.035; oy += 0.0175) {
      for (let ox = -0.035; ox <= 0.035; ox += 0.0175) {
        const candidateCenter = {
          x: center.x + bboxWidth * ox,
          y: center.y + bboxWidth * oy,
        };
        const score = scoreCandidate(imageData, candidateCenter, hexSize);
        if (!best || score > best.score) best = { center: candidateCenter, hexSize, score };
      }
    }
  }
  return best;
}

function classifyColor(color) {
  let best = null;
  for (const proto of PROTOTYPES) {
    const d = rgbDistance(color, proto.rgb);
    if (!best || d < best.distance) best = { type: proto.type, distance: d };
  }
  return best;
}

function isPale(color) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  return min > 165 && max - min < 16;
}

export function classifyBoard(imageData, located) {
  if (!located) throw new Error('Board could not be located');
  const cells = new Int8Array(CELL_COUNT);
  cells.fill(-1);
  const details = [];

  for (const cell of BOARD.cells) {
    const p = boardPoint(located.center, located.hexSize, cell);
    const centerColor = sample(imageData, p.x, p.y, Math.max(2, located.hexSize * 0.13));
    const edgeColor = meanSamples([30, 90, 150, 210, 270, 330].map((degrees) => {
      const a = degrees * Math.PI / 180;
      return sample(imageData, p.x + Math.cos(a) * located.hexSize * 0.72, p.y + Math.sin(a) * located.hexSize * 0.72, Math.max(1, located.hexSize * 0.04));
    }));
    const contrast = rgbDistance(centerColor, edgeColor);
    const obviousMarble = contrast > Math.max(18, located.hexSize * 0.17);

    if (!obviousMarble) {
      details.push({ index: cell.index, x: p.x, y: p.y, type: -1, confidence: Math.max(0, 1 - contrast / 18), candidates: [], reason: 'empty' });
      continue;
    }

    if (isPale(centerColor)) {
      // Salt and Mercury use the same base color in the upstream palette.
      details.push({
        index: cell.index, x: p.x, y: p.y,
        type: PIECES.SALT,
        confidence: 0.45,
        candidates: [PIECES.SALT, PIECES.MERCURY],
        reason: 'pale-ambiguous',
      });
      continue;
    }

    const nearest = classifyColor(centerColor);
    const confidence = Math.max(0, 1 - nearest.distance / 110);
    details.push({ index: cell.index, x: p.x, y: p.y, type: nearest.type, confidence, candidates: [nearest.type], reason: 'color' });
    cells[cell.index] = nearest.type;
  }

  // Give the ambiguous pale pieces to Salt/Mercury by the most plausible
  // count first. The UI can still ask for correction when confidence is low.
  const ambiguous = details.filter((d) => d.reason === 'pale-ambiguous');
  const saltCount = 4;
  const mercuryCount = 5;
  let remainingSalt = saltCount;
  let remainingMercury = mercuryCount;
  for (const d of details) {
    if (d.type === PIECES.SALT) remainingSalt -= 1;
    if (d.type === PIECES.MERCURY) remainingMercury -= 1;
  }
  for (const d of ambiguous) {
    if (remainingMercury > 0) {
      d.type = PIECES.MERCURY;
      cells[d.index] = PIECES.MERCURY;
      remainingMercury -= 1;
    } else {
      d.type = PIECES.SALT;
      cells[d.index] = PIECES.SALT;
      remainingSalt = Math.max(0, remainingSalt - 1);
    }
  }

  const detected = details.filter((d) => d.type >= 0).length;
  const lowConfidence = details.filter((d) => d.type >= 0 && d.confidence < 0.55).length;

  return {
    cells,
    details,
    detected,
    lowConfidence,
    ambiguous: ambiguous.length,
    summary: `${detected}/${CELL_COUNT} cells read, ${lowConfidence} low-confidence`,
  };
}

export { boardPoint };
