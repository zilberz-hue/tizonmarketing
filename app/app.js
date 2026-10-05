const KEY = 'tizon-marketing-v1';
const STAGES = ['חדש', 'בטיפול', 'פגישה', 'הצעת מחיר', 'נסגר', 'אבוד'];
const POST_STATUS = ['טיוטה', 'מתוזמן', 'פורסם'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => '₪' + Math.round(n || 0).toLocaleString('he-IL');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

let db = load();
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { campaigns: [], posts: [], leads: [] }; }
  catch { return { campaigns: [], posts: [], leads: [] }; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} render(); }
const camp = id => db.campaigns.find(c => c.id === id);
const campName = id => camp(id)?.name || 'ללא קמפיין';

// tabs
$('#tabs').addEventListener('click', e => {
  const t = e.target.dataset.tab; if (!t) return;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === e.target));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === t));
});

// campaigns
$('#new-campaign').onclick = () => { $('#campaign-form').hidden = false; };
$('#cancel-campaign').onclick = () => { $('#campaign-form').hidden = true; };
$('#campaign-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target);
  db.campaigns.push({
    id: uid(), name: f.get('name'), goal: f.get('goal'), audience: f.get('audience'),
    channels: f.getAll('ch'), budget: +f.get('budget'), target: +f.get('target'),
    start: f.get('start'), end: f.get('end'), message: f.get('message'), spent: 0, status: 'פעיל'
  });
  e.target.reset(); e.target.hidden = true; save();
});

// posts
$('#post-form').addEventListener('submit', e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  db.posts.push({ id: uid(), ...f, status: 'מתוזמן' });
  e.target.reset(); save();
});

// leads
$('#lead-form-app').addEventListener('submit', e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  db.leads.push({ id: uid(), ...f, value: +f.value, stage: STAGES[0], created: new Date().toISOString().slice(0, 10) });
  e.target.reset(); save();
});

// actions (delegated)
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id } = b.dataset;
  if (act === 'del-campaign' && confirm('למחוק את הקמפיין?')) db.campaigns = db.campaigns.filter(c => c.id !== id);
  if (act === 'spend') { const c = camp(id), v = prompt('כמה הוצאתם עד כה (₪)?', c.spent); if (v !== null && !isNaN(+v)) c.spent = +v; }
  if (act === 'toggle-campaign') { const c = camp(id); c.status = c.status === 'פעיל' ? 'הסתיים' : 'פעיל'; }
  if (act === 'del-post') db.posts = db.posts.filter(p => p.id !== id);
  if (act === 'published') db.posts.find(p => p.id === id).status = 'פורסם';
  if (act === 'copy') { navigator.clipboard?.writeText(db.posts.find(p => p.id === id).text); b.textContent = 'הועתק ✓'; return; }
  if (act === 'del-lead' && confirm('למחוק את הליד?')) db.leads = db.leads.filter(l => l.id !== id);
  if (act === 'move') { const l = db.leads.find(x => x.id === id); l.stage = b.dataset.stage; }
  save();
});

// export / import
$('#export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = 'tizon-marketing-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
};
$('#import').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(d.campaigns) || !Array.isArray(d.posts) || !Array.isArray(d.leads)) throw 0;
    if (confirm('הייבוא יחליף את כל הנתונים הנוכחיים. להמשיך?')) { db = d; save(); }
  } catch { alert('קובץ לא תקין'); }
  e.target.value = '';
};

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
function render() {
  const opts = '<option value="">ללא קמפיין</option>' + db.campaigns.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  [$('#post-campaign'), $('#lead-campaign')].forEach(s => { const v = s.value; s.innerHTML = opts; s.value = v; });
  renderCampaigns(); renderPosts(); renderLeads(); renderReports(); renderDash();
}

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
    const due = p.status !== 'פורסם' && p.date <= today();
    return `<article class="item ${due ? 'due' : ''}">
      <div><span class="tag">${esc(p.channel)}</span><span class="tag">${esc(p.status)}</span>${due ? '<span class="tag">⏰ הגיע הזמן לפרסם</span>' : ''}</div>
      <div class="meta">${esc(p.date)} ${esc(p.time)} · ${esc(campName(p.campaign))}</div>
      <div style="white-space:pre-wrap">${esc(p.text)}</div>
      <div class="acts">
        <button data-act="copy" data-id="${p.id}">העתקה</button>
        ${p.status !== 'פורסם' ? `<button data-act="published" data-id="${p.id}">סימון כפורסם</button>` : ''}
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
  const due = db.posts.filter(p => p.status !== 'פורסם' && p.date <= today());
  const stale = db.leads.filter(l => l.stage === 'חדש' && (Date.now() - new Date(l.created)) > 2 * 864e5);
  $('#dash').innerHTML = `<h2>סקירה</h2>
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
    <h3>התהליך המומלץ</h3>
    <ol><li>הגדירו קמפיין עם יעד, קהל, ערוצים ותקציב</li><li>תזמנו תוכן בלוח התוכן</li><li>הזינו כל ליד שנכנס וקדמו אותו בצנרת</li><li>עדכנו הוצאה שבועית וקראו את הדוחות</li><li>הגדילו את מה שעובד, עצרו את מה שלא</li></ol>`;
}

function renderReports() {
  const t = totals();
  const rows = db.campaigns.map(c => { const s = stats(c);
    return `<tr><td>${esc(c.name)}</td><td>${money(c.spent)}</td><td>${s.leads}</td><td>${money(s.cpl)}</td><td>${s.won}</td><td>${money(s.cac)}</td><td>${money(s.revenue)}</td><td>${s.roas.toFixed(2)}x</td><td>${s.conv.toFixed(0)}%</td></tr>`; }).join('');
  $('#reports').innerHTML = `<h2>דוחות</h2>
    <div class="kpis">
      <div class="kpi"><b>${money(t.cpl)}</b>עלות לליד</div>
      <div class="kpi"><b>${t.roas.toFixed(2)}x</b>החזר על הוצאה</div>
      <div class="kpi"><b>${t.won}</b>עסקאות שנסגרו</div>
    </div>
    <div style="overflow-x:auto"><table><tr><th>קמפיין</th><th>הוצאה</th><th>לידים</th><th>עלות לליד</th><th>נסגרו</th><th>עלות רכישה</th><th>הכנסה</th><th>ROAS</th><th>המרה</th></tr>${rows}</table></div>`;
}

render();
