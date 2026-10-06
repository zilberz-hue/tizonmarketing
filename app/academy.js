// 🎓 Training center: interactive lessons (a tour that highlights the real buttons), quizzes, progress per user,
// "what's new", the AI tutor, our living knowledge book (needs / decisions), the activity log and the manual.

const ac = { content: null, me: null, knowledge: null, activity: null, team: null, loaded: false };
const acLesson = id => ac.content?.lessons?.[id];
const acTrackIds = () => ac.content?.tracks?.[ac.me?.track]?.lessons || [];

// minimal, safe markdown (headings, lists, bold, italics, paragraphs)
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])_(.+?)_(?=[\s).,]|$)/g, '$1<i>$2</i>');
  let html = '', list = false;
  for (const line of String(src || '').split('\n')) {
    const li = /^\s*[-*]\s+(.*)/.exec(line), h = /^(#{1,3})\s+(.*)/.exec(line);
    if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { html += '</ul>'; list = false; }
    if (h) html += `<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }); } catch { return ''; } };

async function loadAcademyBasics() {
  if (ac.loaded) return;
  [ac.content, ac.me] = await Promise.all([api('GET', '/guide/content'), api('GET', '/guide/me')]);
  ac.loaded = true; renderAcademy();
}
async function loadAcademyAll() {
  await loadAcademyBasics();
  const jobs = [api('GET', '/guide/knowledge'), api('GET', '/guide/activity?limit=40')];
  if (me?.role === 'admin') jobs.push(api('GET', '/guide/team'));
  [ac.knowledge, ac.activity, ac.team] = await Promise.all(jobs);
  renderAcademy();
}

function academyNextHtml() {
  if (!ac.loaded) return '';
  const ids = acTrackIds(), next = ids.find(id => !ac.me.done[id]);
  const done = ids.filter(id => ac.me.done[id]).length;
  if (!next) return `<div class="panel plan-next"><div class="bar"><h3>🎓 סיימתם את מסלול ההדרכה</h3><button type="button" class="btn btn-sm" data-ac-open>למרכז ההדרכה</button></div></div>`;
  return `<div class="panel plan-next"><div class="bar"><h3>🎓 הדרכה: ${done}/${ids.length}</h3><button type="button" class="btn btn-sm" data-ac-start="${esc(next)}">${done ? 'המשיכו' : 'התחילו'}: ${esc(acLesson(next).title)}</button></div></div>`;
}

function renderAcademy() {
  const dot = $('#tab-academy .dot');
  if (ac.loaded && dot) dot.hidden = ac.me.seenRelease === ac.content.releases[0].id;
  const root = $('#academy'); if (!root || !ac.loaded) return;
  const ids = acTrackIds(), done = ids.filter(id => ac.me.done[id]).length, pct = ids.length ? Math.round(done / ids.length * 100) : 0;
  const track = ac.content.tracks[ac.me.track];
  const lastSeen = ac.content.releases.findIndex(r => r.id === ac.me.seenRelease);
  const newCount = lastSeen === -1 ? ac.content.releases.length : lastSeen;
  root.innerHTML = `<div class="bar"><h2>🎓 מרכז ההדרכה</h2><button type="button" class="btn btn-sm btn-ghost" id="ac-manual">⬇ ספר הפעלה</button></div>
    <p class="meta">מסלול: <b>${esc(track.name)}</b>. ${esc(track.desc)}</p>
    <div class="bar-track big"><div class="bar-fill" style="width:${pct}%"></div></div>
    <p class="meta">${done} מתוך ${ids.length} שיעורים הושלמו${pct === 100 ? ' 🎉 מוכנים לפעול!' : ''}</p>

    <section class="panel" id="ac-lessons"><h3>השיעורים שלי</h3><ul class="ac-list">${ids.map(id => { const l = acLesson(id), d = ac.me.done[id];
      return `<li class="${d ? 'done' : ''}"><div><b>${esc(l.title)}</b> ${d ? `<span class="badge auto">✓ ${d.score}%</span>` : ''}<div class="meta">${l.min} דקות · ${l.steps.length} שלבים · ${esc(l.intro)}</div></div>
        <button type="button" class="btn btn-sm ${d ? 'btn-ghost' : ''}" data-ac-start="${esc(id)}">${d ? 'לחזור' : 'להתחיל'}</button></li>`; }).join('')}</ul></section>

    <section class="panel" id="ac-releases"><div class="bar"><h3>🆕 מה חדש ${newCount ? `<span class="badge auto">${newCount} חדשים</span>` : ''}</h3>${newCount ? '<button type="button" class="link" id="ac-seen">סימון כנקרא</button>' : ''}</div>
      <ul class="ac-list">${ac.content.releases.slice(0, 6).map((r, i) => `<li><div><b>${esc(r.title)}</b> ${i < newCount ? '<span class="badge auto">חדש</span>' : ''}<div class="meta">${esc(r.date)} · ${esc(r.summary)}</div></div>
        <div class="acts">${r.lessons.filter(id => acLesson(id)).slice(0, 2).map(id => `<button type="button" data-ac-start="${esc(id)}">${esc(acLesson(id).title)}</button>`).join('')}</div></li>`).join('')}</ul></section>

    <section class="panel" id="ac-ask"><h3>💬 שאלו את המדריך</h3>
      <form id="ac-ask-form" class="ac-askrow"><input name="q" placeholder="למשל: איך יוצרים באנר לחג? מה לעשות כשפוסט נעצר?" maxlength="500" required><button class="btn btn-sm" type="submit">שאלו</button></form>
      <div id="ac-answer" aria-live="polite"></div></section>

    <section class="panel" id="ac-need"><h3>🧠 הידע שלנו: מה אנחנו צריכים ומה החלטנו</h3>
      <p class="meta">כל צורך או החלטה נרשמים, מקושרים לשיעורים רלוונטיים, ונכנסים לספר הפעולה.</p>
      <form id="ac-need-form"><div class="row"><label>סוג <select name="type"><option value="need">אנחנו צריכים</option><option value="decision">החלטנו</option><option value="note">הערה</option></select></label>
        <label style="grid-column:span 2">כותרת <input name="title" placeholder="למשל: אנחנו צריכים באנר לחג" maxlength="120" required></label></div>
        <label>פירוט (אופציונלי) <textarea name="body" rows="2" maxlength="1500"></textarea></label><button class="btn btn-sm" type="submit">הוספה לידע</button></form>
      <ul class="ac-list" id="ac-items">${(ac.knowledge?.items || []).map(k => `<li><div><span class="badge">${k.type === 'decision' ? 'החלטה' : k.type === 'need' ? 'צורך' : 'הערה'}</span> <b>${esc(k.title)}</b>${k.body ? `<div>${esc(k.body)}</div>` : ''}
        <div class="meta">${esc(k.by)} · ${fmtDate(k.at)}</div>${(k.related || []).length ? `<div class="acts">${k.related.filter(r => acLesson(r.id)).map(r => `<button type="button" data-ac-start="${esc(r.id)}">📘 ${esc(r.title)}</button>`).join('')}</div>` : ''}</div>
        ${me?.role === 'admin' || k.byEmail === me?.email ? `<button type="button" class="link" data-ac-del="${esc(k.id)}" aria-label="מחיקה">✕</button>` : ''}</li>`).join('') || '<li class="meta">עדיין לא נרשם דבר.</li>'}</ul></section>

    <section class="panel" id="ac-book"><div class="bar"><h3>📖 ספר הפעולה החי</h3><button type="button" class="btn btn-sm" id="ac-learn">🧠 עדכנו את הידע</button></div>
      <p class="meta">${ac.knowledge?.playbook ? `עודכן ${fmtDate(ac.knowledge.playbook.updated)} · ${ac.knowledge.playbook.by === 'system' ? 'אוטומטית' : ac.knowledge.playbook.ai ? 'על ידי AI' : 'לפי הנתונים'}. מתעדכן לבד פעם בשבוע.` : 'עדיין לא נכתב. לחצו על "עדכנו את הידע", או שיתעדכן אוטומטית.'}</p>
      <div class="ac-md">${ac.knowledge?.playbook ? md(ac.knowledge.playbook.body) : ''}</div></section>

    <section class="panel" id="ac-activity"><h3>🕒 יומן פעילות</h3><ul class="ac-list">${(ac.activity || []).map(e => `<li><div>${esc(e.text)}<div class="meta">${esc(e.by)} · ${fmtDate(e.at)} ${esc(new Date(e.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }))}</div></div></li>`).join('') || '<li class="meta">עדיין אין פעילות.</li>'}</ul></section>

    ${me?.role === 'admin' && ac.team ? `<section class="panel" id="ac-team"><h3>👥 התקדמות הצוות</h3><div style="overflow-x:auto"><table><tr><th>איש צוות</th><th>מסלול</th><th>התקדמות</th><th>ציון ממוצע</th><th>פעילות אחרונה</th></tr>
      ${ac.team.map(u => `<tr><td>${esc(u.name || u.email)}<div class="meta">${esc(u.email)}</div></td>
        <td><select data-ac-track="${esc(u.email)}" aria-label="מסלול של ${esc(u.email)}">${Object.entries(ac.content.tracks).map(([k, t]) => `<option value="${k}" ${k === u.track ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td>
        <td>${u.done}/${u.total}</td><td>${u.done ? u.avgScore + '%' : '-'}</td><td>${u.lastActive ? fmtDate(u.lastActive) : '-'}</td></tr>`).join('')}</table></div></section>` : ''}`;
}

// ---------- actions ----------
document.addEventListener('click', safe(async e => {
  const st = e.target.closest('[data-ac-start]');
  if (st) { document.querySelector('[data-tab=academy]')?.click(); return startLesson(st.dataset.acStart); }
  if (e.target.closest('[data-ac-open]')) return document.querySelector('[data-tab=academy]')?.click();
  if (e.target.id === 'ac-seen') { ac.me.seenRelease = (await api('POST', '/guide/seen', {})).seenRelease; return renderAcademy(); }
  if (e.target.id === 'ac-learn') {
    const r = await aiCall('/guide/learn', {});
    ac.knowledge = await api('GET', '/guide/knowledge'); ac.activity = await api('GET', '/guide/activity?limit=40'); renderAcademy(); toast(r.ai ? 'הידע עודכן בעזרת AI 🧠' : 'הידע עודכן לפי הפעילות והנתונים 🧠'); return;
  }
  if (e.target.id === 'ac-manual') {
    const r = await fetch('/api/guide/manual', { headers: { authorization: 'Bearer ' + getToken(), ...(getWs() !== 'main' && { 'x-workspace': getWs() }) } });
    if (!r.ok) throw new Error('לא ניתן להוריד כרגע');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'הוראות-הפעלה.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); return;
  }
  const del = e.target.closest('[data-ac-del]');
  if (del && confirm('למחוק את הפריט?')) { await api('DELETE', '/guide/knowledge/' + del.dataset.acDel); ac.knowledge = await api('GET', '/guide/knowledge'); renderAcademy(); }
}));
document.addEventListener('submit', safe(async e => {
  if (e.target.id === 'ac-ask-form') {
    e.preventDefault();
    const q = new FormData(e.target).get('q'), out = $('#ac-answer');
    const r = await aiCall('/guide/ask', { question: q });
    out.innerHTML = `<div class="ac-answer">${esc(r.answer).replace(/\n/g, '<br>')}</div>${r.lessons.length ? `<div class="acts">${r.lessons.map(l => `<button type="button" class="btn btn-sm btn-ghost" data-ac-start="${esc(l.id)}">📘 ${esc(l.title)}</button>`).join('')}</div>` : ''}`;
  } else if (e.target.id === 'ac-need-form') {
    e.preventDefault();
    await api('POST', '/guide/knowledge', Object.fromEntries(new FormData(e.target)));
    ac.knowledge = await api('GET', '/guide/knowledge'); ac.activity = await api('GET', '/guide/activity?limit=40'); renderAcademy(); toast('נוסף לידע ✅');
  }
}));
document.addEventListener('change', safe(async e => {
  const sel = e.target.closest('[data-ac-track]'); if (!sel) return;
  await api('PUT', '/guide/track', { email: sel.dataset.acTrack, track: sel.value });
  ac.team = await api('GET', '/guide/team'); renderAcademy(); toast('המסלול עודכן');
}));

// ---------- interactive tour ----------
let tour = null;
function tourDom() {
  const spot = document.createElement('div'); spot.className = 'tour-spot';
  const tip = document.createElement('div'); tip.className = 'tour-tip'; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-live', 'polite');
  return { spot, tip };
}
const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };

function startLesson(id) {
  const l = acLesson(id); if (!l) return;
  endTour();
  tour = { id, l, i: -1, spot: null, tip: null, raf: 0, onClick: null };
  tourStep(0);
}
function endTour() {
  if (!tour) return;
  cancelAnimationFrame(tour.raf); tour.spot?.remove(); tour.tip?.remove();
  if (tour.onClick) document.removeEventListener('click', tour.onClick, true);
  document.removeEventListener('keydown', tourKey, true);
  tour = null;
}
function tourKey(e) { if (!tour) return; if (e.key === 'Escape') endTour(); else if (e.key === 'ArrowLeft' || e.key === 'Enter') { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') tourStep(tour.i + 1); } }

async function tourStep(i) {
  if (!tour) return;
  const { l } = tour;
  if (tour.onClick) { document.removeEventListener('click', tour.onClick, true); tour.onClick = null; }
  if (i >= l.steps.length) { const id = tour.id; endTour(); return openQuiz(id); }
  tour.i = Math.max(0, i);
  const step = l.steps[tour.i], token = tour.i;
  if (step.tab) document.querySelector(`[data-tab=${step.tab}]`)?.click();
  // wait for the target to exist (dialogs and AI results appear later)
  let target = null; const t0 = Date.now(), maxWait = step.sel ? (step.wait || 2500) : 0;
  while (step.sel && Date.now() - t0 < maxWait) { target = [...document.querySelectorAll(step.sel)].find(visible); if (target) break; await new Promise(r => setTimeout(r, 120)); if (!tour || tour.i !== token) return; }
  if (!tour || tour.i !== token) return;
  tour.spot?.remove(); tour.tip?.remove();
  const { spot, tip } = tourDom(); tour.spot = spot; tour.tip = tip; tour.target = target;
  const host = target?.closest('dialog[open]') || document.body;
  const last = tour.i === l.steps.length - 1;
  tip.innerHTML = `<div class="tour-head"><b>${esc(l.title)}</b><span class="meta">${tour.i + 1}/${l.steps.length}</span><button type="button" class="link" data-tour="end" aria-label="סגירת ההדרכה">✕</button></div>
    <h4>${esc(step.t)}</h4><p>${esc(step.d)}</p>${step.sel && !target ? '<p class="meta">הרכיב הזה לא מוצג כרגע במסך. אפשר להמשיך לשלב הבא.</p>' : ''}
    ${step.act === 'click' && target ? '<p class="tour-hint">👆 לחצו על הרכיב המודגש כדי להמשיך</p>' : ''}
    <div class="tour-nav"><button type="button" class="link" data-tour="prev" ${tour.i === 0 ? 'disabled' : ''}>הקודם</button><button type="button" class="btn btn-sm" data-tour="next">${last ? 'סיום וחידון' : 'הבא'}</button></div>`;
  host.appendChild(spot); host.appendChild(tip);
  tip.onclick = e => { const a = e.target.closest('[data-tour]')?.dataset.tour; if (a === 'end') endTour(); else if (a === 'prev') tourStep(tour.i - 1); else if (a === 'next') tourStep(tour.i + 1); };
  document.addEventListener('keydown', tourKey, true);
  if (target) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (step.act === 'click') { tour.onClick = ev => { if (ev.target.closest(step.sel)) setTimeout(() => { if (tour && tour.i === token) tourStep(token + 1); }, 450); }; document.addEventListener('click', tour.onClick, true); }
  }
  const place = () => {
    if (!tour || tour.tip !== tip) return;
    const t = tour.target && document.contains(tour.target) ? tour.target : null;
    if (t && visible(t)) {
      const r = t.getBoundingClientRect();
      Object.assign(spot.style, { display: 'block', top: r.top - 6 + 'px', left: r.left - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
      const tw = Math.min(380, innerWidth - 24), below = r.bottom + 12 + 190 < innerHeight;
      tip.style.width = tw + 'px';
      tip.style.left = Math.max(12, Math.min(innerWidth - tw - 12, r.left + r.width / 2 - tw / 2)) + 'px';
      tip.style.top = below ? r.bottom + 14 + 'px' : Math.max(12, r.top - 14 - tip.offsetHeight) + 'px';
    } else {
      spot.style.display = 'none'; const tw = Math.min(380, innerWidth - 24);
      Object.assign(tip.style, { width: tw + 'px', left: (innerWidth - tw) / 2 + 'px', top: Math.max(12, innerHeight / 2 - tip.offsetHeight / 2) + 'px' });
    }
    tour.raf = requestAnimationFrame(place);
  };
  place();
}

// ---------- quiz ----------
function openQuiz(id) {
  const l = acLesson(id);
  let dlg = document.getElementById('quiz-dlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'quiz-dlg'; dlg.className = 'quick'; document.body.appendChild(dlg); }
  dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form><h2>חידון: ${esc(l.title)}</h2><p class="sub">בחרו תשובה לכל שאלה. ציון 50% ומעלה משלים את השיעור.</p>
    <form id="quiz-form" class="panel" data-lesson="${esc(id)}">${l.quiz.map((q, qi) => `<fieldset class="quiz-q"><legend>${esc(q.q)}</legend>${q.o.map((o, oi) => `<label class="chip"><input type="radio" name="q${qi}" value="${oi}" required><span>${esc(o)}</span></label>`).join('')}<div class="quiz-why" id="why${qi}"></div></fieldset>`).join('')}
      <div class="qfoot"><button class="btn" type="submit">בדיקה</button><button type="button" class="link" data-close>סגירה</button><span id="quiz-result" class="meta" role="status"></span></div></form>`;
  dlg.showModal();
}
document.addEventListener('submit', safe(async e => {
  if (e.target.id !== 'quiz-form') return;
  e.preventDefault();
  const id = e.target.dataset.lesson, l = acLesson(id), fd = new FormData(e.target);
  let right = 0;
  l.quiz.forEach((q, qi) => { const ok = +fd.get('q' + qi) === q.a; if (ok) right++; document.getElementById('why' + qi).innerHTML = `<span class="${ok ? 'ok' : 'err'}">${ok ? '✅ נכון.' : '❌ לא מדויק.'}</span> ${esc(q.why)}`; });
  const score = Math.round(right / l.quiz.length * 100);
  if (score >= 50) {
    ac.me.done = (await api('POST', '/guide/progress', { lesson: id, score })).done;
    $('#quiz-result').textContent = `ציון ${score}%. השיעור הושלם ✓`;
    renderAcademy(); toast(`הושלם: ${l.title} (${score}%)`);
    if (acTrackIds().every(x => ac.me.done[x])) toast('🎉 סיימתם את כל מסלול ההדרכה. מוכנים לפעול!');
  } else $('#quiz-result').textContent = `ציון ${score}%. כדאי לחזור על השיעור ולנסות שוב.`;
}));

// load the basics once logged in, and the rest when the tab opens
document.addEventListener('click', e => { if (e.target.closest('[data-tab=academy]')) loadAcademyAll().catch(err => err.message !== 'auth' && toast(err.message)); });
