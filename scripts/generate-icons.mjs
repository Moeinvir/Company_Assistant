/**
 * One-off rasteriser for the PWA icon set: renders the source SVGs at every
 * size the manifest and iOS reference. Run after changing an icon:
 *
 *   node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const iconsDir = path.resolve("public/icons");
await mkdir(iconsDir, { recursive: true });

const rounded = await readFile(path.join(iconsDir, "icon.svg"));
const maskable = await readFile(path.join(iconsDir, "icon-maskable.svg"));

const render = (input, size, output) =>
  sharp(input).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(iconsDir, output));

await Promise.all([
  render(rounded, 192, "icon-192.png"),
  render(rounded, 512, "icon-512.png"),
  render(maskable, 512, "maskable-512.png"),
  render(maskable, 180, "apple-touch-icon.png"),
]);

console.log("icons written to public/icons");
