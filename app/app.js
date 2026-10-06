const STAGES = ['חדש', 'בטיפול', 'פגישה', 'הצעת מחיר', 'נסגר', 'אבוד'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '₪' + Math.round(n || 0).toLocaleString('he-IL');

let db = { campaigns: [], posts: [], leads: [], checklist: {} };
let me = null, caps = {}, workspaces = [], currentWs = 'main';
const camp = id => db.campaigns.find(c => c.id === id);
const campName = id => camp(id)?.name || 'ללא קמפיין';

const TOKEN_KEY = 'tizon-token';
const WS_KEY = 'tizon-ws';
const getWs = () => { try { return localStorage.getItem(WS_KEY) || 'main'; } catch { return 'main'; } };
const setWs = id => { try { localStorage.setItem(WS_KEY, id); } catch {} };
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

async function api(method, path, body) {
  const token = getToken();
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', ...(token && { authorization: 'Bearer ' + token }), ...(getWs() !== 'main' && { 'x-workspace': getWs() }) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401 && path !== '/login') { setToken(''); showLogin(); throw new Error('auth'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error || 'שגיאה') + (d.detail ? ` (${d.detail})` : ''));
  return d;
}
// ---------- Progress meter (shown above everything, including open dialogs) ----------
// Server-side AI work has no real percentage, so the bar follows an estimate that eases towards ~92% and jumps to
// 100% when the work finishes. Steps we do ourselves (saving a banner, creating posts) report real progress via set().
const mmss = s => s < 60 ? `${s} שנ׳` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function progressDock() {
  let d = document.getElementById('progress-dock');
  if (!d) { d = document.createElement('div'); d.id = 'progress-dock'; d.className = 'pdock'; d.setAttribute('popover', 'manual'); document.body.appendChild(d); }
  return d;
}
function startProgress({ label, est = 10000 }) {
  const dock = progressDock(), el = document.createElement('div'), t0 = Date.now();
  el.className = 'ptask'; el.setAttribute('role', 'progressbar'); el.setAttribute('aria-label', label); el.setAttribute('aria-valuemin', '0'); el.setAttribute('aria-valuemax', '100');
  el.innerHTML = `<div class="phead"><b class="plabel">${esc(label)}</b><span class="ppct">0%</span></div><div class="ptrack"><div class="pfill"></div></div><div class="pfoot"><span class="pstage">מתחיל…</span><span class="ptime">0 שנ׳</span></div>`;
  dock.appendChild(el);
  try { dock.showPopover(); } catch { dock.classList.add('pfallback'); }
  let manual = null, closed = false;
  const paint = pct => {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    el.setAttribute('aria-valuenow', String(pct)); el.querySelector('.ppct').textContent = pct + '%'; el.querySelector('.pfill').style.width = pct + '%';
  };
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    el.querySelector('.ptime').textContent = mmss(s);
    paint(manual ?? 92 * (1 - Math.exp(-(Date.now() - t0) / (est / 2.3))));
  }, 200);
  const remove = delay => setTimeout(() => { el.remove(); if (!dock.children.length) try { dock.hidePopover(); } catch {} }, delay);
  paint(2);
  return {
    stage: txt => { el.querySelector('.pstage').textContent = txt; },
    set: pct => { manual = pct; paint(pct); },
    done: txt => { if (closed) return; closed = true; clearInterval(tick); paint(100); el.classList.add('pdone'); el.querySelector('.pstage').textContent = txt || 'הושלם ✓'; remove(700); },
    fail: msg => { if (closed) return; closed = true; clearInterval(tick); el.classList.add('pfail'); el.querySelector('.pstage').textContent = '❌ ' + String(msg).slice(0, 160); remove(5000); }
  };
}

// AI calls can take a while. The server may answer { job } and finish in the background: poll until done.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AI_LABELS = {
  '/ai/quick-campaign': ['בונה את הקמפיין', 25000], '/ai/plan': ['מתכנן לוח תוכן', 25000], '/ai/improve': ['משדרג את הטקסט', 9000], '/ai/generate': ['כותב פוסט', 9000],
  '/ai/banner-copy': ['מנסח כותרות לבאנר', 9000], '/ai/image-prompt': ['כותב תיאור לתמונה', 6000], '/ai/image': ['יוצר תמונה', 30000], '/compliance/fix': ['מתקן את הניסוח', 9000], '/insights': ['מנתח את הנתונים', 12000], '/guide/ask': ['המדריך מכין תשובה', 9000], '/guide/learn': ['מעדכן את ספר הידע', 15000]
};
async function aiCall(path, body) {
  const [label, est] = AI_LABELS[path] || ['מעבד', 10000];
  const pr = startProgress({ label, est });
  pr.stage('שולח בקשה…');
  const slow = setTimeout(() => pr.stage('ה-AI עובד…'), 1200);
  try {
    const r = await api('POST', path, body);
    if (!r.job) { pr.done(); return r; }
    pr.stage('ממתין בתור…');
    for (let i = 0; i < 100; i++) {
      await sleep(2000);
      const j = await api('GET', '/jobs/' + r.job);
      if (j.status === 'running') pr.stage('ה-AI עובד…');
      if (j.status === 'done') { pr.done(); return j.result; }
      if (j.status === 'error') throw new Error(j.error || 'המשימה נכשלה');
    }
    throw new Error('המשימה לוקחת יותר מדי זמן. נסו שוב בעוד רגע');
  } catch (e) { pr.fail(e.message === 'auth' ? 'נדרשת התחברות' : e.message); throw e; }
  finally { clearTimeout(slow); }
}
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== 'auth') alert(e.message); } };

const riskHtml = r => r?.level ? `<div class="risk ${r.level}"><b>${r.level === 'high' ? '🔴 ניסוח רפואי בעייתי: לא יפורסם אוטומטית' : '🟠 כדאי לבדוק את הניסוח'}</b><ul>${r.findings.map(f => `<li><b>"${esc(f.match)}"</b>: ${esc(f.why)}. ${esc(f.fix)}</li>`).join('')}</ul></div>` : '';

// Pick an image, shrink it in the browser (max 1280px, <~600KB) and upload it. Resolves to the media id (or null).
function pickImage() {
  return new Promise((resolve, reject) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      try {
        const f = inp.files[0]; if (!f) return resolve(null);
        const bmp = await createImageBitmap(f), sc = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        let q = 0.85, url; do { url = cv.toDataURL('image/jpeg', q); q -= 0.1; } while (url.length * 0.75 > 600e3 && q > 0.3);
        resolve((await api('POST', '/media', { dataUrl: url })).id);
      } catch (e) { reject(e); }
    };
    inp.click();
  });
}
const thumb = id => id ? `<img class="thumb" src="/api/media/${esc(id)}" alt="תמונת הפוסט" loading="lazy">` : '';

const localDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('sv'); };
const localTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }); };
async function refresh() {
  const s = await api('GET', '/state');
  me = s.me; caps = s.caps; workspaces = s.workspaces || []; currentWs = s.ws || 'main';
  db = { checklist: s.checklist || {}, campaigns: s.campaigns, leads: s.leads, posts: s.posts.map(p => ({ ...p, date: localDate(p.at), time: localTime(p.at) })) };
  $('#login').hidden = true;
  render();
}
function showLogin() { $('#login').hidden = false; }

$('#toggle-pw').onclick = e => {
  const btn = e.currentTarget, input = btn.previousElementSibling, show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', show);
  btn.setAttribute('aria-label', show ? 'הסתרת סיסמה' : 'הצגת סיסמה');
  input.focus();
};

$('#login-form').addEventListener('submit', safe(async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  setToken((await api('POST', '/login', f)).token);
  e.target.reset();
  await refresh();
}));
$('#logout').onclick = safe(async () => { await api('POST', '/logout').catch(() => {}); setToken(''); location.reload(); });

$('#tabs').addEventListener('click', e => {
  const t = e.target.dataset.tab; if (!t) return;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === e.target));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === t));
  if (t === 'settings') loadSettings().catch(e => e.message !== 'auth' && alert(e.message));
  if (t === 'reports') loadInsights(false);
});

$('#new-campaign').onclick = () => { $('#campaign-form').hidden = false; };
$('#cancel-campaign').onclick = () => { $('#campaign-form').hidden = true; };
$('#campaign-form').addEventListener('submit', safe(async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  await api('POST', '/campaigns', {
    name: f.get('name'), goal: f.get('goal'), audience: f.get('audience'), channels: f.getAll('ch'),
    budget: +f.get('budget'), target: +f.get('target'), start: f.get('start'), end: f.get('end'), message: f.get('message')
  });
  e.target.reset(); e.target.hidden = true; await refresh();
}));

$('#post-form').addEventListener('submit', safe(async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  await api('POST', '/posts', { campaign: f.campaign, channel: f.channel, text: f.text, image: f.image || '', at: new Date(f.date + 'T' + f.time).toISOString() });
  $('#post-img-preview').innerHTML = ''; $('#post-risk').hidden = true;
  e.target.reset(); await refresh();
}));
$('#post-img').onclick = safe(async () => {
  const id = await pickImage(); if (!id) return;
  $('#post-form [name=image]').value = id;
  $('#post-img-preview').innerHTML = thumb(id) + ' <button type="button" class="link" id="post-img-clear">הסרה</button>';
});
$('#post-img-preview').addEventListener('click', e => { if (e.target.id === 'post-img-clear') { $('#post-form [name=image]').value = ''; $('#post-img-preview').innerHTML = ''; } });
let riskTimer;
$('#post-form [name=text]').addEventListener('input', e => {
  clearTimeout(riskTimer);
  riskTimer = setTimeout(async () => {
    try { const r = await api('POST', '/compliance/check', { text: e.target.value }); $('#post-risk').innerHTML = riskHtml(r); $('#post-risk').hidden = !r.level; } catch {}
  }, 600);
});
$('#ai-text').onclick = safe(async () => {
  const f = Object.fromEntries(new FormData($('#post-form')));
  const t = prompt('על מה הפוסט? (הנחיה קצרה, אפשר להשאיר ריק)', '');
  if (t === null) return;
  $('#ai-text').disabled = true;
  try { $('#post-form [name=text]').value = (await aiCall('/ai/generate', { campaign: f.campaign, channel: f.channel, brief: t })).text; }
  finally { $('#ai-text').disabled = false; }
});

$('#lead-form-app').addEventListener('submit', safe(async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  await api('POST', '/leads', { ...f, value: +f.value });
  e.target.reset(); await refresh();
}));

document.addEventListener('submit', safe(async e => {
  if (e.target.id !== 'user-form') return;
  e.preventDefault();
  await api('POST', '/users', Object.fromEntries(new FormData(e.target)));
  e.target.reset(); alert('המשתמש נוצר');
}));

