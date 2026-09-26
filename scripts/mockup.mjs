// Snapshots the papercut mockup page (mockup.html, run by the dev server) into a static page and a screenshot.
// Usage: node scripts/mockup.mjs [outDir]   Env: SMOKE_URL (default http://localhost:5173)
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const [outDir = 'smoke-out/mockup'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${process.env.SMOKE_URL ?? 'http://localhost:5173'}/mockup.html`);
await page.waitForSelector('body[data-ready="1"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/mockup-top.png` });
await page.screenshot({ path: `${outDir}/mockup-full.png`, fullPage: true });
const content = await page.evaluate(() => document.getElementById('page').outerHTML);
// The page's own head (title, fonts, styles) without the module script that built it.
const head = readFileSync('mockup.html', 'utf8').split('<main id="page"></main>')[0];
writeFileSync(`${outDir}/papercut-forest.html`, `${head}${content}\n`);
console.log(`wrote ${outDir}/papercut-forest.html`, errors.length ? `errors: ${errors.join(' | ')}` : 'no errors');
await browser.close();
