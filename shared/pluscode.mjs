/**
 * Minimal ESM Plus Code helpers (decode + recoverNearest).
 *
 * Decisión: open-location-code@1.0.3 es CJS/UMD y no importa limpio en este
 * proyecto ESM + browser (shared/ lo usa el cliente y el server). Portamos
 * isValid/isShort/isFull/decode/encode/recoverNearest del port oficial
 * (Apache-2.0, Google) a ESM puro.
 */

const SEPARATOR = "+";
const SEPARATOR_POSITION = 8;
const PADDING_CHARACTER = "0";
const CODE_ALPHABET = "23456789CFGHJMPQRVWX";
const ENCODING_BASE = CODE_ALPHABET.length;
const LATITUDE_MAX = 90;
const LONGITUDE_MAX = 180;
const MIN_DIGIT_COUNT = 2;
const MAX_DIGIT_COUNT = 15;
const PAIR_CODE_LENGTH = 10;
const PAIR_FIRST_PLACE_VALUE = Math.pow(ENCODING_BASE, PAIR_CODE_LENGTH / 2 - 1);
const PAIR_PRECISION = Math.pow(ENCODING_BASE, 3);
const GRID_CODE_LENGTH = MAX_DIGIT_COUNT - PAIR_CODE_LENGTH;
const GRID_COLUMNS = 4;
const GRID_ROWS = 5;
const GRID_LAT_FIRST_PLACE_VALUE = Math.pow(GRID_ROWS, GRID_CODE_LENGTH - 1);
const GRID_LNG_FIRST_PLACE_VALUE = Math.pow(GRID_COLUMNS, GRID_CODE_LENGTH - 1);
const FINAL_LAT_PRECISION =
  PAIR_PRECISION * Math.pow(GRID_ROWS, MAX_DIGIT_COUNT - PAIR_CODE_LENGTH);
const FINAL_LNG_PRECISION =
  PAIR_PRECISION * Math.pow(GRID_COLUMNS, MAX_DIGIT_COUNT - PAIR_CODE_LENGTH);
const CODE_PRECISION_NORMAL = 10;

function clipLatitude(latitude) {
  return Math.min(90, Math.max(-90, latitude));
}

function normalizeLongitude(longitude) {
  while (longitude < -180) longitude += 360;
  while (longitude >= 180) longitude -= 360;
  return longitude;
}

export function isValid(code) {
  if (!code || typeof code !== "string") return false;
  if (code.indexOf(SEPARATOR) === -1) return false;
  if (code.indexOf(SEPARATOR) !== code.lastIndexOf(SEPARATOR)) return false;
  if (code.length === 1) return false;
  if (
    code.indexOf(SEPARATOR) > SEPARATOR_POSITION ||
    code.indexOf(SEPARATOR) % 2 === 1
  ) {
    return false;
  }
  if (code.indexOf(PADDING_CHARACTER) > -1) {
    if (code.indexOf(SEPARATOR) < SEPARATOR_POSITION) return false;
    if (code.indexOf(PADDING_CHARACTER) === 0) return false;
    const padMatch = code.match(new RegExp(`(${PADDING_CHARACTER}+)`, "g"));
    if (
      !padMatch ||
      padMatch.length > 1 ||
      padMatch[0].length % 2 === 1 ||
      padMatch[0].length > SEPARATOR_POSITION - 2
    ) {
      return false;
    }
    if (code.charAt(code.length - 1) !== SEPARATOR) return false;
  }
  if (code.length - code.indexOf(SEPARATOR) - 1 === 1) return false;

  const stripped = code
    .replace(new RegExp(`\\${SEPARATOR}+`), "")
    .replace(new RegExp(`${PADDING_CHARACTER}+`), "");
  for (let i = 0; i < stripped.length; i++) {
    const character = stripped.charAt(i).toUpperCase();
    if (character !== SEPARATOR && CODE_ALPHABET.indexOf(character) === -1) {
      return false;
    }
  }
  return true;
}

export function isShort(code) {
  if (!isValid(code)) return false;
  return code.indexOf(SEPARATOR) >= 0 && code.indexOf(SEPARATOR) < SEPARATOR_POSITION;
}

export function isFull(code) {
  if (!isValid(code)) return false;
  if (isShort(code)) return false;
  const firstLatValue =
    CODE_ALPHABET.indexOf(code.charAt(0).toUpperCase()) * ENCODING_BASE;
  if (firstLatValue >= LATITUDE_MAX * 2) return false;
  if (code.length > 1) {
    const firstLngValue =
      CODE_ALPHABET.indexOf(code.charAt(1).toUpperCase()) * ENCODING_BASE;
    if (firstLngValue >= LONGITUDE_MAX * 2) return false;
  }
  return true;
}

