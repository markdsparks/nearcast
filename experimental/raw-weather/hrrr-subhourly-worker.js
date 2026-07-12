(function installHrrrSubhourlyWorker(scope) {
  "use strict";

  const NOAA_HRRR_ORIGIN = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com";
  const MAX_RECORD_BYTES = 4 * 1024 * 1024;
  const MAX_SOURCE_POINTS = 3_000_000;
  const MAX_TEXTURE_PIXELS = 1_048_576;
  const HRRR_SPHERE_RADIUS = 6_371_229;
  const jobs = new Map();

  scope.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "cancel") {
      cancelJobs(message.payload?.requestId);
      return;
    }
    if (message.type !== "decode" || !message.id) return;
    const controller = new AbortController();
    jobs.set(message.id, controller);
    decodeFrame(message.payload || {}, controller.signal)
      .then((result) => {
        jobs.delete(message.id);
        scope.postMessage({ id: message.id, type: "result", result }, [result.data.buffer]);
      })
      .catch((error) => {
        jobs.delete(message.id);
        scope.postMessage({
          id: message.id,
          type: "error",
          error: serializeError(error)
        });
      });
  });

  function cancelJobs(requestId) {
    if (requestId && jobs.has(requestId)) {
      jobs.get(requestId).abort();
      return;
    }
    if (!requestId) {
      for (const controller of jobs.values()) controller.abort();
    }
  }

  async function decodeFrame(input, outerSignal) {
    const startedAt = nowMs();
    const config = normalizeInput(input);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
    const signal = anySignal([outerSignal, timeoutController.signal]);

    try {
      const bytes = await fetchRange(config.frame, config.maxRecordBytes, signal);
      const parsed = parseGrib2(bytes);
      validateFrameTime(config.frame, parsed.referenceTime, parsed.forecastMinutes);
      const unpacked = unpackComplexSpatial(bytes, parsed);
      if (signal.aborted) throw abortError();
      const sampled = resampleViewport({
        values: unpacked.values,
        grid: parsed.grid,
        representation: parsed.representation,
        bounds: config.bounds,
        width: config.width,
        height: config.height,
        threshold: config.threshold,
        dbzMin: config.dbzMin,
        dbzMax: config.dbzMax,
        signal
      });
      const sourceMinDbz = scaleValue(unpacked.minValue, parsed.representation);
      const sourceMaxDbz = scaleValue(unpacked.maxValue, parsed.representation);

      return {
        data: sampled.data,
        width: config.width,
        height: config.height,
        bounds: config.bounds,
        projection: "web-mercator-bounds",
        provider: "noaa-hrrr-subhourly",
        cycleTime: config.frame.cycleTime,
        validTime: config.frame.validTime,
        forecastMinutes: config.frame.forecastMinutes,
        sourceUrl: config.frame.url,
        encoding: {
          type: "uint8-dbz",
          dbzMin: config.dbzMin,
          dbzMax: config.dbzMax,
          threshold: config.threshold,
          noData: 0,
          valueMin: 1,
          valueMax: 255,
          formula: "dbz = dbzMin + (value - 1) * (dbzMax - dbzMin) / 254"
        },
        grid: {
          template: 30,
          ni: parsed.grid.ni,
          nj: parsed.grid.nj,
          lat1: parsed.grid.lat1,
          lon1: parsed.grid.lon1,
          dx: parsed.grid.dx,
          dy: parsed.grid.dy,
          scanMode: parsed.grid.scanMode
        },
        metrics: {
          rangeStart: config.frame.rangeStart,
          rangeEnd: config.frame.rangeEnd,
          recordBytes: bytes.byteLength,
          sourcePoints: unpacked.values.length,
          sourceMinDbz,
          sourceMaxDbz,
          outputPixels: sampled.data.length,
          precipPixels: sampled.precipPixels,
          minDbz: Number.isFinite(sampled.minDbz) ? sampled.minDbz : null,
          maxDbz: Number.isFinite(sampled.maxDbz) ? sampled.maxDbz : null,
          elapsedMs: Math.round(nowMs() - startedAt),
          memoryStrategy: "range-fetch one REFC message; unpack one national Int32 field; retain one Uint8 viewport texture"
        }
      };
    } catch (error) {
      if (timeoutController.signal.aborted && !outerSignal.aborted) {
        throw codedError("HRRR_SUBHOURLY_TIMEOUT", `HRRR decode exceeded ${config.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeInput(input) {
    const source = input.frame || {};
    const url = new URL(source.url || "");
    if (url.origin !== NOAA_HRRR_ORIGIN
      || !/^\/hrrr\.\d{8}\/conus\/hrrr\.t\d{2}z\.wrfsubhf\d{2}\.grib2$/.test(url.pathname)) {
      throw codedError("HRRR_SUBHOURLY_SOURCE_REJECTED", "Only public NOAA CONUS HRRR sub-hourly objects are accepted.");
    }
    const rangeStart = finiteInteger(source.rangeStart, "rangeStart");
    const rangeEnd = finiteInteger(source.rangeEnd, "rangeEnd");
    if (rangeStart < 0 || rangeEnd < rangeStart) {
      throw codedError("HRRR_SUBHOURLY_RANGE_INVALID", "A finite increasing byte range is required.");
    }
    const bounds = normalizeBounds(input.bounds);
    const width = clampInteger(input.width, 512, 64, 1024);
    const height = clampInteger(input.height, 384, 64, 1024);
    if (width * height > MAX_TEXTURE_PIXELS) {
      throw codedError("HRRR_SUBHOURLY_TEXTURE_TOO_LARGE", `Texture exceeds ${MAX_TEXTURE_PIXELS.toLocaleString()} pixels.`);
    }
    const dbzMin = clampNumber(input.dbzMin, 0, -20, 40);
    const dbzMax = clampNumber(input.dbzMax, 80, 41, 100);
    if (dbzMax <= dbzMin) {
      throw codedError("HRRR_SUBHOURLY_ENCODING_INVALID", "dbzMax must be greater than dbzMin.");
    }
    return {
      frame: {
        ...source,
        url: url.href,
        rangeStart,
        rangeEnd,
        forecastMinutes: Number(source.forecastMinutes)
      },
      bounds,
      width,
      height,
      dbzMin,
      dbzMax,
      threshold: clampNumber(input.threshold, 5, -10, 80),
      timeoutMs: clampInteger(input.timeoutMs, 45_000, 5_000, 90_000),
      maxRecordBytes: clampInteger(input.maxRecordBytes, MAX_RECORD_BYTES, 64 * 1024, 8 * 1024 * 1024)
    };
  }

  async function fetchRange(frame, maxBytes, signal) {
    const expectedBytes = frame.rangeEnd - frame.rangeStart + 1;
    if (expectedBytes > maxBytes) {
      throw codedError(
        "HRRR_SUBHOURLY_RECORD_TOO_LARGE",
        `HRRR REFC record is ${expectedBytes.toLocaleString()} bytes; limit is ${maxBytes.toLocaleString()}.`
      );
    }
    const response = await fetch(frame.url, {
      signal,
      cache: "no-store",
      headers: { Range: `bytes=${frame.rangeStart}-${frame.rangeEnd}` }
    });
    if (!response.ok) {
      throw codedError("HRRR_SUBHOURLY_FETCH_FAILED", `HRRR range fetch failed with HTTP ${response.status}.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedBytes) {
      throw codedError(
        "HRRR_SUBHOURLY_RANGE_MISMATCH",
        `HRRR range returned ${bytes.byteLength.toLocaleString()} bytes; expected ${expectedBytes.toLocaleString()}.`
      );
    }
    return bytes;
  }

  function parseGrib2(bytes) {
    if (ascii(bytes, 0, 4) !== "GRIB") {
      throw codedError("HRRR_SUBHOURLY_GRIB_INVALID", "Downloaded byte range is not a GRIB2 message.");
    }
    if (bytes[7] !== 2) {
      throw codedError("HRRR_SUBHOURLY_GRIB_UNSUPPORTED", `Unsupported GRIB edition ${bytes[7]}.`);
    }
    const view = dataView(bytes);
    const totalLength = readUint64(view, 8);
    if (totalLength !== bytes.byteLength) {
      throw codedError(
        "HRRR_SUBHOURLY_GRIB_TRUNCATED",
        `GRIB declares ${totalLength} bytes but the range contains ${bytes.byteLength}.`
      );
    }
    const sections = [];
    let offset = 16;
    while (offset < totalLength) {
      if (ascii(bytes, offset, 4) === "7777") {
        sections.push({ number: 8, offset, length: 4 });
        offset += 4;
        break;
      }
      if (offset + 5 > totalLength) {
        throw codedError("HRRR_SUBHOURLY_GRIB_TRUNCATED", "GRIB section header is truncated.");
      }
      const length = view.getUint32(offset);
      const number = bytes[offset + 4];
      if (length < 5 || offset + length > totalLength) {
        throw codedError("HRRR_SUBHOURLY_GRIB_INVALID", `GRIB section ${number} has an invalid length.`);
      }
      sections.push({ number, offset, length });
      offset += length;
    }
    if (offset !== totalLength || ascii(bytes, totalLength - 4, 4) !== "7777") {
      throw codedError("HRRR_SUBHOURLY_GRIB_INVALID", "GRIB end marker is missing.");
    }

    const section = (number) => sections.find((item) => item.number === number);
    const identification = section(1);
    const gridSection = section(3);
    const productSection = section(4);
    const representationSection = section(5);
    const bitmapSection = section(6);
    const dataSection = section(7);
    if (!identification || !gridSection || !productSection || !representationSection || !dataSection) {
      throw codedError("HRRR_SUBHOURLY_GRIB_MISSING_SECTION", "Required GRIB2 sections are missing.");
    }
    if (bitmapSection && bytes[bitmapSection.offset + 5] !== 255) {
      throw codedError("HRRR_SUBHOURLY_BITMAP_UNSUPPORTED", "Bitmap-packed HRRR fields are not supported.");
    }

    return {
      grid: parseLambertGrid(bytes, gridSection),
      representation: parseComplexRepresentation(bytes, representationSection),
      dataSection,
      referenceTime: parseReferenceTime(bytes, identification),
      forecastMinutes: parseForecastMinutes(bytes, productSection)
    };
  }

  function parseLambertGrid(bytes, section) {
    const view = dataView(bytes);
    const template = view.getUint16(section.offset + 12);
    if (template !== 30) {
      throw codedError("HRRR_SUBHOURLY_GRID_UNSUPPORTED", `Expected Lambert grid 3.30; received 3.${template}.`);
    }
    const shape = bytes[section.offset + 14];
    if (shape !== 6) {
      throw codedError("HRRR_SUBHOURLY_EARTH_UNSUPPORTED", `Expected HRRR spherical Earth shape 6; received ${shape}.`);
    }
    const ni = view.getUint32(section.offset + 30);
    const nj = view.getUint32(section.offset + 34);
    const pointCount = view.getUint32(section.offset + 6);
    if (!ni || !nj || ni * nj !== pointCount || pointCount > MAX_SOURCE_POINTS) {
      throw codedError("HRRR_SUBHOURLY_GRID_INVALID", "HRRR grid dimensions are invalid or exceed the safety limit.");
    }
    const scanMode = bytes[section.offset + 64];
    if ((scanMode & 0x30) !== 0) {
      throw codedError("HRRR_SUBHOURLY_SCAN_UNSUPPORTED", `Unsupported HRRR scan mode ${scanMode}.`);
    }
    const lat1 = view.getInt32(section.offset + 38) / 1_000_000;
    const lon1 = normalizeLongitude(view.getInt32(section.offset + 42) / 1_000_000);
    const latD = view.getInt32(section.offset + 47) / 1_000_000;
    const lonV = normalizeLongitude(view.getInt32(section.offset + 51) / 1_000_000);
    const latin1 = view.getInt32(section.offset + 65) / 1_000_000;
    const latin2 = view.getInt32(section.offset + 69) / 1_000_000;
    const dx = view.getUint32(section.offset + 55) / 1_000;
    const dy = view.getUint32(section.offset + 59) / 1_000;
    if (![lat1, lon1, latD, lonV, latin1, latin2, dx, dy].every(Number.isFinite) || dx <= 0 || dy <= 0) {
      throw codedError("HRRR_SUBHOURLY_GRID_INVALID", "HRRR Lambert projection parameters are invalid.");
    }
    const projection = {
      radius: HRRR_SPHERE_RADIUS,
      lat0: latD,
      lon0: lonV,
      lat1: latin1,
      lat2: latin2
    };
    const origin = projectLonLat(lon1, lat1, projection);
    return {
      template,
      ni,
      nj,
      pointCount,
      lat1,
      lon1,
      dx,
      dy,
      scanMode,
      iDirection: (scanMode & 0x80) === 0 ? 1 : -1,
      jDirection: (scanMode & 0x40) !== 0 ? 1 : -1,
      projection,
      origin
    };
  }

  function parseComplexRepresentation(bytes, section) {
    const view = dataView(bytes);
    const template = view.getUint16(section.offset + 9);
    if (template !== 3) {
      throw codedError("HRRR_SUBHOURLY_PACKING_UNSUPPORTED", `Expected complex spatial packing 5.3; received 5.${template}.`);
    }
    const representation = {
      pointCount: view.getUint32(section.offset + 5),
      referenceValue: view.getFloat32(section.offset + 11),
      binaryScale: readSignedMagnitude(bytes, section.offset + 15, 2),
      decimalScale: readSignedMagnitude(bytes, section.offset + 17, 2),
      referenceBits: bytes[section.offset + 19],
      missingManagement: bytes[section.offset + 22],
      numberOfGroups: view.getUint32(section.offset + 31),
      referenceGroupWidth: bytes[section.offset + 35],
      groupWidthBits: bytes[section.offset + 36],
      referenceGroupLength: view.getUint32(section.offset + 37),
      groupLengthIncrement: bytes[section.offset + 41],
      trueLastGroupLength: view.getUint32(section.offset + 42),
      groupLengthBits: bytes[section.offset + 46],
      spatialOrder: bytes[section.offset + 47],
      descriptorOctets: bytes[section.offset + 48]
    };
    if (representation.missingManagement !== 0) {
      throw codedError("HRRR_SUBHOURLY_MISSING_UNSUPPORTED", "HRRR missing-value complex packing is not supported.");
    }
    if (![1, 2].includes(representation.spatialOrder)
      || representation.descriptorOctets < 1
      || representation.descriptorOctets > 4
      || representation.referenceBits > 31
      || representation.groupWidthBits > 31
      || representation.groupLengthBits > 31
      || !representation.numberOfGroups
      || representation.numberOfGroups > representation.pointCount) {
      throw codedError("HRRR_SUBHOURLY_PACKING_INVALID", "HRRR complex-packing metadata is invalid.");
    }
    return representation;
  }

  function unpackComplexSpatial(bytes, parsed) {
    const rep = parsed.representation;
    const section = parsed.dataSection;
    if (rep.pointCount !== parsed.grid.pointCount) {
      throw codedError("HRRR_SUBHOURLY_POINT_COUNT_MISMATCH", "Grid and packed-value counts do not match.");
    }
    let descriptorOffset = section.offset + 5;
    const initialValues = [];
    for (let index = 0; index < rep.spatialOrder; index += 1) {
      initialValues.push(readSignedMagnitude(bytes, descriptorOffset, rep.descriptorOctets));
      descriptorOffset += rep.descriptorOctets;
    }
    const minimumDifference = readSignedMagnitude(bytes, descriptorOffset, rep.descriptorOctets);
    descriptorOffset += rep.descriptorOctets;
    const reader = new BitReader(bytes, descriptorOffset * 8, (section.offset + section.length) * 8);
    const groupReferences = new Uint32Array(rep.numberOfGroups);
    const groupWidths = new Uint8Array(rep.numberOfGroups);
    const groupLengths = new Uint32Array(rep.numberOfGroups);

    for (let index = 0; index < rep.numberOfGroups; index += 1) {
      groupReferences[index] = reader.read(rep.referenceBits);
    }
    reader.align();
    for (let index = 0; index < rep.numberOfGroups; index += 1) {
      groupWidths[index] = rep.referenceGroupWidth + reader.read(rep.groupWidthBits);
      if (groupWidths[index] > 31) {
        throw codedError("HRRR_SUBHOURLY_GROUP_WIDTH_INVALID", "Packed group width exceeds 31 bits.");
      }
    }
    reader.align();
    let totalValues = 0;
    for (let index = 0; index < rep.numberOfGroups; index += 1) {
      const scaledLength = reader.read(rep.groupLengthBits);
      const length = index === rep.numberOfGroups - 1
        ? rep.trueLastGroupLength
        : rep.referenceGroupLength + scaledLength * rep.groupLengthIncrement;
      groupLengths[index] = length;
      totalValues += length;
    }
    reader.align();
    if (totalValues !== rep.pointCount) {
      throw codedError(
        "HRRR_SUBHOURLY_GROUP_LENGTH_MISMATCH",
        `Packed groups describe ${totalValues} values; expected ${rep.pointCount}.`
      );
    }

    const values = new Int32Array(rep.pointCount);
    let output = 0;
    for (let group = 0; group < rep.numberOfGroups; group += 1) {
      const reference = groupReferences[group];
      const width = groupWidths[group];
      const length = groupLengths[group];
      for (let index = 0; index < length; index += 1) {
        const value = reference + reader.read(width);
        if (!Number.isSafeInteger(value) || value > 0x7fffffff) {
          throw codedError("HRRR_SUBHOURLY_PACKED_VALUE_INVALID", "Packed HRRR value exceeds the integer safety limit.");
        }
        values[output++] = value;
      }
    }
    for (let index = 0; index < rep.spatialOrder; index += 1) values[index] = initialValues[index];

    if (rep.spatialOrder === 1) {
      for (let index = 1; index < values.length; index += 1) {
        values[index] = values[index - 1] + values[index] + minimumDifference;
      }
    } else {
      for (let index = 2; index < values.length; index += 1) {
        values[index] = 2 * values[index - 1] - values[index - 2] + values[index] + minimumDifference;
      }
    }

    let minValue = Infinity;
    let maxValue = -Infinity;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      if (Math.abs(value) > 10_000_000) {
        throw codedError("HRRR_SUBHOURLY_SPATIAL_INVALID", "Inverse spatial differencing produced an unsafe value.");
      }
      if (value < minValue) minValue = value;
      if (value > maxValue) maxValue = value;
    }
    return { values, minValue, maxValue };
  }

  function resampleViewport(input) {
    const output = new Uint8Array(input.width * input.height);
    const grid = input.grid;
    const northY = mercatorY(input.bounds.maxLat);
    const southY = mercatorY(input.bounds.minLat);
    let precipPixels = 0;
    let minDbz = Infinity;
    let maxDbz = -Infinity;

    for (let y = 0; y < input.height; y += 1) {
      if ((y & 15) === 0 && input.signal.aborted) throw abortError();
      const worldY = northY + (southY - northY) * ((y + 0.5) / input.height);
      const latitude = inverseMercatorY(worldY);
      for (let x = 0; x < input.width; x += 1) {
        const longitude = input.bounds.minLon
          + (input.bounds.maxLon - input.bounds.minLon) * ((x + 0.5) / input.width);
        const projected = projectLonLat(longitude, latitude, grid.projection);
        const sourceX = (projected.x - grid.origin.x) / (grid.dx * grid.iDirection);
        const sourceY = (projected.y - grid.origin.y) / (grid.dy * grid.jDirection);
        if (sourceX < 0 || sourceY < 0 || sourceX > grid.ni - 1 || sourceY > grid.nj - 1) continue;
        const x0 = Math.min(grid.ni - 1, Math.floor(sourceX));
        const y0 = Math.min(grid.nj - 1, Math.floor(sourceY));
        const x1 = Math.min(grid.ni - 1, x0 + 1);
        const y1 = Math.min(grid.nj - 1, y0 + 1);
        const tx = sourceX - x0;
        const ty = sourceY - y0;
        const top = input.values[y0 * grid.ni + x0] * (1 - tx)
          + input.values[y0 * grid.ni + x1] * tx;
        const bottom = input.values[y1 * grid.ni + x0] * (1 - tx)
          + input.values[y1 * grid.ni + x1] * tx;
        const dbz = scaleValue(top * (1 - ty) + bottom * ty, input.representation);
        if (!Number.isFinite(dbz) || dbz < input.threshold) continue;
        output[y * input.width + x] = encodeDbz(dbz, input.dbzMin, input.dbzMax);
        precipPixels += 1;
        if (dbz < minDbz) minDbz = dbz;
        if (dbz > maxDbz) maxDbz = dbz;
      }
    }
    return { data: output, precipPixels, minDbz, maxDbz };
  }

  function scaleValue(value, representation) {
    return (representation.referenceValue + value * 2 ** representation.binaryScale)
      * 10 ** (-representation.decimalScale);
  }

  function encodeDbz(dbz, minimum, maximum) {
    const clamped = Math.max(minimum, Math.min(maximum, dbz));
    return 1 + Math.round((clamped - minimum) * 254 / (maximum - minimum));
  }

  function projectLonLat(lon, lat, projection) {
    const radians = Math.PI / 180;
    const phi = Math.max(-89.999999, Math.min(89.999999, lat)) * radians;
    const lambda = lon * radians;
    const phi0 = projection.lat0 * radians;
    const phi1 = projection.lat1 * radians;
    const phi2 = projection.lat2 * radians;
    const lambda0 = projection.lon0 * radians;
    const n = Math.abs(phi1 - phi2) < 1e-12
      ? Math.sin(phi1)
      : Math.log(Math.cos(phi1) / Math.cos(phi2))
        / Math.log(tanHalfPi(phi2) / tanHalfPi(phi1));
    const factor = Math.cos(phi1) * Math.pow(tanHalfPi(phi1), n) / n;
    const rho = projection.radius * factor / Math.pow(tanHalfPi(phi), n);
    const rho0 = projection.radius * factor / Math.pow(tanHalfPi(phi0), n);
    const theta = n * normalizeRadians(lambda - lambda0);
    return {
      x: rho * Math.sin(theta),
      y: rho0 - rho * Math.cos(theta)
    };
  }

  function tanHalfPi(phi) {
    return Math.tan(Math.PI / 4 + phi / 2);
  }

  function normalizeRadians(value) {
    let result = value;
    while (result > Math.PI) result -= Math.PI * 2;
    while (result < -Math.PI) result += Math.PI * 2;
    return result;
  }

  function normalizeLongitude(value) {
    let result = Number(value);
    while (result > 180) result -= 360;
    while (result < -180) result += 360;
    return result;
  }

  function mercatorY(latitude) {
    const clamped = Math.max(-85.051129, Math.min(85.051129, latitude));
    const radians = clamped * Math.PI / 180;
    return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
  }

  function inverseMercatorY(value) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * value))) * 180 / Math.PI;
  }

  function parseReferenceTime(bytes, section) {
    const view = dataView(bytes);
    const date = new Date(Date.UTC(
      view.getUint16(section.offset + 12),
      bytes[section.offset + 14] - 1,
      bytes[section.offset + 15],
      bytes[section.offset + 16],
      bytes[section.offset + 17],
      bytes[section.offset + 18]
    ));
    if (!Number.isFinite(date.getTime())) {
      throw codedError("HRRR_SUBHOURLY_REFERENCE_TIME_INVALID", "GRIB reference time is invalid.");
    }
    return date;
  }

  function parseForecastMinutes(bytes, section) {
    const view = dataView(bytes);
    const template = view.getUint16(section.offset + 7);
    if (template !== 0) {
      throw codedError("HRRR_SUBHOURLY_PRODUCT_UNSUPPORTED", `Expected product template 4.0; received 4.${template}.`);
    }
    const unit = bytes[section.offset + 17];
    const value = view.getUint32(section.offset + 18);
    if (unit === 0) return value;
    if (unit === 1) return value * 60;
    throw codedError("HRRR_SUBHOURLY_TIME_UNIT_UNSUPPORTED", `Unsupported forecast-time unit ${unit}.`);
  }

  function validateFrameTime(frame, referenceTime, forecastMinutes) {
    const expectedCycle = Date.parse(frame.cycleTime);
    const expectedValid = Date.parse(frame.validTime);
    const actualValid = referenceTime.getTime() + forecastMinutes * 60_000;
    if (Number.isFinite(expectedCycle) && Math.abs(expectedCycle - referenceTime.getTime()) > 1_000) {
      throw codedError("HRRR_SUBHOURLY_CYCLE_MISMATCH", "GRIB cycle time does not match the selected HRRR run.");
    }
    if (Number.isFinite(expectedValid) && Math.abs(expectedValid - actualValid) > 1_000) {
      throw codedError("HRRR_SUBHOURLY_VALID_TIME_MISMATCH", "GRIB valid time does not match the selected forecast frame.");
    }
    if (Number.isFinite(frame.forecastMinutes) && frame.forecastMinutes !== forecastMinutes) {
      throw codedError("HRRR_SUBHOURLY_FORECAST_TIME_MISMATCH", "GRIB forecast lead does not match its index entry.");
    }
  }

  class BitReader {
    constructor(bytes, bitOffset, bitEnd) {
      this.bytes = bytes;
      this.offset = bitOffset;
      this.end = bitEnd;
    }

    read(bitCount) {
      if (!bitCount) return 0;
      if (!Number.isInteger(bitCount) || bitCount < 0 || bitCount > 31 || this.offset + bitCount > this.end) {
        throw codedError("HRRR_SUBHOURLY_BITSTREAM_INVALID", "Packed HRRR bitstream is truncated or invalid.");
      }
      let remaining = bitCount;
      let value = 0;
      while (remaining > 0) {
        const byteIndex = this.offset >>> 3;
        const available = 8 - (this.offset & 7);
        const take = Math.min(remaining, available);
        const shift = available - take;
        const mask = 2 ** take - 1;
        value = value * 2 ** take + ((this.bytes[byteIndex] >>> shift) & mask);
        this.offset += take;
        remaining -= take;
      }
      return value;
    }

    align() {
      this.offset = (this.offset + 7) & ~7;
      if (this.offset > this.end) {
        throw codedError("HRRR_SUBHOURLY_BITSTREAM_INVALID", "Packed HRRR bitstream alignment exceeds the section.");
      }
    }
  }

  function readSignedMagnitude(bytes, offset, octets) {
    let value = 0;
    for (let index = 0; index < octets; index += 1) value = value * 256 + bytes[offset + index];
    const sign = 2 ** (octets * 8 - 1);
    return value >= sign ? -(value - sign) : value;
  }

  function normalizeBounds(value) {
    const bounds = {
      minLat: Number(value?.minLat),
      minLon: Number(value?.minLon),
      maxLat: Number(value?.maxLat),
      maxLon: Number(value?.maxLon)
    };
    if (!Object.values(bounds).every(Number.isFinite)
      || bounds.minLat >= bounds.maxLat
      || bounds.minLon >= bounds.maxLon
      || bounds.minLat < -85
      || bounds.maxLat > 85
      || bounds.minLon < -180
      || bounds.maxLon > 180) {
      throw codedError("HRRR_SUBHOURLY_BOUNDS_INVALID", "A valid increasing Web Mercator bounds object is required.");
    }
    return bounds;
  }

  function finiteInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw codedError("HRRR_SUBHOURLY_RANGE_INVALID", `${label} must be a safe integer.`);
    }
    return number;
  }

  function anySignal(signals) {
    if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  function dataView(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  function readUint64(view, offset) {
    const high = view.getUint32(offset);
    const low = view.getUint32(offset + 4);
    const value = high * 2 ** 32 + low;
    if (!Number.isSafeInteger(value)) {
      throw codedError("HRRR_SUBHOURLY_GRIB_TOO_LARGE", "GRIB length exceeds JavaScript's safe integer range.");
    }
    return value;
  }

  function ascii(bytes, offset, length) {
    let result = "";
    for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index]);
    return result;
  }

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }

  function clampInteger(value, fallback, min, max) {
    return Math.round(clampNumber(value, fallback, min, max));
  }

  function codedError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.details = details || null;
    return error;
  }

  function abortError() {
    const error = codedError("HRRR_SUBHOURLY_ABORTED", "HRRR sub-hourly operation was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function serializeError(error) {
    return {
      name: error?.name || "Error",
      message: error?.message || String(error),
      code: error?.code || (error?.name === "AbortError" ? "HRRR_SUBHOURLY_ABORTED" : "HRRR_SUBHOURLY_DECODE_FAILED"),
      details: error?.details || null
    };
  }

  function nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }
})(self);
