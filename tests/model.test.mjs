// Properties and formulas of the calculation core, checked in the page context without the UI
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, open, PAGES } from './helpers.mjs';

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser.close();
});

test('Cost model: more employees never cost less, reserve packages never less than the entry package', async () => {
  const { page } = await open(browser, PAGES.aihow);
  const r = await page.evaluate(() => {
    const Ns = [1, 3, 10, 30, 100, 300];
    const bad = [];
    let points = 0;
    for (const mask of [1, 2, 4, 8, 16, 32, 3, 12, 48, 63])
      for (const qual of [0, 1])
        for (const int of [0.4, 2])
          for (const agents of [0, 2, 8]) {
            const tasks = TASKS.filter((t, i) => mask & (1 << i));
            let cls = tasks.reduce((m, t) => Math.max(m, t.c), 0);
            if (agents > 0) cls = Math.max(cls, 1);
            cls = Math.min(3, cls + qual);
            let prev = -1;
            for (const N of Ns) {
              points++;
              const I = {
                data: 1,
                tasks,
                cls,
                N,
                int,
                agents,
                H: 9,
                eta: 0.65,
                tps: 15,
                ttft: 4,
                kwh: 0.3,
                yrs: 3,
                fx: 0.89,
                mac: 0.75,
                kunde: '',
              };
              const p1 = cheapest(cls, I, N);
              if (!p1) {
                prev = Infinity;
                continue;
              }
              const p2 = cheapest(cls, I, Math.ceil(N * 1.5));
              if (p2 && N === 10) {
                // The recommended package is the cheapest of all fitting combinations at 1.5 times the staff
                const N2 = Math.ceil(N * 1.5);
                SYS.forEach((s) =>
                  MOD[cls].forEach((m) => {
                    const r = trySize(s, m, CLS[cls].ctx, I, load(I, N2));
                    if (r.ok && costOf(s, m, r.units, r.bMax, I, load(I, I.N)).tco < p2.tco - 1e-6)
                      bad.push(`recommended is not the cheapest: ${mask}/${qual}/${int}/${agents}`);
                  }),
                );
              }
              if (p1.tco < prev - 1e-6) bad.push(`not monotonic: ${mask}/${qual}/${int}/${agents} N=${N}`);
              prev = p1.tco;
              if (p2 && p2.tco < p1.tco - 1e-6)
                bad.push(`recommended is cheaper: ${mask}/${qual}/${int}/${agents} N=${N}`);
              if (
                p2 &&
                p2.s === p1.s &&
                p2.units === p1.units &&
                p2.model.n === p1.model.n &&
                Math.abs(p2.perUser - p1.perUser) > 1e-9
              )
                bad.push(`gleiche Hardware, andere Zahl: ${mask}/${qual}/${int}/${agents} N=${N}`);
              if (Math.abs(p1.perUser * I.yrs * 12 * N - p1.tco) > 1e-6)
                bad.push(`per head does not match total: N=${N}`);
              if (p1.one < I.tps - 1e-9 || p1.tpre > I.ttft + 1e-9) bad.push(`Grenzen verletzt: N=${N}`);
            }
          }
    return { points, bad: bad.slice(0, 10), n: bad.length };
  });
  assert.ok(r.points > 500, `nur ${r.points} Punkte`);
  assert.equal(r.n, 0, r.bad.join('\n'));
  await page.close();
});

test('Cost model: offloaded models read their share from the slow memory, like the technical view', async () => {
  const { page } = await open(browser, PAGES.aihow);
  const r = await page.evaluate(() => {
    // DGX Station GB300 with GLM-5.3 (Q4, 467 GB): 252 GB HBM, the rest in LPDDR5X
    const s = SYS.find((x) => x.id === 'gb300'),
      m = MOD[3][0],
      ctx = CLS[3].ctx;
    const I = {
      tasks: [TASKS[4]],
      N: 1,
      int: 1,
      agents: 0,
      H: 9,
      eta: 1,
      tps: 1,
      ttft: 1e9,
      kwh: 0.3,
      yrs: 3,
      fx: 0.89,
      mac: 0.75,
    };
    const cost = trySize(s, m, ctx, I, load(I, 1));
    const i = HW.findIndex((h) => h.id === 'gb300'),
      j = MODELS.findIndex((x) => x.s === 'GLM-5.3');
    const sv = { ...S };
    S.ctx = CTX.indexOf(ctx);
    S.batch = 0;
    const tech = calc(i, j, 'std', 0);
    Object.assign(S, sv);
    return { gb: m.gb, cost: cost.one, tech: tech.stream, ram: tech.ram };
  });
  assert.ok(r.gb > 252 && r.ram > 100, 'model sits partly in the second memory');
  assert.ok(Math.abs(r.cost - r.tech) / r.tech < 1e-9, `Kostenrechner ${r.cost} vs Technik ${r.tech} Token/s`);
  await page.close();
});

