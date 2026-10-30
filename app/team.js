// 👥 Team tab (admins): add team members, hand over their login details, reset passwords, set roles and client access.
// Also: every user can change their own password (🔑 in the header).

const genPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint32Array(12)); return [...r].map(n => a[n % a.length]).join(''); };
let teamInvite = null; // { name, email, password } shown once, right after creating a member or resetting a password

function inviteText(i) {
  return `שלום ${i.name || ''},\nנוצר לך משתמש במערכת השיווק של TizonHealth.\nכתובת: ${location.origin}/app/\nאימייל: ${i.email}\nסיסמה זמנית: ${i.password}\nמומלץ להחליף את הסיסמה בכניסה הראשונה (הכפתור 🔑 למעלה).`.replace(/\s+,/, ',');
}

function seenHtml(u) {
  if (!u.lastSeen) return '<span class="meta">עדיין לא נכנס/ה</span>';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(u.lastSeen)) / 60000));
  if (mins <= 2) return '<span class="ok">🟢 מחובר/ת עכשיו</span>';
  const ago = mins < 60 ? `לפני ${mins} דקות` : mins < 1440 ? `לפני ${Math.round(mins / 60)} שעות` : `לפני ${Math.round(mins / 1440)} ימים`;
  return `<span class="meta">${ago}${u.lastLogin ? `<br>כניסה אחרונה: ${new Date(u.lastLogin).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}` : ''}</span>`;
}
// keeps "connected now" fresh without re-rendering the tab (so nothing typed is lost)
setInterval(async () => {
  if (document.hidden || !$('#team.active') || me?.role !== 'admin') return;
  try { for (const u of await api('GET', '/access')) { const c = document.querySelector(`[data-seen="${CSS.escape(u.email)}"]`); if (c) c.innerHTML = seenHtml(u); } } catch {}
}, 30000);

