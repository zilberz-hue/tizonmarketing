// Agency workspaces (switcher + admin), month calendar with drag & drop, and PWA install.

// ---------- Workspace switcher ----------
function renderWsSwitch() {
  const sel = $('#ws-switch'); if (!sel) return;
  const show = workspaces.length > 1 || me?.role === 'admin';
  sel.hidden = !show; if (!show) return;
  sel.innerHTML = workspaces.map(w => `<option value="${esc(w.id)}" ${w.id === currentWs ? 'selected' : ''}>${esc(w.name)}</option>`).join('')
    + (me?.role === 'admin' ? '<option value="__new">＋ לקוח חדש…</option>' : '');
}
$('#ws-switch').addEventListener('change', safe(async e => {
  const v = e.target.value;
  if (v === '__new') {
    const name = prompt('שם הלקוח או העסק החדש:');
    if (!name) { e.target.value = currentWs; return; }
    setWs((await api('POST', '/workspaces', { name })).id);
  } else setWs(v);
  location.reload();
}));

// ---------- Admin: clients and access ----------
async function renderWorkspaceAdmin() {
  if (me?.role !== 'admin') return;
  const [wss, access] = await Promise.all([api('GET', '/workspaces'), api('GET', '/access')]);
  const box = document.createElement('div');
  box.id = 'ws-admin';
  box.innerHTML = `<form class="panel" id="ws-form"><div class="bar"><h3>👥 לקוחות וסביבות עבודה</h3></div>
      <p class="meta">כל לקוח מקבל סביבה נפרדת: קמפיינים, לידים, חיבורים והגדרות משלו. לאתר של לקוח מוסיפים את מזהה הסביבה לטופס הלידים (ראו "קוד לאתר").</p>
      <ul class="ws-list">${wss.map(w => `<li><b>${esc(w.name)}</b> <span class="meta">${esc(w.id)}</span>
        <button type="button" data-ws-rename="${esc(w.id)}">שינוי שם</button>
        <button type="button" data-ws-snippet="${esc(w.id)}">קוד לאתר</button>
        ${w.id !== currentWs ? `<button type="button" data-ws-go="${esc(w.id)}">מעבר</button>` : '<span class="badge auto">פעילה</span>'}</li>`).join('')}</ul>
      <div class="row"><label>לקוח חדש <input name="name" placeholder="שם הלקוח או העסק"></label></div>
      <button class="btn btn-sm" type="submit">הוספת לקוח</button>
      <h4>תפקידים</h4><p class="meta">מנהל רואה ועורך הכול, כולל הגדרות וצוות. חבר צוות לא רואה הגדרות.</p>
      <div style="overflow-x:auto"><table>${access.map(u => `<tr><td>${esc(u.name || u.email)}<div class="meta">${esc(u.email)}</div></td><td><select data-role="${esc(u.email)}" aria-label="תפקיד של ${esc(u.email)}"><option value="member" ${u.role !== 'admin' ? 'selected' : ''}>חבר צוות</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>מנהל</option></select></td></tr>`).join('')}</table></div>
      ${access.some(u => u.role !== 'admin') ? `<h4>הרשאות צוות</h4><div style="overflow-x:auto"><table><tr><th>איש צוות</th>${wss.map(w => `<th>${esc(w.name)}</th>`).join('')}</tr>
        ${access.filter(u => u.role !== 'admin').map(u => `<tr><td>${esc(u.name || u.email)}<div class="meta">${esc(u.email)}</div></td>${wss.map(w => `<td><input type="checkbox" data-access="${esc(u.email)}" value="${esc(w.id)}" ${u.workspaces.includes(w.id) ? 'checked' : ''} aria-label="${esc(u.email)} – ${esc(w.name)}"></td>`).join('')}</tr>`).join('')}</table></div>` : '<p class="meta">מנהלים רואים את כל הסביבות. חברי צוות מקבלים גישה לסביבות כאן.</p>'}
    </form>`;
  $('#ws-admin')?.remove();
  $('#settings').prepend(box);
}
document.addEventListener('submit', safe(async e => {
  if (e.target.id !== 'ws-form') return;
  e.preventDefault();
  const name = new FormData(e.target).get('name').trim(); if (!name) return;
  await api('POST', '/workspaces', { name });
  await refresh(); await renderWorkspaceAdmin(); toast('הלקוח נוסף');
}));
document.addEventListener('click', safe(async e => {
  const go = e.target.closest('[data-ws-go]'), ren = e.target.closest('[data-ws-rename]'), sn = e.target.closest('[data-ws-snippet]');
  if (go) { setWs(go.dataset.wsGo); location.reload(); }
  if (ren) { const name = prompt('שם חדש:'); if (name?.trim()) { await api('PUT', '/workspaces/' + ren.dataset.wsRename, { name }); await refresh(); await renderWorkspaceAdmin(); } }
  if (sn) {
    const code = `fetch('${location.origin}/api/public/lead', {\n  method: 'POST', headers: { 'content-type': 'application/json' },\n  body: JSON.stringify({ name, phone, email, message, ws: '${sn.dataset.wsSnippet}' })\n});`;
    navigator.clipboard?.writeText(code); toast('הקוד הועתק. הדביקו אותו בטופס באתר של הלקוח');
  }
}));
document.addEventListener('change', safe(async e => {
  const cb = e.target.closest('[data-access]'); if (!cb) return;
  const email = cb.dataset.access;
  const list = [...document.querySelectorAll(`[data-access="${CSS.escape(email)}"]:checked`)].map(x => x.value);
  await api('PUT', '/access', { email, workspaces: list });
  toast('ההרשאות עודכנו');
}));