test('Cost model: a higher minimum tier never costs less, capacity is the last count without another device', async () => {
  const { page } = await open(browser, PAGES.aihow);
  const r = await page.evaluate(() => {
    const bad = [];
    for (const [ti, N] of [
      [0, 10],
      [2, 10],
      [4, 10],
      [0, 200],
      [5, 60],
    ]) {
      const I = {
        data: 1,
        tasks: [TASKS[ti]],
        cls: TASKS[ti].c,
        N,
        int: 1,
        agents: 0,
        H: 9,
        eta: 0.65,
        tps: 15,
        ttft: 4,
        kwh: 0.3,
        yrs: 3,
        fx: 0.89,
        mac: 0.75,
        kunde: '',
      };
      let prev = null;
      for (let c = 0; c < CLS.length; c++) {
        const p = cheapest(c, I, N);
        if (!p) continue;
        if (p.cls < c) bad.push(`Klasse ${p.cls} unter Mindestklasse ${c}`);
        if (prev && p.tco < prev - 1e-6) bad.push(`minimum tier ${c} cheaper than ${c - 1} (task ${ti}, N=${N})`);
        prev = p.tco;
        const cap = capacity(p, I);
        if (cap < N) bad.push(`capacity ${cap} below N=${N}`);
        const at = trySize(p.s, p.model, CLS[p.cls].ctx, I, load(I, cap));
        if (!at.ok || at.units !== p.units) bad.push(`does not fit any more at capacity ${cap}`);
        if (cap < CAP_MAX) {
          const beyond = trySize(p.s, p.model, CLS[p.cls].ctx, I, load(I, cap + 1));
          if (beyond.ok && beyond.units === p.units) bad.push(`capacity ${cap} too low: ${cap + 1} still fits`);
        }
      }
    }
    // Basic-tier example from the review: a cheaper model of a higher tier may become the entry package
    const I0 = {
      data: 1,
      tasks: [TASKS[0]],
      cls: 0,
      N: 10,
      int: 1,
      agents: 0,
      H: 9,
      eta: 0.65,
      tps: 15,
      ttft: 4,
      kwh: 0.3,
      yrs: 3,
      fx: 0.89,
      mac: 0.75,
      kunde: '',
    };
    const e = cheapest(0, I0, 10);
    return { bad, einstieg: [e.s.id, e.model.n, e.cls, Math.round(e.capex)] };
  });
  assert.deepEqual(r.bad, []);
  assert.deepEqual(r.einstieg, ['m6', 'Laguna XS 2.1 (33B-A3B, Q4)', 1, 1489]);
  await page.close();
});

test('Cost model: within a tier, no model wins that needs more devices than another', async () => {
  const { page } = await open(browser, PAGES.aihow);
  const r = await page.evaluate(() => {
    const bad = [];
    for (const cls of [1, 2, 3])
      for (const N of [10, 50, 200]) {
        const tasks = cls === 3 ? [TASKS[4]] : cls === 2 ? [TASKS[5]] : [TASKS[2]];
        const I = {
          data: 1,
          tasks,
          cls,
          N,
          int: 1,
          agents: 0,
          H: 9,
          eta: 0.65,
          tps: 15,
          ttft: 4,
          kwh: 0.3,
          yrs: 3,
          fx: 0.89,
          mac: 0.75,
          kunde: '',
        };
        SYS.forEach((s) => {
          const chosen = size(s, cls, I, N);
          if (!chosen.ok) return;
          MOD[cls].forEach((m) => {
            const r = trySize(s, m, CLS[cls].ctx, I, load(I, N));
            if (r.ok && r.units < chosen.units)
              bad.push(`${s.id} Klasse ${cls} N=${N}: ${chosen.model.n} (${chosen.units}) statt ${m.n} (${r.units})`);
          });
        });
      }
    const top = size(
      SYS.find((s) => s.id === 'gb300'),
      3,
      {
        data: 1,
        tasks: [TASKS[4]],
        cls: 3,
        N: 200,
        int: 1,
        agents: 0,
        H: 9,
        eta: 0.65,
        tps: 15,
        ttft: 4,
        kwh: 0.3,
        yrs: 3,
        fx: 0.89,
        mac: 0.75,
        kunde: '',
      },
      200,
    );
    return { bad, top: [top.model.n, top.units] };
  });
  assert.deepEqual(r.bad, []);
  assert.deepEqual(r.top, ['GLM-5.3 (IQ2)', 1], 'top tier: variant in fast memory instead of many devices');
  await page.close();
});

