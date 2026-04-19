import { generateAccessCode } from '../_shared/access.js';

const NOTIFY_EMAIL_DEFAULT = 'tyler.perleberg@aisymmetricsolutions.com';
const FROM_DEFAULT = 'Aegis Website <onboarding@resend.dev>';
const TOOL_URL_DEFAULT = 'https://aisymmetricaegis.com/scan/';

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (data.website) return json({ ok: true });

  const formType = data.formType === 'download' ? 'download' : 'assessment';
  const fields = sanitize(data);

  if (!fields.email || !isEmail(fields.email)) return json({ error: 'A valid email is required.' }, 400);
  if (!fields.name || fields.name.length < 2) return json({ error: 'Please provide your name.' }, 400);
  if (formType === 'assessment' && !fields.company) return json({ error: 'Please provide your company name.' }, 400);

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return json({ error: 'Email service not configured. Please try again later.' }, 500);
  }

  const from = env.RESEND_FROM || FROM_DEFAULT;
  const notifyTo = env.NOTIFY_EMAIL || NOTIFY_EMAIL_DEFAULT;
  const toolBase = env.AEGIS_TOOL_URL || TOOL_URL_DEFAULT;

  let access = null;
  if (formType === 'download') {
    try {
      access = await generateAccessCode(env.ACCESS_SECRET);
    } catch (e) {
      console.error('Access code generation failed:', e);
      return json({ error: 'Access control is not configured. Please try again later.' }, 500);
    }
  }

  const toolUrl = access ? `${toolBase.replace(/\/$/, '/')}?code=${encodeURIComponent(access.code)}` : toolBase;

  const notifySubject = formType === 'assessment'
    ? `New Assessment Request — ${fields.company}`
    : `New Free Scan Request — ${fields.company || fields.name}`;

  const confirmSubject = formType === 'assessment'
    ? "We've got your assessment request — AISymmetric Aegis"
    : 'Your 7-day Aegis Scan access — AISymmetric Aegis';

  const [notify, confirm] = await Promise.allSettled([
    sendEmail(apiKey, {
      from,
      to: [notifyTo],
      reply_to: fields.email,
      subject: notifySubject,
      html: buildNotifyHtml(formType, fields, access),
      text: buildNotifyText(formType, fields, access),
    }),
    sendEmail(apiKey, {
      from,
      to: [fields.email],
      reply_to: notifyTo,
      subject: confirmSubject,
      html: buildConfirmHtml(formType, fields, toolUrl, access),
      text: buildConfirmText(formType, fields, toolUrl, access),
    }),
  ]);

  if (notify.status === 'rejected') {
    console.error('Notification email failed:', notify.reason);
    return json({ error: 'Failed to send message. Please email us directly.' }, 502);
  }
  if (confirm.status === 'rejected') {
    console.error('Confirmation email failed (non-fatal):', confirm.reason);
  }

  return json({ ok: true });
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function sendEmail(apiKey, payload) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend ${resp.status}: ${body}`);
  }
  return resp.json();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function sanitize(data) {
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') clean[k] = v.trim().slice(0, 2000);
  }
  return clean;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value) {
  if (!value) return '';
  return `<tr>
    <td style="padding:8px 16px 8px 0;color:#6B7A9A;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
    <td style="padding:8px 0;color:#0A0C10;font-size:14px;vertical-align:top;">${escapeHtml(value).replace(/\n/g, '<br>')}</td>
  </tr>`;
}

function firstName(name) {
  return (name || '').split(/\s+/)[0] || name || '';
}

function emailShell(title, accent, bodyHtml) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#F4F2EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #EAE7E1;">
  <tr><td style="background:#0A0C10;padding:24px 28px;">
    <div style="color:${accent};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;">AISymmetric Aegis</div>
    <div style="color:#F4F2EE;font-size:20px;font-weight:700;margin-top:6px;letter-spacing:-0.01em;">${escapeHtml(title)}</div>
  </td></tr>
  ${bodyHtml}
</table>
</body></html>`;
}

