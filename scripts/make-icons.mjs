// Generates PWA icons from the logo tile in ui/Login.dc.html (2x3 grid of colored rounded bars).
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

// Mark geometry in "tile units" (the 72px tile from the design): cols 14px, rows 9px, gap 3px.
function mark(cx, cy, k) {
  const cw = 14 * k, rh = 9 * k, g = 3 * k, r = 3 * k;
  const w = cw * 2 + g, h = rh * 3 + g * 2, x0 = cx - w / 2, y0 = cy - h / 2;
  const rect = (col, row, span, fill) =>
    `<rect x="${x0 + col * (cw + g)}" y="${y0 + row * (rh + g)}" width="${cw}" height="${rh * span + g * (span - 1)}" rx="${r}" fill="${fill}"/>`;
  return rect(0, 0, 2, '#007AFF') + rect(1, 0, 1, '#34C759') + rect(1, 1, 2, '#FF9500') + rect(0, 2, 1, '#AF52DE');
}

const svg = (size, { rounded, k }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${rounded ? size * 17 / 72 : 0}" fill="#ffffff"/>${mark(size / 2, size / 2, k)}</svg>`;

const out = 'public/icons/';
const jobs = [
  ['icon-192.png', 192, { rounded: true, k: 192 / 72 * 1.25 }],
  ['icon-512.png', 512, { rounded: true, k: 512 / 72 * 1.25 }],
  ['icon-maskable-512.png', 512, { rounded: false, k: 512 / 72 * 1.0 }],
  ['apple-touch-icon.png', 180, { rounded: false, k: 180 / 72 * 1.25 }]
];
for (const [name, size, opts] of jobs) await sharp(Buffer.from(svg(size, opts))).png().toFile(out + name);
writeFileSync(out + 'favicon.svg', svg(64, { rounded: true, k: 64 / 72 * 1.3 }));
console.log('icons written');
