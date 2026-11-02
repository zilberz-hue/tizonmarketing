// 🎨 Image & banner studio. A banner designer that works with no key at all (sizes, brand colours, logo, headline,
// button), plus optional AI: headline suggestions (Claude) and AI-generated backgrounds (OpenAI images).

const STUDIO_SIZES = [['ריבוע (פוסט)', 1080, 1080], ['אנכי (אינסטגרם)', 1080, 1350], ['סטורי', 1080, 1920], ['רוחבי (פייסבוק / לינקדאין)', 1200, 630]];
const STUDIO_BG = {
  brand: { name: 'מותג', type: 'gradient', c1: '#9a6a2a', c2: '#5f8f08', text: '#ffffff', ctaBg: '#ffffff', ctaFg: '#7a531e' },
  light: { name: 'בהיר', type: 'solid', c1: '#f7f3ea', text: '#2b2a26', ctaBg: '#9a6a2a', ctaFg: '#ffffff' },
  dark: { name: 'כהה', type: 'solid', c1: '#1f1d17', text: '#f3efe6', ctaBg: '#d4a259', ctaFg: '#1f1d17' },
  green: { name: 'ירוק', type: 'gradient', c1: '#6c9d12', c2: '#3d6205', text: '#ffffff', ctaBg: '#ffffff', ctaFg: '#3d6205' },
  image: { name: 'תמונה', type: 'image', text: '#ffffff', ctaBg: '#9a6a2a', ctaFg: '#ffffff' }
};
const FONT = '"Heebo","Segoe UI",system-ui,-apple-system,Arial,sans-serif';

let studio = null; // current session state
const studioLogo = Object.assign(new Image(), { src: '/assets/logo.webp' });

function wrapLines(ctx, text, maxW) {
  const lines = []; let cur = '';
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

function drawBanner(canvas, s) {
  const { w, h } = s, ctx = canvas.getContext('2d');
  canvas.width = w; canvas.height = h;
  const theme = STUDIO_BG[s.bg === 'image' && !s.bgImage ? 'brand' : s.bg];
  // background
  if (theme.type === 'image') {
    const im = s.bgImage, sc = Math.max(w / im.width, h / im.height), dw = im.width * sc, dh = im.height * sc;
    ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.fillStyle = `rgba(0,0,0,${s.overlay})`; ctx.fillRect(0, 0, w, h);
  } else if (theme.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, theme.c1); g.addColorStop(1, theme.c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  } else { ctx.fillStyle = theme.c1; ctx.fillRect(0, 0, w, h); }

  const pad = w * 0.08, maxW = w - pad * 2;
  ctx.direction = 'rtl'; ctx.textBaseline = 'top';
  const alignX = s.align === 'right' ? w - pad : s.align === 'left' ? pad : w / 2;
  ctx.textAlign = s.align;

  // logo badge
  let top = pad;
  if (s.logo && studioLogo.complete && studioLogo.naturalWidth) {
    const lh = h * (h > w ? 0.075 : 0.14), lw = lh * (studioLogo.naturalWidth / studioLogo.naturalHeight), padB = lh * 0.14;
    const bx = s.align === 'right' ? w - pad - lw - padB * 2 : s.align === 'left' ? pad : (w - lw - padB * 2) / 2;
    ctx.fillStyle = '#ffffff'; roundRect(ctx, bx, top, lw + padB * 2, lh + padB * 2, lh * 0.22); ctx.fill();
    ctx.drawImage(studioLogo, bx + padB, top + padB, lw, lh);
    top += lh + padB * 2 + h * 0.03;
  }

  // text block: shrink the headline until it fits in at most 4 lines
  let size = Math.min(w, h) * 0.105, lines;
  do { ctx.font = `800 ${size}px ${FONT}`; lines = wrapLines(ctx, s.headline, maxW); size *= 0.93; } while ((lines.length > 4 || lines.some(l => ctx.measureText(l).width > maxW)) && size > 24);
  size /= 0.93;
  const lineH = size * 1.18, subSize = size * 0.42, ctaSize = size * 0.38;
  ctx.font = `500 ${subSize}px ${FONT}`;
  const subLines = s.sub ? wrapLines(ctx, s.sub, maxW) : [];
  const ctaPadX = ctaSize * 1.1, ctaPadY = ctaSize * 0.55;
  const blockH = lines.length * lineH + (subLines.length ? size * 0.25 + subLines.length * subSize * 1.35 : 0) + (s.cta ? size * 0.5 + ctaSize + ctaPadY * 2 : 0);
  let y = top + Math.max(0, (h - top - pad - blockH) / 2);

  ctx.fillStyle = theme.text; ctx.font = `800 ${size}px ${FONT}`;
  for (const l of lines) { ctx.fillText(l, alignX, y); y += lineH; }
  if (subLines.length) {
    y += size * 0.25; ctx.font = `500 ${subSize}px ${FONT}`; ctx.globalAlpha = 0.92;
    for (const l of subLines) { ctx.fillText(l, alignX, y); y += subSize * 1.35; }
    ctx.globalAlpha = 1;
  }
  if (s.cta) {
    y += size * 0.5; ctx.font = `700 ${ctaSize}px ${FONT}`;
    const tw = ctx.measureText(s.cta).width, bw = tw + ctaPadX * 2, bh = ctaSize + ctaPadY * 2;
    const bx = s.align === 'right' ? w - pad - bw : s.align === 'left' ? pad : (w - bw) / 2;
    ctx.fillStyle = theme.ctaBg; roundRect(ctx, bx, y, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = theme.ctaFg; ctx.textAlign = 'center'; ctx.fillText(s.cta, bx + bw / 2, y + ctaPadY);
  }
}

function firstSentence(text) { return String(text || '').replace(/https?:\/\/\S+/g, '').split(/[\n.!?]/).map(x => x.trim()).find(x => x.length > 2)?.slice(0, 60) || ''; }

function canvasToJpeg(canvas) {
  return new Promise(resolve => {
    let q = 0.9;
    const go = () => canvas.toBlob(b => { if (b.size > 600e3 && q > 0.45) { q -= 0.1; go(); } else resolve(b); }, 'image/jpeg', q);
    go();
  });
}
const blobToDataUrl = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('לא ניתן לטעון את התמונה')); i.src = src; });