document.addEventListener('click', safe(async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'quick-open') return openQuick();
  if (act === 'edit-campaign') return editCampaignDialog(id);
  if (act === 'edit-lead') return editLeadDialog(id);
  if (act === 'edit-post') return typeof editPostDialog === 'function' ? editPostDialog(id) : undefined;
  if (act === 'sync') { b.disabled = true; try { const r = await api('POST', '/sync', {}); await refresh(); toast(`עודכנו ${r.posts} פוסטים ו-${r.campaigns} קמפיינים`); } finally { b.disabled = false; } return; }
  if (act === 'attach-image') { const img = await pickImage(); if (!img) return; await api('PUT', '/posts/' + id, { image: img }); await refresh(); toast('התמונה נוספה'); return; }
  if (act === 'override') { if (!confirm('לאשר פרסום למרות הניסוח שסומן? האחריות על התוכן עליכם.')) return; await api('PUT', '/posts/' + id, { override: 1, status: 'מתוזמן', error: '' }); await refresh(); toast('הפוסט אושר ויפורסם בקרוב'); return; }
  if (act === 'fix-ai') {
    const p = db.posts.find(x => x.id === id); b.disabled = true; b.textContent = 'מתקן…';
    try { const r = await aiCall('/compliance/fix', { text: p.text }); if (!confirm('הנוסח המתוקן:\n\n' + r.text + '\n\nלהחליף?')) return; await api('PUT', '/posts/' + id, { text: r.text, status: p.status === 'ממתין לבדיקה' ? 'מתוזמן' : p.status, error: '' }); await refresh(); toast('הניסוח עודכן'); } finally { b.disabled = false; }
    return;
  }
  if (act === 'contacted') { await api('POST', `/leads/${id}/contacted`, {}); await refresh(); toast('נרשם. תאריך המעקב הבא עודכן'); return; }
  if (act === 'edit-note') { const l = db.leads.find(x => x.id === id), v = prompt('הערה על הליד:', l.note || ''); if (v === null) return; await api('PUT', '/leads/' + id, { note: v }); await refresh(); return; }
  if (act === 'fb-campaign') {
    const c = camp(id), v = prompt('מזהה הקמפיין הממומן בפייסבוק (Ads Manager), כדי למשוך הוצאה אוטומטית. השאירו ריק להסרה:', c.fbCampaign || '');
    if (v === null) return; await api('PUT', '/campaigns/' + id, { fbCampaign: v.trim() }); await refresh(); return;
  }
  if (act === 'test') return testConnection(b);
  if (act === 'clear-secret') { if (!confirm('להסיר את הערך השמור?')) return; await api('PUT', '/settings', { clear: [b.dataset.key] }); await loadSettings(); await refresh(); return; }
  if (act === 'copy-link') { navigator.clipboard?.writeText(`${location.origin}/?c=${id}${b.dataset.v ? '&v=' + b.dataset.v : ''}`); toast('הקישור הועתק. לידים שיגיעו דרכו ישויכו לקמפיין'); return; }
  if (act === 'copy') { navigator.clipboard?.writeText(db.posts.find(p => p.id === id).text); b.textContent = 'הועתק ✓'; return; }
  if (act === 'del-campaign' && confirm('למחוק את הקמפיין?')) await api('DELETE', '/campaigns/' + id);
  else if (act === 'spend') { const c = camp(id), v = prompt('כמה הוצאתם עד כה (₪)?', c.spent); if (v === null || isNaN(+v)) return; await api('PUT', '/campaigns/' + id, { spent: +v }); }
  else if (act === 'set-status') await api('PUT', '/campaigns/' + id, { status: b.dataset.status });
  else if (act === 'camp-move') {
    const ids = sortedCamps().map(c => c.id), from = ids.indexOf(id), to = from + +b.dataset.dir;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await saveCampOrder(ids.map(x => ({ id: x })));
  }
  else if (act === 'ai-plan') {
    const d = prompt('לכמה ימים לתכנן תוכן?', '7'); if (d === null) return;
    b.disabled = true; b.textContent = 'מייצר...';
    try { const r = await aiCall('/ai/plan', { campaign: id, days: +d }); alert(`נוצרו ${r.created} פוסטים (${r.status}). ${r.status === 'טיוטה' ? 'אשרו אותם בלוח התוכן כדי שיתפרסמו.' : ''}`); }
    finally { b.disabled = false; }
  }
  else if (act === 'del-post') await api('DELETE', '/posts/' + id);
  else if (act === 'approve') await api('PUT', '/posts/' + id, { status: 'מתוזמן' });
  else if (act === 'published') await api('PUT', '/posts/' + id, { status: 'פורסם' });
  else if (act === 'del-lead' && confirm('למחוק את הליד?')) await api('DELETE', '/leads/' + id);
  else if (act === 'move') await api('PUT', '/leads/' + id, { stage: b.dataset.stage });
  else return;
  await refresh();
}));

$('#export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = 'tizon-marketing-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
};

document.addEventListener('change', safe(async e => {
  if (!e.target.classList?.contains('nextdate')) return;
  await api('PUT', '/leads/' + e.target.dataset.id, { next: e.target.value });
  await refresh();
}));

// Persist a new campaign order (and, on the board, each card's column/status) with a single call.
async function saveCampOrder(items) {
  await api('POST', '/campaigns/order', { items });
  await refresh();
}

