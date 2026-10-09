import type { UsageSnapshot } from '../../services/usage-service';
import { formatClock, formatClockSeconds, formatDuration, formatNumber, friendlyModel, percentText } from '../format';

export interface RenderOptions {
  nonce: string;
  cspSource: string;
  hideCache: boolean;
  /** Full dashboard (trends, history) vs compact sidebar summary. */
  full: boolean;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function sparklineSvg(values: readonly number[], width = 240, height = 40): string {
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Usage over the last five hours"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${pts}"/></svg>`;
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

export function renderDashboardHtml(snap: UsageSnapshot | undefined, o: RenderOptions): string {
  const csp = `default-src 'none'; style-src 'nonce-${o.nonce}'; script-src 'nonce-${o.nonce}'; img-src ${o.cspSource} data:;`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Claude Usage</title><style nonce="${o.nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}
h1{font-size:1.2em;margin:0 0 8px}h2{font-size:1em;margin:16px 0 6px}
table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:normal;opacity:.75;padding:2px 12px 2px 0}td{padding:2px 0;text-align:right}
.bar{height:8px;background:var(--vscode-editorWidget-border,#444);border-radius:4px;overflow:hidden;margin:6px 0}
.bar>div{height:100%;background:var(--vscode-progressBar-background,#0e70c0)}
.warn{color:var(--vscode-editorWarning-foreground)}.muted{opacity:.7}
.spark{color:var(--vscode-textLink-foreground);width:100%;height:auto}
button.link{background:transparent;color:var(--vscode-textLink-foreground);border:1px solid var(--vscode-textLink-foreground);margin-right:6px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 10px;cursor:pointer}
</style></head><body>`;
  const script = `<script nonce="${o.nonce}">const vscode=acquireVsCodeApi();document.getElementById('refresh')?.addEventListener('click',()=>vscode.postMessage({type:'refresh'}));document.getElementById('usage-page')?.addEventListener('click',()=>vscode.postMessage({type:'openUsagePage'}));</script>`;
  const usagePage = `<p><button id="usage-page" class="link" title="Opens claude.ai in your browser">Open claude.ai usage page ↗</button><span class="muted">Official plan limits and usage</span></p>`;
  const tail = `${usagePage}${script}</body></html>`;

  if (!snap) return `${head}<h1>Claude Code Usage</h1><p class="muted">Loading…</p>${tail}`;
  if (snap.status === 'no-claude-data') {
    return `${head}<h1>Claude Code Usage</h1><p class="warn">Claude data was not found.</p><p>Run <b>Claude Usage: Diagnostics</b> for what was checked and how to fix it.</p>${tail}`;
  }

  const w = snap.window;
  const pct = snap.percentUsed;
  const parts: string[] = [`<h1>Claude Code Usage</h1><div class="muted">Current 5-Hour Window</div>`];
  if (pct !== undefined) {
    parts.push(`<div class="bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.min(100, pct).toFixed(1)}%"></div></div>`);
  }
  const rows = [
    row('Used', pct === undefined ? 'unknown (no capacity)' : percentText(pct)),
    row('Remaining', snap.percentRemaining === undefined ? 'unknown' : percentText(snap.percentRemaining)),
    row('Input Tokens', formatNumber(w.totals.input)),
    row('Output Tokens', formatNumber(w.totals.output)),
  ];
  if (!o.hideCache) {
    rows.push(row('Cache Read', formatNumber(w.totals.cacheRead)), row('Cache Create', formatNumber(w.totals.cacheCreate)));
  }
  rows.push(
    row('Estimated Total', formatNumber(w.totals.total)),
    row('Window Reset', w.resetAt ? formatClock(w.resetAt) : '—'),
    row('Current Model', friendlyModel(w.currentModel)),
    row('Last Refresh', formatClockSeconds(snap.generatedAt)),
  );
  parts.push(`<table>${rows.join('')}</table>`);
  if (snap.capacity) {
    parts.push(`<p class="muted">Capacity ${escapeHtml(formatNumber(snap.capacity.tokens))} tokens — ${escapeHtml(snap.capacity.method)} (${snap.capacity.confidence} confidence). ${escapeHtml(snap.capacity.note)}</p>`);
  }

  if (o.full) {
    parts.push('<h2>Trends</h2>', sparklineSvg(snap.sparkline));
    const trend = [
      row('Burn rate', `${formatNumber(snap.burnRatePerMinute)} tokens/min`),
      row('Estimated depletion', snap.depletionAt ? formatClock(snap.depletionAt) : snap.capacity ? 'not within 5h' : 'unknown'),
    ];
    parts.push(`<table>${trend.join('')}</table>`);
    if (snap.peaks.length) {
      parts.push('<h2>Peak hours</h2><table>');
      for (const p of snap.peaks) parts.push(row(`${new Date(p.start).toISOString().slice(0, 13).replace('T', ' ')}:00 UTC`, formatNumber(p.counted)));
      parts.push('</table>');
    }
    if (w.byModel.length) {
      parts.push('<h2>Models in window</h2><table>');
      for (const m of w.byModel) parts.push(row(friendlyModel(m.model), `${formatNumber(m.totals.total)} (${m.messages} msgs)`));
      parts.push('</table>');
    }
    const recent = snap.blocks.slice(-8).reverse();
    if (recent.length) {
      parts.push('<h2>Five-hour window history</h2><table>');
      for (const b of recent) {
        const when = `${new Date(b.start).toISOString().slice(5, 16).replace('T', ' ')} UTC${b.active ? ' (active)' : ''}`;
        const share = snap.capacity ? ` · ${percentText((b.counted / snap.capacity.tokens) * 100)}` : '';
        parts.push(row(when, `${formatNumber(b.counted)}${share}`));
      }
      parts.push('</table>');
    }
  } else {
    parts.push(`<h2>Trend</h2>${sparklineSvg(snap.sparkline, 200, 32)}`);
  }

  if (snap.warnings.length) {
    parts.push(`<h2>Warnings</h2><ul>${snap.warnings.map((m) => `<li class="warn">${escapeHtml(m)}</li>`).join('')}</ul>`);
  }
  parts.push('<p><button id="refresh">Refresh</button></p>');
  return head + parts.join('') + tail;
}
