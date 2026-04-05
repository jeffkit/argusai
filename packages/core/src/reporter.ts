/**
 * @module reporter
 * Test result reporters for preflight.
 *
 * Provides three built-in {@link Reporter} implementations:
 * - {@link ConsoleReporter} — streams coloured output to stdout
 * - {@link JSONReporter}    — collects events and generates a JSON report
 * - {@link HTMLReporter}    — generates a self-contained HTML report file
 */

import fs from 'node:fs/promises';
import type { TestEvent, TestReport, SuiteReport, Reporter } from './types.js';

// =====================================================================
// ANSI helpers (no external dependency)
// =====================================================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';

// =====================================================================
// Console Reporter
// =====================================================================

/**
 * Reporter that streams coloured test results to stdout in real-time.
 */
export class ConsoleReporter implements Reporter {
  id = 'console';
  private events: TestEvent[] = [];

  /**
   * Handle an incoming test event.
   * Prints a human-readable line to stdout immediately.
   */
  onEvent(event: TestEvent): void {
    this.events.push(event);

    switch (event.type) {
      case 'suite_start':
        console.log(`\n${BOLD}Suite: ${event.suite}${RESET}`);
        break;
      case 'case_start':
        // Intentionally silent — result is printed on pass/fail
        break;
      case 'case_pass':
        console.log(`  ${GREEN}✓${RESET} ${event.name} ${GRAY}(${event.duration}ms)${RESET}`);
        break;
      case 'case_fail':
        console.log(`  ${RED}✗${RESET} ${event.name} ${GRAY}(${event.duration}ms)${RESET}`);
        console.log(`    ${RED}${event.error}${RESET}`);
        break;
      case 'case_skip':
        console.log(`  ${YELLOW}○${RESET} ${event.name}${event.reason ? ` — ${event.reason}` : ''}`);
        break;
      case 'suite_end':
        console.log(
          `\n  ${GREEN}${event.passed} passed${RESET}` +
            (event.failed > 0 ? `, ${RED}${event.failed} failed${RESET}` : '') +
            (event.skipped > 0 ? `, ${YELLOW}${event.skipped} skipped${RESET}` : '') +
            ` ${GRAY}(${event.duration}ms)${RESET}`,
        );
        break;
      case 'log':
        {
          const colour = event.level === 'error' ? RED : event.level === 'warn' ? YELLOW : GRAY;
          console.log(`  ${colour}[${event.level}]${RESET} ${event.message}`);
        }
        break;
    }
  }

  /**
   * Generate a structured {@link TestReport} from all collected events.
   */
  generate(): TestReport {
    return buildReport(this.events);
  }
}

// =====================================================================
// JSON Reporter
// =====================================================================

/**
 * Reporter that collects events silently and produces a JSON-friendly
 * {@link TestReport} via `generate()`.
 */
export class JSONReporter implements Reporter {
  id = 'json';
  private events: TestEvent[] = [];

  /**
   * Record an event (no stdout output).
   */
  onEvent(event: TestEvent): void {
    this.events.push(event);
  }

  /**
   * Generate a structured {@link TestReport} from all collected events.
   */
  generate(): TestReport {
    return buildReport(this.events);
  }
}

// =====================================================================
// HTML Reporter
// =====================================================================

/**
 * Reporter that generates a self-contained HTML report file.
 *
 * Collects events silently and produces a single HTML file with
 * embedded CSS — no external dependencies required.
 */
export class HTMLReporter implements Reporter {
  id = 'html';
  private events: TestEvent[] = [];

  /**
   * Record an event (no stdout output).
   */
  onEvent(event: TestEvent): void {
    this.events.push(event);
  }

  /**
   * Generate a structured {@link TestReport} from all collected events.
   */
  generate(): TestReport {
    return buildReport(this.events);
  }

  /**
   * Write a self-contained HTML report to the specified path.
   *
   * @param outputPath - File path for the output HTML
   */
  async writeReport(outputPath: string): Promise<void> {
    const report = this.generate();
    const html = renderHTML(report);
    await fs.writeFile(outputPath, html, 'utf-8');
  }
}

/**
 * Render a {@link TestReport} as a self-contained HTML string.
 */
