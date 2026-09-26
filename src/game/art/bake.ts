import type Phaser from 'phaser';
import { artCatalogue, type ArtEntry } from '../../core/art/catalogue';

/** Art is drawn this many times its game size, so it stays crisp when the canvas is scaled up. */
export const ART_SCALE = 2;
/** Atlas page size in texture px. */
const PAGE = 2048;
/** Gap between packed frames, so neighbours never bleed into each other when filtered. */
const GAP = 2;

/** Where each baked piece of art lives: its atlas texture and frame name (the art key). */
const baked = new Map<string, { texture: string; w: number; h: number }>();

/** The atlas texture holding `key`, or undefined if that art was never baked (it keeps its plain shape). */
export const bakedArt = (key: string) => baked.get(key);

function loadImage(entry: ArtEntry): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([entry.svg()], { type: 'image/svg+xml' }));
  const img = new Image(entry.w * ART_SCALE, entry.h * ART_SCALE);
  return new Promise((resolve, reject) => {
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`art ${entry.key} failed to render`));
    img.src = url;
  });
}

/**
 * Renders every catalogue SVG once and packs them, shelf by shelf, into a few atlas pages
 * registered as canvas textures; each piece becomes a frame named by its art key. Done once per
 * page load: later runs reuse the textures.
 */
export async function bakeArt(scene: Phaser.Scene, onProgress?: (share: number) => void): Promise<void> {
  if (baked.size) return;
  const entries = artCatalogue();
  // Tallest first packs shelves tightly.
  const sorted = [...entries].sort((a, b) => b.h - a.h || b.w - a.w);
  let done = 0;
  const images = await Promise.all(
    sorted.map((e) =>
      loadImage(e).then((img) => {
        onProgress?.(++done / sorted.length);
        return img;
      }),
    ),
  );
  let page = -1;
  let ctx: CanvasRenderingContext2D | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let x = PAGE;
  let y = 0;
  let shelf = 0;
  const frames: { page: number; key: string; x: number; y: number; w: number; h: number }[] = [];
  const pages: HTMLCanvasElement[] = [];
  sorted.forEach((entry, i) => {
    const w = entry.w * ART_SCALE;
    const h = entry.h * ART_SCALE;
    if (x + w > PAGE) {
      x = 0;
      y += shelf + GAP;
      shelf = 0;
    }
    if (!canvas || y + h > PAGE) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = PAGE;
      ctx = canvas.getContext('2d')!;
      pages.push(canvas);
      page++;
      x = y = shelf = 0;
    }
    ctx!.drawImage(images[i], x, y, w, h);
    frames.push({ page, key: entry.key, x, y, w, h });
    x += w + GAP;
    shelf = Math.max(shelf, h);
  });
  pages.forEach((c, p) => {
    const texture = scene.textures.addCanvas(`paper${p}`, c)!;
    for (const f of frames.filter((f) => f.page === p)) {
      texture.add(f.key, 0, f.x, f.y, f.w, f.h);
      baked.set(f.key, { texture: `paper${p}`, w: f.w / ART_SCALE, h: f.h / ART_SCALE });
    }
  });
}
