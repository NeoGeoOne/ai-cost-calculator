// Page behavior in the browser: views, walkthrough, persistence, import, absence of errors
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, open, go, visible, choose, setValue, text, euro, brokenLinks, url, PAGES, ROOT } from './helpers.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

const toResult = async (page) => {
  await page.click('[data-step="0"] [data-next]');
  await page.click('[data-step="1"] [data-next]');
  await page.click('[data-step="2"] [data-next]');
  await page.waitForTimeout(300);
};

test('Start page loads without errors, links point to files, views switch via the address', async () => {
  const { page, errors } = await open(browser, PAGES.start);
  assert.deepEqual(await brokenLinks(page, PAGES.start), []);
  assert.equal(await visible(page, '#view-start'), true);
  assert.equal(await visible(page, '#view-aihow'), false);
  assert.equal(await visible(page, '#report'), false);
  await page.click('a[href="#aihow"]');
  await page.waitForTimeout(250);
  assert.equal(await visible(page, '#view-aihow'), true);
  assert.equal(await visible(page, '#view-start'), false);
  assert.match(await text(page, 'header nav a.on'), /Kostenrechner/);
  assert.match(await page.title(), /Kostenrechner/);
  assert.equal(
    await page.$eval('#expertToggle', (a) => a.getAttribute('href')),
    '#aihow',
    'link target stays the cost calculator',
  );
  await go(page, 'toca');
  assert.equal(await visible(page, '#view-toca'), true);
  assert.equal(await visible(page, '#expertToggle'), false, 'advanced assumptions only in the cost calculator');
  await go(page, 'start');
  assert.equal(await visible(page, '#view-start'), true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Start page and cost calculator stay free of page errors after several seconds', async () => {
  const { page, errors } = await open(browser, PAGES.start);
  await page.waitForTimeout(7000);
  await go(page, 'aihow');
  await page.waitForTimeout(1000);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Unknown and malformed addresses land on the start page', async () => {
  const { page, errors } = await open(browser, PAGES.start);
  for (const h of ['#constructor', '#__proto__', '#toString', '#gibtesnicht']) {
    await page.evaluate((v) => (location.hash = v), h);
    await page.waitForTimeout(150);
    assert.equal(await visible(page, '#view-start'), true, h);
    assert.match(await page.title(), /Eigene KI/, h);
  }
  assert.deepEqual(errors, []);
  await page.close();
});

test('Readability: white text sits on a dark background in both color schemes', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme });
    const page = await ctx.newPage();
    await page.goto(url(PAGES.aihow));
    await page.waitForTimeout(300);
    await toResult(page);
    const ratios = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c
          .match(/\d+/g)
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bg = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)/.test(c)) return c;
        }
        return 'rgb(255, 255, 255)';
      };
      return ['#bigRec .dev', '#view-aihow button.pri', '#view-aihow .steps div::before', '#packs .card em'].map(
        (sel) => {
          const pseudo = sel.includes('::') ? '::before' : null;
          const el = document.querySelector(sel.replace('::before', ''));
          const st = getComputedStyle(el, pseudo);
          const fg = lum(st.color),
            bgc = lum(pseudo ? st.backgroundColor : bg(el));
          return [sel, Math.round(((Math.max(fg, bgc) + 0.05) / (Math.min(fg, bgc) + 0.05)) * 100) / 100];
        },
      );
    });
    for (const [sel, ratio] of ratios) assert.ok(ratio >= 4.5, `${colorScheme}: ${sel} Kontrast ${ratio}`);
    await ctx.close();
  }
});

test('Data view: all devices, models, tariffs and assumptions are listed in tables with a source', async () => {
  const { page, errors } = await open(browser, PAGES.start.replace(/$/, '#daten'));
  assert.equal(await visible(page, '#view-daten'), true);
  assert.match(await text(page, 'header nav a.on'), /Daten/);
  const n = await page.evaluate(() => ({
    dev: document.querySelectorAll('#dDevices tbody tr').length,
    mod: document.querySelectorAll('#dModels tbody tr').length,
    cloud: document.querySelectorAll('#dCloud tbody tr').length,
    ass: document.querySelectorAll('#dAssume tbody tr').length,
    D: DEVICES.length,
    M: MODELS.length,
    C: CLOUD.length + RENT.length + 1,
  }));
  assert.equal(n.dev, n.D);
  assert.equal(n.mod, n.M);
  assert.equal(n.cloud, n.C);
  assert.ok(n.ass >= 15, 'assumptions listed');
  const cells = await page.$$eval('#view-daten td.q', (tds) => tds.map((t) => t.textContent.trim()));
  for (const c of cells) assert.ok(c.length > 0, 'every source cell has text');
  assert.equal(await page.$$eval('#view-daten td.miss', (tds) => tds.length), 0, 'no row without a source');
  const links = await page.$$eval('#view-daten td.q a', (as) => as.map((a) => a.getAttribute('href')));
  assert.ok(links.length >= 60, 'sources are linked');
  for (const h of links) assert.match(h, /^https:\/\//, 'source links are absolute https URLs');
  assert.deepEqual(errors, []);
  await page.close();
});

test('No horizontal scrolling: no view is wider than the screen on a narrow phone', async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  for (const v of ['', '#aihow', '#toca', '#daten']) {
    await page.goto(url(PAGES.start) + v);
    await page.waitForTimeout(v === '#toca' ? 800 : 250);
    if (v === '#aihow') {
      await toResult(page);
      await page.click('#expertToggle');
      await page.waitForTimeout(150);
    }
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.equal(w, 360, `view ${v || 'start'} is ${w}px wide`);
  }
  await ctx.close();
});

