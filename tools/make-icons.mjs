// Renders client/public/icon.svg to the PNG icons: node tools/make-icons.mjs client/public
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const svg = readFileSync(dir + '/icon.svg', 'utf8');
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
async function shot(name, size, html) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: `${dir}/${name}`, omitBackground: true });
  console.log(name, size);
}
const full = (s) => svg.replace('<svg ', `<svg width="${s}" height="${s}" `);
await shot('apple-touch-icon.png', 180, full(180));
await shot('icon-192.png', 192, full(192));
await shot('icon-512.png', 512, full(512));
// Maskable: the art inside the 80% safe zone.
await shot('icon-maskable-512.png', 512, `<div style="width:512px;height:512px;background:#BD5C36;display:grid;place-items:center">${svg.replace('<svg ', '<svg width="410" height="410" ')}</div>`);
// Badge: white on transparent, for Android/desktop status bars.
await shot('badge-96.png', 96, `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 512 512"><path d="M256 96 420 236v150a26 26 0 0 1-26 26H118a26 26 0 0 1-26-26V236Z" fill="none" stroke="#fff" stroke-width="44" stroke-linejoin="round"/><path d="M192 300l46 46 84-98" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
await browser.close();
