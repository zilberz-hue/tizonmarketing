# טיזון שיווק

אתר שיווק סטטי בעברית (RTL). פתחו את `index.html` בדפדפן, או הריצו `python3 -m http.server`.

התאימו תוכן, צבעים (`:root` ב-`style.css`) וחיבור הטופס (`script.js`).

## מערכת שיווק ופרסום עצמאית

שרת Node.js בלי תלויות חיצוניות (נדרש Node 22.13+), עם מסד נתונים SQLite מקומי.

```bash
cp .env.example .env   # ערכו ADMIN_EMAIL ו-ADMIN_PASSWORD
npm start              # http://localhost:3000  (האתר) ו-/app/ (המערכת)
npm test
```

או עם Docker (תקיפו `-e TRUST_PROXY=true` אם הוא יושב מאחורי Netlify/Caddy): `docker build -t tizon . && docker run -p 3000:3000 -v tizon-data:/data --env-file .env tizon`

### מה עובד לבד
- **פרסום מתוזמן:** כל 30 שניות השרת מפרסם פוסטים שהגיע זמנם (3 ניסיונות, ואז התראה). חיבורים: פייסבוק (Page API), טלגרם, ו-Webhook כללי (Make/Zapier/n8n) לכל ערוץ אחר. ערוץ בלי חיבור מסומן "ידני" ושולח התראה.
- **תוכן ב-AI:** כתיבת פוסט, או לוח תוכן שלם לקמפיין (`ANTHROPIC_API_KEY`). פוסטים שה-AI יוצר נשמרים כטיוטה לאישור, אלא אם `AUTO_APPROVE=true`.
- **לידים:** טופס האתר שולח ל-`/api/public/lead` (מוגן מספאם), והליד מופיע בצנרת עם התראה. ליד שממתין יותר מיומיים מקבל תזכורת.
- **צוות:** התחברות עם סיסמאות מוצפנות; מנהל מוסיף אנשי צוות במסך הסקירה.

### בעלות ואבטחה
הנתונים נמצאים רק בתיקיית `data/` בשרת שלכם. הגדירו HTTPS (למשל Caddy/nginx מול השרת) לפני חשיפה לאינטרנט, וגבו את `data/` באופן קבוע. מפתחות API נשמרים ב-`.env` בלבד ולא נשלחים לדפדפן.

## פריסה: Netlify + (השרת שלכם או Firebase)

האתר והממשק עולים ל-Netlify, וכל קריאת `/api/*` מועברת לבק-אנד שבחרתם. אותו קוד (`server/core.js`) רץ בשני המצבים:

| | שרת משלכם | Firebase |
|---|---|---|
| נתונים | SQLite בקובץ אצלכם | Firestore |
| מתזמן | כל 30 שניות | Cloud Scheduler כל דקה |
| עלות | שרת קטן (VPS) | מסלול Blaze, לפי שימוש |

**Netlify** (בשני המצבים): חברו את הריפו. `netlify.toml` כבר מגדיר את הבנייה. הגדירו משתנה סביבה אחד:
- שרת משלכם: `BACKEND_URL=https://your-server.example.com`
- Firebase: `FIREBASE_PROJECT_ID=my-project` (אופציונלי `FIREBASE_REGION`, ברירת מחדל `europe-west1`)

**Firebase:**
```bash
npm i -g firebase-tools && firebase login
firebase use --add                      # בחרו פרויקט עם מסלול Blaze
cp .env.example functions/.env          # ADMIN_EMAIL/ADMIN_PASSWORD, מפתחות חיבורים (ללא PORT/DATA_DIR)
firebase deploy --only functions,firestore:rules
```
אחרי ההתחברות הראשונה כמנהל, הסירו את `ADMIN_PASSWORD` מ-`functions/.env` ופרסו שוב. כללי Firestore חוסמים גישה ישירה מהדפדפן; הכול עובר דרך הפונקציה.

אפשר גם לשלב: להשאיר את שני הבק-אנדים מוכנים ולהחליף ביניהם רק על ידי שינוי `BACKEND_URL` / `FIREBASE_PROJECT_ID` ב-Netlify (הנתונים אינם עוברים אוטומטית בין שניהם).

הגבלות ידועות: הגבלת הקצב היא לפי מופע בסביבת Firebase (בערך, לא מדויקת), והתחברות נשמרת בטוקן ב-`localStorage` של הדפדפן.
