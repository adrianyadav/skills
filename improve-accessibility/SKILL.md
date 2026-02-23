---
name: improve-accessibility
description: Analyze and improve the accessibility (a11y) of React components according to WCAG standards, and verify with axe-core and Lighthouse.
---

# Improve Accessibility Skill

## Core System Instructions

**Purpose:** Analyze React components for WCAG compliance, generate an HTML report of violations, request user approval, implement fixes as individual git commits, and re-verify.

**CRITICAL RULES:**

1. **NO REPO BLOAT:** All reports, temporary files, and configs go in `.a11y-reports/` at the project root.
2. **GIT IGNORE:** Create `.a11y-reports/.gitignore` containing `*` so it is ignored by Git.
3. **EPHEMERAL TOOLS:** Use `npx --yes` to run tools. Do NOT install anything into the user's `package.json`.
4. **INDIVIDUAL COMMITS:** Each fix must be committed individually with an `a11y:` prefix.
5. **HTML REPORTS ONLY:** Do NOT generate PDFs. Use HTML for all reports.
6. **WRITE REPORTS DIRECTLY:** Use `Write` to generate HTML reports. Do NOT run Node scripts to generate them — running Node scripts via `Bash` for report generation is unreliable.
7. **TELL THE USER THE REPORT PATH:** After writing a report, output the file path in your message so the user can open it. Do NOT use any shell command to open the file.
8. **BACKGROUND SCANNER COMMANDS ONLY:** Only use `Bash` with `run_in_background: true` for axe-core and Lighthouse scans, which must be polled with `TaskOutput`.

---

## Execution Model

| Task                    | Tool to use                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| Read files              | `Read`                                                                  |
| Write/edit source files | `Write` or `Edit`                                                       |
| Write JSON data files   | `Write`                                                                 |
| Generate HTML reports   | `Write` (compose HTML directly — do NOT shell out to Node)              |
| Show report to user     | Output the file path in your message (e.g. `.a11y-reports/report-pre.html`) |
| Run axe-core scan            | `Bash` with `run_in_background: true`, poll with `TaskOutput`      |
| Run Lighthouse scan          | `Bash` with `run_in_background: true`, poll with `TaskOutput`      |
| Run screen reader simulation | `Write` sr-test.mjs, `Bash` (npm install + node), `run_in_background: true` |
| Git commits                  | `Bash` (fast, safe)                                                |

---

## Decision Tree (Execute First)

```
Request received
├─ User provides a React component file? → CONTINUE
├─ User provides a URL only? → Skip to automated tools, no manual review
└─ No file or URL? → ASK user what to analyze
```

---

## Workflow

### Phase 1: Initialize & Analyze

#### Step 1.1 — Create `.a11y-reports/` directory

Use `Write` to create `.a11y-reports/.gitignore` with content `*`. This also creates the directory.

#### Step 1.2 — Detect the dev server URL

Read the project config files directly with `Read`:

- Vite: check `vite.config.js` or `vite.config.ts` for a `port:` setting. Default is **5173**.
- Next.js: default is **3000**.
- CRA: default is **3000**.

If the dev server is not running, start it as a background command:

```bash
npm run dev -- --port <port>
```

