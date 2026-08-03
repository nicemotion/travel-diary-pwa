// zip.js — minimal ZIP writer/reader (STORE method only, no compression).
// No external libraries: needed to stay fully offline-capable.
// Produces/reads standard, valid .zip files (readable by any unzip tool).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, dosDate };
}

function writeUint32LE(view, offset, value) { view.setUint32(offset, value, true); }
function writeUint16LE(view, offset, value) { view.setUint16(offset, value, true); }

/**
 * Creates a ZIP Blob from a list of { name, data } entries.
 * `data` must be a Uint8Array.
 */
export function createZip(entries) {
  const { time, dosDate } = dosDateTime();
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const localHeader = new ArrayBuffer(30);
    const lv = new DataView(localHeader);
    writeUint32LE(lv, 0, 0x04034b50);
    writeUint16LE(lv, 4, 20);
    writeUint16LE(lv, 6, 0);
    writeUint16LE(lv, 8, 0); // STORE = no compression
    writeUint16LE(lv, 10, time);
    writeUint16LE(lv, 12, dosDate);
    writeUint32LE(lv, 14, crc);
    writeUint32LE(lv, 18, size);
    writeUint32LE(lv, 22, size);
    writeUint16LE(lv, 26, nameBytes.length);
    writeUint16LE(lv, 28, 0);

    localParts.push(new Uint8Array(localHeader), nameBytes, data);

    const centralHeader = new ArrayBuffer(46);
    const cv = new DataView(centralHeader);
    writeUint32LE(cv, 0, 0x02014b50);
    writeUint16LE(cv, 4, 20);
    writeUint16LE(cv, 6, 20);
    writeUint16LE(cv, 8, 0);
    writeUint16LE(cv, 10, 0);
    writeUint16LE(cv, 12, time);
    writeUint16LE(cv, 14, dosDate);
    writeUint32LE(cv, 16, crc);
    writeUint32LE(cv, 20, size);
    writeUint32LE(cv, 24, size);
    writeUint16LE(cv, 28, nameBytes.length);
    writeUint16LE(cv, 30, 0);
    writeUint16LE(cv, 32, 0);
    writeUint16LE(cv, 34, 0);
    writeUint16LE(cv, 36, 0);
    writeUint32LE(cv, 38, 0);
    writeUint32LE(cv, 42, offset);

    centralParts.push(new Uint8Array(centralHeader), nameBytes);

    offset += localHeader.byteLength + nameBytes.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const p of centralParts) centralSize += p.length;

  const end = new ArrayBuffer(22);
  const ev = new DataView(end);
  writeUint32LE(ev, 0, 0x06054b50);
  writeUint16LE(ev, 4, 0);
  writeUint16LE(ev, 6, 0);
  writeUint16LE(ev, 8, entries.length);
  writeUint16LE(ev, 10, entries.length);
  writeUint32LE(ev, 12, centralSize);
  writeUint32LE(ev, 16, centralStart);
  writeUint16LE(ev, 20, 0);

  return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type: 'application/zip' });
}

/**
 * Reads a ZIP file (STORE entries only, which is all createZip produces).
 * Returns an array of { name, data: Uint8Array }.
 */
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);

  // find End Of Central Directory record by scanning from the end
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid zip file');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralStart = view.getUint32(eocdOffset + 16, true);

  const results = [];
  let ptr = centralStart;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Corrupt central directory');
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(buf.slice(ptr + 46, ptr + 46 + nameLen));

    // read local header to get exact data start (name/extra lengths can differ)
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(localOffset + 18, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.slice(dataStart, dataStart + size);

    results.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return results;
}