function locationToIntegers(latitude, longitude) {
  let latVal = Math.floor(latitude * FINAL_LAT_PRECISION);
  latVal += LATITUDE_MAX * FINAL_LAT_PRECISION;
  if (latVal < 0) {
    latVal = 0;
  } else if (latVal >= 2 * LATITUDE_MAX * FINAL_LAT_PRECISION) {
    latVal = 2 * LATITUDE_MAX * FINAL_LAT_PRECISION - 1;
  }
  let lngVal = Math.floor(longitude * FINAL_LNG_PRECISION);
  lngVal += LONGITUDE_MAX * FINAL_LNG_PRECISION;
  if (lngVal < 0) {
    lngVal =
      (lngVal % (2 * LONGITUDE_MAX * FINAL_LNG_PRECISION)) +
      2 * LONGITUDE_MAX * FINAL_LNG_PRECISION;
  } else if (lngVal >= 2 * LONGITUDE_MAX * FINAL_LNG_PRECISION) {
    lngVal = lngVal % (2 * LONGITUDE_MAX * FINAL_LNG_PRECISION);
  }
  return [latVal, lngVal];
}

function encodeIntegers(latInt, lngInt, codeLength) {
  if (typeof codeLength === "undefined") {
    codeLength = CODE_PRECISION_NORMAL;
  } else {
    codeLength = Math.min(MAX_DIGIT_COUNT, Number(codeLength));
  }
  if (isNaN(latInt) || isNaN(lngInt) || isNaN(codeLength)) {
    throw new Error("ValueError: Parameters are not numbers");
  }
  if (
    codeLength < MIN_DIGIT_COUNT ||
    (codeLength < PAIR_CODE_LENGTH && codeLength % 2 === 1)
  ) {
    throw new Error("IllegalArgumentException: Invalid Open Location Code length");
  }

  const code = new Array(MAX_DIGIT_COUNT + 1);
  code[SEPARATOR_POSITION] = SEPARATOR;

  if (codeLength > PAIR_CODE_LENGTH) {
    for (let i = MAX_DIGIT_COUNT - PAIR_CODE_LENGTH; i >= 1; i--) {
      const latDigit = latInt % GRID_ROWS;
      const lngDigit = lngInt % GRID_COLUMNS;
      const ndx = latDigit * GRID_COLUMNS + lngDigit;
      code[SEPARATOR_POSITION + 2 + i] = CODE_ALPHABET.charAt(ndx);
      latInt = Math.floor(latInt / GRID_ROWS);
      lngInt = Math.floor(lngInt / GRID_COLUMNS);
    }
  } else {
    latInt = Math.floor(latInt / Math.pow(GRID_ROWS, GRID_CODE_LENGTH));
    lngInt = Math.floor(lngInt / Math.pow(GRID_COLUMNS, GRID_CODE_LENGTH));
  }

  code[SEPARATOR_POSITION + 1] = CODE_ALPHABET.charAt(latInt % ENCODING_BASE);
  code[SEPARATOR_POSITION + 2] = CODE_ALPHABET.charAt(lngInt % ENCODING_BASE);
  latInt = Math.floor(latInt / ENCODING_BASE);
  lngInt = Math.floor(lngInt / ENCODING_BASE);

  for (let i = PAIR_CODE_LENGTH / 2 + 1; i >= 0; i -= 2) {
    code[i] = CODE_ALPHABET.charAt(latInt % ENCODING_BASE);
    code[i + 1] = CODE_ALPHABET.charAt(lngInt % ENCODING_BASE);
    latInt = Math.floor(latInt / ENCODING_BASE);
    lngInt = Math.floor(lngInt / ENCODING_BASE);
  }

  if (codeLength >= SEPARATOR_POSITION) {
    return code.slice(0, codeLength + 1).join("");
  }
  return (
    code.slice(0, codeLength).join("") +
    Array(SEPARATOR_POSITION - codeLength + 1).join(PADDING_CHARACTER) +
    SEPARATOR
  );
}

export function encode(latitude, longitude, codeLength) {
  const [latInt, lngInt] = locationToIntegers(Number(latitude), Number(longitude));
  return encodeIntegers(latInt, lngInt, codeLength);
}

