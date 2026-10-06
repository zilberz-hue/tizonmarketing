// Pre-publish check for risky health-marketing claims (Hebrew). Rule-based and conservative:
// "high" findings block automatic publishing until a person fixes or explicitly approves the post.
// These are rules of thumb, not legal advice.
const HE = '[א-ת]';
// Hebrew attaches prefixes (ו, ב, ל, מ, ש, ה, כ) to words, so allow up to two before the keyword.
const word = alt => new RegExp(`(?<!${HE})[ובכלמשה]{0,2}(?:${alt})(?!${HE})`, 'g');

const RULES = [
  { id: 'cure', level: 'high', re: word('מרפא|לרפא|נרפא|נרפאת|ירפא|תרפא|ריפא'), why: 'הבטחת ריפוי', fix: 'תארו תמיכה או שיפור תחושה, לא ריפוי.' },
  { id: 'guarantee', level: 'high', re: word('מבטיח|מבטיחה|מבטיחים|מובטח|מובטחת|ערבות לתוצאה|אחריות לתוצאה|ללא סיכון|בלי סיכון'), why: 'הבטחת תוצאה', fix: 'הסירו הבטחות. כתבו מה אתם מציעים ולא מה בטוח שיקרה.' },
  { id: 'nosideeffects', level: 'high', re: word('(?:ללא|בלי|אין) תופעות לוואי'), why: 'טענת בטיחות מוחלטת', fix: 'אל תטענו שאין תופעות לוואי.' },
  { id: 'stopmeds', level: 'high', re: new RegExp(`(?:הפסיקו|תפסיקו|להפסיק)\\s+(?:ליטול|את)?\\s*(?:ה)?(?:תרופ|טיפול)|במקום\\s+(?:ה)?(?:תרופ|טיפול\\s+רפואי)|מחליף\\s+(?:את\\s+)?(?:ה)?תרופ`, 'g'), why: 'עידוד להפסיק טיפול או תרופה', fix: 'לעולם אל תמליצו להפסיק טיפול. הפנו להתייעצות עם הרופא המטפל.' },
  { id: 'healing', level: 'med', re: word('ריפוי'), why: 'המילה "ריפוי" עלולה להישמע כהבטחה', fix: 'ודאו שזו לא הבטחת ריפוי.' },
  { id: 'absolute', level: 'med', re: /100\s*%|מאה אחוז/g, why: 'טענה מוחלטת', fix: 'הימנעו מ-100% כשמדובר בבריאות.' },
  { id: 'beforeafter', level: 'med', re: /לפני\s*(?:ו|\/)?\s*אחרי|before\s*\/?\s*after/gi, why: '"לפני/אחרי" עלול להיחשב הטעיה', fix: 'הימנעו מתמונות או מסיפורים שמבטיחים שינוי.' },
  { id: 'disease', level: 'med', re: word('סרטן|סוכרת|אלצהיימר|פרקינסון|דיכאון קליני|יתר לחץ דם|קורונה|קוביד|שבץ|אוטיזם'), why: 'אזכור מחלה קשה', fix: 'אל תבטיחו או תרמזו על טיפול או תוצאה במחלה קשה.' },
  { id: 'science', level: 'med', re: /מוכח\s+מדעית|הוכח\s+(?:מחקרית|קלינית)|מחקרים\s+מוכיחים|מחקרים\s+הוכיחו/g, why: 'טענה מדעית בלי מקור', fix: 'ציינו מקור מדויק או הסירו.' },
  { id: 'superlative', level: 'med', re: /הכי\s+טוב|הטוב\s+ביותר|מספר\s*1|מס['׳]?\s*1|מס׳\s*1/g, why: 'מצב-על שאין לו הוכחה', fix: 'הימנעו מדירוגים שאי אפשר להוכיח.' },
  { id: 'miracle', level: 'med', re: word('נס|פלא|קסם|פתרון קסם|סוד מוחלט'), why: 'ניסוח של "פלא" או "קסם"', fix: 'כתבו בפשטות מה אתם מציעים.' },
  { id: 'weight', level: 'med', re: /\d+\s*(?:ק"ג|קילו|ק״ג)[^.\n]{0,25}(?:בשבוע|ביום|בחודש|ב-?\s*\d+\s*ימים)/g, why: 'הבטחת ירידה במשקל', fix: 'אל תציינו כמות ירידה במשקל בזמן נתון.' }
];

export function checkText(text) {
  const t = String(text || '');
  const findings = [];
  for (const r of RULES) {
    for (const m of t.matchAll(r.re)) { findings.push({ id: r.id, level: r.level, match: m[0].trim(), why: r.why, fix: r.fix }); break; }
  }
  const level = findings.some(f => f.level === 'high') ? 'high' : findings.length ? 'med' : '';
  return { level, findings };
}

export const fixPrompt = (text, findings, profile) => `שכתב את הפוסט השיווקי הבא בעברית כך שיישאר משכנע וקצר, אבל בלי הבטחות רפואיות, בלי טענות ריפוי או תוצאה מובטחת, בלי "לפני/אחרי", ובלי מילים שמסומנות למטה. שמור על אותו מסר וקריאה לפעולה. החזר את הטקסט בלבד, בלי הסברים.
${profile ? 'על העסק: ' + profile.slice(0, 400) + '\n' : ''}ניסוחים בעייתיים שזוהו: ${findings.map(f => `"${f.match}" (${f.why})`).join('; ') || 'אין, אך הקפידו על זהירות'}
הפוסט:
${text}`;
