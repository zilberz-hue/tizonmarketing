// ✨ AI upgrade for every text field: click inside a field, press ✨, type one line about what you want
// ("shorter", "warmer", "add a call to action"), review the result, and replace the field with one click.

const AI_NAMES = { text: 'טקסט הפוסט', idea: 'הרעיון לקמפיין', audience: 'קהל היעד', message: 'המסר המרכזי', note: 'הערה', BUSINESS_PROFILE: 'תיאור העסק', AUTO_REPLY_TEXT: 'נוסח התגובה האוטומטית' };
const AI_CHIPS = ['קצר יותר', 'חם ואישי יותר', 'מקצועי יותר', 'הוסף קריאה לפעולה', 'פשוט וברור יותר', 'הוסף אימוג׳י', 'תקן שגיאות', 'בלי הבטחות רפואיות'];

function aiLabelFor(el) {
  if (!el?.matches?.('textarea, input[type=text], input:not([type])')) return null;
  if (el.closest('#login-form, #user-form, #ws-form, #ai-dlg') || el.disabled || el.readOnly) return null;
  if (el.classList.contains('ptext')) return AI_NAMES.text;
  if (el.name === 'name') return el.closest('#campaign-form, #editcamp-form, #quick-launch') ? 'שם הקמפיין' : null;
  return AI_NAMES[el.name] || null;
}

let aiFab, aiTarget, aiHideTimer;
function ensureFab() {
  if (aiFab) return aiFab;
  aiFab = document.createElement('button');
  aiFab.type = 'button'; aiFab.id = 'ai-fab'; aiFab.className = 'ai-fab'; aiFab.hidden = true;
  aiFab.textContent = '✨ שדרוג עם AI'; aiFab.title = 'כתבו שורה אחת מה לשפר, וה-AI ישדרג את הטקסט';
  aiFab.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the field
  aiFab.addEventListener('click', () => { if (aiTarget) openAiDialog(aiTarget); });
  return aiFab;
}
function placeFab() {
  if (!aiTarget || !document.contains(aiTarget)) return hideFab();
  const fab = ensureFab(), host = aiTarget.closest('dialog[open]') || document.body;
  if (fab.parentNode !== host) host.appendChild(fab);
  const r = aiTarget.getBoundingClientRect();
  fab.hidden = false;
  fab.style.top = Math.max(4, r.top - 14) + 'px';
  fab.style.left = Math.max(4, r.left + 6) + 'px';
}
function hideFab() { if (aiFab) aiFab.hidden = true; aiTarget = null; }

document.addEventListener('focusin', e => {
  clearTimeout(aiHideTimer);
  if (aiLabelFor(e.target)) { aiTarget = e.target; placeFab(); } else if (e.target !== aiFab) hideFab();
});
document.addEventListener('focusout', () => { clearTimeout(aiHideTimer); aiHideTimer = setTimeout(() => { if (document.activeElement !== aiFab && !document.querySelector('#ai-dlg[open]')) hideFab(); }, 250); });
window.addEventListener('scroll', () => { if (aiTarget) placeFab(); }, true);
window.addEventListener('resize', () => { if (aiTarget) placeFab(); });

function openAiDialog(field) {
  const label = aiLabelFor(field) || 'טקסט';
  const channel = field.closest('form, .qpost, dialog')?.querySelector('[name=channel], .pch')?.value || '';
  let dlg = document.getElementById('ai-dlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'ai-dlg'; dlg.className = 'quick'; document.body.appendChild(dlg); }
  const text = field.value;
  dlg.innerHTML = `<form method="dialog" class="x"><button aria-label="סגירה">✕</button></form>
    <h2>✨ שדרוג עם AI</h2><p class="sub">${esc(label)}</p>
    ${caps.ai ? `
    <div class="panel">
      <label>הטקסט הנוכחי <textarea id="ai-current" rows="3">${esc(text)}</textarea></label>
      <label>מה תרצו שה-AI יעשה? (שורה אחת) <input id="ai-instruction" placeholder="למשל: קצר יותר, יותר חם, עם קריאה לפעולה" maxlength="300"></label>
      <div class="chips" aria-label="הצעות">${AI_CHIPS.map(c => `<button type="button" class="chip-btn" data-ai-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="qfoot"><button type="button" class="btn" id="ai-run">✨ שדרגו</button><button type="button" class="link" data-close>ביטול</button><span id="ai-status" class="meta" role="status"></span></div>
    </div>
    <div id="ai-result" class="panel" hidden>
      <label>התוצאה (אפשר לערוך) <textarea id="ai-out" rows="5"></textarea></label>
      <div id="ai-risk"></div>
      <div class="qfoot"><button type="button" class="btn" id="ai-apply">החליפו בשדה</button><button type="button" class="btn btn-ghost" id="ai-again">נסו שוב עם הנחיה אחרת</button></div>
    </div>` : `<div class="panel"><p>כדי להשתמש בשדרוג עם AI צריך לחבר מפתח.</p><div class="qfoot"><button type="button" class="btn" id="ai-settings">להגדרות</button><button type="button" class="link" data-close>סגירה</button></div></div>`}`;
  dlg.showModal();
  $('#ai-settings')?.addEventListener('click', () => { dlg.close(); document.querySelector('[data-tab=settings]')?.click(); });
  if (!caps.ai) return;
  const instr = $('#ai-instruction'), run = $('#ai-run');
  instr.focus();
  dlg.querySelectorAll('[data-ai-chip]').forEach(b => b.onclick = () => { instr.value = (instr.value ? instr.value.replace(/[.\s]+$/, '') + ', ' : '') + b.dataset.aiChip; instr.focus(); });
  instr.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run.click(); } };
  run.onclick = async () => {
    const current = $('#ai-current').value, instruction = instr.value.trim();
    if (!current.trim() && !instruction) { $('#ai-status').textContent = 'כתבו טקסט, או הנחיה לגבי מה לכתוב'; return; }
    run.disabled = true; $('#ai-status').textContent = 'מעבד… (עד כדקה)'; $('#ai-result').hidden = true;
    try {
      const r = await aiCall('/ai/improve', { text: current, instruction, label, channel });
      $('#ai-out').value = r.text; $('#ai-risk').innerHTML = riskHtml(r.risk); $('#ai-result').hidden = false; $('#ai-status').textContent = '';
      $('#ai-out').focus();
    } catch (e) { $('#ai-status').textContent = e.message === 'auth' ? '' : '❌ ' + e.message; }
    finally { run.disabled = false; }
  };
  $('#ai-again').onclick = () => { $('#ai-result').hidden = true; $('#ai-current').value = $('#ai-out').value; instr.value = ''; instr.focus(); };
  $('#ai-apply').onclick = () => {
    field.value = $('#ai-out').value;
    field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true }));
    dlg.close(); field.focus(); toast('הטקסט עודכן ✨');
  };
}

// one-time tip
try { if (!localStorage.getItem('tz-ai-tip')) { localStorage.setItem('tz-ai-tip', '1'); setTimeout(() => typeof toast === 'function' && toast('✨ בכל שדה טקסט: לחצו בתוכו וייפתח כפתור שדרוג עם AI'), 3000); } } catch {}
