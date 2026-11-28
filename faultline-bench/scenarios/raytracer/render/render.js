'use strict';

// Usage: node render.js <workspaceDir> <outFile.png>
// Renders the fixed scene at 320x240 with the agent's tracer (left) next to the
// reference solution (right), with a caption giving the share of matching pixels.
// Never throws on broken agent code: the failure is drawn into the image instead.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const RW = 320;
const RH = 240;
const CAPTION = 36;
const W = RW * 2;
const H = RH + CAPTION;
const TOLERANCE = 24; // max per-channel difference for a pixel to count as matching

const v = (x, y, z) => ({ x, y, z });
const SCENE = {
  camera: { origin: v(0, 1.4, 5), lookAt: v(0, 0.7, 0), fov: 45 },
  light: { position: v(-5, 5, 1), intensity: 1 },
  ambient: 0.1,
  background: v(0.55, 0.7, 0.9),
  objects: [
    { type: 'plane', point: v(0, 0, 0), normal: v(0, 1, 0), color: v(0.75, 0.75, 0.7), reflectivity: 0 },
    { type: 'sphere', center: v(-1.1, 0.7, 0), radius: 0.7, color: v(0.9, 0.15, 0.1), reflectivity: 0 },
    { type: 'sphere', center: v(0.9, 0.9, -0.4), radius: 0.9, color: v(0.85, 0.85, 0.9), reflectivity: 0.8 },
    { type: 'sphere', center: v(0.2, 0.35, 1.3), radius: 0.35, color: v(0.15, 0.3, 0.9), reflectivity: 0 },
  ],
};

// Runs the agent's render() in a child process so an infinite loop or a crash cannot take this script down.
const CHILD = `
const path = require('node:path');
const [ws, sceneJson, w, h] = process.argv.slice(-4);
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true; // keep stray console.log output out of the pixel stream
const { render } = require(path.join(ws, 'src', 'trace.js'));
const img = render(JSON.parse(sceneJson), Number(w), Number(h));
const n = w * h * 3;
const got = img && img.pixels ? img.pixels.length : typeof img;
if (got !== n) throw new Error('render() returned ' + got + ' pixel values, expected ' + n);
write(Buffer.from(Array.from(img.pixels, (p) => p & 255)));
`;

function renderAgent(ws) {
  const r = spawnSync(process.execPath, ['-e', CHILD, ws, JSON.stringify(SCENE), String(RW), String(RH)], {
    timeout: 15000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  if (r.error && r.error.code === 'ETIMEDOUT') throw new Error('render() did not finish within 15 s');
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const lines = String(r.stderr).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    throw new Error(lines.find((l) => /^\w*Error\b/.test(l)) || lines.pop() || `exit code ${r.status}`);
  }
  return r.stdout.subarray(-RW * RH * 3);
}

function renderReference() {
  const { render } = require(path.join(__dirname, '..', 'solution', 'src', 'trace.js'));
  return Buffer.from(render(SCENE, RW, RH).pixels);
}

// 3x5 bitmap font: 15 bits per glyph, rows top to bottom.
const FONT = {};
'A010101111101101 B110101110101110 C011100100100011 D110101101101110 E111100110100111 F111100110100100 G011100101101011 H101101111101101 I111010010010111 J001001001101010 K101101110101101 L100100100100111 M101111111101101 N110101101101101 O010101101101010 P110101110100100 Q010101101110011 R110101110101101 S011100010001110 T111010010010010 U101101101101111 V101101101101010 W101101111111101 X101101010101101 Y101101010010010 Z111001010100111 0111101101101111 1010110010010111 2110001010100111 3110001010001110 4101101111001001 5111100110001110 6011100111101111 7111001010010010 8111101111101111 9111101111001110 .000000000000010 :000010000010000 -000000111000000 %101001010100101 (001010010010001 )100010010010100 /001001010100100 ,000000000010100 =000111000111000 _000000000000111 <001010100010001 >100010001010100 ?110001010000010 !010010010000010 \'010010000000000 "101101000000000 [011010010010011 ]110010010010110 +000010111010000 *000101010101000'
  .split(' ')
  .forEach((g) => (FONT[g[0]] = g.slice(1)));
FONT[' '] = '0'.repeat(15);

function fillRect(buf, x0, y0, w, h, rgb) {
  for (let y = Math.max(0, y0); y < Math.min(H, y0 + h); y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + w); x++) buf.set(rgb, (y * W + x) * 3);
}

