// 💡 Improvement suggestions: anyone on the team writes one, everyone can vote, admins set the status.

const IDEA_AREAS = ['קמפיינים', 'לוח תוכן', 'לידים', 'מטופלים', 'הדרכה', 'הגדרות', 'דוחות', 'אחר'], IDEA_STATUS = ['חדש', 'בבדיקה', 'אושר', 'בוצע', 'נדחה'];
const ideas = { list: null, filter: 'הכול' };
const ideaDay = iso => { try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }); } catch { return ''; } };

async function loadIdeas() { ideas.list = await api('GET', '/ideas'); renderIdeas(); }

function renderIdeas() {
  const root = $('#ideas'); if (!root || !ideas.list) return;
  const admin = me?.role === 'admin', shown = ideas.list.filter(i => ideas.filter === 'הכול' || i.status === ideas.filter);
  const sorted = [...shown].sort((a, b) => (+(a.status === 'נדחה' || a.status === 'בוצע') - +(b.status === 'נדחה' || b.status === 'בוצע')) || b.votes - a.votes || b.created.localeCompare(a.created));
  root.innerHTML = `<div class="bar"><h2>💡 הצעות יעול</h2></div>
    <p class="meta">כל דבר שיכול לעבוד טוב, מהר או פשוט יותר במערכת או בעבודה שלנו. כותבים כאן, מצביעים על מה שחשוב, והמנהל מעדכן סטטוס.</p>
    <form id="idea-form" class="panel"><div class="row"><label style="grid-column:span 2">כותרת <input name="title" required maxlength="120" placeholder="למשל: להוסיף תבנית פוסט לחגים"></label>
      <label>תחום <select name="area">${IDEA_AREAS.map(a => `<option ${a === 'אחר' ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div>
      <label>פירוט: מה הבעיה ומה ההצעה (אופציונלי)<textarea name="body" rows="3" maxlength="2000"></textarea></label>
      <button class="btn btn-sm" type="submit">הוספת הצעה</button></form>
    <div class="chips" role="group" aria-label="סינון לפי סטטוס">${['הכול', ...IDEA_STATUS].map(s => `<label class="chip"><input type="radio" name="idea-filter" value="${s}" ${s === ideas.filter ? 'checked' : ''}><span>${s}${s === 'הכול' ? ` (${ideas.list.length})` : ` (${ideas.list.filter(i => i.status === s).length})`}</span></label>`).join('')}</div>
    <ul class="ac-list" id="idea-list">${sorted.map(i => `<li><div style="flex:1"><div><span class="badge ${i.status === 'בוצע' || i.status === 'אושר' ? 'auto' : ''}">${esc(i.status)}</span> <span class="tag">${esc(i.area || 'אחר')}</span> <b>${esc(i.title)}</b></div>
      ${i.body ? `<div>${esc(i.body).replace(/\n/g, '<br>')}</div>` : ''}<div class="meta">${esc(i.by)} · ${ideaDay(i.created)}</div>
      <div class="acts">${admin ? `<select data-idea-status="${esc(i.id)}" aria-label="סטטוס">${IDEA_STATUS.map(s => `<option ${s === i.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : ''}
      ${admin || i.mine ? `<button type="button" class="danger" data-idea-del="${esc(i.id)}">מחיקה</button>` : ''}</div></div>
      <button type="button" class="btn btn-sm ${i.voted ? '' : 'btn-ghost'}" data-idea-vote="${esc(i.id)}" aria-pressed="${i.voted}" aria-label="הצבעה להצעה">👍 ${i.votes}</button></li>`).join('') || '<li class="meta">אין עדיין הצעות. תהיו הראשונים.</li>'}</ul>`;
}

document.addEventListener('submit', safe(async e => {
  if (e.target.id !== 'idea-form') return;
  e.preventDefault(); await api('POST', '/ideas', Object.fromEntries(new FormData(e.target)));
  toast('ההצעה נוספה 💡'); await loadIdeas();
}));
document.addEventListener('click', safe(async e => {
  const v = e.target.closest('[data-idea-vote]');
  if (v) { const u = await api('POST', `/ideas/${v.dataset.ideaVote}/vote`, {}); ideas.list = ideas.list.map(i => i.id === u.id ? u : i); return renderIdeas(); }
  const d = e.target.closest('[data-idea-del]');
  if (d && confirm('למחוק את ההצעה?')) { await api('DELETE', '/ideas/' + d.dataset.ideaDel); await loadIdeas(); }
}));
document.addEventListener('change', safe(async e => {
  if (e.target.name === 'idea-filter') { ideas.filter = e.target.value; return renderIdeas(); }
  const s = e.target.closest('[data-idea-status]');
  if (s) { const u = await api('PUT', '/ideas/' + s.dataset.ideaStatus, { status: s.value }); ideas.list = ideas.list.map(i => i.id === u.id ? u : i); toast('הסטטוס עודכן'); renderIdeas(); }
}));
document.addEventListener('click', e => { if (e.target.closest('[data-tab=ideas]')) loadIdeas().catch(err => err.message !== 'auth' && toast(err.message)); });
