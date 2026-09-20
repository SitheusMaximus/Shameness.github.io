import { classifyBoard } from './detector.js?v=20260920-1';

self.onmessage = (event) => {
  const { id, image, located } = event.data || {};
  try {
    if (!id || !image?.data || !located) throw new Error('Invalid screenshot detection request.');
    const imageData = {
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    };
    const result = classifyBoard(imageData, located, (done, total, stage = 'reading') => {
      self.postMessage({ id, progress: { done, total, stage } });
    });
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }
};