test('Cost calculator: three steps lead to a recommendation, packages and a report', async () => {
  const { page, errors } = await open(browser, PAGES.aihow);
  assert.equal(await visible(page, '#view-aihow'), true);
  await toResult(page);
  const rec = await text(page, '#bigRec');
  assert.match(rec, /Empfehlung/);
  assert.match(rec, /€/);
  assert.match(rec, /Mitarbeitende reichen damit/);
  const cards = await page.$$eval('#packs .card', (cs) => cs.map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
  assert.ok(cards.length >= 1 && cards.length <= 3, `Karten: ${cards.length}`);
  assert.equal(
    new Set(cards.map((c) => c.replace(/^(Einstieg|Mit Reserve|Nächste Stufe: \w+|Ausbau)(Tipp)?/, ''))).size,
    cards.length,
    'keine zwei gleichen Karten',
  );
  for (const c of cards) assert.match(c, /reicht bis\s*(ca\. \d+|mehr als [\d.]+) Mitarbeitende/, c);
  assert.match(await page.$eval('#report', (e) => e.innerHTML), /Empfehlung/);
  assert.match(await text(page, '#packsSub'), /über 3 Jahre/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Cost calculator: packages get more expensive with the reserve, never cheaper', async () => {
  const { page } = await open(browser, PAGES.aihow);
  await choose(page, 'input[name=data][value="0"]');
  await page.click('[data-step="0"] [data-next]');
  for (const i of [1, 2, 3, 4, 5]) await choose(page, `input[name=task][value="${i}"]`);
  await choose(page, 'input[name=qual][value="1"]');
  await page.click('[data-step="1"] [data-next]');
  await page.fill('#users', '200');
  await choose(page, 'input[name=int][value="2"]');
  await choose(page, 'input[name=ag][value="8"]');
  await page.click('[data-step="2"] [data-next]');
  await page.waitForTimeout(300);
  const cards = await page.$$eval('#packs .card', (cs) =>
    cs.map((c) => ({ capex: c.querySelector('.p')?.textContent, perUser: c.querySelector('li b')?.textContent })),
  );
  assert.ok(cards.length >= 1, 'at least the entry package');
  const capex = cards.map((c) => euro(c.capex)),
    perUser = cards.map((c) => euro(c.perUser));
  for (let i = 1; i < cards.length; i++) {
    assert.ok(capex[i] >= capex[0], `Anschaffung Karte ${i + 1} unter Einstieg: ${capex}`);
    assert.ok(perUser[i] >= perUser[0], `pro Kopf Karte ${i + 1} unter Einstieg: ${perUser}`);
  }
  await page.close();
});

test('Cost calculator: without a task and without automation the result stays locked', async () => {
  const { page } = await open(browser, PAGES.aihow);
  await page.click('[data-step="0"] [data-next]');
  await choose(page, 'input[name=task][value="0"]', false);
  assert.equal(await page.$eval('#next2', (e) => e.disabled), true);
  assert.equal(await page.$eval('#go', (e) => e.disabled), true);
  await choose(page, 'input[name=task][value="0"]', true);
  assert.equal(await page.$eval('#next2', (e) => e.disabled), false);
  await page.close();
});

test('Cost calculator: advanced assumptions open via ?expert, persist after reload and can be reset', async () => {
  const { page } = await open(browser, PAGES.aihow, { query: '?expert' });
  assert.equal(await page.$eval('#expert', (e) => e.classList.contains('hidden')), false);
  assert.ok((await page.$$('#prices tr')).length > 5, 'price table filled');
  await setValue(page, '#kwh', '0.42');
  await setValue(page, '#yrs', '5');
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(await page.$eval('#kwh', (e) => e.value), '0.42');
  assert.equal(await page.$eval('#yrs', (e) => e.value), '5');
  await toResult(page);
  assert.match(await text(page, '#packsSub'), /über 5 Jahre/);
  await page.click('#reset');
  assert.equal(await page.$eval('#yrs', (e) => e.value), '3');
  await page.click('#expertToggle');
  assert.equal(await page.$eval('#expert', (e) => e.classList.contains('hidden')), true);
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('Cost calculator: stored prices are validated on load and cannot inject markup', async () => {
  const { page, errors } = await open(browser, PAGES.aihow, { query: '?expert' });
  const [id0, id1, defaults] = await page.evaluate(() => [SYS0[0].id, SYS0[1].id, [SYS0[0].price, SYS0[0].load]]);
  await page.evaluate(
    ([a, b]) =>
      localStorage.setItem(
        'kostenrechner.prices.v2',
        JSON.stringify({
          [a]: { price: '1"><img id="injected" src=x>', load: -5, n: '<b id="renamed">x</b>' },
          [b]: { price: 1234, load: 99, idle: 7 },
        }),
      ),
    [id0, id1],
  );
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(await page.$('#injected, #renamed'), null, 'no injected element');
  const row = await page.evaluate(() => [
    SYS[0].price,
    SYS[0].load,
    SYS[0].n === SYS0[0].n,
    SYS[1].price,
    SYS[1].load,
    SYS[1].idle,
  ]);
  assert.deepEqual(row, [defaults[0], defaults[1], true, 1234, 99, 7]);
  assert.deepEqual(errors, []);
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('Cost calculator: only changed prices are stored, and edge values in old data are validated', async () => {
  const { page, errors } = await open(browser, PAGES.aihow, { query: '?expert' });
  const [id0, id1, d0, d1] = await page.evaluate(() => [SYS0[0].id, SYS0[1].id, { ...SYS0[0] }, { ...SYS0[1] }]);
  const row = (i) => page.evaluate((j) => [SYS[j].price, SYS[j].load, SYS[j].idle], i);
  const reloadWith = async (key, value) => {
    await page.evaluate(([k, v]) => (localStorage.clear(), localStorage.setItem(k, v)), [key, value]);
    await page.reload();
    await page.waitForTimeout(300);
  };
  await reloadWith('kostenrechner.prices.v2', JSON.stringify({ [id0]: { price: 0, load: 0, idle: -1 }, [id1]: 'x' }));
  assert.deepEqual(await row(0), [d0.price, 0, d0.idle], 'price 0 and negative idle rejected, load 0 kept');
  assert.deepEqual(await row(1), [d1.price, d1.load, d1.idle], 'non-object entry ignored');
  await reloadWith('kostenrechner.prices.v2', 'null');
  assert.deepEqual(await row(0), [d0.price, d0.load, d0.idle], 'null root ignored');
  await setValue(page, '#prices input[data-i="0"][data-k="price"]', String(d0.price + 100));
  const stored = await page.evaluate(() => [
    localStorage.getItem('kostenrechner.prices.v3'),
    localStorage.getItem('kostenrechner.prices.v2'),
  ]);
  assert.deepEqual(JSON.parse(stored[0]), { [id0]: { price: d0.price + 100 } }, 'only the changed value is stored');
  assert.equal(stored[1], null, 'old full snapshot removed');
  await page.click('#reset');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('kostenrechner.prices.v3')),
    null,
    'reset clears stored prices',
  );
  assert.deepEqual(errors, []);
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('Technical view: loads and shows token rate, matrix and chart for all devices without errors', async () => {
  const { page, errors } = await open(browser, PAGES.toca);
  assert.deepEqual(await brokenLinks(page, PAGES.toca), []);
  assert.match(await text(page, '#kpi'), /Token\/s/);
  const devices = await page.evaluate(() => HW.length);
  assert.equal((await page.$$('#matrix tbody tr')).length, devices);
  assert.equal((await page.$$('#chart .row')).length, devices);
  assert.equal(await page.$eval('#hw', (s) => s.options.length), devices);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Technical view: the animation only runs while visible and produces output', async () => {
  const { page, errors } = await open(browser, PAGES.toca);
  await page.waitForTimeout(9000);
  assert.ok((await page.$$('#out span')).length > 0, 'tokens in the output');
  await go(page, 'aihow');
  assert.match(await text(page, '#pause'), /Weiter/, 'paused when leaving');
  await go(page, 'toca');
  assert.match(await text(page, '#pause'), /Pause/, 'resumed when coming back');
  await page.click('#pause');
  assert.match(await text(page, '#pause'), /Weiter/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Technical view: decision model and speculative decoding switch the method', async () => {
  const { page, errors } = await open(browser, PAGES.toca);
  const nimble = await page.$eval('#model', (s) => [...s.options].find((o) => /nimble/.test(o.text)).value);
  await page.selectOption('#model', nimble);
  assert.match(await text(page, '#kpi'), /Entscheidungen\/s/);
  const glm = await page.$eval('#model', (s) => [...s.options].find((o) => /GLM-5.3-Flash/.test(o.text)).value);
  await page.selectOption('#model', glm);
  await page.check('#spec');
  assert.match(await text(page, '#modes'), /Spekulativ/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('Technical view: the Mac memory limit changes usable memory without changing the data', async () => {
  const { page } = await open(browser, PAGES.toca);
  const m6 = await page.$eval('#hw', (s) => [...s.options].find((o) => /Apple M6/.test(o.text)).value);
  await page.selectOption('#hw', m6);
  const before = await page.evaluate(() => usable(HW[S.hw]));
  await page.selectOption('#tMacLim', '.9');
  const after = await page.evaluate(() => usable(HW[S.hw]));
  assert.equal(before, 24);
  assert.ok(Math.abs(after - 28.8) < 1e-9, String(after));
  assert.equal(await page.evaluate(() => HW[S.hw].use), 0.75, 'device data stays unchanged');
  await page.close();
});

test('Technical view: device import rejects malformed input and runs no injected HTML', async () => {
  const { page, errors } = await open(browser, PAGES.toca);
  for (const bad of ['kein json', '"abc"', 'null', '[1,2]', '{"host":"x"}']) {
    await page.fill('#impTxt', bad);
    await page.click('#impBtn');
    assert.match(await text(page, '#impMsg'), /JSON|Erwartet wird/, `input ${bad}`);
    assert.equal((await page.$$('#impList .imp')).length, 0, `no device for ${bad}`);
  }
  await page.fill('#impTxt', JSON.stringify({ v: 1, host: 'komma', ram_gb: '32,5', ram_bw: 40 }));
  await page.click('#impBtn');
  assert.match(await text(page, '#impList'), /komma: CPU 33 GB/, 'decimal comma as in the normalization');
  await page.click('#impList button');
  const evil = {
    v: 1,
    host: '<img src=x onerror="window.__xss=1">',
    cpu: 'x',
    cpu_cores: 4,
    cpu_mhz: 3000,
    cpu_flags: 'avx2',
    ram_gb: '32',
    ram_bw: '<b>40</b>',
    ram_type: '<img src=x onerror="window.__xss=1">',
  };
  await page.fill('#impTxt', JSON.stringify(evil));
  await page.click('#impBtn');
  await page.waitForTimeout(500);
  assert.equal((await page.$$('#impList .imp')).length, 1);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.match(await text(page, '#impList'), /<img src=x/);
  assert.match(await text(page, '#impList'), /40 GB\/s · 32 GB/);
  await page.click('#impList button');
  assert.equal((await page.$$('#impList .imp')).length, 0);
  assert.deepEqual(
    errors.filter((e) => !/ERR_FILE_NOT_FOUND/.test(e)),
    [],
  );
  await page.evaluate(() => localStorage.clear());
  await page.close();
});

test('Data date: from six months after STAND, every view and the report state the age of the data', async () => {
  const stand = fs
    .readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    .match(/const STAND = '(\d{2})\.(\d{2})\.(\d{4})'/);
  const at = (months) => new Date(+stand[3], +stand[2] - 1 + months, +stand[1], 12);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(at(7));
  for (const h of ['', '#aihow', '#toca', '#daten']) {
    await page.goto(url(PAGES.start) + h);
    await page.waitForTimeout(300);
    assert.equal(await visible(page, '#stale'), true, `notice in ${h || 'start page'}`);
    assert.match(await text(page, '#stale'), /Veraltete Daten: .* 7 Monate alt/);
    const s = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      top: document.getElementById('stale').getBoundingClientRect().top,
    }));
    assert.equal(s.w, 360, `${h || 'start page'} without horizontal scrolling`);
    assert.ok(s.top >= 0 && s.top < 200, `notice visible when opening ${h || 'start page'} (top ${s.top})`);
  }
  await page.goto(url(PAGES.aihow));
  await page.waitForTimeout(300);
  await toResult(page);
  assert.match(await text(page, '#report .r-stale'), /7 Monate alt/);
  assert.equal(
    await page.evaluate(() => /github\.com\/NeoGeoOne/i.test(document.documentElement.outerHTML)),
    false,
    'no repository link in the page',
  );
  assert.deepEqual(errors, []);
  await ctx.close();

  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.clock.setFixedTime(at(1));
  await p2.goto(url(PAGES.aihow));
  await p2.waitForTimeout(300);
  assert.equal(await visible(p2, '#stale'), false);
  await toResult(p2);
  assert.equal(await p2.$('#report .r-stale'), null);
  await fresh.close();
});
