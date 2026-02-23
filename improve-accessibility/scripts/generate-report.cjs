#!/usr/bin/env node
// generate-report.cjs
// Generates a self-contained HTML accessibility report.
// Usage:
//   node generate-report.cjs \
//     --axe <axe-output.txt> \
//     --lighthouse-json <lighthouse.report.json> \
//     --manual '<JSON array>' \
//     --output <report.html> \
//     --phase <pre|post>

'use strict';

const fs = require('fs');
const path = require('path');

// --- Argument parsing ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

const axePath = getArg('--axe');
const lighthouseJsonPath = getArg('--lighthouse-json');
const manualJson = getArg('--manual');
const manualFilePath = getArg('--manual-file');
const outputPath = getArg('--output');
const phase = getArg('--phase') || 'pre';

if (!outputPath) {
  console.error('Error: --output is required');
  process.exit(1);
}

// --- Parse inputs ---

// axe-core text output
let axeText = '';
if (axePath && fs.existsSync(axePath)) {
  axeText = fs.readFileSync(axePath, 'utf-8');
  // Strip ANSI escape codes (color, bold, underline, etc.)
  axeText = axeText.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

// Parse axe violations from text output
function parseAxeViolations(text) {
  const violations = [];
  const violationRegex = /Violation of "([^"]+)" with (\d+) occurrences?!\s*\n\s*([\s\S]*?)(?=\n\s*Violation of|\n\s*\d+ Accessibility|$)/g;
  let match;
  while ((match = violationRegex.exec(text)) !== null) {
    const rule = match[1];
    const count = parseInt(match[2], 10);
    const body = match[3];

    // Extract description (first line after the header)
    const lines = body.trim().split('\n');
    const description = lines[0] ? lines[0].trim() : '';

    // Extract elements
    const elements = [];
    for (const line of lines) {
      const elMatch = line.match(/^\s+-\s+(.+)/);
      if (elMatch) elements.push(elMatch[1].trim());
    }

    // Extract deque URL
    const urlMatch = body.match(/(https:\/\/dequeuniversity\.com\/[^\s]+)/);
    const helpUrl = urlMatch ? urlMatch[1] : '';

    violations.push({ rule, count, description, elements, helpUrl });
  }
  return violations;
}

const axeViolations = parseAxeViolations(axeText);

// Lighthouse JSON
let lighthouseScore = null;
let lighthouseAudits = [];
if (lighthouseJsonPath && fs.existsSync(lighthouseJsonPath)) {
  try {
    const lhData = JSON.parse(fs.readFileSync(lighthouseJsonPath, 'utf-8'));
    lighthouseScore = Math.round((lhData.categories?.accessibility?.score || 0) * 100);

    // Extract failing audits
    const audits = lhData.audits || {};
    for (const [id, audit] of Object.entries(audits)) {
      if (audit.score !== null && audit.score < 1 && audit.details?.items?.length > 0) {
        lighthouseAudits.push({
          id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
          items: audit.details.items.length,
        });
      }
    }
  } catch (e) {
    console.warn('Warning: Could not parse Lighthouse JSON:', e.message);
  }
}

// Manual findings — prefer --manual-file over inline --manual to avoid shell escaping issues
let manualFindings = [];
if (manualFilePath && fs.existsSync(manualFilePath)) {
  try {
    manualFindings = JSON.parse(fs.readFileSync(manualFilePath, 'utf-8'));
  } catch (e) {
    console.warn('Warning: Could not parse --manual-file JSON:', e.message);
  }
} else if (manualJson) {
  try {
    manualFindings = JSON.parse(manualJson);
  } catch (e) {
    console.warn('Warning: Could not parse --manual JSON:', e.message);
  }
}

// --- Severity colors ---
function severityColor(sev) {
  const colors = {
    critical: '#dc2626',
    serious: '#ea580c',
    moderate: '#ca8a04',
    minor: '#2563eb',
  };
  return colors[sev] || '#6b7280';
}

function severityBg(sev) {
  const colors = {
    critical: '#fef2f2',
    serious: '#fff7ed',
    moderate: '#fefce8',
    minor: '#eff6ff',
  };
  return colors[sev] || '#f9fafb';
}

