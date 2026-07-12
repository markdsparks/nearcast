(function runMrmsSmoke(global) {
  "use strict";

  const runButton = document.querySelector("#run");
  const status = document.querySelector("#status");
  const canvas = document.querySelector("#preview");
  const context = canvas.getContext("2d");
  let client = null;

  runButton.addEventListener("click", run);

  async function run() {
    runButton.disabled = true;
    if (client) client.destroy();
    client = global.NearcastMrms.createClient();
    status.textContent = "Listing recent NOAA MRMS frames…";
    try {
      const frames = await global.NearcastMrms.listRecentFrames({ minutes: 30, maxFrames: 6 });
      if (!frames.length) throw new Error("No recent MRMS frames were listed.");
      const latest = frames[frames.length - 1];
      status.textContent = `Decoding ${latest.observedAt} (${formatBytes(latest.size)})…`;
      const texture = await client.decodeFrame(latest, {
        bounds: { minLat: 38.35, minLon: -90.65, maxLat: 39.25, maxLon: -89.25 },
        width: canvas.width,
        height: canvas.height
      });
      paintTexture(texture);
      status.textContent = [
        `Decoded ${latest.observedAt}`,
        `${texture.width} × ${texture.height} texture · ${texture.metrics.precipPixels.toLocaleString()} weather pixels`,
        `${texture.metrics.sourceRowsDecoded.toLocaleString()} / ${texture.metrics.sourceRowsTotal.toLocaleString()} source rows streamed`,
        `${texture.metrics.compressedBytes.toLocaleString()} downloaded bytes · ${texture.metrics.elapsedMs.toLocaleString()} ms`,
        texture.metrics.memoryStrategy
      ].join("\n");
    } catch (error) {
      status.textContent = `${error.code || error.name}: ${error.message}`;
      console.error(error);
    } finally {
      runButton.disabled = false;
    }
  }

  function paintTexture(texture) {
    const source = texture.data instanceof Uint8Array ? texture.data : new Uint8Array(texture.data);
    const image = context.createImageData(texture.width, texture.height);
    for (let index = 0; index < source.length; index += 1) {
      const encoded = source[index];
      const out = index * 4;
      if (!encoded) {
        image.data[out] = 12;
        image.data[out + 1] = 35;
        image.data[out + 2] = 52;
        image.data[out + 3] = 255;
        continue;
      }
      const dbz = texture.encoding.dbzMin + (encoded - 1) *
        (texture.encoding.dbzMax - texture.encoding.dbzMin) / 254;
      const color = radarColor(dbz);
      image.data[out] = color[0];
      image.data[out + 1] = color[1];
      image.data[out + 2] = color[2];
      image.data[out + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  function radarColor(dbz) {
    const stops = [
      [5, 46, 127, 213],
      [15, 38, 194, 164],
      [25, 98, 218, 98],
      [35, 239, 222, 74],
      [45, 250, 146, 44],
      [55, 236, 63, 56],
      [65, 190, 63, 173],
      [80, 247, 226, 250]
    ];
    let upper = stops.findIndex((stop) => dbz <= stop[0]);
    if (upper <= 0) upper = 1;
    if (upper === -1) upper = stops.length - 1;
    const low = stops[upper - 1];
    const high = stops[upper];
    const mix = Math.max(0, Math.min(1, (dbz - low[0]) / (high[0] - low[0])));
    return [1, 2, 3].map((channel) => Math.round(low[channel] + (high[channel] - low[channel]) * mix));
  }

  function formatBytes(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
})(window);
