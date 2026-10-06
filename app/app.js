const STAGES = ['חדש', 'בטיפול', 'פגישה', 'הצעת מחיר', 'נסגר', 'אבוד'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '₪' + Math.round(n || 0).toLocaleString('he-IL');

let db = { campaigns: [], posts: [], leads: [] };
let me = null, caps = {};
const camp = id => db.campaigns.find(c => c.id === id);
const campName = id => camp(id)?.name || 'ללא קמפיין';

const TOKEN_KEY = 'tizon-token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

async function api(method, path, body) {
  const token = getToken();
  const r = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', ...(token && { authorization: 'Bearer ' + token }) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401 && path !== '/login') { setToken(''); showLogin(); throw new Error('auth'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error || 'שגיאה') + (d.detail ? ` (${d.detail})` : ''));
  return d;
}
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== 'auth') alert(e.message); } };

const localDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('sv'); };
const localTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }); };
async function refresh() {
  const s = await api('GET', '/state');
  me = s.me; caps = s.caps;
  db = { campaigns: s.campaigns, leads: s.leads, posts: s.posts.map(p => ({ ...p, date: localDate(p.at), time: localTime(p.at) })) };
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
  await api('POST', '/posts', { campaign: f.campaign, channel: f.channel, text: f.text, at: new Date(f.date + 'T' + f.time).toISOString() });
  e.target.reset(); await refresh();
}));
$('#ai-text').onclick = safe(async () => {
  const f = Object.fromEntries(new FormData($('#post-form')));
  const t = prompt('על מה הפוסט? (הנחיה קצרה, אפשר להשאיר ריק)', '');
  if (t === null) return;
  $('#ai-text').disabled = true;
  try { $('#post-form [name=text]').value = (await api('POST', '/ai/generate', { campaign: f.campaign, channel: f.channel, brief: t })).text; }
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
  if (act === 'test') return testConnection(b);
  if (act === 'clear-secret') { if (!confirm('להסיר את הערך השמור?')) return; await api('PUT', '/settings', { clear: [b.dataset.key] }); await loadSettings(); await refresh(); return; }
  if (act === 'copy-link') { navigator.clipboard?.writeText(`${location.origin}/?c=${id}`); toast('הקישור הועתק. לידים שיגיעו דרכו ישויכו לקמפיין'); return; }
  if (act === 'copy') { navigator.clipboard?.writeText(db.posts.find(p => p.id === id).text); b.textContent = 'הועתק ✓'; return; }
  if (act === 'del-campaign' && confirm('למחוק את הקמפיין?')) await api('DELETE', '/campaigns/' + id);
  else if (act === 'spend') { const c = camp(id), v = prompt('כמה הוצאתם עד כה (₪)?', c.spent); if (v === null || isNaN(+v)) return; await api('PUT', '/campaigns/' + id, { spent: +v }); }
  else if (act === 'toggle-campaign') await api('PUT', '/campaigns/' + id, { status: camp(id).status === 'פעיל' ? 'הסתיים' : 'פעיל' });
  else if (act === 'ai-plan') {
    const d = prompt('לכמה ימים לתכנן תוכן?', '7'); if (d === null) return;
    b.disabled = true; b.textContent = 'מייצר...';
    try { const r = await api('POST', '/ai/plan', { campaign: id, days: +d }); alert(`נוצרו ${r.created} פוסטים (${r.status}). ${r.status === 'טיוטה' ? 'אשרו אותם בלוח התוכן כדי שיתפרסמו.' : ''}`); }
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
    btn.disabled = true; btn.textContent = 'בונה את הקמפיין…';
    try {
      const r = await api('POST', '/ai/quick-campaign', { idea: f.get('idea'), channels: f.getAll('ch'), days: +f.get('days') });
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
      <h3>לוח התוכן (${d.posts.length} פוסטים)</h3>
      ${d.posts.map((p, i) => `<div class="qpost" data-i="${i}">
        <div class="qhead">
          <label class="chip"><input type="checkbox" class="inc" checked><span>כלול</span></label>
          <input type="date" class="pdate" value="${dateFor(p.day)}" required aria-label="תאריך">
          <input type="time" class="ptime" value="10:00" required aria-label="שעה">
          <select class="pch" aria-label="ערוץ">${ALL_CHANNELS.map(c => `<option ${c === p.channel ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <span class="badge ${isAuto(p.channel) ? 'auto' : ''}">${isAuto(p.channel) ? '⚡ אוטומטי' : 'ידני: תקבלו תזכורת'}</span>
        </div>
        <textarea class="ptext" rows="3" aria-label="טקסט הפוסט">${esc(p.text)}</textarea>
      </div>`).join('')}
      <div class="qfoot">
        <button class="btn" type="submit" value="launch">🚀 שגרו את הקמפיין</button>
        <button class="btn btn-ghost" type="submit" value="draft">שמרו כטיוטות</button>
        <button type="button" class="link" id="quick-back">חזרה</button>
      </div>
    </form>`;
}

$('#quick-body').addEventListener('click', e => {
  if (e.target.id === 'quick-back') openQuick();
});
$('#quick-body').addEventListener('change', e => {
  const post = e.target.closest('.qpost'); if (!post) return;
  if (e.target.classList.contains('inc')) post.classList.toggle('off', !e.target.checked);
  if (e.target.classList.contains('pch')) {
    const b = post.querySelector('.badge'), auto = isAuto(e.target.value);
    b.className = 'badge' + (auto ? ' auto' : ''); b.textContent = auto ? '⚡ אוטומטי' : 'ידני: תקבלו תזכורת';
  }
});

async function launchQuick(form, asDraft) {
  const f = new FormData(form);
  const posts = [...form.querySelectorAll('.qpost')].filter(el => el.querySelector('.inc').checked).map(el => ({
    channel: el.querySelector('.pch').value, text: el.querySelector('.ptext').value.trim(),
    at: new Date(`${el.querySelector('.pdate').value}T${el.querySelector('.ptime').value}`)
  })).filter(p => p.text && !isNaN(p.at));
  if (!posts.length) throw new Error('סמנו לפחות פוסט אחד');
  const dates = posts.map(p => p.at).sort((a, b) => a - b);
  const camp = await api('POST', '/campaigns', {
    name: f.get('name'), goal: f.get('goal'), audience: f.get('audience'), message: f.get('message'), budget: +f.get('budget') || 0,
    channels: [...new Set(posts.map(p => p.channel))], start: ymd(dates[0]), end: ymd(dates[dates.length - 1])
  });
  await Promise.all(posts.map(p => api('POST', '/posts', { campaign: camp.id, channel: p.channel, text: p.text, at: p.at.toISOString(), status: asDraft ? 'טיוטה' : 'מתוזמן' })));
  $('#quick').close();
  await refresh();
  document.querySelector('[data-tab=content]').click();
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

const LTR_KEYS = new Set(['AI_MODEL', 'FB_PAGE_ID', 'TG_CHAT_ID', 'EMAIL_FROM', 'OWNER_EMAIL']);
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
    const r = await api('POST', '/insights', { ai });
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
  renderCampaigns(); renderPosts(); renderLeads(); renderReports(); renderDash();
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
function renderCampaigns() {
  $('#campaign-list').innerHTML = db.campaigns.map(c => {
    const s = stats(c), pct = c.budget ? Math.min(100, c.spent / c.budget * 100) : 0;
    return `<article class="item">
      <h3>${esc(c.name)} <span class="tag">${esc(c.status)}</span></h3>
      <div class="meta">יעד: ${esc(c.goal)} · ${esc(c.start || '?')} – ${esc(c.end || '?')}</div>
      <div>${c.channels.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
      ${c.audience ? `<div>קהל: ${esc(c.audience)}</div>` : ''}${c.message ? `<div>מסר: ${esc(c.message)}</div>` : ''}
      <div class="meta">תקציב ${money(c.budget)} · הוצאה ${money(c.spent)} · לידים ${s.leads}${c.target ? '/' + c.target : ''}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="acts">
        <button data-act="ai-plan" data-id="${c.id}">✨ תכנון תוכן אוטומטי</button>
        <button data-act="copy-link" data-id="${c.id}">🔗 קישור מעקב</button>
        <button data-act="spend" data-id="${c.id}">עדכון הוצאה</button>
        <button data-act="toggle-campaign" data-id="${c.id}">${c.status === 'פעיל' ? 'סיום' : 'הפעלה מחדש'}</button>
        <button class="danger" data-act="del-campaign" data-id="${c.id}">מחיקה</button>
      </div></article>`;
  }).join('') || '<p class="meta">אין קמפיינים עדיין. לחצו "קמפיין חדש".</p>';
}

const today = () => new Date().toISOString().slice(0, 10);
function renderPosts() {
  const posts = [...db.posts].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  $('#post-list').innerHTML = posts.map(p => {
    const due = ['ידני','נכשל'].includes(p.status);
    return `<article class="item ${due ? 'due' : ''}">
      <div><span class="tag">${esc(p.channel)}</span><span class="tag">${esc(p.status)}</span>${due ? '<span class="tag">⏰ דורש טיפול</span>' : ''}${p.error ? `<span class="tag">${esc(p.error)}</span>` : ''}</div>
      <div class="meta">${esc(p.date)} ${esc(p.time)} · ${esc(campName(p.campaign))}</div>
      <div style="white-space:pre-wrap">${esc(p.text)}</div>
      <div class="acts">
        <button data-act="copy" data-id="${p.id}">העתקה</button>
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
      <span class="meta">${esc(campName(l.campaign))} · ${money(l.value)}</span>
      <div class="acts">
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
  $('#dash').innerHTML = `<div class="bar"><h2>סקירה</h2><button class="btn" data-act="quick-open">✨ קמפיין בדקה</button></div>
    <div class="kpis">
      <div class="kpi"><b>${db.campaigns.filter(c => c.status === 'פעיל').length}</b>קמפיינים פעילים</div>
      <div class="kpi"><b>${t.leads}</b>לידים</div>
      <div class="kpi"><b>${money(t.spent)}</b>הוצאה</div>
      <div class="kpi"><b>${money(t.revenue)}</b>הכנסות</div>
    </div>
    <h3>משימות להיום</h3>
    ${due.map(p => `<div class="item due">⏰ לפרסם ב${esc(p.channel)}: ${esc(p.text.slice(0, 80))}</div>`).join('')}
    ${stale.map(l => `<div class="item due">📞 ליד ממתין יותר מיומיים: ${esc(l.name)} ${esc(l.phone)}</div>`).join('')}
    ${due.length + stale.length ? '' : '<p class="meta">אין משימות דחופות 🎉</p>'}
    <h3>מצב אוטומציה</h3>
    <p class="meta">פרסום: ${[caps.facebook && 'פייסבוק', caps.telegram && 'טלגרם', caps.webhook && 'Webhook'].filter(Boolean).join(', ') || 'לא מחובר – פוסטים יסומנו לפרסום ידני'} · AI: ${caps.ai ? 'פעיל' : 'לא מוגדר'}</p>
    ${me?.role === 'admin' ? `<h3>הוספת איש צוות</h3><form id="user-form" class="panel"><div class="row"><label>שם <input name="name"></label><label>אימייל <input name="email" type="email" required></label><label>סיסמה (8+) <input name="password" type="password" minlength="8" required></label><label>תפקיד <select name="role"><option value="member">חבר צוות</option><option value="admin">מנהל</option></select></label></div><button class="btn btn-sm">הוספה</button></form>` : ''}
    <h3>התהליך המומלץ</h3>
    <ol><li>הגדירו קמפיין עם יעד, קהל, ערוצים ותקציב</li><li>תזמנו תוכן בלוח התוכן</li><li>הזינו כל ליד שנכנס וקדמו אותו בצנרת</li><li>עדכנו הוצאה שבועית וקראו את הדוחות</li><li>הגדילו את מה שעובד, עצרו את מה שלא</li></ol>`;
}

function renderReports() {
  const t = totals();
  const rows = db.campaigns.map(c => { const s = stats(c);
    return `<tr><td>${esc(c.name)}</td><td>${money(c.spent)}</td><td>${s.leads}</td><td>${money(s.cpl)}</td><td>${s.won}</td><td>${money(s.cac)}</td><td>${money(s.revenue)}</td><td>${s.roas.toFixed(2)}x</td><td>${s.conv.toFixed(0)}%</td></tr>`; }).join('');
  $('#reports-body').innerHTML = `<h2>דוחות</h2>
    <div class="kpis">
      <div class="kpi"><b>${money(t.cpl)}</b>עלות לליד</div>
      <div class="kpi"><b>${t.roas.toFixed(2)}x</b>החזר על הוצאה</div>
      <div class="kpi"><b>${t.won}</b>עסקאות שנסגרו</div>
    </div>
    <div style="overflow-x:auto"><table><tr><th>קמפיין</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th><th>נסגרו</th><th>עלות רכישה</th><th>הכנסה</th><th>ROAS</th><th>המרה</th></tr>${rows}</table></div>`;
}


refresh().catch(() => showLogin());
setInterval(() => { if ($('#login').hidden && !document.hidden) refresh().catch(() => {}); }, 30000);
