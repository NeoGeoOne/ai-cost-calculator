// Shared helpers for the headless tests (Playwright + node:test)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The single page with its views: start page, cost calculator (#aihow), technical view (#toca). */
export const PAGES = { start: 'index.html', aihow: 'index.html#aihow', toca: 'index.html#toca' };
export const url = (rel) => 'file://' + path.join(ROOT, rel);

export const launch = () => chromium.launch();

/** Opens a view via file:// and collects console and page errors. */
export async function open(browser, rel, { width = 1200, height = 900, query = '' } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  const [file, hash] = rel.split('#');
  await page.goto(url(file) + query + (hash ? '#' + hash : ''));
  await page.waitForTimeout(300);
  return { page, errors };
}

/** Switches the view via the address, like a click on a # link. */
export async function go(page, view) {
  await page.evaluate((v) => (location.hash = v === 'start' ? '' : '#' + v), view);
  await page.waitForTimeout(250);
}

/** Visible means rendered: a display:none on an ancestor counts too. */
export const visible = (page, selector) => page.$eval(selector, (e) => e.getClientRects().length > 0);

/** Sets a visually hidden radio button or checkbox and fires change. */
export const choose = (page, selector, checked = true) =>
  page.$eval(
    selector,
    (e, c) => {
      e.checked = c;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    checked,
  );

/** Sets the value of a field and fires change. */
export const setValue = (page, selector, value) =>
  page.$eval(
    selector,
    (e, v) => {
      e.value = v;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    value,
  );

export const text = async (page, selector) => (await page.textContent(selector)).replace(/\s+/g, ' ').trim();

/** Euro amount from "2.769 €" or "7,97 €" (German format) as a number. */
export const euro = (s) =>
  Number(
    s
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, '')
      .replace(',', '.'),
  );

/** Relative links that point to no file (folders do not count, via file:// they only open a listing). */
export async function brokenLinks(page, rel) {
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const dir = path.dirname(path.join(ROOT, rel.split('#')[0]));
  return hrefs
    .filter((h) => !/^(https?:|#|mailto:)/.test(h))
    .filter((h) => {
      const t = path.resolve(dir, h.split('#')[0].split('?')[0]);
      return !fs.existsSync(t) || fs.statSync(t).isDirectory();
    });
}