function drawText(buf, x, y, text, rgb, s = 2) {
  for (const ch of String(text).toUpperCase()) {
    const g = FONT[ch] || FONT['?'];
    for (let i = 0; i < 15; i++) if (g[i] === '1') fillRect(buf, x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s, rgb);
    x += 4 * s;
  }
}

function blit(buf, pixels, x0) {
  for (let y = 0; y < RH; y++) pixels.copy(buf, (y * W + x0) * 3, y * RW * 3, (y + 1) * RW * 3);
}

function drawFailure(buf, x0, message) {
  fillRect(buf, x0, 0, RW, RH, [70, 0, 0]);
  drawText(buf, x0 + 10, 30, 'render failed:', [255, 90, 90]);
  const words = String(message).replace(/\s+/g, ' ').split(' ');
  const lines = [''];
  for (const w of words) {
    if ((lines[lines.length - 1] + ' ' + w).trim().length > 37) lines.push('');
    lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + w).trim().slice(0, 37);
  }
  lines.slice(0, 14).forEach((l, i) => drawText(buf, x0 + 10, 56 + i * 13, l, [255, 220, 220]));
}

const meanBrightness = (px) => px.reduce((s, p) => s + p, 0) / px.length / 255;

function compose(ws) {
  const buf = Buffer.alloc(W * H * 3);
  let ref = null;
  let mine = null;
  try {
    ref = renderReference();
    blit(buf, ref, RW);
  } catch (e) {
    drawFailure(buf, RW, `reference: ${e.message}`);
  }
  try {
    mine = renderAgent(ws);
    blit(buf, mine, 0);
  } catch (e) {
    drawFailure(buf, 0, e.message);
  }
  for (const [x, label] of [[0, 'your code'], [RW, 'reference']]) {
    fillRect(buf, x + 6, 6, label.length * 8 + 8, 18, [0, 0, 0]);
    drawText(buf, x + 10, 10, label, [255, 255, 255]);
  }
  fillRect(buf, RW - 1, 0, 2, RH, [0, 0, 0]);

  let caption = 'raytracer: render failed';
  let ok = false;
  if (mine && ref) {
    let match = 0;
    for (let k = 0; k < mine.length; k += 3) {
      const d = Math.max(Math.abs(mine[k] - ref[k]), Math.abs(mine[k + 1] - ref[k + 1]), Math.abs(mine[k + 2] - ref[k + 2]));
      if (d <= TOLERANCE) match++;
    }
    const pct = (100 * match) / (RW * RH);
    ok = pct >= 99;
    caption = `raytracer: ${pct.toFixed(1)}% pixels match  mean ${meanBrightness(mine).toFixed(3)} (ref ${meanBrightness(ref).toFixed(3)})`;
  }
  fillRect(buf, 0, RH, W, CAPTION, ok ? [10, 60, 20] : [90, 10, 10]);
  drawText(buf, 12, RH + 13, caption, [255, 255, 255]);
  return buf;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

function encodePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolor RGB, deflate, no filter, no interlace
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter byte 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (require.main === module) {
  const [ws, outFile] = process.argv.slice(2);
  if (!ws || !outFile) {
    console.error('usage: node render.js <workspaceDir> <outFile.png>');
    process.exit(2);
  }
  let buf;
  try {
    buf = compose(path.resolve(ws));
  } catch (e) {
    buf = Buffer.alloc(W * H * 3);
    drawFailure(buf, 0, e.message);
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, encodePng(W, H, buf));
}
