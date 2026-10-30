// 📋 Setup checklist: pops up when an admin opens Settings (once per visit, unless switched off) and can be reopened from the Settings header.
// Status comes from the live connection state; the admin-password item is the same "s1" task as in the work plan.

const SETUP_ORDER = [['ai', true], ['business', true], ['facebook', true], ['telegram', true], ['email', false], ['image', false], ['webhook', false]];
const setupGroupDone = g => g.connected ?? g.fields.some(f => f.set || (f.value && f.type !== 'select'));

function setupItems() {
  const groups = settingsState?.groups || [], items = SETUP_ORDER.map(([id, essential]) => {
    const g = groups.find(x => x.id === id); if (!g) return null;
    return { id, essential, title: g.title, desc: g.desc, done: !!setupGroupDone(g), group: id };
  }).filter(Boolean);
  items.unshift({ id: 'pw', essential: true, title: '🔑 החלפת סיסמת המנהל', desc: 'סיסמה חזקה משלכם, ואחר כך הסרת ADMIN_PASSWORD מהגדרות Netlify.', done: !!db.checklist?.s1, group: '' });
  return items;
}

function openSetupChecklist() {
  const items = setupItems(), done = items.filter(i => i.done).length;
  let dlg = $('#setup-dlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'setup-dlg'; dlg.className = 'quick'; document.body.appendChild(dlg); }
  const pct = Math.round(done / items.length * 100);
  dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form>
    <h2>📋 צ'קליסט הקמה</h2><p class="sub">${done} מתוך ${items.length} הושלמו. הפריטים המסומנים "מומלץ" כדאי להשלים לפני שמתחילים לפרסם.</p>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    <ul class="ac-list" id="setup-list">${items.map(i => `<li><div><span aria-hidden="true">${i.done ? '✅' : '⚪'}</span> <b>${esc(i.title)}</b> <span class="badge ${i.essential ? 'auto' : ''}">${i.essential ? 'מומלץ' : 'אופציונלי'}</span>${i.desc ? `<div class="meta">${esc(i.desc)}</div>` : ''}</div>
      ${i.id === 'pw' ? `<span class="acts"><button type="button" class="btn btn-sm" data-setup-pw>🔑 החלפה</button><button type="button" class="btn btn-sm btn-ghost" data-setup-tick="${i.done ? 0 : 1}">${i.done ? 'ביטול סימון' : 'סימון כבוצע'}</button></span>` : `<button type="button" class="btn btn-sm btn-ghost" data-setup-go="${esc(i.group)}">מעבר</button>`}</li>`).join('')}</ul>
    <div class="qfoot"><label class="chk"><input type="checkbox" id="setup-off" ${(() => { try { return localStorage.getItem('tz-setup-off') ? 'checked' : ''; } catch { return ''; } })()}> אל תציגו אוטומטית בכניסה להגדרות</label><button type="button" class="btn" data-close>סגירה</button></div>`;
  if (!dlg.open) dlg.showModal();
}

document.addEventListener('click', safe(async e => {
  if (e.target.closest('#setup-open')) return openSetupChecklist();
  const go = e.target.closest('[data-setup-go]');
  if (go) {
    $('#setup-dlg')?.close();
    const f = document.querySelector(`.set-group[data-group="${CSS.escape(go.dataset.setupGo)}"]`); if (!f) return;
    f.scrollIntoView({ block: 'start', behavior: 'smooth' }); f.querySelector('details')?.setAttribute('open', ''); f.querySelector('input,textarea,select')?.focus({ preventScroll: true }); return;
  }
  if (e.target.closest('[data-setup-pw]')) { $('#setup-dlg')?.close(); return $('#chpw')?.click(); }
  const tick = e.target.closest('[data-setup-tick]');
  if (tick) { const done = tick.dataset.setupTick === '1'; await api('POST', '/checklist', { key: 's1', done }); db.checklist = { ...db.checklist, s1: done ? 1 : 0 }; return openSetupChecklist(); }
}));
document.addEventListener('change', e => { if (e.target.id === 'setup-off') { try { e.target.checked ? localStorage.setItem('tz-setup-off', '1') : localStorage.removeItem('tz-setup-off'); } catch {} } });

// auto-open once per browser session when an admin opens Settings and something essential is still missing
document.addEventListener('click', e => {
  if (!e.target.closest('#tabs [data-tab=settings]') || me?.role !== 'admin') return;
  try { if (localStorage.getItem('tz-setup-off') || sessionStorage.getItem('tz-setup-shown')) return; } catch {}
  let tries = 0;
  const wait = setInterval(() => {
    if (document.querySelector('#settings .set-group') || ++tries > 25) {
      clearInterval(wait);
      if (!document.querySelector('#settings .set-group')) return;
      try { sessionStorage.setItem('tz-setup-shown', '1'); } catch {}
      if (setupItems().some(i => i.essential && !i.done)) openSetupChecklist();
    }
  }, 150);
});
