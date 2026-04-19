const NOTIFY_EMAIL_DEFAULT = 'tyler.perleberg@aisymmetricsolutions.com';
const FROM_DEFAULT = 'Aegis Website <onboarding@resend.dev>';

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (data.website) {
    return json({ ok: true });
  }

  const formType = data.formType === 'download' ? 'download' : 'assessment';
  const fields = sanitize(data);

  if (!fields.email || !isEmail(fields.email)) {
    return json({ error: 'A valid email is required.' }, 400);
  }
  if (!fields.name || fields.name.length < 2) {
    return json({ error: 'Please provide your name.' }, 400);
  }
  if (formType === 'assessment' && !fields.company) {
    return json({ error: 'Please provide your company name.' }, 400);
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return json({ error: 'Email service not configured. Please try again later.' }, 500);
  }

  const from = env.RESEND_FROM || FROM_DEFAULT;
  const to = env.NOTIFY_EMAIL || NOTIFY_EMAIL_DEFAULT;
  const subject = formType === 'assessment'
    ? `New Assessment Request — ${fields.company}`
    : `New Aegis Tool Download — ${fields.company || fields.name}`;

  const html = buildHtml(formType, fields);
  const text = buildText(formType, fields);

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: fields.email,
      subject,
      html,
      text,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error('Resend API error:', resp.status, body);
    return json({ error: 'Failed to send message. Please email us directly.' }, 502);
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

function buildHtml(formType, f) {
  const title = formType === 'assessment' ? 'New Assessment Request' : 'New Aegis Tool Download';
  const accent = formType === 'assessment' ? '#C9A84C' : '#1A9B8C';

  const rows = formType === 'assessment'
    ? [
        row('Name', f.name),
        row('Email', f.email),
        row('Company', f.company),
        row('Role', f.role),
        row('Size', f.size),
        row('Interest', f.interest),
        row('Timeline', f.timeline),
        row('Context', f.context),
        row('Source', f.source),
      ].join('')
    : [
        row('Name', f.name),
        row('Email', f.email),
        row('Company', f.company),
        row('Use case', f.useCase),
        row('Source', f.source),
      ].join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#F4F2EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #EAE7E1;">
  <tr><td style="background:#0A0C10;padding:24px 28px;">
    <div style="color:${accent};font-size:11px;letter-spacing:0.15em;text-transform:uppercase;font-weight:600;">AISymmetric Aegis</div>
    <div style="color:#F4F2EE;font-size:20px;font-weight:700;margin-top:6px;">${escapeHtml(title)}</div>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </td></tr>
  <tr><td style="padding:16px 28px;background:#F4F2EE;color:#6B7A9A;font-size:12px;">
    Reply directly to this email to contact ${escapeHtml(f.name)}.
  </td></tr>
</table>
</body></html>`;
}

function buildText(formType, f) {
  const title = formType === 'assessment' ? 'New Assessment Request' : 'New Aegis Tool Download';
  const pairs = formType === 'assessment'
    ? [['Name', f.name], ['Email', f.email], ['Company', f.company], ['Role', f.role], ['Size', f.size], ['Interest', f.interest], ['Timeline', f.timeline], ['Context', f.context], ['Source', f.source]]
    : [['Name', f.name], ['Email', f.email], ['Company', f.company], ['Use case', f.useCase], ['Source', f.source]];
  return `${title}\n\n` + pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}
