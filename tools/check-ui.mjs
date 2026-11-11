// Headless WebKit (Safari's engine) at phone widths: signs in for real, visits every
// screen, adds and ticks things the way a thumb would, and fails on sideways scrolling,
// a blank page or a page error. Screenshots go to [dir].
//   node tools/check-ui.mjs <url> <user> <password> [dir]
// Needs a seeded scratch copy (tools/seed-demo.mjs): it changes data. PROBE=1 plants a
// wide box to prove the overflow check can fail.
import { webkit } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const [url, username, password, dir = 'screens'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const exe = `${homedir()}/.cache/ms-playwright/webkit-2336/pw_run.sh`;
const browser = await webkit.launch({ executablePath: exe });
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log('  ✗ ' + msg);
};

async function measure(page, name, width) {
  await page.waitForTimeout(500);
  if (process.env.PROBE) await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="width:2000px;height:5px"></div>'));
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.chips.slide, .roomscroll, .strip');
      })
      .filter((e, _, all) => !all.some((o) => o !== e && e.contains(o)))
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`);
    const small = [...document.querySelectorAll('button, a, input:not([type=file]), select')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && (b.height < 32 || b.width < 32);
      })
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20)}"`);
    return { vw, sw: document.documentElement.scrollWidth, wide: wide.slice(0, 5), small: small.slice(0, 8), text: document.body.innerText.length };
  });
  await page.screenshot({ path: `${dir}/${width}-${name}.png`, fullPage: true });
  const ok = r.sw <= r.vw && r.text > 80;
  console.log(`${ok ? '✓' : '✗'} ${width}px ${name}: scroll ${r.sw}/${r.vw}, ${r.text} chars`);
  if (r.text <= 80) fail(`${name} looks blank`);
  if (r.sw > r.vw) fail(`${name} scrolls sideways: ${r.wide.join(', ')}`);
  if (r.small.length) console.log(`  small targets: ${r.small.join(' | ')}`);
}

for (const width of [375, 390, 430]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const vs = page.viewportSize();
  if (vs.width !== width) fail(`viewport is ${vs.width}, wanted ${width}`);
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && fail(`console: ${m.text()}`));
  const go = async (path, sel) => {
    await page.goto(url + path);
    await page.waitForSelector(sel, { timeout: 8000 });
  };
  const closeSheet = async () => {
    await page.click('.sheet header button');
    await page.waitForSelector('.sheet', { state: 'detached' });
  };

  await page.goto(url);
  await measure(page, 'login', width);
  await page.click('.seg button:has-text("Password")');
  await page.fill('input[autocomplete=username]', username);
  await page.fill('input[type=password]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForSelector('.jobrow', { timeout: 8000 });
  await measure(page, 'home', width);

  // Add a job with the round button: title, room, done.
  const title = `Check ${width} ${Date.now() % 100000}`;
  await page.click('.fab');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await measure(page, 'job-sheet', width);
  await page.fill('.sheet input[maxlength="140"]', title);
  await page.click('.sheet .chip:has-text("Kitchen")');
  await page.click('.sheet button:has-text("Date, who, cost")');
  await page.waitForTimeout(300);
  await measure(page, 'job-sheet-more', width);
  await page.click('.sheet button.primary');
  await page.waitForSelector('.sheet', { state: 'detached' });

  await page.click('.tabbar button:has-text("Jobs")');
  await page.waitForSelector(`.jobrow:has-text("${title}")`);
  await measure(page, 'jobs', width);
  // Tick it off, and see it leave the list.
  await page.click(`.jobrow:has-text("${title}") button[aria-label^="Done"]`);
  await page.waitForSelector(`.jobrow:has-text("${title}")`, { state: 'detached' });
  await page.click('.seg button:has-text("Done")');
  await page.waitForSelector(`.jobrow:has-text("${title}")`);
  await measure(page, 'jobs-done', width);
  await page.click('.seg button:has-text("To do")');

  // A bigger job: steps, costs, a photo.
  await page.click('.jobrow:has-text("New bathroom") .main');
  await page.waitForSelector('.titleblock h1');
  await page.setInputFiles('input[type=file]', 'client/public/icon-512.png');
  await page.waitForSelector('.strip .thumb img', { timeout: 10000 }).catch(() => fail('photo did not appear after upload'));
  await measure(page, 'job', width);
  await page.click('.costline >> nth=0');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await measure(page, 'cost-sheet', width);
  await closeSheet();
  await page.click('.steptitle >> nth=0');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await measure(page, 'step-sheet', width);
  await closeSheet();

  await go('/rooms', '.roomcard');
  await measure(page, 'rooms', width);
  await page.click('.head button:has-text("Edit")');
  await page.waitForSelector('.sheet');
  await page.waitForTimeout(400);
  await measure(page, 'rooms-edit', width);
  await closeSheet();
  await page.click('.roomcard:has-text("Kitchen")');
  await page.waitForSelector('.hero h1');
  await measure(page, 'room', width);

  for (const [path, name, sel] of [
    ['/shopping', 'shopping', '.line'],
    ['/progress', 'progress', '.hero'],
    ['/more', 'more', '.linkrow'],
    ['/ideas', 'ideas', '.idea'],
    ['/notes', 'notes', '.note'],
    ['/trades', 'trades', '.trade'],
    ['/settings', 'settings', '.pstate'],
  ]) {
    await go(path, sel);
    await measure(page, name, width);
  }
  await go('/trades', '.trade');
  await page.click('.trade >> nth=0');
  await page.waitForSelector('.three');
  await measure(page, 'trade', width);

  if (width === 390) {
    await page.evaluate(() => localStorage.setItem('nest-look', 'dark'));
    await go('/', '.jobrow');
    await measure(page, 'home-dark', width);
    await go('/jobs', '.jobrow');
    await page.click('.jobrow:has-text("New bathroom") .main');
    await page.waitForSelector('.titleblock h1');
    await measure(page, 'job-dark', width);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} problem(s)` : 'All good');
process.exit(failures ? 1 : 0);