function openStudio({ text = '', onDone } = {}) {
  studio = { w: 1080, h: 1080, bg: 'brand', bgImage: null, headline: firstSentence(text), sub: '', cta: 'השאירו פרטים', overlay: 0.35, logo: true, align: 'center', sourceText: text, onDone, deck: [], i: 0 };
  let dlg = document.getElementById('studio-dlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'studio-dlg'; dlg.className = 'quick studio'; document.body.appendChild(dlg); }
  dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form>
    <h2>🎨 יצירת תמונה / באנר</h2>
    <div class="studio-grid">
      <div class="studio-preview"><canvas id="studio-canvas" aria-label="תצוגה מקדימה של הבאנר"></canvas>
        <div id="st-strip" class="st-strip" role="group" aria-label="שקופיות"></div>
        <div class="acts st-slide-acts"><button type="button" class="btn btn-sm btn-ghost" id="st-add">➕ שקופית</button><button type="button" class="btn btn-sm btn-ghost" id="st-left" title="הזזה שמאלה (שקופית מאוחרת יותר)" aria-label="הזזת השקופית שמאלה">◀</button><button type="button" class="btn btn-sm btn-ghost" id="st-right" title="הזזה ימינה (שקופית מוקדמת יותר)" aria-label="הזזת השקופית ימינה">▶</button><button type="button" class="btn btn-sm btn-ghost danger" id="st-del">🗑 מחיקה</button></div>
        <p class="meta" id="st-deck-hint">שקופית אחת = תמונה רגילה. שתיים ויותר = קרוסלה.</p></div>
      <div class="studio-controls">
        <div class="panel st-ai"><b>🎠 קרוסלה מהפוסט</b><div class="row"><label>כמה שקופיות <select id="st-count">${[3, 4, 5, 6, 7, 8].map(n => `<option ${n === 5 ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
          <div class="qfoot"><button type="button" class="btn btn-sm" id="st-carousel">${caps.ai ? '✨ בנו קרוסלה עם AI' : '✂️ פצלו את הפוסט לשקופיות'}</button><span id="st-car-status" class="meta" role="status"></span></div></div>
        <label>גודל <select id="st-size">${STUDIO_SIZES.map(([n, w, h], i) => `<option value="${i}">${n} · ${w}×${h}</option>`).join('')}</select></label>
        <fieldset class="chips"><legend>רקע</legend>${Object.entries(STUDIO_BG).filter(([k]) => k !== 'image').map(([k, v]) => `<button type="button" class="chip-btn ${k === 'brand' ? 'on' : ''}" data-st-bg="${k}">${v.name}</button>`).join('')}
          <button type="button" class="chip-btn" id="st-upload">📷 תמונה מהמחשב</button><input type="file" id="st-file" accept="image/*" hidden></fieldset>
        <div id="st-overlay-row" hidden><label>כהות שכבה על התמונה <input id="st-overlay" type="range" min="0" max="0.8" step="0.05" value="0.35"></label></div>
        ${caps.image ? `<div class="panel st-ai"><label>🎨 רקע מ-AI: תארו מה לצייר <textarea id="st-prompt" rows="2" placeholder="למשל: שדה פתוח באור בוקר רך, אווירה רגועה"></textarea></label>
          <div class="qfoot">${caps.ai ? '<button type="button" class="link" id="st-suggest-prompt">✨ הציעו תיאור לפי הפוסט</button>' : ''}<button type="button" class="btn btn-sm" id="st-gen">צרו רקע</button><span id="st-gen-status" class="meta" role="status"></span></div></div>`
          : '<p class="meta">רוצים רקעים שנוצרים ב-AI? חברו מפתח OpenAI ב<a href="#" id="st-to-settings">הגדרות ← יצירת תמונות</a>. המעצב עובד גם בלעדיו.</p>'}
        <label>כותרת <input id="st-headline" value="${esc(studio.headline)}" maxlength="80"></label>
        <label>שורת משנה (אופציונלי) <input id="st-sub" maxlength="140"></label>
        <label>טקסט הכפתור <input id="st-cta" value="${esc(studio.cta)}" maxlength="40"></label>
        ${caps.ai ? '<div><button type="button" class="link" id="st-copy">✨ הציעו לי כותרות</button> <span id="st-copy-status" class="meta" role="status"></span><div id="st-options" class="st-options"></div></div>' : ''}
        <div class="row"><label>יישור <select id="st-align"><option value="center">מרכז</option><option value="right">ימין</option><option value="left">שמאל</option></select></label>
          <label class="chip"><input type="checkbox" id="st-logo" checked><span>לוגו</span></label></div>
        <div class="qfoot"><button type="button" class="btn" id="st-use">✔ השתמשו בתמונה</button><button type="button" class="btn btn-ghost" id="st-download">⬇ הורדה</button><button type="button" class="link" data-close>ביטול</button><span id="st-status" class="meta" role="status"></span></div>
      </div>
    </div>`;
  dlg.showModal();
  const FIELDS = ['headline', 'sub', 'cta', 'bg', 'bgImage', 'overlay', 'logo', 'align'];
  const snap = () => Object.fromEntries(FIELDS.map(k => [k, studio[k]]));
  let thumbTimer;
  const renderStrip = () => {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const box = document.getElementById('st-strip'); if (!box) return;
      const tw = 64, th = Math.round(tw * studio.h / studio.w);
      box.innerHTML = studio.deck.map((_, i) => `<button type="button" class="st-slide ${i === studio.i ? 'on' : ''}" data-st-slide="${i}" aria-label="שקופית ${i + 1}" aria-pressed="${i === studio.i}"><canvas width="${tw}" height="${th}"></canvas><span>${i + 1}</span></button>`).join('');
      box.querySelectorAll('canvas').forEach((c, i) => { const off = document.createElement('canvas'); drawBanner(off, { ...studio.deck[i], w: studio.w, h: studio.h }); c.getContext('2d').drawImage(off, 0, 0, c.width, c.height); });
      document.getElementById('st-deck-hint').textContent = studio.deck.length > 1 ? `קרוסלה של ${studio.deck.length} שקופיות. "השתמשו בתמונה" ישמור את כולן.` : 'שקופית אחת = תמונה רגילה. שתיים ויותר = קרוסלה.';
      document.getElementById('st-use').textContent = studio.deck.length > 1 ? `✔ השתמשו בקרוסלה (${studio.deck.length})` : '✔ השתמשו בתמונה';
    }, 120);
  };
  const cv = document.getElementById('studio-canvas'), redraw = () => { studio.deck[studio.i] = snap(); document.fonts?.ready?.then?.(() => drawBanner(cv, studio)); drawBanner(cv, studio); renderStrip(); };
  studioLogo.complete || studioLogo.addEventListener('load', redraw, { once: true });
  redraw();
  const $$ = id => document.getElementById(id);
  const syncControls = () => {
    $$('st-headline').value = studio.headline; $$('st-sub').value = studio.sub || ''; $$('st-cta').value = studio.cta; $$('st-align').value = studio.align; $$('st-logo').checked = !!studio.logo;
    $$('st-overlay').value = studio.overlay; $$('st-overlay-row').hidden = studio.bg !== 'image';
    dlg.querySelectorAll('[data-st-bg]').forEach(x => x.classList.toggle('on', x.dataset.stBg === studio.bg));
  };
  const showSlide = i => { studio.deck[studio.i] = snap(); studio.i = i; Object.assign(studio, studio.deck[i]); syncControls(); redraw(); };
  $$('st-strip').onclick = e => { const b = e.target.closest('[data-st-slide]'); if (b) showSlide(+b.dataset.stSlide); };
  $$('st-add').onclick = () => { if (studio.deck.length >= 10) return toast('אפשר עד 10 שקופיות'); studio.deck[studio.i] = snap(); studio.deck.splice(studio.i + 1, 0, { ...snap(), headline: '', sub: '' }); showSlide(studio.i + 1); $$('st-headline').focus(); };
  $$('st-del').onclick = () => { if (studio.deck.length < 2) return toast('זו השקופית היחידה'); studio.deck.splice(studio.i, 1); const i = Math.min(studio.i, studio.deck.length - 1); studio.i = i; Object.assign(studio, studio.deck[i]); syncControls(); redraw(); };
  const move = d => { const j = studio.i + d; if (j < 0 || j >= studio.deck.length) return; studio.deck[studio.i] = snap(); [studio.deck[studio.i], studio.deck[j]] = [studio.deck[j], studio.deck[studio.i]]; studio.i = j; redraw(); };
  $$('st-left').onclick = () => move(1); $$('st-right').onclick = () => move(-1);
  // build a whole carousel: with AI (hook, points, call to action), or by splitting the post text into sentences
  const applySlides = list => {
    const base = snap();
    studio.deck = list.map(o => ({ ...base, headline: o.headline, sub: o.sub || '', cta: o.cta || '' }));
    studio.i = 0; Object.assign(studio, studio.deck[0]); syncControls(); redraw();
  };
  $$('st-carousel').onclick = async () => {
    const st = $$('st-car-status'), n = +$$('st-count').value, src = studio.sourceText || studio.headline;
    if (!src.trim()) { st.textContent = 'כתבו קודם את טקסט הפוסט'; return; }
    if (studio.deck.length > 1 && !confirm('זה יחליף את השקופיות הנוכחיות. להמשיך?')) return;
    st.textContent = 'בונה… (עד כדקה)'; $$('st-carousel').disabled = true;
    try {
      if (caps.ai) {
        const r = await aiCall('/ai/carousel', { text: src, count: n });
        applySlides(r.slides); st.textContent = r.slides.some(x => x.risk?.level) ? '⚠️ יש ניסוח שמסומן בבדיקת התאימות. כדאי לעבור על השקופיות.' : `נוצרו ${r.slides.length} שקופיות ✨`;
      } else {
        const parts = String(src).replace(/https?:\/\/\S+/g, '').split(/[\n.!?]/).map(x => x.trim()).filter(x => x.length > 2).slice(0, n - 1);
        if (!parts.length) { st.textContent = 'אין מספיק טקסט לפיצול'; return; }
        applySlides([...parts.map(p => ({ headline: p.slice(0, 80), sub: '', cta: '' })), { headline: 'רוצים לשמוע עוד?', sub: '', cta: studio.cta || 'השאירו פרטים' }]);
        st.textContent = `פוצל ל-${studio.deck.length} שקופיות. אפשר לערוך כל אחת.`;
      }
    } catch (e) { st.textContent = e.message === 'auth' ? '' : '❌ ' + e.message; } finally { $$('st-carousel').disabled = false; }
  };
  $$('st-size').onchange = e => { const [, w, h] = STUDIO_SIZES[+e.target.value]; Object.assign(studio, { w, h }); redraw(); };
  dlg.querySelectorAll('[data-st-bg]').forEach(b => b.onclick = () => { studio.bg = b.dataset.stBg; dlg.querySelectorAll('.chip-btn').forEach(x => x.classList.toggle('on', x === b)); $$('st-overlay-row').hidden = true; redraw(); });
  const useImage = img => { studio.bgImage = img; studio.bg = 'image'; dlg.querySelectorAll('[data-st-bg]').forEach(x => x.classList.remove('on')); $$('st-overlay-row').hidden = false; redraw(); };
  $$('st-upload').onclick = () => $$('st-file').click();
  $$('st-file').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { useImage(await loadImg(URL.createObjectURL(f))); } catch (err) { $$('st-status').textContent = '❌ ' + err.message; } };
  $$('st-overlay').oninput = e => { studio.overlay = +e.target.value; redraw(); };
  for (const [id, key] of [['st-headline', 'headline'], ['st-sub', 'sub'], ['st-cta', 'cta']]) $$(id).oninput = e => { studio[key] = e.target.value; redraw(); };
  $$('st-align').onchange = e => { studio.align = e.target.value; redraw(); };
  $$('st-logo').onchange = e => { studio.logo = e.target.checked; redraw(); };
  $$('st-to-settings')?.addEventListener('click', e => { e.preventDefault(); dlg.close(); document.querySelector('[data-tab=settings]')?.click(); });

  // AI: headline suggestions
  $$('st-copy')?.addEventListener('click', async () => {
    const st = $$('st-copy-status'); st.textContent = 'מציע… (עד כדקה)';
    try {
      const r = await aiCall('/ai/banner-copy', { text: studio.sourceText || studio.headline, instruction: $$('st-headline').value });
      $$('st-options').innerHTML = r.options.map((o, i) => `<button type="button" class="chip-btn" data-st-opt="${i}" title="${esc(o.sub)}">${esc(o.headline)}${o.risk?.level ? ' ⚠️' : ''}</button>`).join('');
      $$('st-options').onclick = e => {
        const o = r.options[+e.target.closest('[data-st-opt]')?.dataset.stOpt]; if (!o) return;
        Object.assign(studio, { headline: o.headline, sub: o.sub, cta: o.cta || studio.cta });
        $$('st-headline').value = studio.headline; $$('st-sub').value = studio.sub; $$('st-cta').value = studio.cta; redraw();
        if (o.risk?.level) toast('שימו לב: ניסוח זה מסומן בבדיקת התאימות');
      };
      st.textContent = '';
    } catch (e) { st.textContent = e.message === 'auth' ? '' : '❌ ' + e.message; }
  });
  // AI: image prompt from the post, and the generated background
  $$('st-suggest-prompt')?.addEventListener('click', async () => {
    const st = $$('st-gen-status'); st.textContent = 'כותב תיאור…';
    try { $$('st-prompt').value = (await aiCall('/ai/image-prompt', { text: studio.sourceText || studio.headline })).prompt; st.textContent = ''; }
    catch (e) { st.textContent = e.message === 'auth' ? '' : '❌ ' + e.message; }
  });
  $$('st-gen')?.addEventListener('click', async () => {
    const st = $$('st-gen-status'), btn = $$('st-gen'), prompt = $$('st-prompt').value.trim();
    if (prompt.length < 3) { st.textContent = 'תארו במשפט מה לצייר'; return; }
    btn.disabled = true; st.textContent = 'יוצר תמונה… (עד כדקה)';
    try {
      const portrait = studio.h > studio.w, wide = studio.w > studio.h;
      const r = await aiCall('/ai/image', { prompt, size: portrait ? '1024x1536' : wide ? '1536x1024' : '1024x1024' });
      useImage(await loadImg(r.url)); st.textContent = 'הרקע מוכן ✨';
    } catch (e) { st.textContent = e.message === 'auth' ? '' : '❌ ' + e.message; }
    finally { btn.disabled = false; }
  });
  // finish: upload (attach) or download
  const renderTo = i => { const c = document.createElement('canvas'); drawBanner(c, { ...studio.deck[i], w: studio.w, h: studio.h }); return c; };
  $$('st-download').onclick = async () => {
    studio.deck[studio.i] = snap();
    for (let i = 0; i < studio.deck.length; i++) {
      const b = await canvasToJpeg(renderTo(i)), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = studio.deck.length > 1 ? `carousel-${i + 1}.jpg` : 'banner.jpg'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000); await new Promise(r => setTimeout(r, 250));
    }
  };
  $$('st-use').onclick = async () => {
    const st = $$('st-status'), btn = $$('st-use'), n = studio.deck.length; btn.disabled = true; st.textContent = '';
    studio.deck[studio.i] = snap();
    const pr = startProgress({ label: n > 1 ? `יוצר קרוסלה של ${n} תמונות` : 'יוצר את הבאנר' });
    try {
      const ids = [];
      for (let i = 0; i < n; i++) {
        const base = Math.round(i / n * 90);
        pr.stage(n > 1 ? `שקופית ${i + 1} מתוך ${n}: מצייר…` : 'מצייר את הבאנר…'); pr.set(base + 5);
        const blob = await canvasToJpeg(renderTo(i));
        pr.stage(`${n > 1 ? `שקופית ${i + 1} מתוך ${n}: ` : ''}מעלה (${Math.round(blob.size / 1024)}KB)…`); pr.set(base + Math.round(45 / n));
        ids.push((await api('POST', '/media', { dataUrl: await blobToDataUrl(blob) })).id);
      }
      pr.set(95); dlg.close(); studio.onDone?.(ids[0], ids); pr.done(n > 1 ? 'הקרוסלה מוכנה ✓' : 'הבאנר מוכן ✓'); toast(n > 1 ? `נוספו ${n} תמונות לקרוסלה ✅` : 'התמונה נוספה ✅');
    } catch (e) { pr.fail(e.message); st.textContent = '❌ ' + e.message; } finally { btn.disabled = false; }
  };
}

