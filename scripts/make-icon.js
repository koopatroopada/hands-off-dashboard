'use strict';

/**
 * 生成桌面快捷方式用的图标（不引入任何依赖）。
 * 256×256 圆角深底 + 四条卡片条，配色取自 index.html 的 --frame / --accent。
 * 输出 assets/icon.ico（单尺寸 PNG-in-ICO，Win10+ 可直接用）和 assets/icon.png（预览）。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const W = 256;
const H = 256;
const px = new Uint8Array(W * H * 4);

function blend(x, y, r, g, b, a) {
  if (a <= 0) return;
  const i = (y * W + x) * 4;
  const da = px[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  px[i] = Math.round((r * a + px[i] * da * (1 - a)) / oa);
  px[i + 1] = Math.round((g * a + px[i + 1] * da * (1 - a)) / oa);
  px[i + 2] = Math.round((b * a + px[i + 2] * da * (1 - a)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

/** 圆角矩形有符号距离场，用来做 1px 抗锯齿 */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function roundRect(cx, cy, hw, hh, r, color, alpha = 1) {
  const [R, G, B] = color;
  const x0 = Math.max(0, Math.floor(cx - hw - 2));
  const x1 = Math.min(W - 1, Math.ceil(cx + hw + 2));
  const y0 = Math.max(0, Math.floor(cy - hh - 2));
  const y1 = Math.min(H - 1, Math.ceil(cy + hh + 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = sdRoundRect(x + 0.5, y + 0.5, cx, cy, hw, hh, r);
      const cover = Math.min(1, Math.max(0, 0.5 - d));
      if (cover > 0) blend(x, y, R, G, B, alpha * cover);
    }
  }
}

// 底板：#0b1d2b → #081124 的竖向渐变
const top = [11, 29, 43];
const bottom = [8, 17, 36];
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
  const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
  const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
  for (let x = 0; x < W; x++) {
    const d = sdRoundRect(x + 0.5, y + 0.5, 128, 128, 112, 112, 56);
    const cover = Math.min(1, Math.max(0, 0.5 - d));
    if (cover > 0) blend(x, y, r, g, b, cover);
  }
}

// 卡片条：标题 + 三条待办，最后一条用品牌蓝
roundRect(128, 74, 72, 13, 7, [255, 255, 255], 0.95);
roundRect(128, 116, 72, 11, 5.5, [255, 255, 255], 0.55);
roundRect(110, 150, 54, 11, 5.5, [255, 255, 255], 0.42);
roundRect(118, 184, 62, 11, 5.5, [0, 113, 227], 1);

/* ── PNG 编码 ─────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng() {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = 0; // 0 表示 256
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset

  return Buffer.concat([header, entry, png]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const png = encodePng();
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(png));

console.log('已生成', path.join(outDir, 'icon.ico'), `${png.length} B`);