Run with `Bash` and `run_in_background: true`, then verify it's ready by polling with `TaskOutput` and also running:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>
```

Expect `200` before proceeding.

#### Step 1.3 — Manual code review

Read the target component(s) with `Read`. Check for:

| Category           | What to look for                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Semantic HTML**  | `<div>`/`<span>` used as buttons/links; missing `<main>`, `<header>`, `<nav>`, `<footer>` |
| **Images**         | `<img>` without `alt`; decorative images without `alt=""` or `role="presentation"`        |
| **Headings**       | Skipped levels (e.g. `<h1>` → `<h3>`); missing `<h1>`; multiple `<h1>`                    |
| **Forms**          | `<input>` without `<label>`; missing `aria-label` on icon-only inputs                     |
| **Links**          | `<a>` without `href`; `<a onClick>` without keyboard support                              |
| **Keyboard**       | `<div onClick>` without `tabIndex`, `onKeyDown`, and `role`                               |
| **Color contrast** | Inline styles with low-contrast color combinations                                        |
| **ARIA**           | Incorrect/redundant ARIA roles; missing `aria-expanded` on toggles                        |
| **Language**       | Missing `lang` attribute on `<html>` (check `index.html`)                                 |

> ⚠️ **axe-core blind spot:** Interactive elements (`<div onClick>`, `<span onClick>`) without `role`, `tabIndex`, and keyboard handlers are **systematically missed** by all automated scanners. Always check the Keyboard row above manually — it is the most common source of critical violations that axe-core will not report.

Collect every finding with: severity, issue description, location (`src/Component.jsx:lineNumber`), WCAG criterion, and proposed fix.

#### Step 1.4 — Run axe-core (background command)

```bash
npx --yes @axe-core/cli http://localhost:<port> --exit 2>&1 | tee .a11y-reports/axe-output.txt
```

Run with `Bash` and `run_in_background: true`. Note the returned `task_id`. Poll with `TaskOutput` until status is complete. Read `.a11y-reports/axe-output.txt` with `Read` after completion.

> **Note:** `@axe-core/cli` runs headless Chrome internally. No Playwright needed.

#### Step 1.5 — Run Lighthouse (background command)

```bash
npx --yes lighthouse http://localhost:<port> \
  --only-categories=accessibility \
  --output=json \
  --output-path=.a11y-reports/lighthouse-report.json \
  --chrome-flags="--headless --no-sandbox" \
  --quiet
```

Run with `Bash` and `run_in_background: true`. Note the returned `task_id`. Poll with `TaskOutput` until complete. After it completes, read the score:

```bash
node --input-type=commonjs -e "const r=require('./.a11y-reports/lighthouse-report.json'); console.log(Math.round(r.categories.accessibility.score*100));"
```

> **Warning:** If `package.json` has `"type": "module"`, you MUST use `--input-type=commonjs` for inline Node commands.

#### Step 1.6 — Screen Reader Simulation (background command)

Use `Write` to create the simulation script, then install `playwright-core` into `.a11y-reports/` (gitignored) and run it. This uses system Chrome — no extra browser download.

**Write `.a11y-reports/sr-test.mjs`:**

```js
// Run from project root: node .a11y-reports/sr-test.mjs <url>
import { chromium } from 'playwright-core';

