(function () {
  'use strict';
  const STORAGE_KEY = 'aegis_access_code_v1';

  const lockEl = document.getElementById('scan-lock');
  const scanUi = document.getElementById('scan-ui');
  const form = document.getElementById('scan-form');
  const input = document.getElementById('scan-url');
  const submit = document.getElementById('scan-submit');
  const errEl = document.getElementById('scan-error');
  const loadEl = document.getElementById('scan-loading');
  const reportEl = document.getElementById('scan-report');
  const lockForm = document.getElementById('lock-form');
  const lockInput = document.getElementById('lock-code');
  const lockError = document.getElementById('lock-error');
  const lockExpiry = document.getElementById('lock-expiry');
  let lastReport = null;
  let currentCode = null;

  function readStoredCode() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } }
  function writeStoredCode(code) { try { localStorage.setItem(STORAGE_KEY, code); } catch {} }
  function clearStoredCode() { try { localStorage.removeItem(STORAGE_KEY); } catch {} }

  function showLock(msg) {
    if (scanUi) scanUi.hidden = true;
    if (reportEl) reportEl.style.display = 'none';
    if (lockEl) lockEl.hidden = false;
    if (lockError) {
      if (msg) { lockError.textContent = msg; lockError.hidden = false; }
      else { lockError.textContent = ''; lockError.hidden = true; }
    }
  }
  function showScanner(expiresAt) {
    if (lockEl) lockEl.hidden = true;
    if (scanUi) scanUi.hidden = false;
    if (lockExpiry && expiresAt) {
      const d = new Date(expiresAt);
      lockExpiry.textContent = `Access expires ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} (${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })})`;
    }
  }

  async function verifyCode(code) {
    const resp = await fetch('/api/verify?code=' + encodeURIComponent(code));
    const out = await resp.json().catch(() => ({}));
    return { ok: resp.ok && out.ok, error: out.error, expiresAt: out.expiresAt };
  }

  async function boot() {
    const url = new URL(window.location.href);
    const urlCode = url.searchParams.get('code');
    if (urlCode) {
      url.searchParams.delete('code');
      history.replaceState({}, '', url.toString());
    }
    const code = urlCode || readStoredCode();
    if (!code) return showLock();

    const r = await verifyCode(code);
    if (r.ok) {
      writeStoredCode(code);
      currentCode = code;
      showScanner(r.expiresAt);
      return;
    }
    if (r.error === 'expired') {
      clearStoredCode();
      return showLock('Your access code has expired. Request a new one.');
    }
    if (r.error === 'invalid' || r.error === 'malformed') {
      clearStoredCode();
      return showLock('That access code could not be verified.');
    }
    return showLock();
  }

  if (lockForm) {
    lockForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (lockInput.value || '').trim();
      if (!code) return;
      const btn = lockForm.querySelector('button');
      const prevText = btn.textContent;
      btn.disabled = true; btn.textContent = 'Unlocking…';
      const r = await verifyCode(code);
      btn.disabled = false; btn.textContent = prevText;
      if (r.ok) {
        writeStoredCode(code);
        currentCode = code;
        showScanner(r.expiresAt);
      } else {
        lockError.textContent = r.error === 'expired' ? 'That code has expired.' : 'Code invalid or malformed.';
        lockError.hidden = false;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!url || !currentCode) return;

      errEl.style.display = 'none';
      reportEl.style.display = 'none';
      loadEl.style.display = 'block';
      submit.disabled = true;
      submit.textContent = 'Scanning…';

      try {
        const resp = await fetch('/api/scan?url=' + encodeURIComponent(url), {
          headers: { 'X-Aegis-Code': currentCode },
        });
        const data = await resp.json();
        if (resp.status === 401) {
          clearStoredCode();
          currentCode = null;
          showLock('Your access code is no longer valid. Please unlock again.');
          return;
        }
        if (!resp.ok) throw new Error(data.error || 'Scan failed.');
        lastReport = data;
        renderReport(data);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.className = 'scan-error';
        errEl.style.display = 'block';
      } finally {
        loadEl.style.display = 'none';
        submit.disabled = false;
        submit.textContent = 'Run Quick Scan';
      }
    });
  }

  document.addEventListener('click', (e) => {
    const dl = e.target.closest('[data-download]');
    if (dl && lastReport) {
      e.preventDefault();
      downloadReport(lastReport);
    }
  });

  function renderReport(data) {
    reportEl.innerHTML = reportInnerHtml(data);
    reportEl.style.display = 'block';
    setTimeout(() => reportEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    animateRing();
  }

  function animateRing() {
    const fg = document.querySelector('.score-ring .fg');
    if (!fg) return;
    const val = +document.querySelector('.score-ring').dataset.value;
    const r = 60, c = 2 * Math.PI * r;
    fg.setAttribute('stroke-dasharray', c);
    fg.setAttribute('stroke-dashoffset', c);
    requestAnimationFrame(() => {
      fg.setAttribute('stroke-dashoffset', c * (1 - val / 100));
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function statusIcon(s) {
    return s === 'pass' ? '✓' : s === 'warn' ? '!' : '×';
  }

  function reportInnerHtml(d) {
    const bd = d.score.breakdown;
    const dt = new Date(d.scannedAt);
    const when = dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    const gradientDef = `
      <svg width="0" height="0" style="position:absolute;">
        <defs>
          <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#C9A84C"/>
            <stop offset="100%" stop-color="#1A9B8C"/>
          </linearGradient>
        </defs>
      </svg>`;

    const header = `
      ${gradientDef}
      <div class="report-header">
        <div class="score-ring" data-value="${d.score.value}">
          <svg viewBox="0 0 140 140">
            <circle class="bg" cx="70" cy="70" r="60"/>
            <circle class="fg" cx="70" cy="70" r="60"/>
          </svg>
          <div class="score-number">
            <div class="val">${d.score.value}</div>
            <div class="grade">Grade ${esc(d.score.grade)}</div>
          </div>
        </div>
        <div class="report-meta">
          <div class="eyebrow">Aegis Quick Scan</div>
          <div class="target">${esc(d.scannedUrl)}</div>
          <div class="when">Scanned ${esc(when)} · ${bd.total} checks run in ${(d.durationMs / 1000).toFixed(1)}s</div>
          <div class="pills">
            <span class="pill pass"><span class="dot"></span>${bd.pass} passed</span>
            ${bd.warn ? `<span class="pill warn"><span class="dot"></span>${bd.warn} warnings</span>` : ''}
            ${bd.fail ? `<span class="pill fail"><span class="dot"></span>${bd.fail} failed</span>` : ''}
          </div>
          <div class="report-actions">
            <a href="#" class="btn-download" data-download>&darr; Download HTML Report</a>
            <a href="/#contact" class="btn-primary-cta">Request Full Assessment &rarr;</a>
          </div>
        </div>
      </div>`;

    const cats = d.categories.map(c => {
      const counts = c.checks.reduce((a, x) => { a[x.status]++; return a; }, { pass: 0, warn: 0, fail: 0 });
      const items = c.checks.map(chk => `
        <div class="check">
          <div class="icon ${chk.status}">${statusIcon(chk.status)}</div>
          <div class="check-body">
            <div class="check-name">${esc(chk.name)}</div>
            <div class="check-detail">${esc(chk.detail)}</div>
          </div>
          <div class="check-status-label ${chk.status}">${chk.status}</div>
        </div>`).join('');
      return `
        <div class="category">
          <div class="cat-head">
            <div class="cat-name">${esc(c.name)}</div>
            <div class="cat-count">${counts.pass} / ${c.checks.length} passed</div>
          </div>
          ${items}
        </div>`;
    }).join('');

    const cta = `
      <div class="next-step">
        <h3>Want the full picture?</h3>
        <p>Quick Scan only looks at what's public on the outside. A full Aegis assessment goes deeper — authenticated platforms, cloud posture, code review, LLM surface, and a fixed-fee remediation plan.</p>
        <a href="/#pricing" class="btn-primary-cta">See Assessment Tiers &rarr;</a>
      </div>`;

    return header + cats + cta;
  }

  function downloadReport(d) {
    const html = buildStandaloneHtml(d);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    const stamp = new Date(d.scannedAt).toISOString().slice(0, 10);
    const slug = (new URL(d.scannedUrl)).hostname.replace(/\./g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `aegis-quick-scan-${slug}-${stamp}.html`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function buildStandaloneHtml(d) {
    const bd = d.score.breakdown;
    const when = new Date(d.scannedAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
    const cats = d.categories.map(c => {
      const items = c.checks.map(chk => `
        <tr class="row-${chk.status}">
          <td class="cell-icon"><span class="icon icon-${chk.status}">${statusIcon(chk.status)}</span></td>
          <td class="cell-body">
            <div class="check-name">${esc(chk.name)}</div>
            <div class="check-detail">${esc(chk.detail)}</div>
          </td>
          <td class="cell-status"><span class="status-${chk.status}">${chk.status.toUpperCase()}</span></td>
        </tr>`).join('');
      return `<section class="cat">
        <h2>${esc(c.name)}</h2>
        <table class="checks">${items}</table>
      </section>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Aegis Quick Scan — ${esc(d.scannedUrl)}</title>
<style>
  :root { --gold:#C9A84C; --teal:#1A9B8C; --red:#E56B6F; --ink:#0A0C10; --mute:#5B6478; --line:#E6E3DD; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:#F4F2EE;padding:40px 20px;line-height:1.6;font-size:14px}
  .page{max-width:820px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 30px rgba(0,0,0,0.06);overflow:hidden}
  header{background:#0A0C10;color:#F4F2EE;padding:32px 40px}
  .brand{font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);font-weight:600;margin-bottom:6px}
  .title{font-size:24px;font-weight:800;letter-spacing:-0.02em}
  .meta{display:grid;grid-template-columns:160px 1fr;gap:32px;padding:32px 40px;border-bottom:1px solid var(--line);align-items:center}
  .score{position:relative;width:140px;height:140px}
  .score svg{width:100%;height:100%;transform:rotate(-90deg)}
  .score circle{fill:none;stroke-width:8}
  .score .bg{stroke:#EFECE4}
  .score .fg{stroke:url(#gg);stroke-linecap:round}
  .score-num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .score-val{font-size:40px;font-weight:800;color:var(--ink);letter-spacing:-0.03em;line-height:1}
  .score-grade{font-size:10px;letter-spacing:0.15em;color:var(--mute);text-transform:uppercase;font-weight:600;margin-top:4px}
  .target{font-size:20px;font-weight:700;color:var(--ink);word-break:break-all;letter-spacing:-0.01em;margin-bottom:8px}
  .when{font-size:12px;color:var(--mute);margin-bottom:14px}
  .pills{display:flex;gap:8px;flex-wrap:wrap}
  .pill{padding:5px 10px;border-radius:100px;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase}
  .pill-pass{background:rgba(26,155,140,0.1);color:var(--teal)}
  .pill-warn{background:rgba(201,168,76,0.12);color:#8A6E30}
  .pill-fail{background:rgba(229,107,111,0.12);color:#B04B4F}
  .body{padding:24px 40px 36px}
  .cat{margin-top:18px}
  .cat:first-child{margin-top:0}
  .cat h2{font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:var(--mute);font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}
  .checks{width:100%;border-collapse:collapse}
  .checks tr{border-bottom:1px solid #F3F0EA}
  .checks tr:last-child{border-bottom:none}
  .cell-icon{padding:10px 12px 10px 0;width:28px;vertical-align:top}
  .cell-body{padding:10px 12px;vertical-align:top}
  .cell-status{padding:10px 0 10px 12px;vertical-align:top;text-align:right;white-space:nowrap}
  .icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:11px;font-weight:700}
  .icon-pass{background:rgba(26,155,140,0.15);color:var(--teal)}
  .icon-warn{background:rgba(201,168,76,0.18);color:#8A6E30}
  .icon-fail{background:rgba(229,107,111,0.15);color:#B04B4F}
  .check-name{font-weight:600;color:var(--ink);font-size:13.5px;margin-bottom:2px}
  .check-detail{color:#5B6478;font-size:12.5px;line-height:1.5}
  .status-pass,.status-warn,.status-fail{font-size:9.5px;font-weight:700;letter-spacing:0.12em;padding:3px 7px;border-radius:4px}
  .status-pass{background:rgba(26,155,140,0.12);color:var(--teal)}
  .status-warn{background:rgba(201,168,76,0.14);color:#8A6E30}
  .status-fail{background:rgba(229,107,111,0.12);color:#B04B4F}
  footer{padding:22px 40px;background:#F8F5EF;border-top:1px solid var(--line);font-size:11.5px;color:var(--mute);line-height:1.55}
  footer a{color:var(--gold);text-decoration:none;font-weight:600}
  .next{background:linear-gradient(135deg,rgba(201,168,76,0.08),rgba(26,155,140,0.08));border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:18px 22px;margin:24px 40px 10px;text-align:center}
  .next strong{color:var(--ink);font-size:14px;display:block;margin-bottom:4px}
  .next span{font-size:12.5px;color:#5B6478}
  .next a{display:inline-block;margin-top:10px;background:linear-gradient(135deg,var(--gold),var(--teal));color:var(--ink);font-weight:700;font-size:12px;padding:9px 16px;border-radius:8px;text-decoration:none;letter-spacing:0.02em}
  @media print { body{padding:0;background:#fff} .page{box-shadow:none} }
</style>
</head><body>
<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#C9A84C"/><stop offset="100%" stop-color="#1A9B8C"/></linearGradient></defs></svg>
<div class="page">
  <header>
    <div class="brand">AISymmetric Aegis &middot; Quick Scan</div>
    <div class="title">Passive security snapshot</div>
  </header>
  <div class="meta">
    <div class="score">
      <svg viewBox="0 0 140 140"><circle class="bg" cx="70" cy="70" r="60"/><circle class="fg" cx="70" cy="70" r="60" stroke-dasharray="${2*Math.PI*60}" stroke-dashoffset="${2*Math.PI*60*(1-d.score.value/100)}"/></svg>
      <div class="score-num"><div class="score-val">${d.score.value}</div><div class="score-grade">Grade ${esc(d.score.grade)}</div></div>
    </div>
    <div>
      <div class="target">${esc(d.scannedUrl)}</div>
      <div class="when">Scanned ${esc(when)} &middot; ${bd.total} checks &middot; ${(d.durationMs/1000).toFixed(1)}s</div>
      <div class="pills">
        <span class="pill pill-pass">${bd.pass} passed</span>
        ${bd.warn ? `<span class="pill pill-warn">${bd.warn} warnings</span>` : ''}
        ${bd.fail ? `<span class="pill pill-fail">${bd.fail} failed</span>` : ''}
      </div>
    </div>
  </div>
  <div class="body">${cats}</div>
  <div class="next">
    <strong>Want a deeper look?</strong>
    <span>Quick Scan stays on the surface. A full Aegis assessment adds authenticated platforms, cloud posture, code review, and a fixed-fee remediation plan.</span><br>
    <a href="https://aisymmetricaegis.com/#pricing">See Assessment Tiers &rarr;</a>
  </div>
  <footer>Generated by <a href="https://aisymmetricaegis.com/scan/">Aegis Quick Scan</a> on behalf of AISymmetric LLC. Quick Scan is informational and passive; it does not constitute a security assessment or a statement of compliance.</footer>
</div>
</body></html>`;
  }

  boot();
})();