test('Cost model: token rate of a dense model follows bandwidth ÷ GB read', async () => {
  const { page } = await open(browser, PAGES.aihow);
  const r = await page.evaluate(() => {
    // RTX 5090 with Granite 8B, one user: read time dominates, compute time is much smaller
    const s = SYS.find((x) => x.id === '5090'),
      m = MOD[0][0],
      ctx = CLS[0].ctx;
    const I = {
      tasks: [TASKS[0]],
      N: 1,
      int: 1,
      agents: 0,
      H: 9,
      eta: 0.65,
      tps: 15,
      ttft: 4,
      kwh: 0.3,
      yrs: 3,
      fx: 0.89,
      mac: 0.75,
    };
    const got = trySize(s, m, ctx, I, load(I, 1)).one;
    const kv = (m.kv * ctx) / 1e9,
      tm = (m.gb + kv) / s.bw,
      tc = (2 * m.a * 1e9) / (s.tf * 1e12 * EFF);
    return { got, expected: I.eta / (Math.max(tm, tc) + 0.001), tm, tc };
  });
  assert.ok(r.tm > r.tc, 'bandwidth-bound');
  assert.ok(Math.abs(r.got - r.expected) / r.expected < 1e-9, `${r.got} vs ${r.expected}`);
  await page.close();
});

test('Technical model: every matrix cell matches the documented formula', async () => {
  const { page } = await open(browser, PAGES.toca);
  const r = await page.evaluate(() => {
    const bad = [];
    let cells = 0;
    S.ctx = 4;
    S.batch = 0;
    S.spec = false;
    const ctx = CTX[S.ctx];
    HW.forEach((h, i) =>
      MODELS.forEach((m, j) => {
        if (m.dec) return;
        m.v.forEach((v, k) => {
          const c = calc(i, j, 'std', k);
          if (!c.fits || c.ram > 0) return;
          cells++;
          const KV = (m.kv * Math.min(ctx, m.maxCtx || Infinity)) / 1e9 / (m.hailo ? 2 : 1);
          const W = m.a < m.p ? v.gb * (m.a / m.p) : v.gb;
          const tm = (W + KV) / h.bw,
            tc = (2 * m.a * 1e9) / (h.tf * 1e12 * EFF);
          const expected = 1 / (Math.max(tm, tc) + (h.ovh ?? 0.001));
          if (Math.abs(c.stream - expected) / expected > 1e-9)
            bad.push(`${h.id} × ${m.s} (${v.n}): ${c.stream} vs ${expected}`);
          if (W + KV > usable(h) + 1e-9)
            bad.push(`${h.id} × ${m.s}: fits according to the model but exceeds usable memory`);
        });
      }),
    );
    return { cells, bad: bad.slice(0, 10), n: bad.length };
  });
  assert.ok(r.cells > 100, `nur ${r.cells} Zellen`);
  assert.equal(r.n, 0, r.bad.join('\n'));
  await page.close();
});

test('Technical model: models that are too large do not fit, with a traceable reason', async () => {
  const { page } = await open(browser, PAGES.toca);
  const r = await page.evaluate(() => {
    const i = HW.findIndex((h) => h.id === 'm6'),
      j = MODELS.findIndex((m) => m.s === 'GLM-5.3');
    const c = calc(i, j, 'std', 0);
    const hailo = calc(
      HW.findIndex((h) => h.id === 'hailo'),
      MODELS.findIndex((m) => m.s === 'granite-3b'),
      'std',
      0,
    );
    return { fits: c.fits, why: c.why, hailoFits: hailo.fits, hailoWhy: hailo.why };
  });
  assert.equal(r.fits, false);
  assert.match(r.why, /GB/);
  assert.equal(r.hailoFits, false);
  assert.match(r.hailoWhy, /Hailo/);
  await page.close();
});

