// Codificador PNG mínimo (Node) para os testes do motor. Sem dependências.
const zlib = require('zlib');
const fs = require('fs');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// data: RGBA (channels 4) ou cinza (channels 1)
function encodePNG(width, height, data, channels = 4) {
  const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePNG(path, width, height, data, channels = 4) {
  fs.writeFileSync(path, encodePNG(width, height, data, channels));
}

// Lê JPG/PNG via `sips` do macOS (converte para BMP 32 bits e decodifica).
function readImageMac(path) {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const tmp = require('path').join(os.tmpdir(), 'ht_' + process.pid + '.bmp');
  execFileSync('sips', ['-s', 'format', 'bmp', path, '--out', tmp], { stdio: 'ignore' });
  const b = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  let h = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  const flip = h > 0;
  h = Math.abs(h);
  const bytes = bpp / 8;
  const stride = Math.ceil((w * bytes) / 4) * 4;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = flip ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const s = off + sy * stride + x * bytes;
      const d = (y * w + x) * 4;
      out[d] = b[s + 2];
      out[d + 1] = b[s + 1];
      out[d + 2] = b[s];
      out[d + 3] = bytes === 4 ? b[s + 3] || 255 : 255;
    }
  }
  return { width: w, height: h, data: out, channels: 4 };
}

module.exports = { encodePNG, writePNG, readImageMac };