async function loadTeam() {
  const root = $('#team'); if (!root || me?.role !== 'admin') return;
  const [people, wss] = await Promise.all([api('GET', '/access'), api('GET', '/workspaces')]);
  root.innerHTML = `<div class="bar"><h2>👥 צוות</h2></div>
    <p class="meta">כאן מוסיפים אנשי צוות ומגדירים מה כל אחד יכול לעשות. מנהל רואה ועורך הכול, כולל הגדרות. חבר צוות עובד בקמפיינים, תוכן, לידים, מטופלים והצעות, ורק בלקוחות שסימנתם לו.</p>
    ${teamInvite ? `<section class="panel invite" role="status"><h3>✅ ${esc(teamInvite.name || teamInvite.email)} מוכן/ה להתחבר</h3>
      <p class="meta">הסיסמה מוצגת רק עכשיו. העתיקו את הפרטים ושלחו אותם (וואטסאפ, מייל). אפשר לאפס סיסמה בכל עת.</p>
      <pre dir="rtl" id="invite-text">${esc(inviteText(teamInvite))}</pre>
      <div class="acts"><button type="button" class="btn btn-sm" id="invite-copy">העתקת הפרטים</button><a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(inviteText(teamInvite))}">שליחה בוואטסאפ</a><button type="button" class="link" id="invite-close">סגירה</button></div></section>` : ''}
    <form id="team-form" class="panel" autocomplete="off"><h3>הוספת איש צוות</h3>
      <div class="row"><label>שם <input name="name" maxlength="100" autocomplete="off"></label>
        <label>אימייל <input name="email" type="email" required autocomplete="off" dir="ltr"></label>
        <label>סיסמה זמנית (8 תווים לפחות) <span class="pw"><input name="password" type="text" minlength="8" required autocomplete="new-password" dir="ltr"><button type="button" class="eye" id="team-gen" title="יצירת סיסמה אקראית" aria-label="יצירת סיסמה אקראית">🎲</button></span></label>
        <label>תפקיד <select name="role"><option value="member">חבר צוות</option><option value="admin">מנהל</option></select></label></div>
      <fieldset class="chips"><legend>לקוחות שאפשר לפתוח (לחבר צוות)</legend>${wss.map(w => `<label class="chip"><input type="checkbox" name="ws" value="${esc(w.id)}" ${w.id === 'main' ? 'checked' : ''}><span>${esc(w.name)}</span></label>`).join('')}</fieldset>
      <div class="err" id="team-err" role="alert" hidden></div>
      <button class="btn btn-sm" type="submit">הוספה</button></form>
    <section class="panel"><h3>אנשי הצוות</h3><div style="overflow-x:auto"><table><tr><th>איש צוות</th><th>תפקיד</th><th>לקוחות</th><th>נראה לאחרונה</th><th></th></tr>
      ${people.map(u => `<tr><td>${esc(u.name || u.email)}<div class="meta">${esc(u.email)}${u.email === me.email ? ' · אתם' : ''}</div></td>
        <td><select data-role="${esc(u.email)}" aria-label="תפקיד של ${esc(u.email)}"><option value="member" ${u.role !== 'admin' ? 'selected' : ''}>חבר צוות</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>מנהל</option></select></td>
        <td>${u.role === 'admin' ? '<span class="meta">כולם</span>' : wss.map(w => `<label class="chk"><input type="checkbox" data-access="${esc(u.email)}" value="${esc(w.id)}" ${(u.workspaces || []).includes(w.id) ? 'checked' : ''}> ${esc(w.name)}</label>`).join('')}</td>
        <td data-seen="${esc(u.email)}">${seenHtml(u)}</td>
        <td class="acts"><button type="button" data-team-reset="${esc(u.email)}" data-name="${esc(u.name || '')}">איפוס סיסמה</button>${u.email === me.email ? '' : `<button type="button" class="danger" data-team-del="${esc(u.email)}">הסרה</button>`}</td></tr>`).join('')}</table></div></section>`;
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'team-form') return;
  e.preventDefault();
  const fd = new FormData(e.target), body = Object.fromEntries(fd), err = $('#team-err'), btn = e.target.querySelector('[type=submit]');
  body.workspaces = fd.getAll('ws'); delete body.ws; body.email = String(body.email || '').trim();
  err.hidden = true; btn.disabled = true;
  try {
    await api('POST', '/users', body);
    teamInvite = { name: body.name, email: body.email.toLowerCase(), password: body.password };
    await loadTeam(); toast('איש הצוות נוסף ✅'); $('#invite-text')?.scrollIntoView({ block: 'center' });
  } catch (ex) { if (ex.message === 'auth') return; err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
});
document.addEventListener('click', safe(async e => {
  if (e.target.closest('[data-tab=team]')) { teamInvite = null; return loadTeam().catch(err => err.message !== 'auth' && toast(err.message)); }
  if (e.target.id === 'team-gen') { const i = $('#team-form [name=password]'); i.value = genPassword(); i.type = 'text'; return; }
  if (e.target.id === 'invite-close') { teamInvite = null; return loadTeam(); }
  if (e.target.id === 'invite-copy') { try { await navigator.clipboard.writeText($('#invite-text').textContent); toast('הפרטים הועתקו'); } catch { const r = document.createRange(); r.selectNodeContents($('#invite-text')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('סמנו והעתיקו ידנית'); } return; }
  const rs = e.target.closest('[data-team-reset]');
  if (rs) {
    if (!confirm(`לאפס את הסיסמה של ${rs.dataset.teamReset}? הסיסמה הנוכחית תפסיק לעבוד.`)) return;
    const password = genPassword(); await api('PUT', '/users', { email: rs.dataset.teamReset, password });
    teamInvite = { name: rs.dataset.name, email: rs.dataset.teamReset, password }; return loadTeam();
  }
  const del = e.target.closest('[data-team-del]');
  if (del && confirm(`להסיר את ${del.dataset.teamDel} מהצוות? הגישה שלו/ה תיחסם מיד.`)) { await api('DELETE', '/users/' + encodeURIComponent(del.dataset.teamDel)); toast('הוסר'); await loadTeam(); }
}));
// a role change made here refreshes the table (the handler itself lives in extras.js)
document.addEventListener('change', e => { if (e.target.closest('#team [data-role]')) setTimeout(() => loadTeam().catch(() => {}), 600); });

// ---- own password ----
document.addEventListener('click', e => {
  if (e.target.closest('#chpw')) {
    let dlg = $('#pwdlg');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'pwdlg'; dlg.className = 'quick'; document.body.appendChild(dlg); }
    dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form><h2>החלפת סיסמה</h2>
      <form id="pw-form" class="panel"><input type="text" name="username" value="${esc(me?.email || '')}" autocomplete="username" hidden>
        <label>סיסמה נוכחית <input name="current" type="password" required autocomplete="current-password"></label>
        <label>סיסמה חדשה (8 תווים לפחות) <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <div class="err" id="pw-err" role="alert" hidden></div><div class="qfoot"><button class="btn" type="submit">שמירה</button><button type="button" class="link" data-close>ביטול</button></div></form>`;
    dlg.showModal();
  }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'pw-form') return;
  e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)), err = $('#pw-err'); err.hidden = true;
  try { await api('POST', '/password', { current: f.current, password: f.password }); $('#pwdlg').close(); toast('הסיסמה הוחלפה ✅'); }
  catch (ex) { if (ex.message === 'auth') return; err.textContent = ex.message; err.hidden = false; }
});