test('Data: cost calculator models and purchasable systems refer to complete entries', async () => {
  const { page } = await open(browser, PAGES.toca);
  const r = await page.evaluate(() => {
    const bad = [];
    COST_MODELS.flat().forEach(({ s, v, n }) => {
      const m = MODELS.find((x) => x.s === s);
      if (!m) bad.push(`Modell ${s} fehlt (${n})`);
      else if (!m.v.find((x) => x.n === v)) bad.push(`Variante ${v} fehlt bei ${s}`);
    });
    DEVICES.forEach((d) => {
      if (!d.id || !d.name || !(d.bw > 0) || !(d.cap > 0) || !(d.tf > 0)) bad.push(`device incomplete: ${d.id}`);
      if (d.unified && !d.os && !(d.use > 0 && d.use <= 1)) bad.push(`Speicheranteil fehlt: ${d.id}`);
      if (d.sys && !(d.sys.price > 0 && d.sys.load > 0 && d.sys.idle >= 0 && d.sys.src && d.sys.kind))
        bad.push(`purchasable system incomplete: ${d.id}`);
    });
    if (new Set(DEVICES.map((d) => d.id)).size !== DEVICES.length) bad.push('duplicate device id');
    if (new Set(MODELS.map((m) => m.s)).size !== MODELS.length) bad.push('duplicate model id');
    return {
      bad,
      usable: [
        usableGB(
          DEVICES.find((d) => d.id === 'm6'),
          0.9,
        ),
        usableGB(DEVICES.find((d) => d.id === 'sv2')),
        usableGB(DEVICES.find((d) => d.id === 'pi')),
      ],
    };
  });
  assert.deepEqual(r.bad, []);
  assert.deepEqual(r.usable, [28.8, 62, 14.5]);
  await page.close();
});

test('Helpers: escaping and profile normalization', async () => {
  const { page } = await open(browser, PAGES.toca);
  const r = await page.evaluate(() => ({
    esc: esc('<a href="x">&</a>'),
    norm: normProfile({ host: 42, ram_gb: '32,5', ram_bw: 'abc', cpu_cores: -3, gpu_name: 'x'.repeat(200) }),
  }));
  assert.equal(r.esc, '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(r.norm.host, '42');
  assert.equal(r.norm.ram_gb, 32.5);
  assert.equal(r.norm.ram_bw, 0);
  assert.equal(r.norm.cpu_cores, 4);
  assert.equal(r.norm.gpu_name.length, 80);
  await page.close();
});

test('Data date: STAND is a real date, age counts full months', async () => {
  const { page } = await open(browser, PAGES.start);
  const r = await page.evaluate(() => {
    const d = (y, m, t) => new Date(y, m - 1, t);
    const s = standDate();
    const plus = (mo, days = 0) => new Date(s.getFullYear(), s.getMonth() + mo, s.getDate() + days);
    return {
      stand: s && s.toISOString(),
      invalid: [standDate('31.02.2026'), standDate('2026-10-11'), standDate('1.10.2026')],
      months: [
        monthsSince(d(2026, 10, 11), d(2027, 4, 10)),
        monthsSince(d(2026, 10, 11), d(2027, 4, 11)),
        monthsSince(d(2026, 8, 31), d(2027, 2, 28)),
        monthsSince(d(2026, 10, 11), d(2026, 9, 1)),
      ],
      fresh: staleText(plus(STALE_MONTHS, -1)),
      stale: staleText(plus(STALE_MONTHS)),
      old: staleText(plus(30)),
      clockBehind: staleText(plus(-3)),
      STAND,
    };
  });
  assert.ok(r.stand, `STAND "${r.STAND}" must be a valid date in the format DD.MM.YYYY`);
  assert.deepEqual(r.invalid, [null, null, null]);
  assert.deepEqual(r.months, [5, 6, 5, -2]);
  assert.equal(r.fresh, '');
  assert.match(r.stale, new RegExp(`vom ${r.STAND.replace(/\./g, '\\.')}, 6 Monate alt`));
  assert.match(r.old, /2 Jahre alt/);
  assert.equal(r.clockBehind, '');
  await page.close();
});