function buildNotifyHtml(formType, f, access) {
  const title = formType === 'assessment' ? 'New Assessment Request' : 'New Free Scan Request';
  const accent = formType === 'assessment' ? '#C9A84C' : '#1A9B8C';
  const assessRows = [row('Name', f.name), row('Email', f.email), row('Company', f.company), row('Role', f.role), row('Size', f.size), row('Interest', f.interest), row('Timeline', f.timeline), row('Context', f.context), row('Source', f.source)];
  const scanRows = [row('Name', f.name), row('Email', f.email), row('Company', f.company), row('Use case', f.useCase), row('Source', f.source)];
  if (access) {
    scanRows.push(row('Access code issued', access.code));
    scanRows.push(row('Expires', access.expiresAt.toISOString().slice(0, 10)));
  }
  const rows = (formType === 'assessment' ? assessRows : scanRows).join('');

  const body = `<tr><td style="padding:24px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>
  <tr><td style="padding:16px 28px;background:#F4F2EE;color:#6B7A9A;font-size:12px;">
    Reply directly to this email to contact ${escapeHtml(f.name)}.
  </td></tr>`;

  return emailShell(title, accent, body);
}

function buildNotifyText(formType, f, access) {
  const title = formType === 'assessment' ? 'New Assessment Request' : 'New Free Scan Request';
  const pairs = formType === 'assessment'
    ? [['Name', f.name], ['Email', f.email], ['Company', f.company], ['Role', f.role], ['Size', f.size], ['Interest', f.interest], ['Timeline', f.timeline], ['Context', f.context], ['Source', f.source]]
    : [['Name', f.name], ['Email', f.email], ['Company', f.company], ['Use case', f.useCase], ['Source', f.source]];
  if (access) {
    pairs.push(['Access code issued', access.code]);
    pairs.push(['Expires', access.expiresAt.toISOString().slice(0, 10)]);
  }
  return `${title}\n\n` + pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}

