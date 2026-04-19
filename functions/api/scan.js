export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const target = u.searchParams.get('url');

  const v = validateTarget(target);
  if (!v.ok) return json({ error: v.error }, 400);

  try {
    const report = await runScan(v.url);
    return json(report);
  } catch (e) {
    console.error('Scan failed:', e);
    return json({ error: e.message || 'Scan failed' }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function validateTarget(raw) {
  if (!raw) return { ok: false, error: 'Missing url parameter.' };
  let url;
  try { url = new URL(raw.startsWith('http') ? raw : `https://${raw}`); }
  catch { return { ok: false, error: 'That does not look like a valid URL.' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, error: 'Localhost addresses are not allowed.' };
  }
  if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1$|fe80:|fc00:|fd00:)/i.test(host)) {
    return { ok: false, error: 'Private IP ranges are not allowed.' };
  }
  const m = host.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) {
    return { ok: false, error: 'Private IP ranges are not allowed.' };
  }
  return { ok: true, url };
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: opts.redirect || 'follow' });
  } finally { clearTimeout(t); }
}

async function runScan(url) {
  const startedAt = Date.now();
  const targetUrl = url.toString();

  const mainReq = fetchWithTimeout(targetUrl, { headers: { 'User-Agent': 'AegisScan/1.0 (+https://aisymmetricaegis.com)' } }).catch(e => ({ error: e.message || 'fetch failed' }));

  const httpProbe = url.protocol === 'https:'
    ? fetchWithTimeout(`http://${url.hostname}${url.pathname}`, { redirect: 'manual' }, 6000).catch(() => null)
    : Promise.resolve(null);

  const robots = fetchWithTimeout(new URL('/robots.txt', url).toString(), {}, 6000).catch(() => null);
  const sitemap = fetchWithTimeout(new URL('/sitemap.xml', url).toString(), { method: 'HEAD' }, 6000).catch(() => null);
  const securityTxt = fetchWithTimeout(new URL('/.well-known/security.txt', url).toString(), { method: 'HEAD' }, 6000).catch(() => null);

  const rootDomain = getRootDomain(url.hostname);
  const spfPromise = dnsTxt(rootDomain).catch(() => []);
  const dmarcPromise = dnsTxt(`_dmarc.${rootDomain}`).catch(() => []);

  const [main, http, rb, sm, st, spfTxt, dmarcTxt] = await Promise.all([
    mainReq, httpProbe, robots, sitemap, securityTxt, spfPromise, dmarcPromise,
  ]);

  if (main && main.error) {
    throw new Error(`Could not reach ${targetUrl}: ${main.error}`);
  }

  const finalUrl = main.url || targetUrl;
  const headers = headersToObject(main.headers);
  const html = (main.headers.get('content-type') || '').includes('text/html') ? await main.text() : '';

  const checks = [];
  const cat = (id, name, items) => ({ id, name, checks: items });

  // Transport
  const transport = [];
  transport.push(check('tls', 'HTTPS in use', url.protocol === 'https:' ? 'pass' : 'fail',
    url.protocol === 'https:' ? 'Page loads over TLS.' : 'Page is served over plain HTTP.'));
  if (http) {
    const loc = http.headers.get('location') || '';
    const redirected = http.status >= 300 && http.status < 400 && /^https:/i.test(loc);
    transport.push(check('http-redirect', 'HTTP → HTTPS redirect', redirected ? 'pass' : 'warn',
      redirected ? `Plain HTTP returns ${http.status} to ${loc}.` : `Plain HTTP request did not redirect to HTTPS (status ${http.status}).`));
  }
  const server = headers['server'];
  transport.push(check('server-banner', 'Server banner hygiene', !server || isGenericServer(server) ? 'pass' : 'warn',
    !server ? 'No Server header exposed.' : `Server header reveals "${server}".`,
    { server: server || null }));

  // Security headers
  const sec = [];
  sec.push(headerCheck(headers, 'strict-transport-security', 'HSTS', 'Browsers will force HTTPS for return visits.'));
  sec.push(headerCheck(headers, 'content-security-policy', 'Content Security Policy', 'Restricts where scripts, styles, and frames may load from.'));
  sec.push(headerCheck(headers, 'x-content-type-options', 'X-Content-Type-Options', 'Blocks MIME-type sniffing.', 'nosniff'));
  sec.push(headerCheck(headers, 'x-frame-options', 'X-Frame-Options / frame-ancestors', 'Prevents clickjacking via iframe embedding.'));
  sec.push(headerCheck(headers, 'referrer-policy', 'Referrer-Policy', 'Controls how much referrer info leaves the site.'));
  sec.push(headerCheck(headers, 'permissions-policy', 'Permissions-Policy', 'Limits what browser features pages can use.'));

  // Email auth
  const email = [];
  const spf = spfTxt.find(r => /^v=spf1/i.test(r));
  email.push(check('spf', 'SPF record', spf ? 'pass' : 'fail',
    spf ? `Record found: ${truncate(spf, 120)}` : `No SPF record found for ${rootDomain}.`));
  const dmarc = dmarcTxt.find(r => /^v=DMARC1/i.test(r));
  if (dmarc) {
    const policy = (dmarc.match(/p=([a-z]+)/i) || [])[1] || '';
    const status = policy === 'reject' ? 'pass' : policy === 'quarantine' ? 'pass' : 'warn';
    email.push(check('dmarc', 'DMARC policy', status,
      `Policy: p=${policy || 'unknown'}. ${policy === 'none' ? 'Monitoring-only; spoofed mail is still delivered.' : 'Enforced policy is in place.'}`));
  } else {
    email.push(check('dmarc', 'DMARC policy', 'fail', `No DMARC record found at _dmarc.${rootDomain}.`));
  }

  // Content integrity
  const content = [];
  if (html) {
    const mixed = url.protocol === 'https:' ? countMixedContent(html) : 0;
    content.push(check('mixed-content', 'Mixed content (http:// on https page)',
      url.protocol !== 'https:' ? 'warn' : mixed === 0 ? 'pass' : mixed < 5 ? 'warn' : 'fail',
      url.protocol !== 'https:' ? 'Page is http:// — mixed content check skipped.' : mixed === 0 ? 'No http:// resources referenced.' : `Found ${mixed} http:// reference${mixed === 1 ? '' : 's'} in HTML.`));

    const { total, withIntegrity, origins, inline } = analyzeScripts(html, url);
    const external = total - inline;
    const sriStatus = external === 0 ? 'pass' : withIntegrity === external ? 'pass' : withIntegrity === 0 ? 'fail' : 'warn';
    content.push(check('sri', 'Subresource Integrity (SRI)', sriStatus,
      external === 0 ? 'No external scripts detected.' : `${withIntegrity} of ${external} external scripts use integrity= hashes.`));
    content.push(check('external-scripts', 'External script origins', origins.size === 0 ? 'pass' : origins.size <= 5 ? 'pass' : 'warn',
      origins.size === 0 ? 'No third-party script origins.' : `${origins.size} distinct third-party origin${origins.size === 1 ? '' : 's'}: ${Array.from(origins).slice(0, 8).join(', ')}${origins.size > 8 ? ', …' : ''}`));
    content.push(check('inline-scripts', 'Inline <script> blocks', inline === 0 ? 'pass' : inline < 5 ? 'warn' : 'warn',
      `${inline} inline script block${inline === 1 ? '' : 's'} found. Inline scripts work against a strict CSP.`));
  } else {
    content.push(check('mixed-content', 'Mixed content', 'warn', 'HTML content was not returned; skipping.'));
  }

  // Cookies
  const setCookie = main.headers.get('set-cookie') || '';
  if (setCookie) {
    const flags = analyzeCookies(setCookie);
    content.push(check('cookies-secure', 'Cookie Secure flag', flags.secureAll ? 'pass' : 'warn',
      flags.secureAll ? 'All cookies carry the Secure flag.' : `${flags.total - flags.secure} of ${flags.total} cookies missing Secure.`));
    content.push(check('cookies-httponly', 'Cookie HttpOnly flag', flags.httpOnlyAll ? 'pass' : 'warn',
      flags.httpOnlyAll ? 'All cookies carry HttpOnly.' : `${flags.total - flags.httpOnly} of ${flags.total} cookies readable from JS.`));
  }

  // Discoverability
  const disc = [];
  disc.push(check('robots', 'robots.txt', rb && rb.ok ? 'pass' : 'warn',
    rb && rb.ok ? 'robots.txt is served.' : 'robots.txt not found.'));
  disc.push(check('sitemap', 'sitemap.xml', sm && sm.ok ? 'pass' : 'warn',
    sm && sm.ok ? 'sitemap.xml is served.' : 'sitemap.xml not found at the root.'));
  disc.push(check('security-txt', 'security.txt', st && st.ok ? 'pass' : 'warn',
    st && st.ok ? 'security.txt is published.' : 'No /.well-known/security.txt — consider adding a vulnerability-reporting contact.'));

  const categories = [
    cat('transport', 'Transport & Encryption', transport),
    cat('headers', 'Security Headers', sec),
    cat('email', 'Email Authentication', email),
    cat('content', 'Content Integrity & Cookies', content),
    cat('discoverability', 'Discoverability & Reporting', disc),
  ];

  const summary = categories.flatMap(c => c.checks).reduce((acc, c) => {
    acc.total++;
    acc[c.status]++;
    return acc;
  }, { total: 0, pass: 0, warn: 0, fail: 0 });

  const score = Math.round(((summary.pass + 0.5 * summary.warn) / Math.max(summary.total, 1)) * 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';

  return {
    scannedUrl: targetUrl,
    finalUrl,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    score: { value: score, grade, breakdown: summary },
    categories,
  };
}

function check(id, name, status, detail, extra) {
  return { id, name, status, detail, ...(extra ? { evidence: extra } : {}) };
}

function headerCheck(headers, key, label, why, expectedValue) {
  const value = headers[key];
  if (!value) return check(key, label, 'fail', `Header missing. ${why}`);
  if (expectedValue && !value.toLowerCase().includes(expectedValue)) {
    return check(key, label, 'warn', `Present but value is "${value}" (expected to include "${expectedValue}").`, { value });
  }
  return check(key, label, 'pass', truncate(value, 160), { value });
}

function headersToObject(h) {
  const out = {};
  h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

function isGenericServer(s) {
  const v = s.toLowerCase();
  if (v === 'cloudflare' || v === 'nginx' || v === 'apache' || v === 'caddy' || v === 'litespeed') return true;
  if (/\d/.test(v)) return false;
  return true;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function countMixedContent(html) {
  const matches = html.match(/(?:src|href|action)\s*=\s*["']http:\/\/[^"']+/gi);
  return matches ? matches.length : 0;
}

function analyzeScripts(html, baseUrl) {
  const origins = new Set();
  let total = 0, withIntegrity = 0, inline = 0;
  const re = /<script\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    total++;
    const attrs = m[1];
    const srcMatch = attrs.match(/\ssrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) { inline++; continue; }
    const src = srcMatch[1];
    try {
      const resolved = new URL(src, baseUrl);
      if (resolved.host !== baseUrl.host) origins.add(resolved.host);
    } catch { /* ignore */ }
    if (/\sintegrity\s*=/i.test(attrs)) withIntegrity++;
  }
  return { total, withIntegrity, origins, inline };
}

function analyzeCookies(setCookie) {
  const cookies = setCookie.split(/,(?=[^;]+=)/).map(s => s.trim());
  let secure = 0, httpOnly = 0;
  cookies.forEach(c => {
    if (/;\s*secure/i.test(c)) secure++;
    if (/;\s*httponly/i.test(c)) httpOnly++;
  });
  return { total: cookies.length, secure, httpOnly, secureAll: secure === cookies.length, httpOnlyAll: httpOnly === cookies.length };
}

function getRootDomain(host) {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  const twoLevel = new Set(['co.uk', 'com.au', 'co.jp', 'co.nz', 'co.za', 'com.br']);
  if (twoLevel.has(`${sld}.${tld}`) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

async function dnsTxt(name) {
  const resp = await fetchWithTimeout(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: 'application/dns-json' },
  }, 6000);
  if (!resp.ok) return [];
  const body = await resp.json();
  if (!body.Answer) return [];
  return body.Answer.map(a => (a.data || '').replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}
