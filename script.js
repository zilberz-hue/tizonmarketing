document.getElementById('year').textContent = new Date().getFullYear();

document.querySelectorAll('[data-count]').forEach(el => {
  const target = +el.dataset.count;
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    const start = performance.now();
    const tick = now => {
      const p = Math.min((now - start) / 1200, 1);
      el.textContent = Math.round(target * p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).observe(el);
});

// Campaign tracking link: /?c=<campaignId> attributes the lead to that campaign.
const CAMPAIGN_KEY = 'tz-campaign';
try { const c = new URLSearchParams(location.search).get('c'); if (c) sessionStorage.setItem(CAMPAIGN_KEY, c); } catch {}
const trackedCampaign = () => { try { return sessionStorage.getItem(CAMPAIGN_KEY) || ''; } catch { return ''; } };

document.getElementById('lead-form').addEventListener('submit', async e => {
  e.preventDefault();
  const status = document.getElementById('form-status');
  try {
    const r = await fetch('/api/public/lead', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(e.target)), campaign: trackedCampaign() })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'שגיאה');
    status.textContent = 'תודה! נחזור אליכם בהקדם.';
    e.target.reset();
  } catch (err) {
    status.textContent = err.message === 'Failed to fetch' ? 'לא ניתן לשלוח כרגע, נסו שוב מאוחר יותר.' : err.message;
  }
});
