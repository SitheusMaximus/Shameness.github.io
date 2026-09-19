const STORAGE_KEY = 'sigmarGardenDiagnosticsV3';
const MAX_ENTRIES = 500;
const entries = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES))); } catch {}
}

export function logEvent(type, data = {}) {
  const safe = sanitize(data);
  entries.push({
    ts: new Date().toISOString(),
    type,
    data: safe,
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persist();
  window.dispatchEvent(new CustomEvent('sigmar:diagnostic', { detail: entries.at(-1) }));
}

export function getDiagnostics() { return entries.slice(); }

export function clearDiagnostics() {
  entries.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  window.dispatchEvent(new CustomEvent('sigmar:diagnostic:clear'));
}

export function diagnosticsJSON(extra = {}) {
  return JSON.stringify({
    app: 'Sigmar Garden Solver',
    version: '3.0.0',
    generatedAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio || 1 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    ...extra,
    entries: getDiagnostics(),
  }, null, 2);
}

export async function copyDiagnostics(extra = {}) {
  const text = diagnosticsJSON(extra);
  await navigator.clipboard.writeText(text);
}

export function downloadDiagnostics(extra = {}) {
  const blob = new Blob([diagnosticsJSON(extra)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sigmar-diagnostics-${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitize(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 200).map(sanitize);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 100)) {
      if (k === 'imageData' || k === 'data' || k === 'feature') continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return String(value);
}
