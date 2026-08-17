export const WIDTH = 96;
export const HEIGHT = 72;
export const START_TIME = Date.parse("2026-08-17T18:00:00.000Z");

export function asymmetricStormTexture() {
  const data = new Uint8Array(WIDTH * HEIGHT);
  paintEllipse(data, 31, 38, 11, 7, 132);
  paintEllipse(data, 41, 34, 7, 4, 198);
  paintEllipse(data, 24, 44, 4, 9, 84);
  paintEllipse(data, 49, 40, 3, 3, 232);
  return data;
}

export function observedTrack(seam, options = {}) {
  const frameCount = options.frameCount || 4;
  const dxPerFrame = options.dxPerFrame ?? 2;
  const dyPerFrame = options.dyPerFrame ?? -1;
  const intervalMinutes = options.intervalMinutes || 5;
  const base = asymmetricStormTexture();
  return Array.from({ length: frameCount }, (_, index) => ({
    width: WIDTH,
    height: HEIGHT,
    validTime: new Date(START_TIME + index * intervalMinutes * 60_000).toISOString(),
    data: seam.translateTexture(
      base,
      WIDTH,
      HEIGHT,
      dxPerFrame * index,
      dyPerFrame * index,
      { interpolation: "nearest" }
    )
  }));
}

export function scaleTexture(data, scale) {
  return Uint8Array.from(data, (value) => Math.max(0, Math.min(255, Math.round(value * scale))));
}

export function signalCentroid(data, threshold = 8) {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value = data[y * WIDTH + x];
      if (value < threshold) continue;
      weightedX += x * value;
      weightedY += y * value;
      weight += value;
    }
  }
  return { x: weightedX / weight, y: weightedY / weight };
}

function paintEllipse(data, centerX, centerY, radiusX, radiusY, peak) {
  for (let y = Math.max(0, centerY - radiusY); y <= Math.min(HEIGHT - 1, centerY + radiusY); y += 1) {
    for (let x = Math.max(0, centerX - radiusX); x <= Math.min(WIDTH - 1, centerX + radiusX); x += 1) {
      const distance = ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2;
      if (distance > 1) continue;
      const value = Math.round(8 + (peak - 8) * (1 - distance) ** 0.7);
      const index = y * WIDTH + x;
      data[index] = Math.max(data[index], value);
    }
  }
}
