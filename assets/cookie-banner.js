(function () {
  'use strict';
  const KEY = 'aegis_privacy_ack_v1';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }

  const style = document.createElement('style');
  style.textContent = `
    .aegis-cb { position: fixed; bottom: 20px; right: 20px; max-width: 380px; z-index: 999; background: linear-gradient(180deg, #141722 0%, #0A0C10 100%); color: #EAE7E1; border: 1px solid rgba(201,168,76,0.18); border-radius: 16px; padding: 20px 22px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; line-height: 1.55; opacity: 0; transform: translateY(20px); transition: opacity 0.4s cubic-bezier(0.16,1,0.3,1), transform 0.4s cubic-bezier(0.16,1,0.3,1); }
    .aegis-cb.visible { opacity: 1; transform: translateY(0); }
    .aegis-cb-eyebrow { display: inline-block; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #C9A84C; font-weight: 700; margin-bottom: 8px; }
    .aegis-cb p { margin: 0 0 14px; color: #8A96B0; }
    .aegis-cb p strong { color: #F4F2EE; font-weight: 600; }
    .aegis-cb-actions { display: flex; gap: 10px; align-items: center; justify-content: flex-end; }
    .aegis-cb-learn { font-size: 12px; font-weight: 500; color: #8A96B0; text-decoration: none; transition: color 0.2s; }
    .aegis-cb-learn:hover { color: #F4F2EE; }
    .aegis-cb-accept { background: linear-gradient(135deg, #C9A84C, #1A9B8C); color: #050608; border: none; border-radius: 8px; padding: 9px 18px; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; letter-spacing: 0.02em; }
    .aegis-cb-accept:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(201,168,76,0.25); }
    @media (max-width: 500px) { .aegis-cb { left: 12px; right: 12px; bottom: 12px; max-width: none; padding: 16px 18px; } }
  `;
  document.head.appendChild(style);

  const box = document.createElement('aside');
  box.className = 'aegis-cb';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Privacy notice');
  box.innerHTML = `
    <div class="aegis-cb-eyebrow">Privacy</div>
    <p><strong>Aegis uses only essential cookies</strong> needed for the site to work. No analytics, no tracking, no third-party ads.</p>
    <div class="aegis-cb-actions">
      <a href="/privacy/" class="aegis-cb-learn">Details</a>
      <button type="button" class="aegis-cb-accept">Got it</button>
    </div>`;
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('visible'));

  box.querySelector('.aegis-cb-accept').addEventListener('click', () => {
    try { localStorage.setItem(KEY, new Date().toISOString()); } catch {}
    box.classList.remove('visible');
    setTimeout(() => box.remove(), 400);
  });
})();
