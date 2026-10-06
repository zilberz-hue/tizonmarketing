// ✅ Work plan: a 4-week roadmap + weekly routine. Progress is shared by the whole team (server-side),
// and tasks the system can verify (connections, campaigns, leads...) tick themselves.
const has = (k) => !!caps[k];
const n = {
  campaigns: () => db.campaigns.length,
  posts: s => db.posts.filter(p => s.includes(p.status)).length,
  leads: () => db.leads.length,
  won: () => db.leads.filter(l => l.stage === 'נסגר').length,
  spent: () => db.campaigns.filter(c => c.spent > 0).length
};

const PLAN = [
  { id: 'w1', title: '🧰 שבוע 1: הקמה וחיבורים', goal: 'בסוף השבוע: המערכת מחוברת, ופנייה מהאתר מגיעה אליכם בטלגרם.', tasks: [
    { id: 's1', text: 'להחליף את סיסמת המנהל', why: 'הוסיפו מנהל חדש עם סיסמה חזקה (סקירה ← הוספת איש צוות), והסירו את ADMIN_PASSWORD מההגדרות ב-Netlify.', go: { tab: 'dash', label: 'לסקירה' } },
    { id: 's2', text: 'למלא את "על העסק" בהגדרות', why: 'מי אתם, מה אתם מציעים, באיזה טון מדברים ומה אסור לומר. ה-AI כותב לפי זה.', go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's3', text: 'לחבר טלגרם (התראות על לידים)', why: 'הכי קל להתחלה: BotFather ← בוט חדש ← טוקן.', auto: () => has('telegram'), go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's4', text: 'להכניס מפתח AI', why: 'כתיבה חכמה של קמפיינים ופוסטים, ותובנות מעמיקות.', auto: () => has('ai'), go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's5', text: 'לחבר פייסבוק', why: 'פרסום אוטומטי לדף העסקי.', auto: () => has('facebook'), go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's6', text: 'לחבר Webhook לאינסטגרם / לינקדאין (אופציונלי)', why: 'דרך Make או Zapier. דלגו אם לא צריך עכשיו.', auto: () => has('webhook'), go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's7', text: 'לחבר אימייל (התראות ותגובה אוטומטית)', why: 'חשבון חינמי ב-Resend.', auto: () => has('email'), go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's8', text: 'ללחוץ "בדיקת חיבור" בכל שירות שחיברתם', why: 'מוודא שהמפתח עובד באמת, לפני שמסתמכים עליו.', go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's9', text: 'לעדכן את עמוד הבית: שירותים אמיתיים, תמונות, טלפון', why: 'כאן הלקוחות נוחתים. שלחו לי את הטקסטים ואעדכן.', go: { href: '../index.html', label: 'לעמוד הבית' } },
    { id: 's10', text: 'ליד מבחן: למלא את הטופס באתר ולראות אותו בלידים', why: 'הוכחה שכל הדרך עובדת מקצה לקצה.', auto: () => n.leads() > 0, go: { tab: 'leads', label: 'ללידים' } }
  ] },
  { id: 'w2', title: '🚀 שבוע 2: הקמפיין הראשון', goal: 'בסוף השבוע: קמפיין פעיל, ולפחות פוסט אחד שפורסם.', tasks: [
    { id: 'c1', text: 'להחליט על יעד אחד ומספר אחד', why: 'למשל: 10 פניות בחודש לשיחת היכרות. בלי מספר אי אפשר לדעת אם הצלחתם.' },
    { id: 'c2', text: 'ליצור קמפיין בדקה', why: 'משפט אחד על ההצעה, ערוצים, ומשך. המערכת בונה את השאר.', auto: () => n.campaigns() > 0, go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'c3', text: 'לעבור על כל פוסט ולתקן', why: 'טון שלכם, קריאה אחת לפעולה, ובלי הבטחות רפואיות (ראו "איך חושבים" למטה).' },
    { id: 'c4', text: 'לשגר את הקמפיין', why: 'פוסטים בערוצים מחוברים (⚡) מתפרסמים לבד.', auto: () => n.posts(['מתוזמן', 'פורסם', 'ידני']) > 0, go: { tab: 'content', label: 'ללוח התוכן' } },
    { id: 'c5', text: 'להעתיק "קישור מעקב" לכל קמפיין', why: 'ליד שיגיע דרכו ישויך לקמפיין לבד, והדוחות יתמלאו בלי הקלדה.', go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'c6', text: 'לשתף את הקישור: סטטוס וואטסאפ, ביו, הודעות ללקוחות', why: 'פוסט שאף אחד לא רואה לא מביא פניות.' },
    { id: 'c7', text: 'לוודא שהפוסט הראשון באמת פורסם', why: 'בדקו בדף הפייסבוק או בערוץ.', auto: () => n.posts(['פורסם']) > 0, go: { tab: 'content', label: 'ללוח התוכן' } },
    { id: 'c8', text: 'לענות לכל פנייה תוך שעה', why: 'מי שעונה ראשון, לרוב מקבל את הלקוח. כפתור 💬 בכרטיס הליד פותח וואטסאפ.', go: { tab: 'leads', label: 'ללידים' } }
  ] },
  { id: 'w3', title: '📈 שבוע 3: למידה ושיפור', goal: 'בסוף השבוע: אתם יודעים מה עובד, ומה לעצור.', tasks: [
    { id: 'l1', text: 'לעדכן הוצאה אמיתית בכל קמפיין', why: 'בלי זה אין עלות לליד.', auto: () => n.spent() > 0, go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'l2', text: 'לקרוא את "תובנות והמלצות" בדוחות', why: 'מה הכי משתלם, איפה מבזבזים, מי מחכה לתשובה.', go: { tab: 'reports', label: 'לדוחות' } },
    { id: 'l3', text: 'ללחוץ "ניתוח עמוק עם AI"', why: 'דורש מפתח AI. נותן המלצות מותאמות לנתונים שלכם.', go: { tab: 'reports', label: 'לדוחות' } },
    { id: 'l4', text: 'להכפיל את מה שעבד: קמפיין חדש על בסיס הפוסט החזק', why: 'אותו מסר, קהל או ערוץ סמוך.', go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'l5', text: 'לעצור קמפיין שלא מביא פניות', why: 'לחצו "סיום" בכרטיס הקמפיין. כסף שנחסך הוא רווח.', go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'l6', text: 'לסגור עסקה ולהזין את שוויה', why: 'כך תראו ROAS אמיתי.', auto: () => n.won() > 0, go: { tab: 'leads', label: 'ללידים' } }
  ] },
  { id: 'w4', title: '🌱 שבוע 4: הרחבה ושגרה', goal: 'בסוף השבוע: שיווק כהרגל קבוע, לא כפרויקט.', tasks: [
    { id: 'e1', text: 'קמפיין שני: הצעה או קהל אחרים', why: 'ככה מגלים מה עוד עובד.', auto: () => n.campaigns() >= 2, go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'e2', text: 'להוסיף איש צוות', why: 'סקירה ← הוספת איש צוות. התקדמות הצ׳קליסט משותפת.', go: { tab: 'dash', label: 'לסקירה' } },
    { id: 'e3', text: 'לקבוע ביומן יום ושעה קבועים לשגרה השבועית', why: '30 דקות בשבוע. השגרה למטה.' },
    { id: 'e4', text: 'לייצא גיבוי של הנתונים', why: 'כפתור "ייצוא" למעלה. שומרים את הקובץ.' },
    { id: 'e5', text: 'לבדוק תקציב חודשי מול תוצאות', why: 'האם עלות הליד ועלות הלקוח מצדיקות להגדיל?', go: { tab: 'reports', label: 'לדוחות' } }
  ] },
  { id: 'wk', weekly: true, title: '🔁 שגרה שבועית (מתאפסת כל יום ראשון)', goal: '30 דקות בשבוע שמחזיקות את הכול.', tasks: [
    { id: 'k1', text: 'לקרוא תובנות והמלצות', go: { tab: 'reports', label: 'לדוחות' } },
    { id: 'k2', text: 'לטפל בכל הלידים שממתינים', go: { tab: 'leads', label: 'ללידים' } },
    { id: 'k3', text: 'לאשר טיוטות ופוסטים שדורשים פרסום ידני', go: { tab: 'content', label: 'ללוח התוכן' } },
    { id: 'k4', text: 'לתכנן את תוכן השבוע (קמפיין בדקה)', go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'k5', text: 'לעדכן הוצאות בקמפיינים', go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'k6', text: 'לרשום: מה עבד השבוע, ומה משנים בשבוע הבא' }
  ] }
];

