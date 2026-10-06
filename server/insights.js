// Campaign analytics and recommendations. Rule-based insights work without any AI key.
const DAY = 864e5;
const shekel = n => '₪' + Math.round(n).toLocaleString('he-IL');

export async function computeStats(store, now = Date.now()) {
  const [campaigns, posts, leads] = await Promise.all(['campaigns', 'posts', 'leads'].map(k => store.list(k)));
  const per = campaigns.map(c => {
    const ls = leads.filter(l => l.campaign === c.id), won = ls.filter(l => l.stage === 'נסגר');
    const revenue = won.reduce((s, l) => s + (l.value || 0), 0), spent = c.spent || 0;
    const variants = {};
    for (const l of ls) if (l.variant) { const v = variants[l.variant] ||= { leads: 0, won: 0 }; v.leads++; if (l.stage === 'נסגר') v.won++; }
    return { id: c.id, name: c.name, status: c.status, spent, budget: c.budget || 0, leads: ls.length, won: won.length, revenue,
      cpl: ls.length ? spent / ls.length : null, roas: spent ? revenue / spent : null, variants, clicks: c.clicks || 0, impressions: c.impressions || 0 };
  });
  const engagement = p => (p.likes || 0) + (p.comments || 0) + (p.shares || 0);
  const top = posts.filter(p => p.status === 'פורסם' && engagement(p) > 0).sort((a, b) => engagement(b) - engagement(a))[0];
  const recent = t => t && now - Date.parse(t) < 7 * DAY;
  return {
    campaigns: per,
    leadsTotal: leads.length,
    leadsWeek: leads.filter(l => recent(l.created)).length,
    wonTotal: leads.filter(l => l.stage === 'נסגר').length,
    unattributed: leads.filter(l => !l.campaign).length,
    stale: leads.filter(l => l.stage === 'חדש' && now - Date.parse(l.created) > 2 * DAY).length,
    topPost: top ? { text: String(top.text).slice(0, 80), channel: top.channel, engagement: engagement(top) } : null,
    blocked: posts.filter(p => p.status === 'ממתין לבדיקה').length,
    followupsDue: leads.filter(l => l.next && l.next <= new Date(now).toISOString().slice(0, 10) && !['נסגר', 'אבוד'].includes(l.stage)).length,
    publishedWeek: posts.filter(p => p.status === 'פורסם' && recent(p.publishedAt)).length,
    failed: posts.filter(p => p.status === 'נכשל').length,
    manual: posts.filter(p => p.status === 'ידני').length,
    drafts: posts.filter(p => p.status === 'טיוטה').length,
    spent: per.reduce((s, c) => s + c.spent, 0),
    revenue: per.reduce((s, c) => s + c.revenue, 0)
  };
}

export function ruleInsights(st) {
  const out = [];
  if (!st.campaigns.length) return ['עדיין אין קמפיינים. לחצו על "✨ קמפיין בדקה" והתחילו.'];
  if (st.stale) out.push(`📞 ${st.stale} לידים חדשים מחכים יותר מיומיים. התקשרו אליהם היום, ליד קר מאבד ערך מהר.`);
  if (st.blocked) out.push(`🛑 ${st.blocked} פוסטים נעצרו בבדיקת התאימות (ניסוח רפואי בעייתי). תקנו או אשרו בלוח התוכן.`);
  if (st.followupsDue) out.push(`🔔 ${st.followupsDue} לידים מחכים למעקב היום.`);
  if (st.failed) out.push(`❌ ${st.failed} פוסטים נכשלו בפרסום. בדקו את החיבור בהגדרות.`);
  if (st.manual) out.push(`⏰ ${st.manual} פוסטים ממתינים לפרסום ידני (אין חיבור לערוץ).`);
  if (st.drafts) out.push(`📝 ${st.drafts} טיוטות ממתינות לאישור בלוח התוכן.`);
  for (const c of st.campaigns) if (c.spent > 0 && c.leads === 0) out.push(`⚠️ בקמפיין "${c.name}" הוצאתם ${shekel(c.spent)} ואין לידים. בדקו את המסר והקהל, או עצרו.`);
  const withLeads = st.campaigns.filter(c => c.leads > 0 && c.cpl !== null && c.spent > 0).sort((a, b) => a.cpl - b.cpl);
  if (withLeads.length) {
    const best = withLeads[0];
    out.push(`🏆 הקמפיין הכי משתלם: "${best.name}", ${shekel(best.cpl)} לליד.`);
    const worst = withLeads[withLeads.length - 1];
    if (withLeads.length > 1 && worst.cpl > best.cpl * 2) out.push(`💡 "${worst.name}" יקר פי ${(worst.cpl / best.cpl).toFixed(1)} מ-"${best.name}". שקלו להעביר אליו תקציב.`);
  }
  for (const c of st.campaigns) {
    const vs = Object.entries(c.variants);
    if (vs.length >= 2) {
      vs.sort((a, b) => b[1].leads - a[1].leads);
      const [wn, w] = vs[0], [ln, l] = vs[1];
      if (w.leads >= 5 && w.leads >= l.leads * 1.5) out.push(`🧪 בבדיקת A/B של "${c.name}", גרסה ${wn} מביאה ${w.leads} פניות מול ${l.leads} בגרסה ${ln}. כדאי להמשיך עם ${wn}.`);
      else out.push(`🧪 בבדיקת A/B של "${c.name}": גרסה ${wn} ${w.leads} פניות, גרסה ${ln} ${l.leads}. עדיין אין מנצחת ברורה, צריך לפחות 5 פניות ופער ברור.`);
    }
  }
  if (st.topPost) out.push(`⭐ הפוסט עם הכי הרבה אינטראקציה: "${st.topPost.text}" (${st.topPost.channel}, ${st.topPost.engagement}). כתבו עוד כמוהו.`);
  if (st.spent > 0 && st.wonTotal > 0 && st.revenue < st.spent) out.push(`📉 ההכנסות (${shekel(st.revenue)}) נמוכות מההוצאה (${shekel(st.spent)}). בדקו מה מונע סגירה.`);
  if (st.leadsWeek) out.push(`📈 השבוע נכנסו ${st.leadsWeek} לידים.`);
  else if (st.leadsTotal) out.push('השבוע לא נכנסו לידים חדשים. כדאי לשגר קמפיין חדש או לחזק את הקיים.');
  if (st.unattributed && st.campaigns.length) out.push(`🔗 ${st.unattributed} לידים לא משויכים לקמפיין. השתמשו ב"קישור מעקב" של כל קמפיין כדי לדעת מה עובד.`);
  return out.slice(0, 8);
}

export const insightsPrompt = (st, profile) => `אתה יועץ שיווק. לפניך נתוני קמפיינים (JSON). כתוב עד 6 תובנות והמלצות פעולה קצרות בעברית, כל אחת בשורה נפרדת שמתחילה ב"- ". התמקד במה שכדאי להגדיל, לעצור או לתקן. בלי הבטחות רפואיות, בלי להמציא נתונים שלא מופיעים.
${profile ? 'על העסק: ' + profile.slice(0, 500) + '\n' : ''}נתונים:\n${JSON.stringify(st)}`;

export const parseBullets = text => text.split('\n').map(l => l.replace(/^[\s\-•*\d.)]+/, '').trim()).filter(l => l.length > 3).slice(0, 8);
