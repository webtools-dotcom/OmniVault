/**
 * Lightweight, zero-dependency QR Code (Model 2) Matrix and SVG Generator.
 * Supports Byte encoding mode with Error Correction (Level L / M).
 */

// Galois Field GF(256) log and antilog tables (primitive polynomial 0x11d)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    EXP_TABLE[i + 255] = val;
    LOG_TABLE[val] = i;
    val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
  }
})();

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function polyMultiply(p1: number[], p2: number[]): number[] {
  const result = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMultiply(p1[i], p2[j]);
    }
  }
  return result;
}

function getGeneratorPolynomial(ecCount: number): number[] {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    poly = polyMultiply(poly, [1, EXP_TABLE[i]]);
  }
  return poly;
}

function computeReedSolomon(data: number[], ecCount: number): number[] {
  const gen = getGeneratorPolynomial(ecCount);
  const remainder = data.concat(new Array(ecCount).fill(0));

  for (let i = 0; i < data.length; i++) {
    const lead = remainder[i];
    if (lead !== 0) {
      for (let j = 0; j < gen.length; j++) {
        remainder[i + j] ^= gfMultiply(gen[j], lead);
      }
    }
  }

  return remainder.slice(data.length);
}

// QR Code version capacities and configurations (Versions 1-4, Level M)
// Version 1: 21x21, 16 data bytes, 10 EC bytes
// Version 2: 25x25, 28 data bytes, 16 EC bytes
// Version 3: 29x29, 44 data bytes, 26 EC bytes
// Version 4: 33x33, 64 data bytes, 36 EC bytes
interface QrConfig {
  version: number;
  size: number;
  /** Data codewords for this version at EC level M, from the spec's table. */
  dataCapacity: number;
  ecCount: number;
  /**
   * Centre of this version's single alignment pattern, as (row, col).
   *
   * Versions 2 to 4 have exactly one, and the spec gives its position through a
   * coordinate list — [6, 18] for version 2 — whose entries are combined
   * pairwise, with the combinations that collide with a finder dropped. For
   * these versions that leaves only the last coordinate paired with itself, so
   * version 2's pattern belongs at (18, 18). Reading the list itself as a
   * coordinate put it at (6, 18) instead: on the timing row, in the data area,
   * and absent from where every decoder looks for it. See D-081.
   */
  alignmentCentre?: number;
}

// Data and EC codeword counts are the spec's values for error correction level
// M. They were each two codewords short, which left the bitstream too small to
// fill the matrix and made every code undecodable.
const QR_CONFIGS: QrConfig[] = [
  { version: 1, size: 21, dataCapacity: 16, ecCount: 10 },
  { version: 2, size: 25, dataCapacity: 28, ecCount: 16, alignmentCentre: 18 },
  { version: 3, size: 29, dataCapacity: 44, ecCount: 26, alignmentCentre: 22 },
  { version: 4, size: 33, dataCapacity: 64, ecCount: 36, alignmentCentre: 26 },
];

/**
 * Generates the 2D boolean module matrix for the given text.
 */
export function generateQrMatrix(text: string): boolean[][] {
  const utf8Bytes = new TextEncoder().encode(text);
  const config =
    QR_CONFIGS.find((c) => c.dataCapacity >= utf8Bytes.length + 3) ||
    QR_CONFIGS[QR_CONFIGS.length - 1];

  const size = config.size;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  // 1. Finder Patterns (7x7 at (0,0), (size-7, 0), (0, size-7))
  const addFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r;
        const mc = col + c;
        if (mr >= 0 && mr < size && mc >= 0 && mc < size) {
          reserved[mr][mc] = true;
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isBlack =
              r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            matrix[mr][mc] = isBlack;
          } else {
            matrix[mr][mc] = false; // Separator
          }
        }
      }
    }
  };

  addFinder(0, 0);
  addFinder(0, size - 7);
  addFinder(size - 7, 0);

  // 2. Alignment Pattern (if version >= 2)
  if (config.alignmentCentre !== undefined) {
    const ar = config.alignmentCentre;
    const ac = config.alignmentCentre;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const mr = ar + r;
        const mc = ac + c;
        if (!reserved[mr][mc]) {
          reserved[mr][mc] = true;
          matrix[mr][mc] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }

  // 3. Timing Patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) {
      reserved[6][i] = true;
      matrix[6][i] = i % 2 === 0;
    }
    if (!reserved[i][6]) {
      reserved[i][6] = true;
      matrix[i][6] = i % 2 === 0;
    }
  }

  // Dark module
  reserved[4 * config.version + 9][8] = true;
  matrix[4 * config.version + 9][8] = true;

  // Reserve format bits areas
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // 4. Encode Payload (Byte Mode)
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Mode indicator 0100 (Byte mode)
  pushBits(0b0100, 4);
  // Character count indicator (8 bits for versions 1-9 in byte mode)
  pushBits(utf8Bytes.length, 8);
  // Data bytes
  for (const b of utf8Bytes) {
    pushBits(b, 8);
  }
  // Terminator bits (up to 4 zeroes)
  const totalDataBits = config.dataCapacity * 8;
  const termLen = Math.min(4, totalDataBits - bits.length);
  for (let i = 0; i < termLen; i++) bits.push(0);
  // Align to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes (0xEC, 0x11)
  const pad = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < totalDataBits) {
    pushBits(pad[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bits to data bytes
  const dataBytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    dataBytes.push(byte);
  }

  // Calculate Reed-Solomon Error Correction bytes
  const ecBytes = computeReedSolomon(dataBytes, config.ecCount);
  const fullCodewords = dataBytes.concat(ecBytes);

  // Convert full codewords to bitstream
  const finalBits: number[] = [];
  for (const byte of fullCodewords) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((byte >> i) & 1);
    }
  }

  // 5. Place Data Bits in Matrix (Zig-zag upward and downward, skipping vertical timing column 6)
  let bitIndex = 0;
  let upwards = true;

  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing line

    const rows = [];
    for (let r = 0; r < size; r++) rows.push(r);
    if (upwards) rows.reverse();

    for (const r of rows) {
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const c = rightCol - colOffset;
        if (!reserved[r][c]) {
          const bit = bitIndex < finalBits.length ? finalBits[bitIndex++] === 1 : false;
          // Apply standard Mask Pattern 0: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          matrix[r][c] = bit !== mask;
        }
      }
    }
    upwards = !upwards;
  }

  // 6. Write Format Information Bits (Mask 0, Error Correction Level M = 00)
  // Format bit sequence for EC M, Mask 0: 101010000010010 (BCH 15,5 error-corrected)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  // Around top-left finder
  for (let i = 0; i < 6; i++) matrix[8][i] = formatBits[i] === 1;
  matrix[8][7] = formatBits[6] === 1;
  matrix[8][8] = formatBits[7] === 1;
  matrix[7][8] = formatBits[8] === 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = formatBits[i] === 1;

  // Around top-right and bottom-left finders. The second copy runs the other
  // way round from the first: bits 0-7 go UP column 8 from the bottom, and bits
  // 8-14 go along row 8 to the right edge. These two were swapped, which left a
  // decoder unable to read the mask and error-correction level and so unable to
  // read anything at all. See D-081.
  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = formatBits[i] === 1;
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = formatBits[i] === 1;

  // Convert matrix nulls to false
  return matrix.map((row) => row.map((cell) => cell === true));
}

/**
 * Returns an SVG path string representing the black modules.
 */
export function generateQrPath(matrix: boolean[][]): string {
  const size = matrix.length;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        path += `M${c},${r}h1v1h-1z `;
      }
    }
  }
  return path;
}
