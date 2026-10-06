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
try { const q = new URLSearchParams(location.search), c = q.get('c'), v = q.get('v'); if (c) sessionStorage.setItem(CAMPAIGN_KEY, c); if (v) sessionStorage.setItem('tz-variant', v); } catch {}
const trackedVariant = () => { try { return sessionStorage.getItem('tz-variant') || ''; } catch { return ''; } };
const trackedCampaign = () => { try { return sessionStorage.getItem(CAMPAIGN_KEY) || ''; } catch { return ''; } };

document.getElementById('lead-form').addEventListener('submit', async e => {
  e.preventDefault();
  const status = document.getElementById('form-status');
  try {
    const r = await fetch('/api/public/lead', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(e.target)), campaign: trackedCampaign(), v: trackedVariant() })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'שגיאה');
    status.textContent = 'תודה! נחזור אליכם בהקדם.';
    e.target.reset();
  } catch (err) {
    status.textContent = err.message === 'Failed to fetch' ? 'לא ניתן לשלוח כרגע, נסו שוב מאוחר יותר.' : err.message;
  }
});
