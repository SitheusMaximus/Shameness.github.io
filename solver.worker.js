import { solve } from './solver.js';

self.onmessage = (event) => {
  const { id, board, timeLimitMs } = event.data;
  const controller = { aborted: false };
  try {
    const result = solve(board, { timeLimitMs, signal: controller });
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
