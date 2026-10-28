# AGENTS.md

Conventions for everyone changing this repository, contributors and coding agents alike. README.md covers
usage, the calculation model and data sources; this file holds only what is easy to get wrong.

## Commands

```bash
npm ci                                       # once; installs Playwright and Prettier
npm run browser                              # once; downloads Chromium for Playwright
npm test                                     # all suites (headless Chromium, slow: fixed waits)
node --test tests/model.test.mjs             # one suite; add --test-concurrency=1 on small machines
npm run check                                # Prettier; `npm run format` fixes it
```

CI runs `npm run check` and `npm test` on every push.

## Where to edit

- Everything is in `index.html`: markup, styles and one classic inline script. Views are routes (`#start`,
  `#aihow`, `#toca`, `#daten`; see `VIEWS`).
- The data tables (`STAND`, `DEVICES`, `MODELS`, `COST_MODELS`, `RENT`, `CLOUD`, `SAAS_USD`, …) sit between the
  "Data date" and "Core" sections. Both views calculate from these same tables.
- `hw-profil.sh` is not a file: it is a string inside `index.html`, downloaded by the `dlScript` button. It must
  stay read-only, and its JSON fields must match `normProfile()` and the import check; change them together.

## Constraints

- No server, no build step, no runtime dependency: `index.html` must work when opened from disk.
- Keep the inline script classic and its top-level names stable: the tests call them through `page.evaluate`
  (`DEVICES`, `MODELS`, `HW`, `SYS`, `calc`, `cheapest`, `trySize`, `esc`, `normProfile`, `staleText`, …).
- Escape every value that is not a literal from the data tables before it goes into `innerHTML`: use `esc()`.
  Validate everything read from `localStorage` (type and range) before using it; imported device profiles go
  through `normProfile()`.
- Storage keys are versioned (`kostenrechner.prices.v3`, `kostenrechner.expert.v1`, `llmcalc.devices.v1`). Bump
  the suffix when the stored shape changes and keep reading the old key until the next save; a new
  cost-calculator key is also cleared by its reset button. Store only what the visitor changed, so defaults
  follow data updates.
- Research values instead of estimating them. Every data row needs `src`, `url` and `date`; mark unavoidable
  estimates with `est` or `kvEst`. Dates are `DD.MM.YYYY`.
- Update `STAND` only after every price has been checked: it drives the outdated-data notice. Record a larger
  verification round in `docs/data-verification.md`.
- Hardware prices are gross incl. 19% VAT. Online services, rental and subscriptions are stored net; the code
  applies `VAT`. Compute is FP16 dense without sparsity; KV per token assumes an FP16 cache and counts only
  layers whose cache grows with context. Power under load is the maximum, not the average.
- Some tests pin data entries, for example devices `m6`, `sv2`, `pi`, `hailo`, models `GLM-5.3`, `GLM-5.3-Flash`,
  `granite-3b`, `nimble`, and the entry-tier result for `m6` (Laguna XS 2.1). If a data update changes them,
  update the expectation in the same pull request and say why.
- A result card appears only if it differs from the others; never show the same figure twice as a comparison.
- No element `id` may equal a route name: the browser would scroll to it.
- The tool stays neutral: no branding, promotion, contact details or personal data, and no link to this
  repository in the page (a test enforces that).
- UI text, including data text shown in the page, is German and free of jargon; the tests match some of these
  strings. Everything else is English: code, comments, tests, docs, commits.
- Check changed views at 360 px width (`open(browser, rel, { width: 360 })` in `tests/helpers.mjs`) and in dark
  mode (`browser.newContext({ colorScheme: 'dark' })`, as in `tests/smoke.test.mjs`).
- Do not commit test screenshots, scratch files or research scripts.

## Pull requests

- Open a pull request only for an issue the maintainer has replied to, and link it (`Closes #N`).
- One topic per pull request. When refactoring, compare outputs before and after (cost scenarios, matrix cells)
  and list every difference in the pull request.
- Run `npm run check` and `npm test` before pushing. Only the maintainer merges.
