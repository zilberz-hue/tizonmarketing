// 📥 Content-plan import: paste a table (e.g. copied from Google Sheets) and it becomes posts.
// Rows with a live link are recorded as already published; everything else lands as a draft to approve. Nothing is scheduled.

// Quote-aware TSV/CSV parser (cells may hold line breaks inside quotes, as Google Sheets exports them).
function parseTable(src) {
  const text = String(src || '').replace(/\r\n?/g, '\n'), delim = text.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && !cell) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows.filter(r => r.some(x => x.trim()));
}
const IMPORT_COLS = [['assetLink', /link to asset|קישור (ל)?(קובץ|נכס)/i], ['liveLink', /live|פוסט חי|קישור לפוסט/i], ['date', /post date|date|תאריך/i], ['pillar', /pillar|עמוד תוכן/i], ['bucket', /bucket|סוג תוכן/i], ['topic', /topic|נושא/i], ['text', /post copy|copy|טקסט|נוסח/i], ['assetType', /asset|נכס|סוג קריאייטיב/i], ['channel', /channel|ערוץ/i]];
function tableToRows(src) {
  const t = parseTable(src); if (t.length < 2) return [];
  const map = t[0].map(h => (IMPORT_COLS.find(([, re]) => re.test(h.trim())) || [])[0]);
  return t.slice(1).map(cells => Object.fromEntries(map.map((k, i) => k ? [k, (cells[i] || '').trim()] : null).filter(Boolean)));
}

function mountImporter() {
  const bar = $('#content .bar'); if (!bar || $('#import-panel')) return;
  bar.insertAdjacentHTML('afterend', `<details id="import-panel" class="panel"><summary><b>📥 ייבוא תוכנית תוכן מטבלה</b></summary>
    <p class="meta">מדביקים טבלה מגוגל שיטס (שורת כותרות ראשונה: Post date, Content Pillar, Content Bucket, Topic, Post Copy, Asset, Link to Asset, Live post). שורה עם קישור לפוסט חי נרשמת כמפורסמת, והשאר נכנסות כטיוטות שאתם מאשרים. שום דבר לא מתוזמן אוטומטית.</p>
    <label>הטבלה <textarea id="import-text" rows="6" dir="auto" placeholder="הדביקו כאן"></textarea></label>
    <div class="row"><label>קמפיין (אופציונלי) <select id="import-campaign"></select></label></div>
    <div id="import-preview" class="meta" aria-live="polite"></div>
    <div class="acts"><button type="button" class="btn btn-sm" id="import-go" disabled>ייבוא</button></div></details>`);
}
mountImporter();
document.addEventListener('toggle', e => {
  if (e.target.id !== 'import-panel' || !e.target.open) return;
  $('#import-campaign').innerHTML = '<option value="">ללא קמפיין</option>' + db.campaigns.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}, true);
document.addEventListener('input', e => {
  if (e.target.id !== 'import-text') return;
  const rows = tableToRows(e.target.value), live = rows.filter(r => /^https?:\/\//.test(r.liveLink || '')).length;
  $('#import-go').disabled = !rows.length;
  $('#import-preview').textContent = rows.length ? `${rows.length} שורות: ${live} יסומנו כפורסמו, ${rows.length - live} ייכנסו כטיוטות. ${rows.filter(r => !r.date).length ? `${rows.filter(r => !r.date).length} ללא תאריך.` : ''}` : (e.target.value.trim() ? 'לא זוהו שורות. ודאו שהשורה הראשונה היא כותרות והטבלה הודבקה מגוגל שיטס.' : '');
});
document.addEventListener('click', safe(async e => {
  if (e.target.id !== 'import-go') return;
  const rows = tableToRows($('#import-text').value); if (!rows.length) return;
  e.target.disabled = true;
  try {
    const r = await api('POST', '/posts/import', { rows, campaign: $('#import-campaign').value });
    $('#import-text').value = ''; $('#import-preview').textContent = '';
    await refresh(); $('#import-panel').open = true;
    toast(`יובאו ${r.created} פוסטים (${r.published} פורסמו, ${r.drafts} טיוטות)${r.skipped ? `, ${r.skipped} דולגו (כפולים או ריקים)` : ''}`);
  } finally { e.target.disabled = false; }
}));