const GUIDE = [
  ['🎯 הנוסחה: ארבע שאלות', 'מי? (קהל ספציפי, לא "כולם"). מה ההצעה? (דבר אחד, ברור). למה עכשיו? (סיבה להגיב היום). מה הצעד הבא? (קריאה אחת: התקשרו / השאירו פרטים / שלחו הודעה).'],
  ['✍️ איך כותבים פוסט', 'פותחים בבעיה או בשאלה של הקהל, לא בעצמכם. שתי עד ארבע שורות. קריאה אחת לפעולה. אימוג׳י אחד או שניים. אותו מסר בניסוחים שונים לאורך השבוע.'],
  ['📏 איך מודדים', 'שלושה מספרים: כמה פניות (לידים), כמה עולה פנייה (עלות לליד), כמה נסגרו. קישור מעקב לכל קמפיין, עדכון הוצאה פעם בשבוע.'],
  ['⚖️ זהירות בתחום הבריאות', 'בלי הבטחות לריפוי או לתוצאה. בלי "לפני/אחרי". בלי להמליץ להפסיק טיפול או תרופה. לציין שזה אינו תחליף לייעוץ רפואי. מומלץ לבדוק את הנוסח מול גורם מקצועי או משפטי לפני פרסום. אלה כללי אצבע, לא ייעוץ משפטי.'],
  ['⏱️ איך מתרגלים', 'שבוע 2: קמפיין קטן של שבוע. שבוע 3: משנים דבר אחד (מסר, ערוץ או שעה) ובודקים. תמיד משנים רק דבר אחד בכל פעם, אחרת לא יודעים מה גרם לשינוי.']
];