// ---------- Month calendar with drag & drop ----------
let calView = (() => { try { return localStorage.getItem('tz-calview') || 'list'; } catch { return 'list'; } })();
const calMonth = new Date(); calMonth.setDate(1);
const CH_ICON = { Facebook: '📘', Instagram: '📸', WhatsApp: '💬', TikTok: '🎬', LinkedIn: '💼', Google: '🔎', Email: '✉️', Telegram: '✈️' };
const MOVABLE = ['מתוזמן', 'טיוטה', 'ממתין לבדיקה', 'ידני', 'נכשל'];

function renderCalendar() {
  const box = $('#cal'), list = $('#post-list'); if (!box) return;
  document.querySelectorAll('#content-view button').forEach(b => b.classList.toggle('on', b.dataset.view === calView));
  list.hidden = calView === 'month'; box.hidden = calView !== 'month';
  if (calView !== 'month') return;
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), pad = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}-`, todayStr = today();
  const byDay = {};
  for (const p of db.posts) if (p.date?.startsWith(prefix)) (byDay[+p.date.slice(8)] ||= []).push(p);
  const cells = [...Array(pad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  box.innerHTML = `<div class="cal-head"><button type="button" data-cal="-1" aria-label="חודש קודם">›</button><b>${calMonth.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</b><button type="button" data-cal="1" aria-label="חודש הבא">‹</button></div>
    <p class="meta">גררו פוסט ליום אחר כדי לדחות או להקדים אותו. לחצו על פוסט כדי לערוך.</p>
    <div class="cal-grid">${['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
    ${cells.map(d => {
      if (!d) return '<div class="day empty"></div>';
      const ds = prefix + String(d).padStart(2, '0');
      return `<div class="day ${ds === todayStr ? 'today' : ''}" data-date="${ds}"><span class="dn">${d}</span>${(byDay[d] || []).sort((a, b) => a.time.localeCompare(b.time)).map(p =>
        `<div class="cpost s-${p.risk?.level === 'high' && p.status !== 'פורסם' ? 'risk' : p.status === 'פורסם' ? 'done' : p.status === 'טיוטה' ? 'draft' : 'sched'}" ${MOVABLE.includes(p.status) ? 'draggable="true"' : ''} data-id="${p.id}" tabindex="0" title="${esc(p.status)}: ${esc(p.text)}">${esc(p.time)} ${CH_ICON[p.channel] || '•'} ${esc(p.text.slice(0, 16))}</div>`).join('')}</div>`;
    }).join('')}</div>`;
}

$('#content-view')?.addEventListener('click', e => { const v = e.target.dataset.view; if (v) { calView = v; try { localStorage.setItem('tz-calview', v); } catch {} renderCalendar(); } });
$('#cal')?.addEventListener('click', e => {
  const nav = e.target.closest('[data-cal]');
  if (nav) { calMonth.setMonth(calMonth.getMonth() + +nav.dataset.cal); return renderCalendar(); }
  const chip = e.target.closest('.cpost'); if (chip) return editPostDialog(chip.dataset.id);
  const day = e.target.closest('.day[data-date]');
  if (day) { $('#post-form [name=date]').value = day.dataset.date; $('#post-form [name=text]').focus(); toast('התאריך נבחר. כתבו את הפוסט בטופס למעלה'); }
});
$('#cal')?.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cpost')) editPostDialog(e.target.dataset.id); });
$('#cal')?.addEventListener('dragstart', e => { const c = e.target.closest('.cpost'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; } });
$('#cal')?.addEventListener('dragover', e => { if (e.target.closest('.day[data-date]')) { e.preventDefault(); e.target.closest('.day').classList.add('over'); } });
$('#cal')?.addEventListener('dragleave', e => e.target.closest('.day')?.classList.remove('over'));
$('#cal')?.addEventListener('drop', safe(async e => {
  const day = e.target.closest('.day[data-date]'); if (!day) return;
  e.preventDefault(); day.classList.remove('over');
  const p = db.posts.find(x => x.id === e.dataTransfer.getData('text/plain')); if (!p || p.date === day.dataset.date) return;
  const at = new Date(`${day.dataset.date}T${p.time}`);
  const patch = { at: at.toISOString() };
  if (['ידני', 'נכשל'].includes(p.status) && at > new Date()) { patch.status = 'מתוזמן'; patch.error = ''; patch.attempts = 0; }
  await api('PUT', '/posts/' + p.id, patch); await refresh(); toast('הפוסט הועבר');
}));

function editPostDialog(id) {
  const p = db.posts.find(x => x.id === id); if (!p) return;
  let dlg = $('#postdlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'postdlg'; dlg.className = 'quick'; document.body.appendChild(dlg); }
  const locked = p.status === 'פורסם';
  dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form>
    <h2>עריכת פוסט</h2><p class="sub">${esc(p.status)} · ${esc(campName(p.campaign))}</p>
    <form id="postdlg-form" class="panel">
      <div class="row"><label>תאריך <input type="date" name="date" value="${esc(p.date)}" ${locked ? 'disabled' : ''}></label>
        <label>שעה <input type="time" name="time" value="${esc(p.time)}" ${locked ? 'disabled' : ''}></label>
        <label>ערוץ <select name="channel" ${locked ? 'disabled' : ''}>${Object.keys(CH_ICON).map(c => `<option ${c === p.channel ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <label>טקסט <textarea name="text" rows="5" ${locked ? 'disabled' : ''}>${esc(p.text)}</textarea></label>
      ${thumb(p.image)}${p.status !== 'פורסם' ? riskHtml(p.risk) : ''}
      <div class="qfoot">${locked ? '' : '<button class="btn" type="submit">שמירה</button>'}${locked ? '' : '<button type="button" class="btn btn-ghost" id="postdlg-del">מחיקה</button>'}<button type="button" class="link" id="postdlg-close">סגירה</button></div>
    </form>`;
  dlg.showModal();
  $('#postdlg-close').onclick = () => dlg.close();
  const del = $('#postdlg-del');
  if (del) del.onclick = safe(async () => { if (!confirm('למחוק את הפוסט?')) return; await api('DELETE', '/posts/' + id); dlg.close(); await refresh(); });
  $('#postdlg-form').onsubmit = safe(async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target), at = new Date(`${f.get('date')}T${f.get('time')}`);
    const patch = { text: f.get('text'), channel: f.get('channel'), at: at.toISOString() };
    if (['ידני', 'נכשל'].includes(p.status) && at > new Date()) { patch.status = 'מתוזמן'; patch.error = ''; patch.attempts = 0; }
    await api('PUT', '/posts/' + id, patch); dlg.close(); await refresh(); toast('נשמר');
  });
}

// ---------- PWA ----------
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('#install-btn').hidden = false; });
$('#install-btn')?.addEventListener('click', async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; $('#install-btn').hidden = true; });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

function renderExtras() { renderWsSwitch(); renderCalendar(); }


// ---------- Drag & drop (pointer based: works with mouse and touch) ----------
// Press a handle, drag the card (a ghost follows the pointer), and the real card moves live between slots.
function dragSort({ root, itemSel, handleSel, containerSel, onDrop }) {
  root.addEventListener('pointerdown', e => {
    const handle = e.target.closest(handleSel);
    if (!handle || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = handle.closest(itemSel); if (!item) return;
    e.preventDefault();
    window.__dragging = true;
    const rect = item.getBoundingClientRect(), dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    const ghost = item.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', pointerEvents: 'none', zIndex: 80 });
    document.body.appendChild(ghost); item.classList.add('drag-source');
    const move = ev => {
      ghost.style.left = ev.clientX - dx + 'px'; ghost.style.top = ev.clientY - dy + 'px';
      if (ev.clientY < 90) window.scrollBy(0, -16); else if (innerHeight - ev.clientY < 90) window.scrollBy(0, 16);
      // Pick the nearest container by geometry (not by the element under the pointer: a sticky header may cover it).
      const conts = root.matches(containerSel) ? [root] : [...root.querySelectorAll(containerSel)];
      const dist = c => { const r = c.getBoundingClientRect(); return Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom)); };
      const cont = conts.sort((a, b) => dist(a) - dist(b))[0];
      if (!cont) return;
      const before = [...cont.children].filter(s => s !== item && s.matches(itemSel)).find(s => { const r = s.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (before) { if (item.nextElementSibling !== before) cont.insertBefore(item, before); }
      else if (cont.lastElementChild !== item) cont.appendChild(item);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      ghost.remove(); item.classList.remove('drag-source');
      Promise.resolve(onDrop(item)).catch(err => alert(err.message)).finally(() => { window.__dragging = false; renderCampaigns(); });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
}

$('#camp-view')?.addEventListener('click', e => {
  const v = e.target.dataset.view; if (!v) return;
  campView = v; try { localStorage.setItem('tz-campview', v); } catch {}
  renderCampaigns();
});
dragSort({ root: $('#campaign-list'), itemSel: '.item', handleSel: '.handle', containerSel: '#campaign-list',
  onDrop: () => saveCampOrder([...document.querySelectorAll('#campaign-list > .item')].map(el => ({ id: el.dataset.id }))) });
dragSort({ root: $('#campaign-board'), itemSel: '.kcard', handleSel: '.handle', containerSel: '.kcol',
  onDrop: () => saveCampOrder([...document.querySelectorAll('#campaign-board .kcol')].flatMap(col => [...col.querySelectorAll(':scope > .kcard')].map(el => ({ id: el.dataset.id, status: col.dataset.status })))) });

document.addEventListener('change', safe(async e => {
  const sel = e.target.closest('[data-role]'); if (!sel) return;
  try { await api('PUT', '/users', { email: sel.dataset.role, role: sel.value }); toast('התפקיד עודכן'); renderWorkspaceAdmin(); }
  catch (err) { await renderWorkspaceAdmin(); throw err; }
}));