// ---------- Edit dialogs: campaign and lead ----------
const GOALS_UI = ['לידים', 'מכירות', 'מודעות למותג', 'תנועה לאתר', 'שימור לקוחות'];
function editDialog(html) {
  let dlg = $('#editdlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'editdlg'; dlg.className = 'quick'; document.body.appendChild(dlg); }
  dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form>${html}`;
  dlg.showModal();
  return dlg;
}
const opts = (list, cur) => list.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

function editCampaignDialog(id) {
  const c = camp(id); if (!c) return;
  editDialog(`<h2>עריכת קמפיין</h2><p class="sub">${esc(c.name)}</p>
    <form id="editcamp-form" class="panel" data-id="${esc(id)}">
      <label>שם הקמפיין <input name="name" value="${esc(c.name)}" required></label>
      <div class="row"><label>יעד <select name="goal">${opts(GOALS_UI, c.goal)}</select></label>
        <label>סטטוס <select name="status">${opts(['פעיל', 'מושהה', 'הסתיים'], c.status)}</select></label></div>
      <label>קהל יעד <textarea name="audience" rows="2">${esc(c.audience || '')}</textarea></label>
      <fieldset class="chips"><legend>ערוצים</legend>${ALL_CHANNELS.map(ch => `<label class="chip"><input type="checkbox" name="ch" value="${ch}" ${(c.channels || []).includes(ch) ? 'checked' : ''}><span>${ch}</span></label>`).join('')}</fieldset>
      <div class="row"><label>תקציב (₪) <input name="budget" type="number" min="0" value="${+c.budget || 0}"></label>
        <label>הוצאה עד כה (₪) <input name="spent" type="number" min="0" step="any" value="${+c.spent || 0}"></label>
        <label>יעד לידים <input name="target" type="number" min="0" value="${+c.target || 0}"></label></div>
      <div class="row"><label>התחלה <input name="start" type="date" value="${esc(c.start || '')}"></label><label>סיום <input name="end" type="date" value="${esc(c.end || '')}"></label></div>
      <label>מסר מרכזי והצעה <textarea name="message" rows="2">${esc(c.message || '')}</textarea></label>
      <div class="qfoot"><button class="btn" type="submit">שמירה</button><button type="button" class="link" data-close>ביטול</button></div>
    </form>`);
}

function editLeadDialog(id) {
  const l = db.leads.find(x => x.id === id); if (!l) return;
  editDialog(`<h2>עריכת ליד</h2><p class="sub">${esc(l.name)}</p>
    <form id="editlead-form" class="panel" data-id="${esc(id)}">
      <div class="row"><label>שם <input name="name" value="${esc(l.name)}" required></label><label>טלפון <input name="phone" type="tel" value="${esc(l.phone || '')}" dir="ltr"></label><label>אימייל <input name="email" type="email" value="${esc(l.email || '')}" dir="ltr"></label></div>
      <div class="row"><label>שלב <select name="stage">${opts(STAGES, l.stage)}</select></label>
        <label>קמפיין / מקור <select name="campaign"><option value="">ללא קמפיין</option>${db.campaigns.map(c => `<option value="${esc(c.id)}" ${c.id === l.campaign ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>שווי עסקה (₪) <input name="value" type="number" min="0" value="${+l.value || 0}"></label>
        <label>תאריך מעקב <input name="next" type="date" value="${esc(l.next || '')}"></label></div>
      <label>הערות <textarea name="note" rows="3">${esc(l.note || '')}</textarea></label>
      <div class="qfoot"><button class="btn" type="submit">שמירה</button><button type="button" class="link" data-close>ביטול</button></div>
    </form>`);
}

document.addEventListener('click', e => { const x = e.target.closest('[data-close]'); if (x) x.closest('dialog')?.close(); });
document.addEventListener('submit', safe(async e => {
  const f = e.target;
  if (f.id === 'editcamp-form') {
    e.preventDefault();
    const d = new FormData(f);
    await api('PUT', '/campaigns/' + f.dataset.id, { name: d.get('name'), goal: d.get('goal'), status: d.get('status'), audience: d.get('audience'), channels: d.getAll('ch'),
      budget: +d.get('budget') || 0, spent: +d.get('spent') || 0, target: +d.get('target') || 0, start: d.get('start'), end: d.get('end'), message: d.get('message') });
  } else if (f.id === 'editlead-form') {
    e.preventDefault();
    const d = new FormData(f);
    await api('PUT', '/leads/' + f.dataset.id, { name: d.get('name'), phone: d.get('phone'), email: d.get('email'), stage: d.get('stage'), campaign: d.get('campaign'), value: +d.get('value') || 0, next: d.get('next'), note: d.get('note') });
  } else return;
  $('#editdlg').close(); await refresh(); toast('נשמר ✅');
}));

// ---------- Quick campaign ----------
const ALL_CHANNELS = ['Facebook', 'Instagram', 'WhatsApp', 'TikTok', 'LinkedIn', 'Google', 'Email', 'Telegram'];
const isAuto = ch => (ch === 'Facebook' && caps.facebook) || (ch === 'Telegram' && caps.telegram) || !!caps.webhook;
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function openQuick() {
  $('#quick-body').innerHTML = `<h2 id="quick-title">✨ קמפיין בדקה</h2>
    <p class="sub">כתבו במשפט אחד מה רוצים לקדם. המערכת תבנה קמפיין שלם, ואתם רק מאשרים.</p>
    <form id="quick-form" class="panel">
      <label>מה רוצים לקדם? <textarea name="idea" rows="3" required placeholder="למשל: ייעוץ בריאות אישי, שיחת היכרות חינם"></textarea></label>
      <fieldset class="chips"><legend>איפה לפרסם? ⚡ = מתפרסם אוטומטית</legend>
        ${ALL_CHANNELS.map((c, i) => `<label class="chip"><input type="checkbox" name="ch" value="${c}" ${i === 0 ? 'checked' : ''}><span>${c}${isAuto(c) ? ' ⚡' : ''}</span></label>`).join('')}
      </fieldset>
      <label>לכמה זמן? <select name="days"><option value="7">שבוע</option><option value="14">שבועיים</option><option value="30">חודש</option></select></label>
      <button class="btn" type="submit">✨ צרו לי קמפיין</button>
      ${caps.ai ? '' : '<p class="meta">מצב בסיסי: תבניות מוכנות. חיבור ANTHROPIC_API_KEY יוסיף כתיבה חכמה.</p>'}
    </form>`;
  $('#quick').showModal();
  $('#quick-form [name=idea]').focus();
}

$('#quick-body').addEventListener('submit', safe(async e => {
  if (e.target.id === 'quick-form') {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'בונה את הקמפיין… (עד כדקה)';
    try {
      const r = await aiCall('/ai/quick-campaign', { idea: f.get('idea'), channels: f.getAll('ch'), days: +f.get('days') });
      renderQuickPreview(r.draft, +f.get('days'));
    } finally { btn.disabled = false; btn.textContent = '✨ צרו לי קמפיין'; }
  } else if (e.target.id === 'quick-launch') {
    e.preventDefault();
    await launchQuick(e.target, e.submitter?.value === 'draft');
  }
}));

function renderQuickPreview(d, days) {
  const start = new Date(); start.setDate(start.getDate() + 1);
  const dateFor = day => { const x = new Date(start); x.setDate(x.getDate() + day); return ymd(x); };
  $('#quick-body').innerHTML = `<h2 id="quick-title">הקמפיין מוכן – עברו ושגרו</h2>
    <p class="sub">אפשר לערוך כל דבר. פוסטים שלא מסומנים לא ייכנסו.</p>
    <form id="quick-launch">
      <div class="panel">
        <label>שם הקמפיין <input name="name" value="${esc(d.name)}" required></label>
        <div class="row">
          <label>יעד <select name="goal">${['לידים', 'מכירות', 'מודעות למותג', 'תנועה לאתר', 'שימור לקוחות'].map(g => `<option ${g === d.goal ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
          <label>תקציב (₪, אופציונלי) <input name="budget" type="number" min="0" value="0"></label>
        </div>
        <label>קהל יעד <textarea name="audience" rows="2">${esc(d.audience)}</textarea></label>
        <label>מסר מרכזי <input name="message" value="${esc(d.message)}"></label>
      </div>
      <div class="bar"><h3>לוח התוכן (${d.posts.length} פוסטים)</h3><span><button type="button" class="link" id="quick-img-all">📷 תמונה לכל הפוסטים</button> <button type="button" class="link" id="quick-studio-all">🎨 באנר לכולם</button></span></div>
      ${d.posts.map((p, i) => `<div class="qpost" data-i="${i}">
        <div class="qhead">
          <label class="chip"><input type="checkbox" class="inc" checked><span>כלול</span></label>
          <input type="date" class="pdate" value="${dateFor(p.day)}" required aria-label="תאריך">
          <input type="time" class="ptime" value="10:00" required aria-label="שעה">
          <select class="pch" aria-label="ערוץ">${ALL_CHANNELS.map(c => `<option ${c === p.channel ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <span class="badge ${isAuto(p.channel) ? 'auto' : ''}">${isAuto(p.channel) ? '⚡ אוטומטי' : 'ידני: תקבלו תזכורת'}</span>
        </div>
        <textarea class="ptext" rows="3" aria-label="טקסט הפוסט">${esc(p.text)}</textarea>
        <div class="qrisk"></div>
        <div class="qimg"><button type="button" class="link" data-qimg="${i}">📷 הוספת תמונה</button><button type="button" class="link" data-qstudio="${i}">🎨 באנר</button><span class="qthumb"></span></div>
      </div>`).join('')}
      <div class="qfoot">
        <button class="btn" type="submit" value="launch">🚀 שגרו את הקמפיין</button>
        <button class="btn btn-ghost" type="submit" value="draft">שמרו כטיוטות</button>
        <button type="button" class="link" id="quick-back">חזרה</button>
      </div>
    </form>`;
  checkQuickRisks();
}

async function checkQuickRisks() {
  const els = [...document.querySelectorAll('#quick-launch .qpost')];
  try {
    const res = await api('POST', '/compliance/check', { texts: els.map(el => el.querySelector('.ptext').value) });
    els.forEach((el, i) => { el.querySelector('.qrisk').innerHTML = riskHtml(res[i]); });
  } catch {}
}
const setQuickImage = (el, id) => { el.dataset.image = id || ''; el.querySelector('.qthumb').innerHTML = id ? thumb(id) : ''; };
$('#quick-body').addEventListener('click', safe(async e => {
  if (e.target.id === 'quick-back') return openQuick();
  const qi = e.target.closest('[data-qimg]');
  if (qi) { const id = await pickImage(); if (id) setQuickImage(qi.closest('.qpost'), id); return; }
  if (e.target.id === 'quick-img-all') { const id = await pickImage(); if (id) document.querySelectorAll('#quick-launch .qpost').forEach(el => setQuickImage(el, id)); }
}));
$('#quick-body').addEventListener('change', e => {
  const post = e.target.closest('.qpost'); if (!post) return;
  if (e.target.classList.contains('ptext')) checkQuickRisks();
  if (e.target.classList.contains('inc')) post.classList.toggle('off', !e.target.checked);
  if (e.target.classList.contains('pch')) {
    const b = post.querySelector('.badge'), auto = isAuto(e.target.value);
    b.className = 'badge' + (auto ? ' auto' : ''); b.textContent = auto ? '⚡ אוטומטי' : 'ידני: תקבלו תזכורת';
  }
});

async function launchQuick(form, asDraft) {
  const f = new FormData(form);
  const posts = [...form.querySelectorAll('.qpost')].filter(el => el.querySelector('.inc').checked).map(el => ({
    channel: el.querySelector('.pch').value, text: el.querySelector('.ptext').value.trim(), image: el.dataset.image || '',
    at: new Date(`${el.querySelector('.pdate').value}T${el.querySelector('.ptime').value}`)
  })).filter(p => p.text && !isNaN(p.at));
  if (!posts.length) throw new Error('סמנו לפחות פוסט אחד');
  const dates = posts.map(p => p.at).sort((a, b) => a - b);
  const pr = startProgress({ label: asDraft ? 'שומר טיוטות' : 'משגר את הקמפיין', est: 4000 });
  pr.stage('יוצר את הקמפיין…'); pr.set(8);
  let camp;
  try {
    camp = await api('POST', '/campaigns', {
      name: f.get('name'), goal: f.get('goal'), audience: f.get('audience'), message: f.get('message'), budget: +f.get('budget') || 0,
      channels: [...new Set(posts.map(p => p.channel))], start: ymd(dates[0]), end: ymd(dates[dates.length - 1])
    });
  } catch (e) { pr.fail(e.message); throw e; }
  let created = 0;
  try {
    await Promise.all(posts.map(p => api('POST', '/posts', { campaign: camp.id, channel: p.channel, text: p.text, image: p.image, at: p.at.toISOString(), status: asDraft ? 'טיוטה' : 'מתוזמן' })
      .then(() => { created++; pr.stage(`מוסיף פוסטים ללוח (${created}/${posts.length})`); pr.set(10 + 85 * created / posts.length); })));
  } catch (e) { pr.fail(e.message); throw e; }
  pr.set(97); pr.stage('מרענן…');
  $('#quick').close();
  await refresh();
  document.querySelector('[data-tab=content]').click();
  pr.done(asDraft ? 'הטיוטות נשמרו ✓' : 'הקמפיין שוגר ✓');
  toast(asDraft ? `נשמרו ${posts.length} טיוטות` : `הקמפיין שוגר: ${posts.length} פוסטים מתוזמנים 🚀`);
}

// ---------- Settings ----------
const waLink = phone => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d.length >= 9 && d.length <= 15 ? `https://wa.me/${d}` : '';
};

let settingsState = { groups: [], encrypted: false };
async function loadSettings() { settingsState = await api('GET', '/settings'); renderSettings(); }

const LTR_KEYS = new Set(['AI_MODEL', 'FB_PAGE_ID', 'TG_CHAT_ID', 'TG_NOTIFY_CHAT_ID', 'EMAIL_FROM', 'OWNER_EMAIL']);
function fieldHtml(f) {
  const src = f.source === 'env' ? ' <span class="badge">מוגדר בשרת</span>' : '';
  const label = esc(f.label);
  if (f.type === 'select') return `<label>${label} <select name="${f.key}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${f.value === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  if (f.type === 'textarea') return `<label>${label} <textarea name="${f.key}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></label>`;
  if (f.secret) return `<label>${label}${src} <span class="pw"><input name="${f.key}" type="password" dir="ltr" autocomplete="off" placeholder="${f.set ? esc(f.hint) + ' מוגדר. להחלפה הקלידו חדש' : esc(f.placeholder || '')}">${f.set && f.source === 'settings' ? `<button type="button" class="eye" data-act="clear-secret" data-key="${f.key}" title="הסרה" aria-label="הסרת ${label}">✕</button>` : ''}</span></label>`;
  return `<label>${label}${src} <input name="${f.key}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"${LTR_KEYS.has(f.key) ? ' dir="ltr"' : ''}></label>`;
}

function renderSettings() {
  const root = $('#settings');
  const open = [...root.querySelectorAll('details[open]')].map(d => d.closest('form').dataset.group);
  root.innerHTML = `<div class="bar"><h2>הגדרות וחיבורים</h2></div>
    <p class="meta">כאן מכניסים את כל המפתחות והחיבורים, במקום אחד. הם נשמרים בשרת, משותפים לכל הצוות, ולא מוצגים שוב אחרי השמירה.${settingsState.encrypted ? ' מוצפנים בהצפנה.' : ''}</p>` +
    settingsState.groups.map(g => `<form class="panel set-group" data-group="${g.id}">
      <div class="bar"><h3>${g.title}</h3><span class="badge ${g.connected ? 'auto' : ''}">${g.connected ? '✅ מחובר' : (g.test ? '⚪ לא מחובר' : '')}</span></div>
      ${g.desc ? `<p class="meta">${esc(g.desc)}</p>` : ''}
      ${g.help ? `<details ${open.includes(g.id) ? 'open' : ''}><summary>איפה משיגים?</summary><p class="meta">${esc(g.help)}</p></details>` : ''}
      ${g.fields.map(fieldHtml).join('')}
      <div class="acts">
        <button class="btn btn-sm" type="submit">שמירה</button>
        ${g.test ? `<button type="button" data-act="test" data-service="${g.test}">בדיקת חיבור</button>` : ''}
        <span class="test-result" role="status"></span>
      </div></form>`).join('');
  if (typeof renderWorkspaceAdmin === 'function') renderWorkspaceAdmin();
}

const settingsValues = form => Object.fromEntries(new FormData(form));
$('#settings').addEventListener('submit', safe(async e => {
  e.preventDefault();
  await api('PUT', '/settings', { values: settingsValues(e.target) });
  await loadSettings(); await refresh();
  toast('ההגדרות נשמרו ✅');
}));

async function testConnection(btn) {
  const form = btn.closest('form'), out = form.querySelector('.test-result');
  out.className = 'test-result'; out.textContent = 'בודק…'; btn.disabled = true;
  try {
    await api('PUT', '/settings', { values: settingsValues(form) }); // test what is on screen
    const r = await api('POST', '/settings/test', { service: btn.dataset.service });
    out.className = 'test-result ' + (r.ok ? 'ok' : 'err');
    out.textContent = (r.ok ? '✅ ' : '❌ ') + r.detail;
    await refresh();
    if (r.ok) { const g = settingsState.groups.find(x => x.id === form.dataset.group); if (g) g.connected = true; form.querySelector('.badge').className = 'badge auto'; form.querySelector('.badge').textContent = '✅ מחובר'; }
  } catch (e) { out.className = 'test-result err'; out.textContent = '❌ ' + e.message; }
  finally { btn.disabled = false; }
}

// ---------- Insights ----------
async function loadInsights(ai) {
  const list = $('#insights-list');
  list.innerHTML = '<li class="meta">מנתח…</li>';
  try {
    const r = ai ? await aiCall('/insights', { ai }) : await api('POST', '/insights', { ai });
    list.innerHTML = r.insights.map(i => `<li>${esc(i)}</li>`).join('') || '<li class="meta">אין תובנות כרגע</li>';
    if (ai && !r.ai) toast('ניתוח AI לא זמין, מוצגות תובנות בסיסיות');
  } catch (e) { list.innerHTML = e.message === 'auth' ? '' : `<li class="meta">${esc(e.message)}</li>`; }
}
$('#insights-ai').onclick = () => loadInsights(true);

function render() {
  const opts = '<option value="">ללא קמפיין</option>' + db.campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  [$('#post-campaign'), $('#lead-campaign')].forEach(s => { const v = s.value; s.innerHTML = opts; s.value = v; });
  $('#ai-text').hidden = !caps.ai;
  $('#tab-settings').hidden = me?.role !== 'admin';
  $('#insights-ai').hidden = !caps.ai;
  if (!window.__dragging) renderCampaigns();
  renderPosts(); renderLeads(); renderReports(); renderDash();
  if (typeof renderPlan === 'function') renderPlan();
  if (typeof loadAcademyBasics === 'function') loadAcademyBasics().catch(() => {}); else if (typeof renderAcademy === 'function') renderAcademy();
  if (typeof renderExtras === 'function') renderExtras();
}

// stats
function stats(c) {
  const ls = db.leads.filter(l => l.campaign === c.id);
  const won = ls.filter(l => l.stage === 'נסגר');
  const revenue = won.reduce((s, l) => s + l.value, 0);
  return {
    leads: ls.length, won: won.length, revenue,
    cpl: ls.length ? c.spent / ls.length : 0,
    cac: won.length ? c.spent / won.length : 0,
    roas: c.spent ? revenue / c.spent : 0,
    conv: ls.length ? won.length / ls.length * 100 : 0
  };
}

// rendering
let campView = (() => { try { return localStorage.getItem('tz-campview') || 'list'; } catch { return 'list'; } })();
const CAMP_COLS = [['פעיל', '🟢 פעיל'], ['מושהה', '⏸ מושהה'], ['הסתיים', '✅ הסתיים']];
const sortedCamps = () => [...db.campaigns].sort((x, y) => (x.order ?? 1e15) - (y.order ?? 1e15));
const statusBtns = c => c.status === 'פעיל'
  ? `<button data-act="set-status" data-id="${c.id}" data-status="מושהה">⏸ השהיה</button><button data-act="set-status" data-id="${c.id}" data-status="הסתיים">סיום</button>`
  : c.status === 'מושהה'
    ? `<button data-act="set-status" data-id="${c.id}" data-status="פעיל">▶ המשך</button><button data-act="set-status" data-id="${c.id}" data-status="הסתיים">סיום</button>`
    : `<button data-act="set-status" data-id="${c.id}" data-status="פעיל">הפעלה מחדש</button>`;

function renderCampaigns() {
  document.querySelectorAll('#camp-view button').forEach(b => b.classList.toggle('on', b.dataset.view === campView));
  $('#campaign-list').hidden = campView === 'board'; $('#campaign-board').hidden = campView !== 'board';
  const list = sortedCamps();
  if (campView === 'board') {
    $('#campaign-board').innerHTML = CAMP_COLS.map(([st, title]) => {
      const cs = list.filter(c => c.status === st);
      return `<section class="kcol" data-status="${st}" aria-label="${esc(title)}"><h3>${title} <span class="badge">${cs.length}</span></h3>${cs.map(c => {
        const s = stats(c), pct = c.budget ? Math.min(100, c.spent / c.budget * 100) : 0;
        return `<article class="kcard" data-id="${c.id}"><div class="khead"><span class="handle" role="button" tabindex="0" aria-label="גרירה: ${esc(c.name)}" title="גררו">⠿</span><b>${esc(c.name)}</b></div>
          <div class="meta">${esc(c.goal)} · לידים ${s.leads}${c.target ? '/' + c.target : ''} · ${money(c.spent)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="acts"><button data-act="edit-campaign" data-id="${c.id}">✎ עריכה</button><button data-act="copy-link" data-id="${c.id}">🔗</button><button data-act="spend" data-id="${c.id}">הוצאה</button>${statusBtns(c)}</div></article>`; }).join('') || '<p class="meta empty-col">גררו לכאן</p>'}</section>`;
    }).join('');
    return;
  }
  $('#campaign-list').innerHTML = list.map((c, i) => {
    const s = stats(c), pct = c.budget ? Math.min(100, c.spent / c.budget * 100) : 0;
    return `<article class="item" data-id="${c.id}">
      <div class="khead"><span class="handle" role="button" tabindex="0" aria-label="גרירה: ${esc(c.name)}" title="גררו כדי לשנות סדר">⠿</span>
        <h3>${esc(c.name)} <span class="tag">${esc(c.status)}</span></h3>
        <span class="movers"><button data-act="camp-move" data-id="${c.id}" data-dir="-1" aria-label="הזזה למעלה" ${i === 0 ? 'disabled' : ''}>▲</button><button data-act="camp-move" data-id="${c.id}" data-dir="1" aria-label="הזזה למטה" ${i === list.length - 1 ? 'disabled' : ''}>▼</button></span></div>
      <div class="meta">יעד: ${esc(c.goal)} · ${esc(c.start || '?')} – ${esc(c.end || '?')}</div>
      <div>${(c.channels || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
      ${c.audience ? `<div>קהל: ${esc(c.audience)}</div>` : ''}${c.message ? `<div>מסר: ${esc(c.message)}</div>` : ''}
      <div class="meta">תקציב ${money(c.budget)} · הוצאה ${money(c.spent)} · לידים ${s.leads}${c.target ? '/' + c.target : ''}${c.clicks ? ` · קליקים ${c.clicks} · חשיפות ${c.impressions}` : ''}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="acts">
        <button data-act="edit-campaign" data-id="${c.id}">✎ עריכה</button>
        <button data-act="ai-plan" data-id="${c.id}">✨ תכנון תוכן אוטומטי</button>
        <button data-act="copy-link" data-id="${c.id}">🔗 קישור מעקב</button>
        <button data-act="copy-link" data-id="${c.id}" data-v="A" title="בדיקת A/B: השתמשו בקישור A בפוסטים אחד, ובקישור B באחרים">🧪 A</button>
        <button data-act="copy-link" data-id="${c.id}" data-v="B">🧪 B</button>
        <button data-act="fb-campaign" data-id="${c.id}">${c.fbCampaign ? '🔌 מחובר לקידום' : '🔌 חיבור לקידום ממומן'}</button>
        <button data-act="spend" data-id="${c.id}">עדכון הוצאה</button>
        ${statusBtns(c)}
        <button class="danger" data-act="del-campaign" data-id="${c.id}">מחיקה</button>
      </div></article>`;
  }).join('') || '<p class="meta">אין קמפיינים עדיין. לחצו "קמפיין חדש".</p>';
}

const today = () => new Date().toLocaleDateString('sv'); // local date, YYYY-MM-DD
function renderPosts() {
  const posts = [...db.posts].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  $('#post-list').innerHTML = posts.map(p => {
    const due = ['ידני', 'נכשל', 'ממתין לבדיקה'].includes(p.status);
    const eng = (p.likes || 0) + (p.comments || 0) + (p.shares || 0);
    return `<article class="item ${due ? 'due' : ''}">
      <div><span class="tag">${esc(p.channel)}</span><span class="tag">${esc(p.status)}</span>${due ? '<span class="tag">⏰ דורש טיפול</span>' : ''}${p.error ? `<span class="tag">${esc(p.error)}</span>` : ''}</div>
      <div class="meta">${esc(p.date)} ${esc(p.time)} · ${esc(campName(p.campaign))}</div>
      ${thumb(p.image)}
      <div style="white-space:pre-wrap">${esc(p.text)}</div>
      ${p.status !== 'פורסם' ? riskHtml(p.risk) : ''}
      ${p.metricsAt ? `<div class="meta">👍 ${p.likes || 0} · 💬 ${p.comments || 0} · ↗ ${p.shares || 0}${eng ? '' : ' (עדיין אין אינטראקציה)'}</div>` : ''}
      <div class="acts">
        ${p.status !== 'פורסם' ? `<button data-act="edit-post" data-id="${p.id}">✎ עריכה</button>` : ''}
        <button data-act="copy" data-id="${p.id}">העתקה</button>
        ${p.status !== 'פורסם' ? `<button data-act="attach-image" data-id="${p.id}">📷 ${p.image ? 'החלפת תמונה' : 'הוספת תמונה'}</button><button data-act="studio-post" data-id="${p.id}">🎨 באנר</button>` : ''}
        ${p.risk?.level && caps.ai && p.status !== 'פורסם' ? `<button data-act="fix-ai" data-id="${p.id}">✨ תקנו את הניסוח עם AI</button>` : ''}
        ${p.status === 'ממתין לבדיקה' ? `<button data-act="override" data-id="${p.id}">אשרו בכל זאת</button>` : ''}
        ${p.status === 'טיוטה' ? `<button data-act="approve" data-id="${p.id}">אישור לפרסום</button>` : ''}${p.status !== 'פורסם' ? `<button data-act="published" data-id="${p.id}">סימון כפורסם</button>` : ''}
        <button class="danger" data-act="del-post" data-id="${p.id}">מחיקה</button>
      </div></article>`;
  }).join('') || '<p class="meta">הלוח ריק.</p>';
}

function renderLeads() {
  $('#pipeline').innerHTML = STAGES.map((st, i) => {
    const ls = db.leads.filter(l => l.stage === st);
    return `<div class="col"><h4>${st} (${ls.length})</h4>${ls.map(l => `<div class="lead">
      <b>${esc(l.name)}</b>
      <span>${esc(l.phone)} ${esc(l.email)}</span>
      <span class="meta">${esc(campName(l.campaign))} · ${money(l.value)}${l.variant ? ` · גרסה ${esc(l.variant)}` : ''}</span>
      ${l.note ? `<span class="note">${esc(l.note)}</span>` : ''}
      ${!['נסגר', 'אבוד'].includes(l.stage) ? `<label class="followup ${l.next && l.next <= today() ? 'due-date' : ''}">🔔 מעקב: <input type="date" class="nextdate" data-id="${l.id}" value="${esc(l.next || '')}" aria-label="תאריך מעקב"></label>` : ''}
      <div class="acts">
        ${!['נסגר', 'אבוד'].includes(l.stage) ? `<button data-act="contacted" data-id="${l.id}" title="מקדם את תאריך המעקב: 3 ימים, אחר כך 7">✓ יצרתי קשר</button>` : ''}
        <button data-act="edit-lead" data-id="${l.id}" title="עריכת פרטי הליד">✎ עריכה</button>
        ${i > 0 ? `<button data-act="move" data-id="${l.id}" data-stage="${STAGES[i - 1]}">→</button>` : ''}
        ${i < STAGES.length - 1 ? `<button data-act="move" data-id="${l.id}" data-stage="${STAGES[i + 1]}">←</button>` : ''}
        <button data-act="move" data-id="${l.id}" data-stage="אבוד">✕</button>
        ${waLink(l.phone) ? `<a href="${waLink(l.phone)}" target="_blank" rel="noopener" title="שלחו הודעה בוואטסאפ" aria-label="וואטסאפ">💬</a>` : ''}
        <button class="danger" data-act="del-lead" data-id="${l.id}">מחיקה</button>
      </div></div>`).join('')}</div>`;
  }).join('');
}

function totals() {
  const spent = db.campaigns.reduce((s, c) => s + c.spent, 0);
  const won = db.leads.filter(l => l.stage === 'נסגר');
  const revenue = won.reduce((s, l) => s + l.value, 0);
  return { spent, revenue, leads: db.leads.length, won: won.length,
    cpl: db.leads.length ? spent / db.leads.length : 0, roas: spent ? revenue / spent : 0 };
}

function renderDash() {
  const t = totals();
  const due = db.posts.filter(p => ['ידני','נכשל'].includes(p.status));
  const stale = db.leads.filter(l => l.stage === 'חדש' && (Date.now() - new Date(l.created)) > 2 * 864e5);
  const follow = db.leads.filter(l => l.next && l.next <= today() && !['נסגר', 'אבוד'].includes(l.stage));
  const held = db.posts.filter(p => p.status === 'ממתין לבדיקה');
  $('#dash').innerHTML = `<div class="bar"><h2>סקירה</h2><button class="btn" data-act="quick-open">✨ קמפיין בדקה</button></div>
    ${typeof planNextHtml === 'function' ? planNextHtml() : ''}
    ${typeof academyNextHtml === 'function' ? academyNextHtml() : ''}
    <div class="kpis">
      <div class="kpi"><b>${db.campaigns.filter(c => c.status === 'פעיל').length}</b>קמפיינים פעילים</div>
      <div class="kpi"><b>${t.leads}</b>לידים</div>
      <div class="kpi"><b>${money(t.spent)}</b>הוצאה</div>
      <div class="kpi"><b>${money(t.revenue)}</b>הכנסות</div>
    </div>
    <h3>משימות להיום</h3>
    ${due.map(p => `<div class="item due">⏰ לפרסם ב${esc(p.channel)}: ${esc(p.text.slice(0, 80))}</div>`).join('')}
    ${held.map(p => `<div class="item due">🛑 פוסט נעצר בבדיקת תאימות: ${esc(p.text.slice(0, 80))}</div>`).join('')}
    ${follow.map(l => `<div class="item due">🔔 היום לחזור אל ${esc(l.name)} ${esc(l.phone)} ${waLink(l.phone) ? `<a href="${waLink(l.phone)}" target="_blank" rel="noopener">💬</a>` : ''}</div>`).join('')}
    ${stale.map(l => `<div class="item due">📞 ליד ממתין יותר מיומיים: ${esc(l.name)} ${esc(l.phone)}</div>`).join('')}
    ${due.length + stale.length + follow.length + held.length ? '' : '<p class="meta">אין משימות דחופות 🎉</p>'}
    <h3>מצב אוטומציה</h3>
    <p class="meta">פרסום: ${[caps.facebook && 'פייסבוק', caps.telegram && 'טלגרם', caps.webhook && 'Webhook'].filter(Boolean).join(', ') || 'לא מחובר – פוסטים יסומנו לפרסום ידני'} · AI: ${caps.ai ? 'פעיל' : 'לא מוגדר'}</p>
    ${me?.role === 'admin' ? `<h3>הוספת איש צוות</h3><form id="user-form" class="panel"><div class="row"><label>שם <input name="name"></label><label>אימייל <input name="email" type="email" required></label><label>סיסמה (8+) <input name="password" type="password" minlength="8" required></label><label>תפקיד <select name="role"><option value="member">חבר צוות</option><option value="admin">מנהל</option></select></label></div><button class="btn btn-sm">הוספה</button></form>` : ''}
    <h3>התהליך המומלץ</h3>
    <ol><li>הגדירו קמפיין עם יעד, קהל, ערוצים ותקציב</li><li>תזמנו תוכן בלוח התוכן</li><li>הזינו כל ליד שנכנס וקדמו אותו בצנרת</li><li>עדכנו הוצאה שבועית וקראו את הדוחות</li><li>הגדילו את מה שעובד, עצרו את מה שלא</li></ol>`;
}

function renderReports() {
  const t = totals();
  const rows = db.campaigns.map(c => { const s = stats(c);
    const vs = Object.entries(db.leads.filter(l => l.campaign === c.id && l.variant).reduce((m, l) => { (m[l.variant] ||= { leads: 0, won: 0 }); m[l.variant].leads++; if (l.stage === 'נסגר') m[l.variant].won++; return m; }, {}));
    return `<tr><td>${esc(c.name)}${vs.length ? `<div class="meta">🧪 ${vs.map(([k, v]) => `גרסה ${esc(k)}: ${v.leads} פניות`).join(' · ')}</div>` : ''}</td><td>${money(c.spent)}</td><td>${s.leads}</td><td>${money(s.cpl)}</td><td>${s.won}</td><td>${money(s.cac)}</td><td>${money(s.revenue)}</td><td>${s.roas.toFixed(2)}x</td><td>${s.conv.toFixed(0)}%</td></tr>`; }).join('');
  $('#reports-body').innerHTML = `<div class="bar"><h2>דוחות</h2>${caps.facebook ? '<button class="btn btn-sm btn-ghost" data-act="sync">🔄 סנכרון נתונים מפייסבוק</button>' : ''}</div>
    <div class="kpis">
      <div class="kpi"><b>${money(t.cpl)}</b>עלות לליד</div>
      <div class="kpi"><b>${t.roas.toFixed(2)}x</b>החזר על הוצאה</div>
      <div class="kpi"><b>${t.won}</b>עסקאות שנסגרו</div>
    </div>
    <div style="overflow-x:auto"><table><tr><th>קמפיין</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th><th>נסגרו</th><th>עלות רכישה</th><th>הכנסה</th><th>ROAS</th><th>המרה</th></tr>${rows}</table></div>`;
}


refresh().catch(() => showLogin());
setInterval(() => { if ($('#login').hidden && !document.hidden) refresh().catch(() => {}); }, 30000);
