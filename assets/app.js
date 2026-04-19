(function () {
  'use strict';

  const nav = document.getElementById('nav');
  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    });
  }

  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  let isRetainer = false;
  const retainerPrices = {
    'price-starter': { num: '1.6', suffix: 'K<span style="font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0.05em">/mo</span>', range: '$1,600 – $6,400 per month' },
    'price-mid':     { num: '6.4', suffix: 'K<span style="font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0.05em">/mo</span>', range: '$6,400 – $16,000 per month' },
    'price-premium': { num: '16',  suffix: 'K<span style="font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0.05em">/mo</span>', range: '$16,000 – $48,000 per month' },
    'price-vciso':   { num: '2.4', suffix: 'K<span style="font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0.05em">/mo</span>', range: '$2,400 – $4,800 per month' },
  };
  const oneTimePrices = {
    'price-starter': { num: '2',  suffix: 'K', range: '$2,000 – $8,000 per engagement' },
    'price-mid':     { num: '8',  suffix: 'K', range: '$8,000 – $20,000 per engagement' },
    'price-premium': { num: '20', suffix: 'K', range: '$20,000 – $60,000 per engagement' },
    'price-vciso':   { num: '3',  suffix: 'K<span style="font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0.05em">/mo</span>', range: '$3,000 – $6,000 per month' },
  };
  function toggleBilling() {
    isRetainer = !isRetainer;
    document.getElementById('billing-toggle').classList.toggle('on', isRetainer);
    document.getElementById('lbl-one').classList.toggle('active', !isRetainer);
    document.getElementById('lbl-ret').classList.toggle('active', isRetainer);
    const prices = isRetainer ? retainerPrices : oneTimePrices;
    Object.entries(prices).forEach(([id, p]) => {
      const el = document.getElementById(id);
      if (el) {
        el.querySelector('.p-num').textContent = p.num;
        el.querySelector('.suffix').innerHTML = p.suffix;
      }
      const rangeEl = document.getElementById('range-' + id.replace('price-', ''));
      if (rangeEl) rangeEl.textContent = p.range;
    });
  }
  const billingToggle = document.getElementById('billing-toggle');
  if (billingToggle) billingToggle.addEventListener('click', toggleBilling);

  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.platform-card').forEach(card => {
        const show = cat === 'all' || card.dataset.cat === cat;
        card.style.display = show ? '' : 'none';
      });
    });
  });

  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });
    revealEls.forEach(el => observer.observe(el));
  }

  const modals = document.querySelectorAll('.modal');
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function openModal(id, source) {
    const m = document.getElementById('modal-' + id);
    if (!m) return;
    const sourceInput = m.querySelector('input[name="source"]');
    if (sourceInput) sourceInput.value = source || '';
    m.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => {
      const first = m.querySelector('input:not([type=hidden]):not(.honeypot), select, textarea');
      if (first) first.focus();
    }, 60);
  }
  function closeModal(m) {
    m.hidden = true;
    document.body.classList.remove('modal-open');
    const status = m.querySelector('.modal-status');
    if (status) { status.textContent = ''; status.className = 'modal-status'; }
    const success = m.querySelector('.modal-success');
    if (success) success.remove();
    const form = m.querySelector('form');
    if (form) {
      form.hidden = false;
      form.reset();
      const submit = form.querySelector('.modal-submit');
      if (submit) {
        submit.disabled = false;
        submit.textContent = form.dataset.formType === 'download' ? 'Email My Access Code' : 'Send Request';
      }
    }
  }
  modals.forEach(m => {
    m.querySelectorAll('[data-modal-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(m));
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modals.forEach(m => { if (!m.hidden) closeModal(m); });
  });
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(btn.dataset.modal, btn.dataset.modalSource || btn.textContent.trim());
    });
  });
  document.querySelectorAll('.modal-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const modal = form.closest('.modal');
      const status = modal.querySelector('.modal-status');
      const submit = form.querySelector('.modal-submit');
      const data = Object.fromEntries(new FormData(form).entries());
      data.formType = form.dataset.formType;

      if (!data.name || !data.email) {
        status.textContent = 'Please fill in name and email.';
        status.className = 'modal-status error';
        return;
      }

      status.textContent = '';
      status.className = 'modal-status';
      submit.disabled = true;
      submit.textContent = 'Sending…';

      try {
        const resp = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const out = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
        form.hidden = true;
        const msg = document.createElement('div');
        msg.className = 'modal-success';
        const label = form.dataset.formType === 'download'
          ? `Your 7-day access code is on its way to <strong>${escHtml(data.email)}</strong>. Click the link inside to launch the scanner.`
          : `We'll be in touch at <strong>${escHtml(data.email)}</strong> within one business day.`;
        msg.innerHTML = `<div class="check-circle">&#10003;</div><h4>Thanks — we got it.</h4><p>${label}</p>`;
        form.parentNode.insertBefore(msg, form.nextSibling);
      } catch (err) {
        status.textContent = err.message || 'Failed to send. Please try again.';
        status.classList.add('error');
        submit.disabled = false;
        submit.textContent = form.dataset.formType === 'download' ? 'Email My Access Code' : 'Send Request';
      }
    });
  });
})();
