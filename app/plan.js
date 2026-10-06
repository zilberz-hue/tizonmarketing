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
    { id: 's7b', text: 'לוודא שבדיקת התאימות פעילה', why: 'הגדרות ← כללי ← "בדיקת תאימות לפני פרסום". פוסט עם ניסוח רפואי בעייתי ("מרפא", "מבטיח") ייעצר לבדיקה ולא יפורסם לבד.', go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's8', text: 'ללחוץ "בדיקת חיבור" בכל שירות שחיברתם', why: 'מוודא שהמפתח עובד באמת, לפני שמסתמכים עליו.', go: { tab: 'settings', label: 'להגדרות' } },
    { id: 's9', text: 'לעדכן את עמוד הבית: שירותים אמיתיים, תמונות, טלפון', why: 'כאן הלקוחות נוחתים. שלחו לי את הטקסטים ואעדכן.', go: { href: '../index.html', label: 'לעמוד הבית' } },
    { id: 's10', text: 'ליד מבחן: למלא את הטופס באתר ולראות אותו בלידים', why: 'הוכחה שכל הדרך עובדת מקצה לקצה.', auto: () => n.leads() > 0, go: { tab: 'leads', label: 'ללידים' } }
  ] },
  { id: 'w2', title: '🚀 שבוע 2: הקמפיין הראשון', goal: 'בסוף השבוע: קמפיין פעיל, ולפחות פוסט אחד שפורסם.', tasks: [
    { id: 'c1', text: 'להחליט על יעד אחד ומספר אחד', why: 'למשל: 10 פניות בחודש לשיחת היכרות. בלי מספר אי אפשר לדעת אם הצלחתם.' },
    { id: 'c2', text: 'ליצור קמפיין בדקה', why: 'משפט אחד על ההצעה, ערוצים, ומשך. המערכת בונה את השאר.', auto: () => n.campaigns() > 0, go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'c3', text: 'לעבור על כל פוסט ולתקן', why: 'טון שלכם, קריאה אחת לפעולה, ובלי הבטחות רפואיות (ראו "איך חושבים" למטה).' },
    { id: 'c4', text: 'לשגר את הקמפיין', why: 'פוסטים בערוצים מחוברים (⚡) מתפרסמים לבד.', auto: () => n.posts(['מתוזמן', 'פורסם', 'ידני']) > 0, go: { tab: 'content', label: 'ללוח התוכן' } },
    { id: 'c4b', text: 'להוסיף תמונה לפוסטים', why: 'פוסט עם תמונה מקבל יותר תשומת לב. כפתור "📷 הוספת תמונה" בלוח התוכן ובקמפיין בדקה.', go: { tab: 'content', label: 'ללוח התוכן' } },
    { id: 'c5', text: 'להעתיק "קישור מעקב" לכל קמפיין', why: 'ליד שיגיע דרכו ישויך לקמפיין לבד, והדוחות יתמלאו בלי הקלדה.', go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'c6', text: 'לשתף את הקישור: סטטוס וואטסאפ, ביו, הודעות ללקוחות', why: 'פוסט שאף אחד לא רואה לא מביא פניות.' },
    { id: 'c7', text: 'לוודא שהפוסט הראשון באמת פורסם', why: 'בדקו בדף הפייסבוק או בערוץ.', auto: () => n.posts(['פורסם']) > 0, go: { tab: 'content', label: 'ללוח התוכן' } },
    { id: 'c8', text: 'לענות לכל פנייה תוך שעה', why: 'מי שעונה ראשון, לרוב מקבל את הלקוח. כפתור 💬 בכרטיס הליד פותח וואטסאפ.', go: { tab: 'leads', label: 'ללידים' } }
  ] },
  { id: 'w3', title: '📈 שבוע 3: למידה ושיפור', goal: 'בסוף השבוע: אתם יודעים מה עובד, ומה לעצור.', tasks: [
    { id: 'l1', text: 'לעדכן הוצאה אמיתית בכל קמפיין', why: 'בלי זה אין עלות לליד.', auto: () => n.spent() > 0, go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'l2', text: 'לקרוא את "תובנות והמלצות" בדוחות', why: 'מה הכי משתלם, איפה מבזבזים, מי מחכה לתשובה.', go: { tab: 'reports', label: 'לדוחות' } },
    { id: 'l3', text: 'ללחוץ "ניתוח עמוק עם AI"', why: 'דורש מפתח AI. נותן המלצות מותאמות לנתונים שלכם.', go: { tab: 'reports', label: 'לדוחות' } },
    { id: 'l3b', text: 'להריץ בדיקת A/B', why: 'בכל קמפיין יש שני קישורי מעקב, 🧪 A ו-🧪 B. השתמשו בכל אחד בפוסטים אחרים, ואחרי כ-5 פניות לכל גרסה התובנות יגידו מי מנצחת. שנו רק דבר אחד בין הגרסאות.', go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'l4', text: 'להכפיל את מה שעבד: קמפיין חדש על בסיס הפוסט החזק', why: 'אותו מסר, קהל או ערוץ סמוך.', go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'l5', text: 'לעצור קמפיין שלא מביא פניות', why: 'לחצו "סיום" בכרטיס הקמפיין. כסף שנחסך הוא רווח.', go: { tab: 'campaigns', label: 'לקמפיינים' } },
    { id: 'l6', text: 'לסגור עסקה ולהזין את שוויה', why: 'כך תראו ROAS אמיתי.', auto: () => n.won() > 0, go: { tab: 'leads', label: 'ללידים' } }
  ] },
  { id: 'w4', title: '🌱 שבוע 4: הרחבה ושגרה', goal: 'בסוף השבוע: שיווק כהרגל קבוע, לא כפרויקט.', tasks: [
    { id: 'e1', text: 'קמפיין שני: הצעה או קהל אחרים', why: 'ככה מגלים מה עוד עובד.', auto: () => n.campaigns() >= 2, go: { quick: true, label: '✨ קמפיין בדקה' } },
    { id: 'e1b', text: 'להפעיל מעקב לידים: תאריך חזרה לכל ליד', why: 'כל ליד חדש מקבל תזכורת למחרת, ואחרי "✓ יצרתי קשר" התזכורת הבאה מגיעה בעוד 3 ימים, ואחריה בעוד 7.', go: { tab: 'leads', label: 'ללידים' } },
    { id: 'e1c', text: 'להתקין את המערכת כאפליקציה בנייד', why: 'בדפדפן בנייד: "הוסף למסך הבית" (ב-Chrome יש גם כפתור 📲 התקנה למעלה).' },
    { id: 'e2', text: 'להוסיף איש צוות', why: 'סקירה ← הוספת איש צוות. התקדמות הצ׳קליסט משותפת.', go: { tab: 'dash', label: 'לסקירה' } },
    { id: 'e2b', text: 'אם משרתים לקוח נוסף: ליצור לו סביבת עבודה', why: 'בבורר שבראש המסך: "＋ לקוח חדש". לכל לקוח חיבורים, קמפיינים ולידים נפרדים.', go: { tab: 'settings', label: 'להגדרות' } },
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


// ---- Channel playbooks: numbered, in order. Work top to bottom. ----
const posted = ch => () => db.posts.some(x => x.channel === ch && x.status === 'פורסם');
const SET = { tab: 'settings', label: 'להגדרות' }, QUICK = { quick: true, label: '✨ קמפיין בדקה' }, CAMP = { tab: 'campaigns', label: 'לקמפיינים' }, LEADS = { tab: 'leads', label: 'ללידים' };
const CHANNELS = [
  { id: 'tg', icon: '✈️', title: 'טלגרם', intro: 'ערוץ ציבורי שמפרסמים אליו אוטומטית, ובוט שמתריע לכם בפרטיות על כל ליד חדש.', steps: [
    { t: 'ליצור ערוץ ציבורי', why: 'בטלגרם: תפריט ← New Channel. שם העסק, הלוגו כתמונה, תיאור קצר, וקישור קבוע באנגלית, למשל t.me/mybusiness. הקישור הוא "הכתובת" שלכם.' },
    { t: 'ליצור בוט', why: 'חפשו בטלגרם את BotFather ושלחו לו את הפקודה newbot. בחרו שם ושם משתמש, והעתיקו את הטוקן. אל תשתפו אותו עם איש.' },
    { t: 'להוסיף את הבוט כמנהל בערוץ', why: 'ניהול הערוץ ← מנהלים ← הוספת מנהל ← הבוט, עם הרשאה לפרסם הודעות.' },
    { t: 'למצוא את מספר הצ׳אט הפרטי שלכם להתראות', why: 'שלחו הודעה כלשהי לבוט שיצרתם, ואז חפשו את הבוט @userinfobot כדי לקבל את המספר שלכם. לשם יגיעו התראות על לידים, ולא לערוץ הציבורי.' },
    { t: 'להזין בהגדרות ולבדוק חיבור', why: 'טוקן הבוט; "ערוץ לפרסום": @שם_הערוץ; "צ׳אט פרטי להתראות": המספר שמצאתם. שמירה ← בדיקת חיבור.', go: SET, auto: () => has('telegram') },
    { t: 'לפרסם הודעת פתיחה בערוץ', why: 'מי אתם, מה יקבלו מנויים כאן, ובאיזו תדירות.' },
    { t: 'ליצור קמפיין בדקה עם ערוץ Telegram', why: 'ולוודא שהפוסט הראשון עלה לערוץ.', go: QUICK, auto: posted('Telegram') },
    { t: 'להפיץ את קישור הערוץ', why: 'עמוד הבית, חתימת מייל, וואטסאפ, כרטיס ביקור. ערוץ בלי מנויים לא מביא פניות.' },
    { t: 'לקבוע שגרה: 2 עד 3 פוסטים בשבוע', why: 'טיפ, שאלה להתעניינות, והצעה. מחזורי: קמפיין בדקה כל שבוע.' },
    { t: 'למדוד: מנויים ופניות', why: 'פעם בשבוע רשמו כמה מנויים יש וכמה פניות הגיעו, והשוו לשבוע הקודם.', go: LEADS }
  ] },
  { id: 'fb', icon: '📘', title: 'פייסבוק', intro: 'דף עסקי עם פרסום אוטומטי מהמערכת.', steps: [
    { t: 'ליצור דף עסקי (Page), לא פרופיל אישי', why: 'קטגוריה, שם העסק, הלוגו כתמונת פרופיל, תמונת שער, כפתור פעולה (התקשרו או וואטסאפ).' },
    { t: 'להשלים את "אודות"', why: 'תיאור, טלפון, שעות פעילות, קישור לאתר (עם קישור מעקב).' },
    { t: 'לפרסם 3 פוסטים ראשונים ידנית', why: 'כדי שהדף לא יהיה ריק כשמגיעים אליו.' },
    { t: 'להזמין לקוחות וחברים לעשות לייק', why: 'מינימום ראשוני של עוקבים נותן אמינות.' },
    { t: 'ליצור אפליקציה ב-developers.facebook.com', why: 'סוג Business. אחר כך Graph API Explorer ← הרשאות pages_manage_posts ו-pages_show_list ← טוקן דף ארוך טווח (ההסבר בהגדרות ← פייסבוק ← "איפה משיגים").' },
    { t: 'להזין בהגדרות ולבדוק חיבור', why: 'Page ID וטוקן הדף. שמירה ← בדיקת חיבור: תראו את שם הדף.', go: SET, auto: () => has('facebook') },
    { t: 'ליצור קמפיין בדקה עם ערוץ Facebook', why: 'ולבדוק שהפוסט הראשון עלה לדף.', go: QUICK, auto: posted('Facebook') },
    { t: 'לשים את קישור המעקב בדף ובפוסטים', why: 'כך תדעו כמה פניות הגיעו מפייסבוק.', go: CAMP },
    { t: 'שגרה: 3 עד 4 פוסטים בשבוע, ותגובה לכל תגובה והודעה', why: 'מענה מהיר משפיע על אמון.' },
    { t: 'אופציונלי: קידום ממומן קטן על הפוסט החזק ביותר', why: 'התחילו בתקציב קטן לבדיקה, ועדכנו את ההוצאה בקמפיין כדי לראות עלות לליד. בתחום הבריאות יש מגבלות על טענות בפרסום ממומן, ולכן בדקו את מדיניות המודעות.', go: CAMP }
  ] },
  { id: 'ig', icon: '📸', title: 'אינסטגרם', intro: 'מפרסמים דרך Webhook (Make או Zapier), כי אינסטגרם דורשת תמונה או וידאו.', steps: [
    { t: 'להמיר לחשבון עסקי ולקשר לדף הפייסבוק', why: 'חובה כדי לפרסם דרך אוטומציה.' },
    { t: 'לעצב ביו: מי אתם, מה ההצעה, קישור', why: 'שימו בביו את קישור המעקב של הקמפיין הפעיל.', go: CAMP },
    { t: 'להכין 5 פוסטים או רילס ראשונים', why: 'צילום בטלפון מספיק. פנים, מאחורי הקלעים, טיפ.' },
    { t: 'לפתוח חשבון ב-Make או Zapier', why: 'ליצור תרחיש: Webhook ← פרסום באינסטגרם לעסקים.' },
    { t: 'להדביק את כתובת ה-Webhook בהגדרות ולבדוק חיבור', go: SET, auto: () => has('webhook') },
    { t: 'ליצור קמפיין בדקה עם ערוץ Instagram', why: 'המערכת שולחת ל-Webhook את הטקסט, והשדה channel. בתרחיש סננו לפי channel=Instagram והוסיפו את התמונה.', go: QUICK, auto: posted('Instagram') },
    { t: 'להוסיף האשטגים וקריאה אחת לפעולה', why: 'שלוש עד חמש תגיות רלוונטיות. פנו לקורא להשאיר הודעה בפרטי.' },
    { t: 'לענות להודעות בפרטי תוך שעות', why: 'שם נסגרות רוב הפניות באינסטגרם.' }
  ] },
  { id: 'wa', icon: '💬', title: 'וואטסאפ', intro: 'הערוץ שבו נסגרות רוב העסקאות. כאן המהירות והאישיות קובעות.', steps: [
    { t: 'להוריד WhatsApp Business ולמלא פרופיל', why: 'שם, תיאור, שעות פעילות, כתובת, אתר.' },
    { t: 'להגדיר הודעת פתיחה, הודעת "לא זמין" ותשובות מהירות', why: 'חוסך זמן ונותן רושם מקצועי.' },
    { t: 'ליצור קישור וואטסאפ עם הודעה מוכנה', why: 'https://wa.me/972523186262?text=שלום. מכניסים לאתר, לביו ולפוסטים.' },
    { t: 'להגדיר תוויות ללקוחות', why: 'חדש, בטיפול, לקוח. מקביל לצנרת במערכת.' },
    { t: 'לקבל הסכמה לפני כל הודעה שיווקית', why: 'בישראל נדרשת הסכמה מפורשת לדיוור שיווקי (חוק התקשורת, "חוק הספאם"). זו הנחיה כללית ולא ייעוץ משפטי.' },
    { t: 'לענות לכל ליד תוך שעה', why: 'הכפתור 💬 בכרטיס הליד במערכת פותח צ׳אט ישירות.', go: LEADS },
    { t: 'לפרסם סטטוס שבועי עם הצעה וקישור', why: 'מגיע לכל אנשי הקשר שלכם.' },
    { t: 'מתקדם: אוטומציה', why: 'Make או Zapier עם WhatsApp Business API. דורש אישור תבניות הודעה מוואטסאפ.' }
  ] },
  { id: 'gg', icon: '🔎', title: 'גוגל', intro: 'לקוחות שמחפשים אתכם בגוגל כבר רוצים. פרופיל עסק חינמי הוא הצעד הכי משתלם.', steps: [
    { t: 'לפתוח Google Business Profile', why: 'business.google.com. אימות בטלפון או בדואר.' },
    { t: 'למלא הכול: קטגוריה, שעות, תיאור, שירותים, תמונות, טלפון, אתר', why: 'פרופיל מלא מופיע גבוה יותר.' },
    { t: 'לבקש ביקורות מלקוחות מרוצים', why: 'שלחו להם קישור ישיר לביקורת. אסור להציע תמורה על ביקורת.' },
    { t: 'להגיב לכל ביקורת', why: 'גם לשלילית, בנימוס ובקצרה, בלי פרטים רפואיים.' },
    { t: 'לפרסם עדכונים והצעות בפרופיל', why: 'פעם בשבוע או שבועיים.' },
    { t: 'לוודא שבעמוד הבית יש כותרת ותיאור ברורים, ושהטלפון והכתובת זהים לפרופיל', why: 'עקביות עוזרת לקידום אורגני.', go: { href: '../index.html', label: 'לעמוד הבית' } },
    { t: 'אופציונלי: קמפיין חיפוש ממומן קטן', why: 'Google Ads על מילות מפתח של השירות, עם עמוד הבית כיעד וקישור מעקב. בתחום הבריאות יש מגבלות על ניסוחים, ולכן עברו על מדיניות המודעות.', go: CAMP }
  ] },
  { id: 'li', icon: '💼', title: 'לינקדאין', intro: 'מתאים אם הלקוחות שלכם הם עסקים או אנשי מקצוע.', steps: [
    { t: 'לעדכן את הפרופיל האישי של בעל העסק', why: 'תמונה מקצועית, כותרת ברורה, תיאור שמסביר איך אתם עוזרים.' },
    { t: 'ליצור דף חברה', why: 'לוגו, תיאור, אתר.' },
    { t: 'להגדיר תרחיש Webhook ב-Make או Zapier ולחבר בהגדרות', go: SET, auto: () => has('webhook') },
    { t: 'ליצור קמפיין בדקה עם ערוץ LinkedIn', go: QUICK, auto: posted('LinkedIn') },
    { t: 'לפרסם תוכן מקצועי: ידע, מקרים, תובנות', why: 'פחות מכירה, יותר ערך.' },
    { t: 'להתחבר עם 10 אנשים רלוונטיים בשבוע ולהגיב לפוסטים שלהם' }
  ] },
  { id: 'tt', icon: '🎬', title: 'טיקטוק', intro: 'וידאו קצר. המערכת תזכיר ותכין את הטקסט, והעלאה היא ידנית.', steps: [
    { t: 'לפתוח חשבון עסקי', why: 'שם, לוגו, ביו וקישור מעקב.' },
    { t: 'להחליט על 3 סוגי סרטונים', why: 'טיפ קצר, מאחורי הקלעים, שאלה ותשובה.' },
    { t: 'לצלם 5 סרטונים בסשן אחד בטלפון', why: 'אור טוב, קול ברור, 15 עד 30 שניות.' },
    { t: 'ליצור קמפיין בדקה עם ערוץ TikTok', why: 'תקבלו תזכורת עם הטקסט והכיתוב לכל סרטון.', go: QUICK },
    { t: 'להעלות לפי הלוח ולהוסיף כיתוב והאשטגים' },
    { t: 'להגיב לכל תגובה בשעה הראשונה', why: 'מגדיל חשיפה.' },
    { t: 'שגרה: 3 סרטונים בשבוע ולמדוד מה צבר צפיות' }
  ] },
  { id: 'em', icon: '✉️', title: 'אימייל', intro: 'מענה אוטומטי ללידים והתראות אליכם. ניוזלטר נעשה כרגע דרך כלי חיצוני.', steps: [
    { t: 'לפתוח חשבון חינמי ב-resend.com', why: 'ליצור API Key ולאמת דומיין (הוספת רשומות DNS בספק הדומיין).' },
    { t: 'להזין בהגדרות: מפתח, כתובת שולח, והאימייל שלכם', go: SET, auto: () => has('email') },
    { t: 'ללחוץ "בדיקת חיבור"', why: 'אמור להגיע מייל בדיקה אליכם.', go: SET },
    { t: 'להפעיל "תגובה אוטומטית" ולערוך את הנוסח', why: 'קצר, חם, עם מועד חזרה. מושבתת כברירת מחדל.', go: SET },
    { t: 'למלא ליד מבחן באתר ולוודא שקיבלתם התראה והלקוח קיבל תגובה', go: LEADS },
    { t: 'לאסוף כתובות רק בהסכמה', why: 'טופס האתר מבקש אימייל ופרטי יצירת קשר. שלחו דיוור שיווקי רק למי שהסכים.' }
  ] }
];

// Wrap Latin/URL runs in <bdi> so they keep their direction inside Hebrew text.
const LATIN = /([A-Za-z][A-Za-z0-9@\/._:=?%#-]*(?: [A-Za-z][A-Za-z0-9@\/._:=?%#-]*)*|@[A-Za-z0-9_]+)/;
const fmt = s => String(s ?? '').split(LATIN).map((x, i) => {
  if (i % 2 === 0) return esc(x);
  const [, body, tail] = x.match(/^(.*?)([.:,]*)$/);
  return `<bdi>${esc(body)}</bdi>${esc(tail)}`;
}).join('');
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return ymd(d); }; // Sunday
const taskKey = (ph, t) => ph.weekly ? `${t.id}@${weekStart()}` : t.id;
function taskState(ph, t) {
  const manual = !!db.checklist?.[taskKey(ph, t)];
  const auto = !manual && !ph.weekly && t.auto ? !!t.auto() : false;
  return { done: manual || auto, auto };
}
const chKey = (c, i) => `ch-${c.id}-${i + 1}`;
function chStepState(c, i) {
  const manual = !!db.checklist?.[chKey(c, i)];
  const auto = !manual && c.steps[i].auto ? !!c.steps[i].auto() : false;
  return { done: manual || auto, auto };
}
const chProgress = c => { const s = c.steps.map((_, i) => chStepState(c, i)); return { done: s.filter(x => x.done).length, total: s.length }; };
function progress(ph) {
  const s = ph.tasks.map(t => taskState(ph, t));
  return { done: s.filter(x => x.done).length, total: s.length };
}
function nextTask() {
  for (const ph of PLAN.filter(p => !p.weekly)) for (const t of ph.tasks) if (!taskState(ph, t).done) return { ph, t };
  return null;
}
const goBtnCh = (go, ch, i) => go ? `<button type="button" class="btn btn-sm btn-ghost" data-plan-goch="${ch}:${i}">${esc(go.label)}</button>` : '';
const goBtn = (go, key) => go ? `<button type="button" class="btn btn-sm btn-ghost" data-plan-go="${esc(key)}">${esc(go.label)}</button>` : '';

function planNextHtml() {
  const all = PLAN.filter(p => !p.weekly), total = all.reduce((s, p) => s + progress(p).total, 0), done = all.reduce((s, p) => s + progress(p).done, 0);
  const nx = nextTask(), pct = Math.round(done / total * 100);
  return `<div class="panel plan-next"><div class="bar"><h3>✅ תוכנית העבודה שלכם: ${pct}%</h3><button type="button" class="btn btn-sm" data-act="plan-open">לצ׳קליסט</button></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    ${nx ? `<p><b>הצעד הבא:</b> ${fmt(nx.t.text)} <span class="meta">(${esc(nx.ph.title.replace(/^\S+\s/, ''))})</span> ${goBtn(nx.t.go, nx.t.id)}</p>` : '<p>🎉 סיימתם את כל תוכנית ההקמה. נשארה השגרה השבועית.</p>'}</div>`;
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
    ${nx ? `<div class="panel plan-next"><b>הצעד הבא: ${fmt(nx.t.text)}</b>${nx.t.why ? `<p class="meta">${fmt(nx.t.why)}</p>` : ''}${goBtn(nx.t.go, nx.t.id)}</div>` : ''}
    ${PLAN.map(ph => { const p = progress(ph), open = openIds.includes(ph.id) || (firstOpen && (nx ? nx.ph.id === ph.id : ph.weekly));
      return `<details class="phase" data-id="${ph.id}" ${open ? 'open' : ''}><summary><span>${esc(ph.title)}</span><span class="badge ${p.done === p.total ? 'auto' : ''}">${p.done}/${p.total}</span></summary>
        <p class="meta">${fmt(ph.goal)}</p>
        <ul class="tasks">${ph.tasks.map(t => { const st = taskState(ph, t), key = taskKey(ph, t);
          return `<li class="task ${st.done ? 'done' : ''}"><label><input type="checkbox" data-plan-key="${esc(key)}" ${st.done ? 'checked' : ''} ${st.auto ? 'disabled' : ''}>
            <span><b>${fmt(t.text)}</b>${st.auto ? ' <span class="badge auto">🤖 זוהה אוטומטית</span>' : ''}${t.why ? `<span class="meta why">${fmt(t.why)}</span>` : ''}</span></label>${goBtn(t.go, t.id)}</li>`; }).join('')}</ul></details>`; }).join('')}

    <h3 class="sec">📚 מדריכי ערוצים: סדר פעולות לכל אמצעי שיווק</h3>
    <p class="meta">בחרו ערוץ ועבדו לפי המספרים, מלמעלה למטה. כל ערוץ מתחיל מההקמה ומסתיים בשגרה ומדידה.</p>
    <div class="chips" role="group" aria-label="בחירת ערוץ">${CHANNELS.map(c => { const cp = chProgress(c); return `<button type="button" class="chip-btn ${cp.done === cp.total ? 'done' : ''}" data-plan-ch="${c.id}">${c.icon} ${esc(c.title)} <small>${cp.done}/${cp.total}</small></button>`; }).join('')}</div>
    ${CHANNELS.map(c => { const cp = chProgress(c), open = openIds.includes('ch-' + c.id);
      return `<details class="phase" id="ch-${c.id}" data-id="ch-${c.id}" ${open ? 'open' : ''}><summary><span>${c.icon} ${esc(c.title)}</span><span class="badge ${cp.done === cp.total ? 'auto' : ''}">${cp.done}/${cp.total}</span></summary>
        <p class="meta">${fmt(c.intro)}</p>
        <ol class="tasks chsteps">${c.steps.map((s, i) => { const st = chStepState(c, i);
          return `<li class="task ${st.done ? 'done' : ''}"><label><input type="checkbox" data-plan-key="${chKey(c, i)}" ${st.done ? 'checked' : ''} ${st.auto ? 'disabled' : ''}>
            <span class="num" aria-hidden="true">${i + 1}</span><span><b>${fmt(s.t)}</b>${st.auto ? ' <span class="badge auto">🤖 זוהה אוטומטית</span>' : ''}${s.why ? `<span class="meta why">${fmt(s.why)}</span>` : ''}</span></label>${goBtnCh(s.go, c.id, i)}</li>`; }).join('')}</ol></details>`; }).join('')}

    <details class="phase"><summary><span>🧠 איך חושבים על קמפיין</span></summary>
      <div class="guide">${GUIDE.map(([h, b]) => `<article class="card"><h3>${fmt(h)}</h3><p>${fmt(b)}</p></article>`).join('')}</div></details>`;
}

function planGo(id) { runGo(PLAN.flatMap(p => p.tasks).find(x => x.id === id)?.go); }
function runGo(go) {
  if (!go) return;
  if (go.quick) return openQuick();
  if (go.href) return window.open(go.href, '_blank', 'noopener');
  document.querySelector(`[data-tab=${go.tab}]`)?.click();
}

document.addEventListener('click', e => {
  const gc = e.target.closest('[data-plan-goch]');
  if (gc) { const [cid, i] = gc.dataset.planGoch.split(':'); const go = CHANNELS.find(c => c.id === cid)?.steps[+i]?.go; return runGo(go); }
  const chip = e.target.closest('[data-plan-ch]');
  if (chip) { const d = document.getElementById('ch-' + chip.dataset.planCh); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
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