function renderHTML(report: TestReport): string {
  const ts = new Date(report.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const totalTests = report.totals.passed + report.totals.failed + report.totals.skipped;
  const passRate = totalTests > 0 ? ((report.totals.passed / totalTests) * 100).toFixed(1) : '0.0';
  const durationSec = (report.duration / 1000).toFixed(1);

  const suitesHTML = report.suites
    .map((suite, idx) => {
      const suiteTotal = suite.passed + suite.failed + suite.skipped;
      const suitePassRate = suiteTotal > 0 ? ((suite.passed / suiteTotal) * 100).toFixed(0) : '0';
      const suitePassPct = suiteTotal > 0 ? (suite.passed / suiteTotal * 100) : 0;
      const suiteFailPct = suiteTotal > 0 ? (suite.failed / suiteTotal * 100) : 0;
      const suiteSkipPct = suiteTotal > 0 ? (suite.skipped / suiteTotal * 100) : 0;
      const suiteStatus = suite.failed > 0 ? 'fail' : 'pass';
      const suiteDurSec = (suite.duration / 1000).toFixed(1);

      const casesHTML = suite.cases
        .map((c, ci) => {
          const icon = c.status === 'passed' ? '&#10003;' : c.status === 'failed' ? '&#10007;' : '&#9675;';
          const cls = c.status;
          const durDisplay = c.duration >= 1000 ? `${(c.duration / 1000).toFixed(1)}s` : `${c.duration}ms`;
          const attemptsHTML = c.attempts && c.attempts.length > 1 ? `<span class="attempts">${c.attempts.length} attempts</span>` : '';
          const errorHTML = c.error
            ? `<details class="error-details"><summary>Error Details</summary><pre class="error-pre">${escapeHTML(c.error)}</pre></details>`
            : '';
          return `<div class="case ${cls}" data-index="${ci}">
            <div class="case-header">
              <span class="icon">${icon}</span>
              <span class="case-name">${escapeHTML(c.name)}</span>
              <span class="case-meta">
                ${attemptsHTML}
                <span class="dur">${durDisplay}</span>
              </span>
            </div>
            ${errorHTML}
          </div>`;
        })
        .join('\n');

      return `
      <div class="suite ${suiteStatus}" id="suite-${idx}">
        <div class="suite-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="suite-title">
            <span class="suite-icon">${suiteStatus === 'pass' ? '&#10003;' : '&#10007;'}</span>
            <h3>${escapeHTML(suite.suite)}</h3>
          </div>
          <div class="suite-stats">
            <span class="badge passed">${suite.passed}</span>
            <span class="badge failed">${suite.failed}</span>
            <span class="badge skipped">${suite.skipped}</span>
            <span class="suite-dur">${suiteDurSec}s</span>
            <span class="suite-rate">${suitePassRate}%</span>
            <span class="chevron">&#9660;</span>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-pass" style="width:${suitePassPct}%"></div>
          <div class="progress-fail" style="width:${suiteFailPct}%"></div>
          <div class="progress-skip" style="width:${suiteSkipPct}%"></div>
        </div>
        <div class="cases">${casesHTML}</div>
      </div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ArgusAI E2E Test Report — ${escapeHTML(report.project || 'AgentStudio')}</title>
<style>
  :root {
    --green: #10b981; --red: #ef4444; --yellow: #f59e0b; --blue: #3b82f6;
    --bg: #f1f5f9; --card: #ffffff; --text: #1e293b; --muted: #94a3b8;
    --border: #e2e8f0; --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  .container { max-width: 1080px; margin: 0 auto; padding: 2rem 1.5rem; }

  /* Header */
  .header { text-align: center; margin-bottom: 2rem; }
  .header h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: .25rem; }
  .header .subtitle { color: var(--muted); font-size: .9rem; }

  /* Overview Cards */
  .overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: var(--card); border-radius: 12px; padding: 1.25rem; text-align: center; box-shadow: var(--shadow); border: 1px solid var(--border); }
  .card .num { font-size: 2rem; font-weight: 800; line-height: 1.2; }
  .card .label { font-size: .75rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-top: .25rem; }
  .card.passed .num { color: var(--green); }
  .card.failed .num { color: var(--red); }
  .card.skipped .num { color: var(--yellow); }
  .card.rate .num { color: var(--blue); }
  .card.duration .num { color: var(--text); font-size: 1.5rem; }
  .card.suites .num { color: #8b5cf6; }

  /* Global progress */
  .global-progress { height: 8px; border-radius: 4px; overflow: hidden; display: flex; margin-bottom: 2rem; background: var(--border); }
  .global-progress .gp-pass { background: var(--green); }
  .global-progress .gp-fail { background: var(--red); }
  .global-progress .gp-skip { background: var(--yellow); }

  /* Suites */
  .suite { background: var(--card); border-radius: 12px; box-shadow: var(--shadow); border: 1px solid var(--border); margin-bottom: 1rem; overflow: hidden; }
  .suite.fail { border-left: 4px solid var(--red); }
  .suite.pass { border-left: 4px solid var(--green); }
  .suite-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; cursor: pointer; user-select: none; }
  .suite-header:hover { background: #f8fafc; }
  .suite-title { display: flex; align-items: center; gap: .5rem; }
  .suite-icon { font-size: 1.1rem; }
  .suite.pass .suite-icon { color: var(--green); }
  .suite.fail .suite-icon { color: var(--red); }
  .suite h3 { font-size: .95rem; font-weight: 600; }
  .suite-stats { display: flex; align-items: center; gap: .5rem; font-size: .8rem; }
  .badge { display: inline-block; padding: .15rem .5rem; border-radius: 9999px; font-weight: 600; font-size: .7rem; }
  .badge.passed { background: #d1fae5; color: #065f46; }
  .badge.failed { background: #fee2e2; color: #991b1b; }
  .badge.skipped { background: #fef3c7; color: #92400e; }
  .suite-dur { color: var(--muted); }
  .suite-rate { font-weight: 600; color: var(--blue); }
  .chevron { color: var(--muted); transition: transform .2s; font-size: .7rem; }
  .suite.collapsed .chevron { transform: rotate(-90deg); }
  .suite.collapsed .cases { display: none; }
  .suite.collapsed .progress-bar { display: none; }

  .progress-bar { height: 3px; display: flex; margin: 0 1.25rem; }
  .progress-pass { background: var(--green); }
  .progress-fail { background: var(--red); }
  .progress-skip { background: var(--yellow); }

  .cases { padding: .5rem 1.25rem 1rem; }
  .case { padding: .5rem 0; font-size: .85rem; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; }
  .case:last-child { border-bottom: none; }
  .case-header { display: flex; align-items: center; gap: .5rem; }
  .case .icon { width: 1.25rem; text-align: center; font-weight: 700; flex-shrink: 0; }
  .case.passed .icon { color: var(--green); }
  .case.failed .icon { color: var(--red); }
  .case.skipped .icon { color: var(--yellow); }
  .case-name { flex: 1; }
  .case-meta { display: flex; gap: .5rem; align-items: center; }
  .dur { color: var(--muted); font-size: .75rem; font-variant-numeric: tabular-nums; }
  .attempts { font-size: .7rem; background: #ede9fe; color: #6d28d9; padding: .1rem .4rem; border-radius: 4px; }
  .error-details { margin-top: .4rem; }
  .error-details summary { cursor: pointer; font-size: .8rem; color: var(--red); font-weight: 500; }
  .error-pre { background: #fef2f2; color: #7f1d1d; padding: .75rem; border-radius: 6px; font-size: .75rem; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; white-space: pre-wrap; word-break: break-word; margin-top: .25rem; max-height: 200px; overflow-y: auto; }

  /* Footer */
  .footer { text-align: center; color: var(--muted); font-size: .75rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }

  /* Filter bar */
  .filter-bar { display: flex; gap: .5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .filter-btn { padding: .4rem .8rem; border: 1px solid var(--border); border-radius: 8px; font-size: .8rem; cursor: pointer; background: var(--card); color: var(--text); transition: all .15s; }
  .filter-btn:hover { border-color: var(--blue); color: var(--blue); }
  .filter-btn.active { background: var(--blue); color: white; border-color: var(--blue); }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>ArgusAI E2E Test Report</h1>
    <div class="subtitle">${escapeHTML(report.project || 'AgentStudio')} &middot; ${ts} &middot; Total Duration: ${durationSec}s</div>
  </div>

  <div class="overview">
    <div class="card passed"><div class="num">${report.totals.passed}</div><div class="label">Passed</div></div>
    <div class="card failed"><div class="num">${report.totals.failed}</div><div class="label">Failed</div></div>
    <div class="card skipped"><div class="num">${report.totals.skipped}</div><div class="label">Skipped</div></div>
    <div class="card rate"><div class="num">${passRate}%</div><div class="label">Pass Rate</div></div>
    <div class="card duration"><div class="num">${durationSec}s</div><div class="label">Duration</div></div>
    <div class="card suites"><div class="num">${report.suites.length}</div><div class="label">Suites</div></div>
  </div>

  <div class="global-progress">
    <div class="gp-pass" style="width:${totalTests > 0 ? (report.totals.passed / totalTests * 100) : 0}%"></div>
    <div class="gp-fail" style="width:${totalTests > 0 ? (report.totals.failed / totalTests * 100) : 0}%"></div>
    <div class="gp-skip" style="width:${totalTests > 0 ? (report.totals.skipped / totalTests * 100) : 0}%"></div>
  </div>

  <div class="filter-bar">
    <button class="filter-btn active" onclick="filterSuites('all')">All (${report.suites.length})</button>
    <button class="filter-btn" onclick="filterSuites('pass')">Passed (${report.suites.filter(s => s.failed === 0).length})</button>
    <button class="filter-btn" onclick="filterSuites('fail')">Failed (${report.suites.filter(s => s.failed > 0).length})</button>
  </div>

  ${suitesHTML}

  <div class="footer">
    Generated by ArgusAI &middot; ${ts}
  </div>
</div>
<script>
function filterSuites(type) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.suite').forEach(s => {
    if (type === 'all') { s.style.display = ''; }
    else if (type === 'pass') { s.style.display = s.classList.contains('pass') ? '' : 'none'; }
    else if (type === 'fail') { s.style.display = s.classList.contains('fail') ? '' : 'none'; }
  });
}
</script>
</body>
</html>`;
}

/** Escape HTML special characters */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =====================================================================
// Shared report builder
// =====================================================================

/**
 * Build a {@link TestReport} from a flat list of {@link TestEvent}s.
 *
 * Supports interleaved events from parallel suites by tracking multiple
 * active suites simultaneously via a name-keyed map.
 */
function buildReport(events: TestEvent[]): TestReport {
  const completedSuites: SuiteReport[] = [];
  const activeSuites = new Map<string, SuiteReport>();

  let firstTs = Infinity;
  let lastTs = 0;

  const getOrCreateSuite = (suiteName: string): SuiteReport => {
    let suite = activeSuites.get(suiteName);
    if (!suite) {
      suite = {
        suite: suiteName,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
        cases: [],
      };
      activeSuites.set(suiteName, suite);
    }
    return suite;
  };

  for (const event of events) {
    if (event.timestamp < firstTs) firstTs = event.timestamp;
    if (event.timestamp > lastTs) lastTs = event.timestamp;

    switch (event.type) {
      case 'suite_start':
        getOrCreateSuite(event.suite);
        break;

      case 'case_start':
        // Ensure suite exists for attribution
        getOrCreateSuite(event.suite);
        break;

      case 'case_pass': {
        const suite = getOrCreateSuite(event.suite);
        suite.passed++;
        suite.cases.push({
          name: event.name,
          status: 'passed',
          duration: event.duration,
          attempts: event.attempts,
        });
        break;
      }

      case 'case_fail': {
        const suite = getOrCreateSuite(event.suite);
        suite.failed++;
        suite.cases.push({
          name: event.name,
          status: 'failed',
          duration: event.duration,
          error: event.error,
          attempts: event.attempts,
          diagnostics: event.diagnostics,
        });
        break;
      }

      case 'case_skip': {
        const suite = getOrCreateSuite(event.suite);
        suite.skipped++;
        suite.cases.push({
          name: event.name,
          status: 'skipped',
          duration: 0,
        });
        break;
      }

      case 'suite_end': {
        const suite = activeSuites.get(event.suite);
        if (suite) {
          suite.duration = event.duration;
          completedSuites.push(suite);
          activeSuites.delete(event.suite);
        }
        break;
      }

      case 'log':
        break;
    }
  }

  // Flush any suites that never received suite_end
  for (const suite of activeSuites.values()) {
    completedSuites.push(suite);
  }

  const totals = {
    passed: completedSuites.reduce((sum, s) => sum + s.passed, 0),
    failed: completedSuites.reduce((sum, s) => sum + s.failed, 0),
    skipped: completedSuites.reduce((sum, s) => sum + s.skipped, 0),
  };

  return {
    project: '',
    timestamp: firstTs === Infinity ? Date.now() : firstTs,
    duration: lastTs > firstTs ? lastTs - firstTs : 0,
    suites: completedSuites,
    totals,
  };
}