const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return ymd(d); }; // Sunday
const taskKey = (ph, t) => ph.weekly ? `${t.id}@${weekStart()}` : t.id;
function taskState(ph, t) {
  const manual = !!db.checklist?.[taskKey(ph, t)];
  const auto = !manual && !ph.weekly && t.auto ? !!t.auto() : false;
  return { done: manual || auto, auto };
}
function progress(ph) {
  const s = ph.tasks.map(t => taskState(ph, t));
  return { done: s.filter(x => x.done).length, total: s.length };
}
function nextTask() {
  for (const ph of PLAN.filter(p => !p.weekly)) for (const t of ph.tasks) if (!taskState(ph, t).done) return { ph, t };
  return null;
}
const goBtn = (go, key) => go ? `<button type="button" class="btn btn-sm btn-ghost" data-plan-go="${esc(key)}">${esc(go.label)}</button>` : '';

function planNextHtml() {
  const all = PLAN.filter(p => !p.weekly), total = all.reduce((s, p) => s + progress(p).total, 0), done = all.reduce((s, p) => s + progress(p).done, 0);
  const nx = nextTask(), pct = Math.round(done / total * 100);
  return `<div class="panel plan-next"><div class="bar"><h3>✅ תוכנית העבודה שלכם: ${pct}%</h3><button type="button" class="btn btn-sm" data-act="plan-open">לצ׳קליסט</button></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    ${nx ? `<p><b>הצעד הבא:</b> ${esc(nx.t.text)} <span class="meta">(${esc(nx.ph.title.replace(/^\S+\s/, ''))})</span> ${goBtn(nx.t.go, nx.t.id)}</p>` : '<p>🎉 סיימתם את כל תוכנית ההקמה. נשארה השגרה השבועית.</p>'}</div>`;
}

