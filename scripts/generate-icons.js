import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

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

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixels(x, y);
      const offset = rowStart + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([signature, chunk("IHDR", ihdrData), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

const BG = [51, 112, 255]; // 飞书蓝
const WHITE = [255, 255, 255];

function iconPixels(size) {
  const pad = Math.round(size * 0.18);
  const foldSize = Math.round(size * 0.22);
  const docLeft = pad;
  const docRight = size - pad;
  const docTop = pad;
  const docBottom = size - pad;

  return (x, y) => {
    const inDoc = x >= docLeft && x < docRight && y >= docTop && y < docBottom;
    if (!inDoc) return [...BG, 255];

    // 右上角折角：折角三角区域露出背景色，其余是白色"文档"
    const dx = x - (docRight - foldSize);
    const dy = y - docTop;
    const inFoldCorner = x >= docRight - foldSize && y < docTop + foldSize && dx > dy;
    if (inFoldCorner) return [...BG, 255];

    return [...WHITE, 255];
  };
}

const sizes = [16, 32, 48, 128];
mkdirSync("icons", { recursive: true });
for (const size of sizes) {
  const png = encodePng(size, size, iconPixels(size));
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}
