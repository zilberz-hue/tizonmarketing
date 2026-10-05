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

// TODO: connect to a real backend / form service
document.getElementById('lead-form').addEventListener('submit', e => {
  e.preventDefault();
  document.getElementById('form-status').textContent = 'תודה! נחזור אליכם בהקדם.';
  e.target.reset();
});