function renderPlan() {
  const root = document.getElementById('plan'); if (!root) return;
  const openIds = [...root.querySelectorAll('details[open]')].map(d => d.dataset.id);
  const firstOpen = !openIds.length;
  const all = PLAN.filter(p => !p.weekly), total = all.reduce((s, p) => s + progress(p).total, 0), done = all.reduce((s, p) => s + progress(p).done, 0);
  const pct = Math.round(done / total * 100), nx = nextTask();
  root.innerHTML = `<div class="bar"><h2>✅ תוכנית עבודה</h2><span class="badge ${pct === 100 ? 'auto' : ''}">${done}/${total} · ${pct}%</span></div>
    <p class="meta">צעד אחרי צעד, מהקמה ועד שגרה. סמנו ✓ כשסיימתם. משימות שהמערכת יכולה לזהות לבד (🤖) מסומנות אוטומטית. ההתקדמות משותפת לכל הצוות.</p>
    <div class="bar-track big"><div class="bar-fill" style="width:${pct}%"></div></div>
    ${nx ? `<div class="panel plan-next"><b>הצעד הבא: ${esc(nx.t.text)}</b>${nx.t.why ? `<p class="meta">${esc(nx.t.why)}</p>` : ''}${goBtn(nx.t.go, nx.t.id)}</div>` : ''}
    ${PLAN.map(ph => { const p = progress(ph), open = openIds.includes(ph.id) || (firstOpen && (nx ? nx.ph.id === ph.id : ph.weekly));
      return `<details class="phase" data-id="${ph.id}" ${open ? 'open' : ''}><summary><span>${esc(ph.title)}</span><span class="badge ${p.done === p.total ? 'auto' : ''}">${p.done}/${p.total}</span></summary>
        <p class="meta">${esc(ph.goal)}</p>
        <ul class="tasks">${ph.tasks.map(t => { const st = taskState(ph, t), key = taskKey(ph, t);
          return `<li class="task ${st.done ? 'done' : ''}"><label><input type="checkbox" data-plan-key="${esc(key)}" ${st.done ? 'checked' : ''} ${st.auto ? 'disabled' : ''}>
            <span><b>${esc(t.text)}</b>${st.auto ? ' <span class="badge auto">🤖 זוהה אוטומטית</span>' : ''}${t.why ? `<span class="meta why">${esc(t.why)}</span>` : ''}</span></label>${goBtn(t.go, t.id)}</li>`; }).join('')}</ul></details>`; }).join('')}
    <details class="phase"><summary><span>🧠 איך חושבים על קמפיין</span></summary>
      <div class="guide">${GUIDE.map(([h, b]) => `<article class="card"><h3>${esc(h)}</h3><p>${esc(b)}</p></article>`).join('')}</div></details>`;
}

function planGo(id) {
  const t = PLAN.flatMap(p => p.tasks).find(x => x.id === id), go = t?.go; if (!go) return;
  if (go.quick) return openQuick();
  if (go.href) return window.open(go.href, '_blank', 'noopener');
  document.querySelector(`[data-tab=${go.tab}]`)?.click();
}

document.addEventListener('click', e => {
  const g = e.target.closest('[data-plan-go]');
  if (g) return planGo(g.dataset.planGo);
  if (e.target.closest('[data-act=plan-open]')) document.querySelector('[data-tab=plan]')?.click();
});
document.addEventListener('change', safe(async e => {
  const k = e.target.dataset?.planKey; if (!k) return;
  e.target.disabled = true;
  const r = await api('POST', '/checklist', { key: k, done: e.target.checked });
  db.checklist = r.done; renderPlan();
  const nx = nextTask(); toast(e.target.checked ? (nx ? 'כל הכבוד! 👏 הצעד הבא: ' + nx.t.text : '🎉 סיימתם את כל התוכנית!') : 'בוטל');
}));