function makeCodeArea(latitudeLo, longitudeLo, latitudeHi, longitudeHi, codeLength) {
  return {
    latitudeLo,
    longitudeLo,
    latitudeHi,
    longitudeHi,
    codeLength,
    latitudeCenter: Math.min(
      latitudeLo + (latitudeHi - latitudeLo) / 2,
      LATITUDE_MAX,
    ),
    longitudeCenter: Math.min(
      longitudeLo + (longitudeHi - longitudeLo) / 2,
      LONGITUDE_MAX,
    ),
  };
}

export function decode(code) {
  if (!isFull(code)) {
    throw new Error(
      `IllegalArgumentException: Passed Plus Code is not a valid full code: ${code}`,
    );
  }
  code = code.replace("+", "").replace(/0/g, "").toLocaleUpperCase("en-US");

  let normalLat = -LATITUDE_MAX * PAIR_PRECISION;
  let normalLng = -LONGITUDE_MAX * PAIR_PRECISION;
  let gridLat = 0;
  let gridLng = 0;
  let digits = Math.min(code.length, PAIR_CODE_LENGTH);
  let pv = PAIR_FIRST_PLACE_VALUE;
  for (let i = 0; i < digits; i += 2) {
    normalLat += CODE_ALPHABET.indexOf(code.charAt(i)) * pv;
    normalLng += CODE_ALPHABET.indexOf(code.charAt(i + 1)) * pv;
    if (i < digits - 2) pv /= ENCODING_BASE;
  }
  let latPrecision = pv / PAIR_PRECISION;
  let lngPrecision = pv / PAIR_PRECISION;

  if (code.length > PAIR_CODE_LENGTH) {
    let rowpv = GRID_LAT_FIRST_PLACE_VALUE;
    let colpv = GRID_LNG_FIRST_PLACE_VALUE;
    digits = Math.min(code.length, MAX_DIGIT_COUNT);
    for (let i = PAIR_CODE_LENGTH; i < digits; i++) {
      const digitVal = CODE_ALPHABET.indexOf(code.charAt(i));
      const row = Math.floor(digitVal / GRID_COLUMNS);
      const col = digitVal % GRID_COLUMNS;
      gridLat += row * rowpv;
      gridLng += col * colpv;
      if (i < digits - 1) {
        rowpv /= GRID_ROWS;
        colpv /= GRID_COLUMNS;
      }
    }
    latPrecision = rowpv / FINAL_LAT_PRECISION;
    lngPrecision = colpv / FINAL_LNG_PRECISION;
  }

  const lat = normalLat / PAIR_PRECISION + gridLat / FINAL_LAT_PRECISION;
  const lng = normalLng / PAIR_PRECISION + gridLng / FINAL_LNG_PRECISION;
  return makeCodeArea(
    lat,
    lng,
    lat + latPrecision,
    lng + lngPrecision,
    Math.min(code.length, MAX_DIGIT_COUNT),
  );
}

export function recoverNearest(shortCode, referenceLatitude, referenceLongitude) {
  if (!isShort(shortCode)) {
    if (isFull(shortCode)) return shortCode.toUpperCase();
    throw new Error(`ValueError: Passed short code is not valid: ${shortCode}`);
  }
  referenceLatitude = Number(referenceLatitude);
  referenceLongitude = Number(referenceLongitude);
  if (isNaN(referenceLatitude) || isNaN(referenceLongitude)) {
    throw new Error("ValueError: Reference position are not numbers");
  }
  referenceLatitude = clipLatitude(referenceLatitude);
  referenceLongitude = normalizeLongitude(referenceLongitude);

  shortCode = shortCode.toUpperCase();
  const paddingLength = SEPARATOR_POSITION - shortCode.indexOf(SEPARATOR);
  const resolution = Math.pow(20, 2 - paddingLength / 2);
  const halfResolution = resolution / 2.0;

  const codeArea = decode(
    encode(referenceLatitude, referenceLongitude).substr(0, paddingLength) +
      shortCode,
  );

  if (
    referenceLatitude + halfResolution < codeArea.latitudeCenter &&
    codeArea.latitudeCenter - resolution >= -LATITUDE_MAX
  ) {
    codeArea.latitudeCenter -= resolution;
  } else if (
    referenceLatitude - halfResolution > codeArea.latitudeCenter &&
    codeArea.latitudeCenter + resolution <= LATITUDE_MAX
  ) {
    codeArea.latitudeCenter += resolution;
  }

  if (referenceLongitude + halfResolution < codeArea.longitudeCenter) {
    codeArea.longitudeCenter -= resolution;
  } else if (referenceLongitude - halfResolution > codeArea.longitudeCenter) {
    codeArea.longitudeCenter += resolution;
  }

  return encode(
    codeArea.latitudeCenter,
    codeArea.longitudeCenter,
    codeArea.codeLength,
  );
}