function buildConfirmHtml(formType, f, toolUrl, access) {
  const hi = firstName(f.name);
  if (formType === 'assessment') {
    const title = 'Thanks — we got your request.';
    const accent = '#C9A84C';
    const body = `<tr><td style="padding:28px 28px 8px;color:#0A0C10;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(hi)},</p>
      <p style="margin:0 0 16px;">Thanks for reaching out about a security assessment${f.company ? ` for <strong>${escapeHtml(f.company)}</strong>` : ''}. We review every request personally and take scope seriously.</p>
      <p style="margin:0 0 12px;font-weight:600;color:#0A0C10;">What happens next:</p>
      <ol style="margin:0 0 16px 18px;padding:0;color:#0A0C10;">
        <li style="margin-bottom:8px;">We'll review your request within one business day.</li>
        <li style="margin-bottom:8px;">We'll reach out to set up a short scoping call (~30 min) to clarify goals, timeline, and deliverables.</li>
        <li style="margin-bottom:0;">You'll receive a fixed-fee proposal with a clear statement of work — no surprise overages.</li>
      </ol>
      <p style="margin:0 0 16px;">In the meantime, feel free to reply to this email with anything you'd like us to know in advance.</p>
      <p style="margin:0;color:#6B7A9A;font-size:14px;">— The AISymmetric Aegis team</p>
    </td></tr>
    <tr><td style="padding:20px 28px;background:#F4F2EE;color:#6B7A9A;font-size:12px;line-height:1.5;">
      AISymmetric LLC &middot; Minnesota, USA &middot; <a href="https://aisymmetricaegis.com" style="color:${accent};text-decoration:none;">aisymmetricaegis.com</a>
    </td></tr>`;
    return emailShell(title, accent, body);
  }

  // download / free scan
  const title = 'Your 7-day Aegis Scan access';
  const accent = '#1A9B8C';
  const code = access ? access.code : '';
  const expiresLabel = access ? access.expiresAt.toUTCString() : '';
  const body = `<tr><td style="padding:28px 28px 8px;color:#0A0C10;font-size:15px;line-height:1.6;">
    <p style="margin:0 0 16px;">Hi ${escapeHtml(hi)},</p>
    <p style="margin:0 0 20px;">Thanks for trying the Aegis Quick Scan — a passive security snapshot for sites you own. It runs in your browser, delivers a branded HTML report in seconds, and doesn't generate any scan traffic against the target.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="border-radius:10px;background:linear-gradient(135deg,#C9A84C,#1A9B8C);">
        <a href="${escapeHtml(toolUrl)}" style="display:inline-block;padding:14px 28px;color:#0A0C10;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:0.02em;">Launch Aegis Scanner &rarr;</a>
      </td></tr>
    </table>
    <div style="background:#F4F2EE;border:1px dashed #D9D2C4;border-radius:10px;padding:16px 18px;margin:0 0 20px;">
      <div style="font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#8A6E30;font-weight:700;margin-bottom:6px;">Your access code</div>
      <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;font-weight:700;color:#0A0C10;letter-spacing:0.04em;word-break:break-all;">${escapeHtml(code)}</div>
      <div style="font-size:12px;color:#6B7A9A;margin-top:8px;line-height:1.5;">Clicking the button above unlocks the scanner for you automatically. If you need to paste the code in later, it's valid until <strong>${escapeHtml(expiresLabel)}</strong> (7 days).</div>
    </div>
    <p style="margin:0 0 12px;font-weight:600;color:#0A0C10;">A few ground rules:</p>
    <ul style="margin:0 0 16px 18px;padding:0;color:#0A0C10;">
      <li style="margin-bottom:6px;">Only scan sites you own or have <strong>explicit authorization</strong> to assess.</li>
      <li style="margin-bottom:6px;">Passive only — reads headers, DNS, and public resources. No fuzzing or traffic generation.</li>
      <li style="margin-bottom:6px;">After each scan, hit <em>Download HTML Report</em> for a printable, branded copy.</li>
      <li style="margin-bottom:0;">Need another 7 days? Request a fresh code from the site any time.</li>
    </ul>
    <p style="margin:0;color:#6B7A9A;font-size:14px;">— The AISymmetric Aegis team</p>
  </td></tr>
  <tr><td style="padding:20px 28px;background:#F4F2EE;color:#6B7A9A;font-size:12px;line-height:1.5;">
    AISymmetric LLC &middot; Minnesota, USA &middot; <a href="https://aisymmetricaegis.com" style="color:${accent};text-decoration:none;">aisymmetricaegis.com</a>
  </td></tr>`;
  return emailShell(title, accent, body);
}

function buildConfirmText(formType, f, toolUrl, access) {
  const hi = firstName(f.name);
  if (formType === 'assessment') {
    return `Hi ${hi},

Thanks for reaching out about a security assessment${f.company ? ` for ${f.company}` : ''}. We review every request personally and take scope seriously.

What happens next:
 1. We'll review your request within one business day.
 2. We'll reach out to set up a short scoping call (~30 min) to clarify goals, timeline, and deliverables.
 3. You'll receive a fixed-fee proposal with a clear statement of work — no surprise overages.

In the meantime, feel free to reply to this email with anything you'd like us to know in advance.

— The AISymmetric Aegis team
https://aisymmetricaegis.com`;
  }
  const codeBlock = access ? `
ACCESS CODE: ${access.code}
VALID UNTIL: ${access.expiresAt.toUTCString()} (7 days)

` : '';
  return `Hi ${hi},

Thanks for trying the Aegis Quick Scan — a passive security snapshot for sites you own. It runs in your browser; no install needed.

Launch the scanner: ${toolUrl}
${codeBlock}
How to use it:
 - Only scan sites you own or have explicit authorization to assess.
 - Passive only — reads headers, DNS, and public resources. No fuzzing or traffic generation.
 - After each scan, download the branded HTML report.
 - Questions or unexpected output? Reply to this email — we read everything.

— The AISymmetric Aegis team
https://aisymmetricaegis.com`;
}