const url = process.argv[2];
if (!url) { console.error('Usage: node sr-test.mjs <url>'); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
const snapshot = await page.locator(':root').ariaSnapshot();
console.log(snapshot);
await browser.close();
```

**Then run (background):**

```bash
[ -d .a11y-reports/node_modules/playwright-core ] || \
  npm install --prefix .a11y-reports playwright-core --no-package-lock --silent 2>&1 | tail -3 && \
  node .a11y-reports/sr-test.mjs http://localhost:<port> 2>&1 | tee .a11y-reports/screen-reader-sim.txt
```

Run with `Bash` and `run_in_background: true`. Poll with `TaskOutput` until complete. Read `.a11y-reports/screen-reader-sim.txt` with `Read`.

The output is a YAML-like accessibility tree showing exactly what a screen reader announces — roles, names, labels, and states. Review it for:
- Missing names on interactive elements (shown as unnamed or generic role)
- Illogical reading order
- Redundant or confusing announcements

> **Requires:** Google Chrome installed on the system. See Troubleshooting if it fails.

---

#### Step 1.7 — Generate the pre-fix HTML report

**Use `Write` to compose the HTML report directly.** Do NOT run a Node script.

Write to `.a11y-reports/report-pre.html`. The report must include:

1. **Score cards row** — Lighthouse score (colored green ≥90 / yellow ≥70 / red <70), axe-core violation count, manual finding count
2. **axe-core violations section** — one card per rule, showing rule name, occurrence count, description, affected elements, and a dequeuniversity.com link
3. **Manual findings table** — columns: Severity badge, Issue, Location (`code` tag), WCAG criterion, Proposed Fix
4. **Screen reader simulation section** — `<pre>` block with the raw `screen-reader-sim.txt` content, styled as a terminal
5. **Fix plan table** — numbered list of planned commits

Add this CSS to the HTML skeleton for the SR output block:
```css
.sr-output {
  background: var(--bg);
  padding: 1rem;
  border-radius: 8px;
  font-family: monospace;
  font-size: 0.8125rem;
  color: var(--accent);
  overflow-x: auto;
  white-space: pre-wrap;
  line-height: 1.8;
}
```

And this section in the body (paste the content of `screen-reader-sim.txt` verbatim into the `<pre>`):
```html
<div class="section">
  <h2>🔊 Screen Reader Simulation</h2>
  <p style="color:var(--muted);font-size:0.8125rem;margin-bottom:0.75rem">
    Accessibility tree as announced by a screen reader. Unnamed interactive elements,
    missing labels, and illogical structure appear here before tooling catches them.
  </p>
  <pre class="sr-output"><!-- paste screen-reader-sim.txt content here --></pre>
</div>
```

Use this dark-mode HTML skeleton (adapt it with the real data):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Accessibility Audit Report</title>
    <style>
      :root {
        --bg: #0f172a;
        --surface: #1e293b;
        --surface-2: #334155;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --accent: #38bdf8;
        --green: #34d399;
        --red: #f87171;
        --orange: #fb923c;
        --yellow: #fbbf24;
        --blue: #60a5fa;
        --border: #475569;
      }
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
        line-height: 1.6;
        padding: 2rem;
      }
      .container {
        max-width: 980px;
        margin: 0 auto;
      }
      h1 {
        font-size: 1.75rem;
        font-weight: 700;
        margin-bottom: 0.25rem;
        color: #fff;
      }
      .subtitle {
        color: var(--muted);
        margin-bottom: 2rem;
        font-size: 0.875rem;
      }
      .score-row {
        display: flex;
        gap: 1rem;
        margin-bottom: 2rem;
      }
      .score-card {
        flex: 1;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1.25rem;
        text-align: center;
      }
      .score-card .label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        margin-bottom: 0.5rem;
      }
      .score-card .value {
        font-size: 2rem;
        font-weight: 700;
      }
      .good {
        color: var(--green);
      }
      .ok {
        color: var(--yellow);
      }
      .bad {
        color: var(--red);
      }
      .section {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1.5rem;
        margin-bottom: 1.5rem;
      }
      .section h2 {
        font-size: 1.125rem;
        font-weight: 600;
        margin-bottom: 1rem;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .violation {
        background: var(--surface-2);
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 0.75rem;
        border-left: 3px solid var(--border);
      }
      .violation.critical {
        border-left-color: var(--red);
      }
      .violation.serious {
        border-left-color: var(--orange);
      }
      .violation.moderate {
        border-left-color: var(--yellow);
      }
      .violation.minor {
        border-left-color: var(--blue);
      }
      .violation .rule {
        font-weight: 600;
        font-size: 0.9375rem;
        margin-bottom: 0.25rem;
      }
      .violation .desc {
        color: var(--muted);
        font-size: 0.8125rem;
        margin-bottom: 0.5rem;
      }
      .badge {
        display: inline-block;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .badge.critical {
        background: #991b1b;
        color: #fecaca;
      }
      .badge.serious {
        background: #9a3412;
        color: #fed7aa;
      }
      .badge.moderate {
        background: #854d0e;
        color: #fef08a;
      }
      .badge.minor {
        background: #1e40af;
        color: #bfdbfe;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8125rem;
      }
      th {
        text-align: left;
        padding: 0.5rem 0.75rem;
        color: var(--muted);
        font-weight: 600;
        font-size: 0.75rem;
        text-transform: uppercase;
        border-bottom: 1px solid var(--border);
      }
      td {
        padding: 0.625rem 0.75rem;
        border-bottom: 1px solid var(--surface-2);
        vertical-align: top;
      }
      code {
        background: var(--bg);
        padding: 0.125rem 0.375rem;
        border-radius: 4px;
        font-size: 0.75rem;
        color: var(--accent);
      }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>
        <!-- TITLE: "Accessibility Audit Report" or "Post-Fix Accessibility Report" -->
      </h1>
      <p class="subtitle">
        <!-- e.g. Pre-fix · Generated 23 Feb 2026 · Target: src/App.jsx -->
      </p>
      <!-- score cards, axe violations, manual findings table, fix plan table -->
    </div>
  </body>
</html>
```

After writing, tell the user the report path so they can open it:

```
Report written to: .a11y-reports/report-pre.html
```

---

### Phase 2: Report Findings & Request Approval (CRITICAL STOP)

**Stop here and message the user.** Do NOT touch source files until they explicitly approve.

Include in your message:

- Total violation count, severity breakdown
- Lighthouse score
- Path to the report: `.a11y-reports/report-pre.html`

---

### Phase 3: Fix (Individual Commits)

After user approval, edit source files using `Edit`.

**Rules:**

- Preserve visual design — change only what's needed for accessibility
- One logical group of changes per commit

**Commit pattern** (these are fast `Bash` calls, safe to run):

```bash
git add <file(s)>
git commit -m "a11y: <description>"
```

**Example commit messages:**

- `a11y: add alt text to logo images`
- `a11y: replace div onClick with semantic button`
- `a11y: add labels to form inputs`
- `a11y: fix heading hierarchy`
- `a11y: add landmark elements (header, main)`
- `a11y: fix color contrast on welcome text`

**Fix priority order:**

1. Critical (images without alt, interactive divs)
2. Serious (contrast, missing landmarks, unlabelled forms)
3. Moderate (heading hierarchy, lang attribute)
4. Minor (ARIA refinements)

---

### Phase 4: Re-Verify

**First, verify the dev server is still running** — it may have stopped during the fix phase:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>
```

Expect `200`. If not, restart it with `npm run dev` (background) and wait for `200` before continuing.

Re-run all three scans as background commands (same as Phase 1):

```bash
npx --yes @axe-core/cli http://localhost:<port> --exit 2>&1 | tee .a11y-reports/axe-output-post.txt
```

```bash
npx --yes lighthouse http://localhost:<port> \
  --only-categories=accessibility \
  --output=json \
  --output-path=.a11y-reports/lighthouse-report-post.json \
  --chrome-flags="--headless --no-sandbox" \
  --quiet
```

Also re-run the screen reader simulation:

```bash
node .a11y-reports/sr-test.mjs http://localhost:<port> 2>&1 | tee .a11y-reports/screen-reader-sim-post.txt
```

Run all three with `Bash` and `run_in_background: true`. Poll each with `TaskOutput` until complete.

Read the new score:

```bash
node --input-type=commonjs -e "const r=require('./.a11y-reports/lighthouse-report-post.json'); console.log(Math.round(r.categories.accessibility.score*100));"
```

Read `.a11y-reports/axe-output-post.txt` with `Read`.

Then **write the post-fix report directly** with `Write` to `.a11y-reports/report-post.html`, using the same HTML skeleton. The manual findings table will be empty; show a green "✅ No violations found" placeholder.

Tell the user the report path:

```
Post-fix report written to: .a11y-reports/report-post.html
```

---

### Phase 5: Final Summary

Reply to the user with:

```
## Accessibility Fixes Complete

**Lighthouse Score:** 72 → 95 (+23 points)
**axe-core Violations:** 8 → 0

### Commits Made:
1. `a11y: add alt text to logo images`
2. ...

### Reports:
- Pre-fix:  .a11y-reports/report-pre.html
- Post-fix: .a11y-reports/report-post.html
```

---

## Troubleshooting

### Bash command stalls

Only use `Bash` with `run_in_background: true` for:

- `npx @axe-core/cli` and `npx lighthouse` (poll completion with `TaskOutput`)
- `npm run dev` (background)

Use regular `Bash` (foreground) for:

- `git add` / `git commit` (fast, safe)
- `curl` health check
- Reading Lighthouse score via `node -e`

### `require is not defined` error

Project has `"type": "module"` in `package.json`. Use `--input-type=commonjs` for inline Node commands.

### axe-core/Lighthouse can't connect

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

Expect `200`. If not, start the dev server first.

### Lighthouse times out

Add `--max-wait-for-load=45000` to the Lighthouse command.

### Stale task notifications

The system may send `<task-notification>` messages for background tasks you already retrieved with `TaskOutput`. **Ignore them** — the result was already captured. Do not re-read the output file or restart the scan. Just acknowledge and continue.

### Screen reader simulation fails

**`Error: Cannot find Chrome installation`** — Install Google Chrome on the system, or replace `channel: 'chrome'` with `channel: 'chromium'` in `sr-test.mjs` and run `npx playwright install chromium` first.

**`ariaSnapshot is not a function`** — `playwright-core` version is too old. Delete `.a11y-reports/node_modules/` and re-run the install to get the latest version.

### Multiple pages to audit

Run axe-core and Lighthouse on each page URL separately. Combine the results into one HTML report written with `Write`.
