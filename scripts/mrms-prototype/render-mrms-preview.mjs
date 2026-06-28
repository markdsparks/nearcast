#!/usr/bin/env node

import fs from "node:fs";
import zlib from "node:zlib";

const BUCKET_URL = "https://noaa-mrms-pds.s3.amazonaws.com/";
const DEFAULT_PRODUCT = "MergedReflectivityQCComposite_00.50";
const DEFAULT_REGION = "CONUS";
const DEFAULT_LAT = 38.7237;
const DEFAULT_LON = -89.9559;
const DEFAULT_ZOOM = 11;
const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 900;
const DEFAULT_OUT = "/tmp/nearcast-mrms-preview.png";
const DEFAULT_STYLE = "continuous";
const PNG_SIGNATURE = "89504e470d0a1a0a";
const RADAR_RAMP = [
  { value: 5, color: [108, 201, 255, 90] },
  { value: 15, color: [45, 205, 112, 150] },
  { value: 25, color: [38, 173, 80, 180] },
  { value: 35, color: [250, 220, 78, 205] },
  { value: 45, color: [245, 132, 43, 220] },
  { value: 55, color: [239, 64, 64, 235] },
  { value: 65, color: [187, 76, 232, 240] },
  { value: 75, color: [255, 224, 255, 245] }
];
const RESOLVED_RAMP = [
  { value: 4, color: [5, 83, 30, 175] },
  { value: 12, color: [19, 125, 39, 195] },
  { value: 20, color: [49, 174, 75, 215] },
  { value: 28, color: [252, 224, 60, 225] },
  { value: 36, color: [247, 155, 36, 235] },
  { value: 44, color: [235, 76, 35, 242] },
  { value: 54, color: [203, 24, 28, 245] },
  { value: 64, color: [156, 55, 178, 248] },
  { value: 74, color: [245, 227, 255, 250] }
];

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`MRMS render failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }

  const grib = await loadGribBuffer(args);
  const parsed = parseGrib2(grib);
  const summary = gribSummary(parsed);

  if (args.probe) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const pngSection = parsed.sections.find((section) => section.number === 7);
  if (!pngSection) throw new Error("GRIB2 section 7 data payload not found");
  const embeddedPng = grib.subarray(pngSection.offset + 5, pngSection.offset + pngSection.length);
  const decodedPng = decodePngGrayscale16(embeddedPng);
  const values = decodeGridValues(decodedPng.samples, parsed.dataRepresentation);
  const stats = gridValueStats(values, parsed.grid);

  const width = numberArg(args.width, DEFAULT_WIDTH);
  const height = numberArg(args.height, DEFAULT_HEIGHT);
  const focusMax = args.focus === "max";
  const focusEdge = args.focus === "edge";
  const focus = focusEdge ? edgeFocus(values, parsed.grid) : null;
  const centerLat = focusEdge && Number.isFinite(focus?.lat)
    ? focus.lat
    : focusMax && Number.isFinite(stats.maxLat)
      ? stats.maxLat
      : numberArg(args.lat, DEFAULT_LAT);
  const centerLon = focusEdge && Number.isFinite(focus?.lon)
    ? focus.lon
    : focusMax && Number.isFinite(stats.maxLon)
      ? stats.maxLon
      : numberArg(args.lon, DEFAULT_LON);
  const zoom = numberArg(args.zoom, DEFAULT_ZOOM);
  const threshold = numberArg(args.threshold, 5);
  const styleName = normalizeStyle(args.style || DEFAULT_STYLE);
  const smooth = numberArg(args.smooth, defaultSmoothForStyle(styleName));
  const style = radarStyle(styleName, args);
  const compare = Boolean(args.compare);

  if (compare) {
    const variants = comparisonVariants(styleName, smooth, args);
    const panels = variants.map((variant) => ({
      ...variant,
      output: renderViewport({
        values,
        grid: parsed.grid,
        centerLat,
        centerLon,
        zoom,
        width,
        height,
        threshold,
        smooth: variant.smooth,
        style: variant.style,
        basemap: !args.transparent
      })
    }));
    const sheet = composeComparison(panels, width, height);
    const outPath = args.out || DEFAULT_OUT;
    fs.writeFileSync(outPath, encodePngRgba(sheet.width, sheet.height, sheet.pixels));
    console.log(JSON.stringify({
      ...summary,
      stats,
      render: {
        out: outPath,
        centerLat,
        centerLon,
        zoom,
        width: sheet.width,
        height: sheet.height,
        panelWidth: width,
        panelHeight: height,
        threshold,
        focus: args.focus || "manual",
        compare: panels.map((panel) => ({
          label: panel.label,
          style: panel.style.name,
          smooth: panel.smooth,
          radarPixels: panel.output.radarPixels,
          maxRenderedDbz: round(panel.output.maxRenderedDbz, 1)
        }))
      }
    }, null, 2));
    return;
  }

  const output = renderViewport({
    values,
    grid: parsed.grid,
    centerLat,
    centerLon,
    zoom,
    width,
    height,
    threshold,
    smooth,
    style,
    basemap: !args.transparent
  });

  const outPath = args.out || DEFAULT_OUT;
  fs.writeFileSync(outPath, encodePngRgba(width, height, output.pixels));
  console.log(JSON.stringify({
    ...summary,
    stats,
    render: {
      out: outPath,
      centerLat,
      centerLon,
      zoom,
      width,
      height,
      threshold,
      smooth,
      style: style.name,
      radarPixels: output.radarPixels,
      maxRenderedDbz: round(output.maxRenderedDbz, 1),
      transparent: Boolean(args.transparent),
      focus: args.focus || "manual"
    }
  }, null, 2));
}

async function loadGribBuffer(options) {
  if (options.file) {
    const fileBuffer = fs.readFileSync(options.file);
    return maybeGunzip(fileBuffer);
  }

  const url = options.url || await latestProductUrl(options);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  const fileBuffer = Buffer.from(await response.arrayBuffer());
  return maybeGunzip(fileBuffer);
}

async function latestProductUrl(options) {
  const region = cleanSegment(options.region || DEFAULT_REGION);
  const product = cleanSegment(options.product || DEFAULT_PRODUCT);
  const date = options.date && options.date !== "today" ? options.date : utcDateString(new Date());
  const prefix = `${region}/${product}/${date}/`;
  const url = new URL(BUCKET_URL);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", String(numberArg(options["max-keys"], 1000)));
  url.searchParams.set("prefix", prefix);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
  const xml = await response.text();
  const objects = blocksForTag(xml, "Contents").map((block) => {
    const key = textForTag(block, "Key");
    return {
      key,
      observedAt: observedTimeFromKey(key)
    };
  }).filter((item) => item.key);

  if (!objects.length) throw new Error(`no MRMS objects found for ${prefix}`);
  objects.sort((a, b) => (b.observedAt?.getTime?.() || 0) - (a.observedAt?.getTime?.() || 0));
  return `${BUCKET_URL}${objects[0].key.split("/").map(encodeURIComponent).join("/")}`;
}

function parseGrib2(buffer) {
  if (buffer.subarray(0, 4).toString("ascii") !== "GRIB") throw new Error("not a GRIB2 file");
  const edition = buffer[7];
  if (edition !== 2) throw new Error(`unsupported GRIB edition ${edition}`);

  const totalLength = Number(buffer.readBigUInt64BE(8));
  const sections = [];
  let offset = 16;
  while (offset < totalLength) {
    if (buffer.subarray(offset, offset + 4).toString("ascii") === "7777") {
      sections.push({ number: 8, offset, length: 4 });
      break;
    }
    const length = buffer.readUInt32BE(offset);
    const number = buffer[offset + 4];
    sections.push({ number, offset, length });
    offset += length;
  }

  const gridSection = sections.find((section) => section.number === 3);
  const dataRepresentationSection = sections.find((section) => section.number === 5);
  if (!gridSection) throw new Error("GRIB2 grid definition section not found");
  if (!dataRepresentationSection) throw new Error("GRIB2 data representation section not found");

  return {
    discipline: buffer[6],
    edition,
    totalLength,
    sections,
    grid: parseGridDefinition(buffer, gridSection),
    product: parseProductDefinition(buffer, sections.find((section) => section.number === 4)),
    dataRepresentation: parseDataRepresentation(buffer, dataRepresentationSection),
    bitmap: parseBitmap(buffer, sections.find((section) => section.number === 6))
  };
}

function parseGridDefinition(buffer, section) {
  const template = buffer.readUInt16BE(section.offset + 12);
  if (template !== 0) throw new Error(`unsupported grid definition template ${template}`);

  const ni = buffer.readUInt32BE(section.offset + 30);
  const nj = buffer.readUInt32BE(section.offset + 34);
  const lat1 = scaledCoord(buffer.readInt32BE(section.offset + 46));
  const lon1 = normalizeLon(scaledCoord(buffer.readInt32BE(section.offset + 50)));
  const lat2 = scaledCoord(buffer.readInt32BE(section.offset + 55));
  const lon2 = normalizeLon(scaledCoord(buffer.readInt32BE(section.offset + 59)));
  const dx = buffer.readUInt32BE(section.offset + 63) / 1e6;
  const dy = buffer.readUInt32BE(section.offset + 67) / 1e6;
  const scanMode = buffer[section.offset + 71];
  const iScansPositive = (scanMode & 0x80) === 0;
  const jScansPositive = (scanMode & 0x40) !== 0;

  return {
    template,
    points: buffer.readUInt32BE(section.offset + 6),
    ni,
    nj,
    lat1,
    lon1,
    lat2,
    lon2,
    dx,
    dy,
    scanMode,
    iScansPositive,
    jScansPositive
  };
}

function parseProductDefinition(buffer, section) {
  if (!section) return null;
  return {
    template: buffer.readUInt16BE(section.offset + 7),
    category: buffer[section.offset + 9],
    parameter: buffer[section.offset + 10]
  };
}

function parseDataRepresentation(buffer, section) {
  const template = buffer.readUInt16BE(section.offset + 9);
  if (template !== 41) throw new Error(`unsupported data representation template ${template}; expected PNG template 5.41`);

  return {
    points: buffer.readUInt32BE(section.offset + 5),
    template,
    referenceValue: buffer.readFloatBE(section.offset + 11),
    binaryScale: buffer.readInt16BE(section.offset + 15),
    decimalScale: buffer.readInt16BE(section.offset + 17),
    bitsPerValue: buffer[section.offset + 19],
    originalType: buffer[section.offset + 20]
  };
}

function parseBitmap(buffer, section) {
  if (!section) return null;
  return {
    indicator: buffer[section.offset + 5]
  };
}

function decodePngGrayscale16(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) throw new Error("GRIB data payload is not a PNG");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (bitDepth !== 16 || colorType !== 0 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(`unsupported embedded PNG: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`);
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const rowBytes = width * 2;
  const expected = (rowBytes + 1) * height;
  if (inflated.length !== expected) throw new Error(`unexpected PNG data length ${inflated.length}; expected ${expected}`);

  const recon = Buffer.alloc(rowBytes * height);
  let inOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inOffset++];
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[inOffset++];
      const left = x >= 2 ? recon[rowStart + x - 2] : 0;
      const up = y > 0 ? recon[rowStart + x - rowBytes] : 0;
      const upLeft = y > 0 && x >= 2 ? recon[rowStart + x - rowBytes - 2] : 0;
      recon[rowStart + x] = (raw + pngFilterPredictor(filter, left, up, upLeft)) & 0xff;
    }
  }

  const samples = new Uint16Array(width * height);
  for (let i = 0, j = 0; i < recon.length; i += 2, j += 1) {
    samples[j] = (recon[i] << 8) | recon[i + 1];
  }

  return { width, height, bitDepth, colorType, samples };
}

function pngFilterPredictor(filter, left, up, upLeft) {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paeth(left, up, upLeft);
  throw new Error(`unsupported PNG row filter ${filter}`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeGridValues(samples, representation) {
  const values = new Float32Array(samples.length);
  const binaryMultiplier = 2 ** representation.binaryScale;
  const decimalDivisor = 10 ** representation.decimalScale;
  for (let i = 0; i < samples.length; i += 1) {
    values[i] = (representation.referenceValue + samples[i] * binaryMultiplier) / decimalDivisor;
  }
  return values;
}

function renderViewport({ values, grid, centerLat, centerLon, zoom, width, height, threshold, smooth, style, basemap }) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const worldSize = 512 * (2 ** zoom);
  const center = lonLatToWorld(centerLon, centerLat, worldSize);
  let radarPixels = 0;
  let maxRenderedDbz = -Infinity;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outIndex = (y * width + x) * 4;
      if (basemap) paintSoftBasemap(pixels, outIndex, x, y, width, height);

      const worldX = center.x + x - width / 2;
      const worldY = center.y + y - height / 2;
      const { lon, lat } = worldToLonLat(worldX, worldY, worldSize);
      const dbz = sampleGrid(values, grid, lat, lon, smooth);
      const thresholdFade = smoothstep(threshold - style.fadeBelow, threshold + style.fadeAbove, dbz);
      if (!Number.isFinite(dbz) || thresholdFade <= 0) {
        if (!basemap) pixels[outIndex + 3] = 0;
        continue;
      }

      const color = radarColor(dbz, style);
      const alpha = Math.min(1, color[3] / 255 * thresholdFade * style.alphaScale);
      pixels[outIndex] = Math.round(color[0] * alpha + pixels[outIndex] * (1 - alpha));
      pixels[outIndex + 1] = Math.round(color[1] * alpha + pixels[outIndex + 1] * (1 - alpha));
      pixels[outIndex + 2] = Math.round(color[2] * alpha + pixels[outIndex + 2] * (1 - alpha));
      const separatorAlpha = bandSeparatorAlpha(dbz, style) * thresholdFade;
      if (separatorAlpha > 0) {
        const strokeAlpha = Math.min(1, separatorAlpha * style.separatorAlpha);
        pixels[outIndex] = Math.round(style.separatorColor[0] * strokeAlpha + pixels[outIndex] * (1 - strokeAlpha));
        pixels[outIndex + 1] = Math.round(style.separatorColor[1] * strokeAlpha + pixels[outIndex + 1] * (1 - strokeAlpha));
        pixels[outIndex + 2] = Math.round(style.separatorColor[2] * strokeAlpha + pixels[outIndex + 2] * (1 - strokeAlpha));
      }
      pixels[outIndex + 3] = basemap ? 255 : color[3];
      radarPixels += 1;
      if (dbz > maxRenderedDbz) maxRenderedDbz = dbz;
    }
  }

  return { pixels, radarPixels, maxRenderedDbz: Number.isFinite(maxRenderedDbz) ? maxRenderedDbz : null };
}

function composeComparison(panels, panelWidth, panelHeight) {
  const gutter = 18;
  const width = panels.length * panelWidth + (panels.length - 1) * gutter;
  const height = panelHeight;
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < panels.length; i += 1) {
    const xOffset = i * (panelWidth + gutter);
    copyPanel(panels[i].output.pixels, pixels, panelWidth, panelHeight, width, xOffset);
  }

  for (let x = panelWidth; x < width; x += panelWidth + gutter) {
    for (let y = 0; y < height; y += 1) {
      for (let gx = x; gx < Math.min(x + gutter, width); gx += 1) {
        const index = (y * width + gx) * 4;
        pixels[index] = 244;
        pixels[index + 1] = 246;
        pixels[index + 2] = 248;
        pixels[index + 3] = 255;
      }
    }
  }

  return { width, height, pixels };
}

function copyPanel(source, target, panelWidth, panelHeight, targetWidth, xOffset) {
  for (let y = 0; y < panelHeight; y += 1) {
    const sourceStart = y * panelWidth * 4;
    const targetStart = (y * targetWidth + xOffset) * 4;
    target.set(source.subarray(sourceStart, sourceStart + panelWidth * 4), targetStart);
  }
}

function gridValueStats(values, grid) {
  let minDbz = Infinity;
  let maxDbz = -Infinity;
  let maxIndex = -1;
  let validCells = 0;
  let precipCells = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = cleanDbz(values[i]);
    if (!Number.isFinite(value)) continue;
    validCells += 1;
    if (value >= 5) precipCells += 1;
    if (value < minDbz) minDbz = value;
    if (value > maxDbz) {
      maxDbz = value;
      maxIndex = i;
    }
  }

  const position = maxIndex >= 0 ? gridPosition(grid, maxIndex) : {};
  return {
    validCells,
    precipCells,
    precipPercent: round(precipCells / values.length * 100, 3),
    minDbz: round(minDbz, 1),
    maxDbz: round(maxDbz, 1),
    maxLat: round(position.lat, 4),
    maxLon: round(position.lon, 4)
  };
}

function edgeFocus(values, grid) {
  let bestScore = -Infinity;
  let bestIndex = -1;
  for (let row = 1; row < grid.nj - 1; row += 2) {
    const rowOffset = row * grid.ni;
    for (let col = 1; col < grid.ni - 1; col += 2) {
      const index = rowOffset + col;
      const value = cleanDbz(values[index]);
      if (!Number.isFinite(value) || value < 12 || value > 55) continue;
      const right = cleanDbz(values[index + 2]);
      const left = cleanDbz(values[index - 2]);
      const down = cleanDbz(values[index + grid.ni * 2]);
      const up = cleanDbz(values[index - grid.ni * 2]);
      if (![right, left, down, up].every(Number.isFinite)) continue;
      const gradient = Math.abs(right - left) + Math.abs(down - up);
      const intensityPreference = 1 - Math.min(Math.abs(value - 32), 28) / 28;
      const score = gradient * (0.55 + intensityPreference);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }

  if (bestIndex < 0) return null;
  return {
    ...gridPosition(grid, bestIndex),
    score: bestScore
  };
}

function gridPosition(grid, index) {
  const row = Math.floor(index / grid.ni);
  const col = index - row * grid.ni;
  return {
    lat: grid.jScansPositive ? grid.lat1 + row * grid.dy : grid.lat1 - row * grid.dy,
    lon: grid.iScansPositive ? grid.lon1 + col * grid.dx : grid.lon1 - col * grid.dx
  };
}

function sampleGrid(values, grid, lat, lon, smooth = 0) {
  let col = grid.iScansPositive ? (lon - grid.lon1) / grid.dx : (grid.lon1 - lon) / grid.dx;
  let row = grid.jScansPositive ? (lat - grid.lat1) / grid.dy : (grid.lat1 - lat) / grid.dy;
  if (lon < grid.lon1 && grid.lon1 > 0) {
    const adjustedLon = lon + 360;
    col = grid.iScansPositive ? (adjustedLon - grid.lon1) / grid.dx : (grid.lon1 - adjustedLon) / grid.dx;
  }
  if (col < 0 || row < 0 || col >= grid.ni - 1 || row >= grid.nj - 1) return NaN;
  if (smooth > 0.05) return sampleGridGaussian(values, grid, row, col, smooth);
  return sampleGridBilinear(values, grid, row, col);
}

function sampleGridBilinear(values, grid, row, col) {
  const x0 = Math.floor(col);
  const y0 = Math.floor(row);
  const xFrac = col - x0;
  const yFrac = row - y0;
  const i00 = y0 * grid.ni + x0;
  const v00 = cleanDbz(values[i00]);
  const v10 = cleanDbz(values[i00 + 1]);
  const v01 = cleanDbz(values[i00 + grid.ni]);
  const v11 = cleanDbz(values[i00 + grid.ni + 1]);
  if (![v00, v10, v01, v11].every(Number.isFinite)) return NaN;

  const top = v00 * (1 - xFrac) + v10 * xFrac;
  const bottom = v01 * (1 - xFrac) + v11 * xFrac;
  return top * (1 - yFrac) + bottom * yFrac;
}

function sampleGridGaussian(values, grid, row, col, smooth) {
  const radius = Math.max(1, Math.ceil(smooth * 2));
  const sigma2 = smooth * smooth * 2;
  const centerX = Math.floor(col);
  const centerY = Math.floor(row);
  let sum = 0;
  let weightSum = 0;

  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    if (y < 0 || y >= grid.nj) continue;
    const dy = y - row;
    const rowOffset = y * grid.ni;
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (x < 0 || x >= grid.ni) continue;
      const value = cleanDbz(values[rowOffset + x]);
      if (!Number.isFinite(value)) continue;
      const dx = x - col;
      const weight = Math.exp(-(dx * dx + dy * dy) / sigma2);
      sum += value * weight;
      weightSum += weight;
    }
  }

  return weightSum ? sum / weightSum : NaN;
}

function cleanDbz(value) {
  if (!Number.isFinite(value) || value < -100 || value > 100) return NaN;
  if (value <= -90) return 0;
  return value;
}

function smoothstep(edge0, edge1, value) {
  if (!Number.isFinite(value)) return 0;
  const t = Math.max(0, Math.min((value - edge0) / (edge1 - edge0), 1));
  return t * t * (3 - 2 * t);
}

function radarColor(value, style) {
  const styledValue = contourValue(value, style);
  return rampColor(styledValue, style.ramp);
}

function contourValue(value, style) {
  if (!Number.isFinite(value) || !style.bandStep) return value;
  const base = style.bandBase;
  const step = style.bandStep;
  if (value <= base) return value;

  const rawBand = (value - base) / step;
  const bandIndex = Math.floor(rawBand);
  const fraction = rawBand - bandIndex;
  const current = base + bandIndex * step + step * 0.5;
  const previous = Math.max(base, current - step);
  const next = current + step;
  const feather = style.bandFeather;

  if (feather > 0 && fraction < feather) {
    return mix(previous, current, smoothstep(0, feather, fraction));
  }
  if (feather > 0 && fraction > 1 - feather) {
    return mix(current, next, smoothstep(1 - feather, 1, fraction));
  }
  return current;
}

function rampColor(value, ramp) {
  if (value <= ramp[0].value) return ramp[0].color;
  for (let i = 1; i < ramp.length; i += 1) {
    const prev = ramp[i - 1];
    const next = ramp[i];
    if (value <= next.value) {
      const t = smoothstep(0, 1, (value - prev.value) / (next.value - prev.value));
      return prev.color.map((channel, index) => Math.round(channel + (next.color[index] - channel) * t));
    }
  }
  return ramp[ramp.length - 1].color;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function normalizeStyle(value) {
  const next = String(value || DEFAULT_STYLE).toLowerCase();
  if (next === "resolved" || next === "field") return "resolved";
  if (next === "banded" || next === "stepped" || next === "contour" || next === "contoured" || next === "raw-banded") {
    return "banded";
  }
  return "continuous";
}

function radarStyle(name, options = {}) {
  if (name === "banded") {
    return {
      name,
      ramp: RADAR_RAMP,
      alphaScale: numberArg(options.alpha, 1.02),
      fadeBelow: numberArg(options["fade-below"], 2.5),
      fadeAbove: numberArg(options["fade-above"], 1.25),
      bandBase: numberArg(options["band-base"], 5),
      bandStep: numberArg(options["band-step"], 7.5),
      bandFeather: numberArg(options["band-feather"], 0.04),
      separatorAlpha: numberArg(options["separator-alpha"], 0.22),
      separatorWidth: numberArg(options["separator-width"], 0.28),
      separatorColor: parseRgb(options["separator-color"], [20, 31, 42])
    };
  }

  if (name === "resolved") {
    return {
      name,
      ramp: RESOLVED_RAMP,
      alphaScale: numberArg(options.alpha, 1.04),
      fadeBelow: numberArg(options["fade-below"], 5),
      fadeAbove: numberArg(options["fade-above"], 1.75),
      bandBase: numberArg(options["band-base"], 5),
      bandStep: numberArg(options["band-step"], 0),
      bandFeather: numberArg(options["band-feather"], 0.4),
      separatorAlpha: numberArg(options["separator-alpha"], 0),
      separatorWidth: numberArg(options["separator-width"], 0),
      separatorColor: parseRgb(options["separator-color"], [20, 31, 42])
    };
  }

  return {
    name: "continuous",
    ramp: RADAR_RAMP,
    alphaScale: numberArg(options.alpha, 1),
    fadeBelow: numberArg(options["fade-below"], 3),
    fadeAbove: numberArg(options["fade-above"], 2),
    bandBase: 5,
    bandStep: 0,
    bandFeather: 0,
    separatorAlpha: 0,
    separatorWidth: 0,
    separatorColor: [20, 31, 42]
  };
}

function defaultSmoothForStyle(styleName) {
  if (styleName === "resolved") return 2.15;
  if (styleName === "banded") return 0.05;
  return 1.15;
}

function comparisonVariants(styleName, smooth, argsForStyle) {
  return [
    {
      label: "continuous",
      smooth: 0.05,
      style: radarStyle("continuous", argsForStyle)
    },
    {
      label: "banded",
      smooth: styleName === "banded" ? smooth : 0.05,
      style: radarStyle("banded", argsForStyle)
    },
    {
      label: "smoothed",
      smooth: styleName === "continuous" ? smooth : 1.15,
      style: radarStyle("continuous", argsForStyle)
    },
    {
      label: "resolved",
      smooth: Math.max(smooth, 2.15),
      style: radarStyle("resolved", argsForStyle)
    }
  ];
}

function bandSeparatorAlpha(value, style) {
  if (!Number.isFinite(value) || !style.bandStep || !style.separatorAlpha || !style.separatorWidth) return 0;
  if (value < style.bandBase + style.bandStep * 0.35) return 0;
  const bandPosition = (value - style.bandBase) / style.bandStep;
  const fraction = bandPosition - Math.floor(bandPosition);
  const distance = Math.min(fraction, 1 - fraction) * style.bandStep;
  if (distance > style.separatorWidth) return 0;
  return 1 - smoothstep(0, style.separatorWidth, distance);
}

function paintSoftBasemap(pixels, index, x, y, width, height) {
  const shade = 232 + Math.round(10 * Math.sin(x / 83) + 7 * Math.cos(y / 61));
  const road = (Math.abs((x + y * 0.35) % 180 - 90) < 1.4) || (Math.abs((x * 0.45 - y) % 230 - 115) < 1.2);
  const water = y > height * 0.68 && Math.sin(x / 70) + Math.cos(y / 40) > 1.15;
  pixels[index] = water ? 210 : road ? 245 : shade;
  pixels[index + 1] = water ? 224 : road ? 242 : shade;
  pixels[index + 2] = water ? 230 : road ? 234 : shade + 2;
  pixels[index + 3] = 255;
}

function encodePngRgba(width, height, rgba) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowBytes + 1);
    raw[rawOffset] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * rowBytes, rowBytes).copy(raw, rawOffset + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE, "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 8 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function gribSummary(parsed) {
  return {
    discipline: parsed.discipline,
    edition: parsed.edition,
    totalLength: parsed.totalLength,
    sections: parsed.sections.map((section) => ({
      number: section.number,
      offset: section.offset,
      length: section.length
    })),
    grid: parsed.grid,
    product: parsed.product,
    dataRepresentation: parsed.dataRepresentation,
    bitmap: parsed.bitmap
  };
}

function lonLatToWorld(lon, lat, worldSize) {
  const sinLat = Math.sin(lat * Math.PI / 180);
  return {
    x: (lon + 180) / 360 * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
  };
}

function worldToLonLat(x, y, worldSize) {
  const lon = x / worldSize * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / worldSize;
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat };
}

function maybeGunzip(buffer) {
  return buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer;
}

function scaledCoord(value) {
  return value / 1e6;
}

function normalizeLon(value) {
  return value > 180 ? value - 360 : value;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const parsed = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) parsed[body] = true;
    else parsed[body.slice(0, eqIndex)] = body.slice(eqIndex + 1);
  });
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/mrms-prototype/render-mrms-preview.mjs --file=/tmp/frame.grib2.gz --probe
  node scripts/mrms-prototype/render-mrms-preview.mjs --file=/tmp/frame.grib2.gz --zoom=11 --out=/tmp/mrms.png
  node scripts/mrms-prototype/render-mrms-preview.mjs --product=MergedReflectivityQCComposite_00.50 --lat=38.7237 --lon=-89.9559

Options:
  --file=PATH                Local .grib2 or .grib2.gz file.
  --url=URL                  Direct MRMS object URL.
  --product=NAME             MRMS product. Defaults to MergedReflectivityQCComposite_00.50.
  --date=YYYYMMDD            Date folder for product lookup. Defaults to today UTC.
  --lat=38.7237              Viewport center latitude.
  --lon=-89.9559             Viewport center longitude.
  --zoom=11                  Web Mercator zoom used for the local preview.
  --width=900                Output image width.
  --height=900               Output image height.
  --focus=max                Center on the strongest decoded radar cell.
  --focus=edge               Center on a high-gradient precip edge.
  --style=continuous         Visual style: continuous, banded, or resolved.
  --threshold=5              Minimum dBZ to draw.
  --smooth=1.15              Data-space smoothing radius; resolved defaults to 2.15.
  --band-step=7.5            Banded style contour band size; resolved defaults to 0.
  --band-feather=0.04        Banded style band transition width.
  --separator-alpha=0.22     Banded style intensity-line strength.
  --separator-width=0.28     Banded style intensity-line width in dBZ.
  --compare                  Render continuous, banded, smoothed, and resolved panels.
  --transparent              Output radar only, no soft local basemap.
  --probe                    Print GRIB2 structure without rendering.
  --out=/tmp/file.png        Output PNG path.
`);
}

function numberArg(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function parseRgb(value, fallback) {
  if (!value) return fallback;
  const parts = String(value).split(",").map((part) => Number(part.trim()));
  return parts.length === 3 && parts.every((part) => Number.isFinite(part))
    ? parts.map((part) => Math.max(0, Math.min(255, Math.round(part))))
    : fallback;
}

function cleanSegment(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function utcDateString(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function observedTimeFromKey(key) {
  const match = String(key || "").match(/_(\d{8})-(\d{6})\.grib2(?:\.gz)?$/);
  if (!match) return null;
  const [, ymd, hms] = match;
  return new Date(Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
    Number(hms.slice(0, 2)),
    Number(hms.slice(2, 4)),
    Number(hms.slice(4, 6))
  ));
}

function blocksForTag(xml, tag) {
  return [...String(xml || "").matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1]);
}

function textForTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return decodeXml(match?.[1] || "");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
