// 👥 Team tab (admins): add team members, set their role and the workspaces (clients) they can open.

async function loadTeam() {
  const root = $('#team'); if (!root || me?.role !== 'admin') return;
  const [people, wss] = await Promise.all([api('GET', '/access'), api('GET', '/workspaces')]);
  root.innerHTML = `<div class="bar"><h2>👥 צוות</h2></div>
    <p class="meta">כאן מוסיפים אנשי צוות ומגדירים מה כל אחד יכול לעשות. מנהל רואה ועורך הכול, כולל הגדרות. חבר צוות עובד בקמפיינים, תוכן, לידים, מטופלים והצעות, ורק בלקוחות שסימנתם לו.</p>
    <form id="team-form" class="panel"><h3>הוספת איש צוות</h3>
      <div class="row"><label>שם <input name="name" maxlength="100" autocomplete="off"></label>
        <label>אימייל <input name="email" type="email" required autocomplete="off"></label>
        <label>סיסמה זמנית (8 תווים לפחות) <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <label>תפקיד <select name="role"><option value="member">חבר צוות</option><option value="admin">מנהל</option></select></label></div>
      <fieldset class="chips"><legend>לקוחות שאפשר לפתוח (לחבר צוות)</legend>${wss.map(w => `<label class="chip"><input type="checkbox" name="ws" value="${esc(w.id)}" ${w.id === 'main' ? 'checked' : ''}><span>${esc(w.name)}</span></label>`).join('')}</fieldset>
      <button class="btn btn-sm" type="submit">הוספה</button></form>
    <section class="panel"><h3>אנשי הצוות</h3><div style="overflow-x:auto"><table><tr><th>איש צוות</th><th>תפקיד</th><th>לקוחות</th></tr>
      ${people.map(u => `<tr><td>${esc(u.name || u.email)}<div class="meta">${esc(u.email)}</div></td>
        <td><select data-role="${esc(u.email)}" aria-label="תפקיד של ${esc(u.email)}"><option value="member" ${u.role !== 'admin' ? 'selected' : ''}>חבר צוות</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>מנהל</option></select></td>
        <td>${u.role === 'admin' ? '<span class="meta">כולם</span>' : wss.map(w => `<label class="chk"><input type="checkbox" data-access="${esc(u.email)}" value="${esc(w.id)}" ${(u.workspaces || []).includes(w.id) ? 'checked' : ''}> ${esc(w.name)}</label>`).join('')}</td></tr>`).join('')}</table></div></section>`;
}

document.addEventListener('submit', safe(async e => {
  if (e.target.id !== 'team-form') return;
  e.preventDefault();
  const fd = new FormData(e.target), body = Object.fromEntries(fd);
  body.workspaces = fd.getAll('ws'); delete body.ws;
  await api('POST', '/users', body);
  toast('איש הצוות נוסף ✅'); await loadTeam();
}));
document.addEventListener('click', e => { if (e.target.closest('[data-tab=team]')) loadTeam().catch(err => err.message !== 'auth' && toast(err.message)); });
// a role change made here refreshes the table (the handler itself lives in extras.js)
document.addEventListener('change', e => { if (e.target.closest('#team [data-role]')) setTimeout(() => loadTeam().catch(() => {}), 600); });