// --- Generate HTML ---
const title = phase === 'post' ? 'Post-Fix Accessibility Report' : 'Accessibility Audit Report';
const timestamp = new Date().toLocaleString();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-2: #334155;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #818cf8;
      --green: #34d399;
      --red: #f87171;
      --orange: #fb923c;
      --yellow: #fbbf24;
      --border: #475569;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    .container { max-width: 960px; margin: 0 auto; }
    h1 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
      color: white;
    }
    .subtitle {
      color: var(--text-muted);
      margin-bottom: 2rem;
      font-size: 0.875rem;
    }

    /* Score card */
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
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .score-card .value {
      font-size: 2rem;
      font-weight: 700;
    }
    .score-card .value.good { color: var(--green); }
    .score-card .value.ok { color: var(--yellow); }
    .score-card .value.bad { color: var(--red); }

    /* Section */
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
      color: white;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .section h2 .icon { font-size: 1.25rem; }

    /* Violation card */
    .violation {
      background: var(--surface-2);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      border-left: 3px solid var(--border);
    }
    .violation.critical { border-left-color: var(--red); }
    .violation.serious { border-left-color: var(--orange); }
    .violation.moderate { border-left-color: var(--yellow); }
    .violation.minor { border-left-color: var(--accent); }
    .violation .rule {
      font-weight: 600;
      font-size: 0.9375rem;
      margin-bottom: 0.25rem;
    }
    .violation .desc {
      color: var(--text-muted);
      font-size: 0.8125rem;
      margin-bottom: 0.5rem;
    }
    .violation .elements {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .violation .elements code {
      background: var(--bg);
      padding: 0.125rem 0.375rem;
      border-radius: 4px;
      font-size: 0.75rem;
      color: var(--accent);
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
    .badge.critical { background: #991b1b; color: #fecaca; }
    .badge.serious { background: #9a3412; color: #fed7aa; }
    .badge.moderate { background: #854d0e; color: #fef08a; }
    .badge.minor { background: #1e40af; color: #bfdbfe; }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }
    th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 0.625rem 0.75rem;
      border-bottom: 1px solid var(--surface-2);
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }

    .empty {
      text-align: center;
      color: var(--green);
      padding: 2rem;
      font-size: 0.9375rem;
    }
    .empty .check { font-size: 2.5rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p class="subtitle">Generated ${timestamp}</p>

    <!-- Score cards -->
    <div class="score-row">
      <div class="score-card">
        <div class="label">Lighthouse Score</div>
        <div class="value ${lighthouseScore === null ? '' : lighthouseScore >= 90 ? 'good' : lighthouseScore >= 70 ? 'ok' : 'bad'}">
          ${lighthouseScore !== null ? lighthouseScore + '/100' : 'N/A'}
        </div>
      </div>
      <div class="score-card">
        <div class="label">axe-core Violations</div>
        <div class="value ${axeViolations.length === 0 ? 'good' : 'bad'}">
          ${axeViolations.reduce((sum, v) => sum + v.count, 0)}
        </div>
      </div>
      <div class="score-card">
        <div class="label">Manual Findings</div>
        <div class="value ${manualFindings.length === 0 ? 'good' : 'bad'}">
          ${manualFindings.length}
        </div>
      </div>
    </div>

    <!-- axe-core violations -->
    <div class="section">
      <h2><span class="icon">🔍</span> axe-core Violations</h2>
      ${axeViolations.length === 0
        ? '<div class="empty"><div class="check">✅</div>No violations found</div>'
        : axeViolations.map(v => `
        <div class="violation">
          <div class="rule">
            ${v.rule}
            <span style="color: var(--text-muted); font-weight: 400; font-size: 0.8125rem; margin-left: 0.5rem;">
              (${v.count} occurrence${v.count > 1 ? 's' : ''})
            </span>
          </div>
          <div class="desc">${escapeHtml(v.description)}</div>
          <div class="elements">
            Elements: ${v.elements.map(e => '<code>' + escapeHtml(e) + '</code>').join(', ')}
          </div>
          ${v.helpUrl ? '<div style="margin-top: 0.375rem; font-size: 0.75rem;"><a href="' + v.helpUrl + '" target="_blank">Learn more →</a></div>' : ''}
        </div>`).join('')
      }
    </div>

    <!-- Manual findings -->
    ${manualFindings.length > 0 ? `
    <div class="section">
      <h2><span class="icon">📝</span> Manual Code Review Findings</h2>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Issue</th>
            <th>Location</th>
            <th>WCAG</th>
            <th>Proposed Fix</th>
          </tr>
        </thead>
        <tbody>
          ${manualFindings.map(f => `
          <tr>
            <td><span class="badge ${f.severity}">${f.severity}</span></td>
            <td>${escapeHtml(f.issue)}</td>
            <td><code>${escapeHtml(f.location)}</code></td>
            <td>${escapeHtml(f.wcag || '')}</td>
            <td>${escapeHtml(f.fix)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <!-- Lighthouse failing audits -->
    ${lighthouseAudits.length > 0 ? `
    <div class="section">
      <h2><span class="icon">🏠</span> Lighthouse Failing Audits</h2>
      <table>
        <thead>
          <tr>
            <th>Audit</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          ${lighthouseAudits.map(a => `
          <tr>
            <td>${escapeHtml(a.title)}</td>
            <td>${a.items}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

  </div>
</body>
</html>`;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Write output ---
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf-8');
console.log('Report saved to ' + outputPath);
