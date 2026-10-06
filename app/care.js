// 🩺 Patient care: a private record per patient, a consent-gated personal link where they report progress
// and ask questions, and a follow-up date that reminds the team. Names and health details stay out of the activity log.

const care = { list: null, open: null };
const careDay = iso => { try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const careTime = iso => { try { return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const waHref = (phone, text) => { let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('0')) d = '972' + d.slice(1); return d ? `https://wa.me/${d}?text=${encodeURIComponent(text || '')}` : ''; };
const TYPE_LABEL = { measure: 'מדידה', note: 'הערה פנימית', reply: 'תשובה שלנו', question: 'שאלה', checkin: 'עדכון מהמטופל/ת' };

async function loadCare() { care.list = await api('GET', '/patients'); renderCare(); }

function sparkline(points) {
  if (points.length < 2) return '';
  const w = 280, h = 70, xs = points.map((_, i) => 10 + i * (w - 20) / (points.length - 1)), lo = Math.min(...points), hi = Math.max(...points), r = hi - lo || 1;
  const ys = points.map(v => h - 12 - (v - lo) / r * (h - 24));
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="גרף משקל: מ-${points[0]} ל-${points[points.length - 1]} ק״ג"><polyline fill="none" stroke="var(--brand2)" stroke-width="2.5" points="${xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')}"/>${xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3.5" fill="var(--brand)"/>`).join('')}<text x="10" y="12" font-size="11" fill="currentColor">${points[0]}</text><text x="${w - 10}" y="12" font-size="11" text-anchor="end" fill="currentColor">${points[points.length - 1]}</text></svg>`;
}

function renderCare() {
  const root = $('#care'); if (!root) return;
  if (care.open) return renderPatient(root);
  const list = care.list || [];
  root.innerHTML = `<div class="bar"><h2>🩺 ליווי מטופלים</h2></div>
    <p class="meta">תיק פרטי לכל מטופל/ת, קישור אישי לעדכון התקדמות ושאלות, ותזכורת לחזור אליהם. מידע בריאותי הוא רגיש: מוסיפים מטופל רק אחרי שהסכים/ה, והמידע לא נכנס ליומן הפעילות או ל-AI.</p>
    <form id="care-form" class="panel"><div class="row">
      <label>שם <input name="name" required maxlength="80"></label>
      <label>טלפון <input name="phone" type="tel"></label>
      <label>מטרה <input name="goal" placeholder="למשל: ירידה במשקל, אנרגיה" maxlength="500"></label>
      <label>לחזור אליו/ה בתאריך <input name="next" type="date"></label></div>
      <label class="chk"><input type="checkbox" name="consent"> המטופל/ת אישר/ה שימוש בפורטל ואיסוף המידע על התקדמותו/ה</label>
      <button class="btn btn-sm" type="submit">הוספת מטופל/ת</button></form>
    ${list.length ? `<div style="overflow-x:auto"><table><tr><th>מטופל/ת</th><th>מטרה</th><th>משקל</th><th>פעילות אחרונה</th><th>סטטוס</th></tr>${list.map(p => {
      const dw = p.lastWeight != null && p.firstWeight != null ? p.lastWeight - p.firstWeight : null;
      return `<tr data-care-open="${esc(p.id)}" style="cursor:pointer"><td><b>${esc(p.name)}</b>${p.open ? ` <span class="badge auto">${p.open} שאלות</span>` : ''}${p.due ? ' <span class="badge">📞 לחזור</span>' : ''}</td><td>${esc(p.goal || '')}</td>
        <td>${p.lastWeight != null ? p.lastWeight + ' ק״ג' : '-'}${dw ? ` <span class="meta">(${dw > 0 ? '+' : ''}${dw.toFixed(1)})</span>` : ''}</td><td>${p.lastAt ? careDay(p.lastAt) : '-'}</td><td>${esc(p.status)}</td></tr>`; }).join('')}</table></div>` : '<p class="meta">עדיין אין מטופלים.</p>'}`;
}

async function openPatient(id) { care.open = await api('GET', '/patients/' + id); care.link = null; renderCare(); }

function renderPatient(root) {
  const { patient: p, entries } = care.open, weights = entries.filter(e => e.weight != null).reverse().map(e => e.weight);
  const openQs = entries.filter(e => e.type === 'question' && !e.answered);
  root.innerHTML = `<div class="bar"><h2>🩺 ${esc(p.name)}</h2><button type="button" class="btn btn-sm btn-ghost" id="care-back">← חזרה לרשימה</button></div>
    <section class="panel"><form id="care-edit"><div class="row">
      <label>שם <input name="name" value="${esc(p.name)}" required></label><label>טלפון <input name="phone" value="${esc(p.phone || '')}" type="tel"></label>
      <label>מטרה <input name="goal" value="${esc(p.goal || '')}"></label><label>לחזור בתאריך <input name="next" type="date" value="${esc(p.next || '')}"></label>
      <label>סטטוס <select name="status">${['פעיל', 'מושהה', 'הושלם'].map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>
      <label>הערות פנימיות (לא מוצגות למטופל/ת)<textarea name="note" rows="2">${esc(p.note || '')}</textarea></label>
      <label class="chk"><input type="checkbox" name="consent" ${p.consent ? 'checked' : ''}> אישר/ה שימוש בפורטל ואיסוף מידע${p.consentAt ? ` (מתאריך ${careDay(p.consentAt)})` : ''}</label>
      <div class="acts"><button class="btn btn-sm" type="submit">שמירה</button>${p.phone ? `<a class="btn btn-sm btn-ghost" href="${waHref(p.phone)}" target="_blank" rel="noopener">💬 וואטסאפ</a>` : ''}
      <button type="button" id="care-export">⬇ ייצוא נתונים</button><button type="button" class="danger" id="care-delete">מחיקה מלאה</button></div></form></section>

    <section class="panel"><h3>🔗 קישור אישי למטופל/ת</h3>
      ${!p.consent ? '<p class="meta">כדי ליצור קישור יש לסמן למעלה שהמטופל/ת אישר/ה, ולשמור.</p>' : care.link
        ? `<label>הקישור (שולחים רק למטופל/ת)<input id="care-url" readonly value="${esc(care.link)}"></label><div class="acts"><button type="button" id="care-copy">העתקה</button>${p.phone ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="${waHref(p.phone, 'שלום ' + p.name.split(' ')[0] + ', זה הקישור האישי שלך לעדכון התקדמות ולשאלות: ' + care.link)}">שליחה בוואטסאפ</a>` : ''}<button type="button" id="care-rotate">קישור חדש (מבטל את הישן)</button><button type="button" class="danger" id="care-revoke">ביטול הקישור</button></div>`
        : `<p class="meta">${p.hasLink ? 'יש קישור פעיל.' : 'עדיין לא נוצר קישור.'}</p><div class="acts"><button type="button" class="btn btn-sm" id="care-mklink">${p.hasLink ? 'הצגת הקישור' : 'יצירת קישור'}</button></div>`}</section>

    ${weights.length > 1 ? `<section class="panel"><h3>📉 התקדמות במשקל</h3>${sparkline(weights)}</section>` : ''}

    <section class="panel"><h3>הוספת רשומה</h3><form id="care-entry"><div class="row">
      <label>סוג <select name="type"><option value="measure">מדידה (מוצגת למטופל/ת)</option><option value="note">הערה פנימית</option><option value="reply">תשובה למטופל/ת</option></select></label>
      <label>משקל (ק״ג) <input name="weight" type="number" step="0.1" min="20" max="400"></label></div>
      <label>טקסט <textarea name="text" rows="2" maxlength="1500"></textarea></label><button class="btn btn-sm" type="submit">הוספה</button></form></section>

    <section class="panel"><h3>היסטוריה ${openQs.length ? `<span class="badge auto">${openQs.length} שאלות ממתינות</span>` : ''}</h3><ul class="ac-list">${entries.map(e => `<li><div><span class="badge ${e.by === 'patient' ? 'auto' : ''}">${TYPE_LABEL[e.type] || e.type}</span> <span class="meta">${careDay(e.at)} ${careTime(e.at)}</span>
      <div>${[e.weight != null ? `משקל ${e.weight}` : '', e.energy != null ? `אנרגיה ${e.energy}/5` : '', e.mood != null ? `מצב רוח ${e.mood}/5` : ''].filter(Boolean).join(' · ')}</div>${e.text ? `<div>${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}</div>
      ${e.type === 'question' && !e.answered ? `<button type="button" data-care-reply="${esc(e.id)}">לענות</button>` : ''}</li>`).join('') || '<li class="meta">אין עדיין רשומות.</li>'}</ul></section>`;
}

document.addEventListener('click', safe(async e => {
  const row = e.target.closest('[data-care-open]'); if (row) return openPatient(row.dataset.careOpen);
  const id = care.open?.patient.id;
  if (e.target.id === 'care-back') { care.open = null; return loadCare(); }
  if (e.target.id === 'care-mklink' || e.target.id === 'care-rotate') {
    if (e.target.id === 'care-rotate' && !confirm('הקישור הישן יפסיק לעבוד. להמשיך?')) return;
    const r = await api('POST', `/patients/${id}/link`, { rotate: e.target.id === 'care-rotate' });
    care.link = location.origin + r.path; care.open.patient.hasLink = true; return renderCare();
  }
  if (e.target.id === 'care-revoke' && confirm('לבטל את הקישור? המטופל/ת לא יוכלו להיכנס.')) { await api('POST', `/patients/${id}/link`, { revoke: true }); care.link = null; care.open.patient.hasLink = false; return renderCare(); }
  if (e.target.id === 'care-copy') { $('#care-url').select(); try { await navigator.clipboard.writeText($('#care-url').value); toast('הקישור הועתק'); } catch { document.execCommand('copy'); toast('הקישור הועתק'); } return; }
  if (e.target.id === 'care-export') {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(care.open, null, 2)], { type: 'application/json' })); a.download = 'patient-data.json'; a.click(); return setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  if (e.target.id === 'care-delete' && confirm('למחוק את המטופל/ת וכל הנתונים שלו/ה לצמיתות? אי אפשר לשחזר.')) { await api('DELETE', '/patients/' + id); care.open = null; toast('נמחק'); return loadCare(); }
  const rp = e.target.closest('[data-care-reply]');
  if (rp) { const f = $('#care-entry'); f.type.value = 'reply'; f.dataset.replyTo = rp.dataset.careReply; f.text.focus(); f.scrollIntoView({ block: 'center' }); }
}));
document.addEventListener('submit', safe(async e => {
  const f = e.target;
  if (f.id === 'care-form') {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f)); d.consent = !!d.consent;
    await api('POST', '/patients', d); f.reset(); toast('נוסף'); return loadCare();
  }
  if (f.id === 'care-edit') {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f)); d.consent = !!d.consent;
    const upd = await api('PUT', '/patients/' + care.open.patient.id, d); care.open.patient = upd; if (!upd.consent) care.link = null; toast('נשמר'); return renderCare();
  }
  if (f.id === 'care-entry') {
    e.preventDefault(); const d = Object.fromEntries(new FormData(f)); if (f.dataset.replyTo) d.replyTo = f.dataset.replyTo;
    await api('POST', `/patients/${care.open.patient.id}/entries`, d); await openPatient(care.open.patient.id); toast('נוסף');
  }
}));
document.addEventListener('click', e => { if (e.target.closest('[data-tab=care]')) { care.open = null; loadCare().catch(err => err.message !== 'auth' && toast(err.message)); } });