// ---- entry points ----
document.addEventListener('click', safe(async e => {
  if (e.target.closest('#post-studio')) {
    return openStudio({ text: $('#post-form [name=text]').value, onDone: (id, ids = [id]) => {
      $('#post-form [name=image]').value = id; $('#post-form [name=images]').value = ids.length > 1 ? JSON.stringify(ids) : '';
      $('#post-img-preview').innerHTML = ids.map(thumb).join('') + (ids.length > 1 ? ` <span class="tag">קרוסלה · ${ids.length}</span>` : '') + ' <button type="button" class="link" id="post-img-clear">הסרה</button>';
    } });
  }
  const qs = e.target.closest('[data-qstudio]');
  if (qs) { const el = qs.closest('.qpost'); return openStudio({ text: el.querySelector('.ptext').value, onDone: id => setQuickImage(el, id) }); }
  if (e.target.id === 'quick-studio-all') {
    const els = [...document.querySelectorAll('#quick-launch .qpost')];
    return openStudio({ text: els[0]?.querySelector('.ptext').value || '', onDone: id => els.forEach(el => setQuickImage(el, id)) });
  }
  const sp = e.target.closest('[data-act=studio-post]');
  if (sp) { const p = db.posts.find(x => x.id === sp.dataset.id); return openStudio({ text: p.text, onDone: async (id, ids = [id]) => { await api('PUT', '/posts/' + p.id, ids.length > 1 ? { images: ids } : { image: id }); await refresh(); } }); }
}));
