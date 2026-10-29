// 🔍 Search for every tab: one bar above the content that filters the items of whichever tab is open.
// Each tab remembers its own query. Filtering only toggles `hidden`, and re-applies after a tab re-renders (data refresh, async loads).

const SEARCH_TABS = {
  dash: ['הסקירה', '#dash .item, #dash li'],
  plan: ['תוכנית העבודה', '#plan li, #plan .item'],
  academy: ['ההדרכה', '#ac-lessons li, #ac-releases li, #ac-items li, #ac-activity li'],
  campaigns: ['הקמפיינים', '#campaign-list article.item, #campaign-board .kcard'],
  content: ['לוח התוכן', '#post-list article'],
  leads: ['הלידים', '#pipeline .lead'],
  care: ['המטופלים', '#care tr[data-care-open]'],
  ideas: ['ההצעות', '#idea-list li'],
  reports: ['הדוחות', '#reports tr:has(td)'],
  team: ['הצוות', '#team tr:has(td)'],
  settings: ['ההגדרות', '#settings .set-group']
};
const searchQuery = {};
const norm = s => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/[^\p{L}\p{N}@.\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
const activeTab = () => document.querySelector('#tabs button.active')?.dataset.tab || 'dash';

function mountSearch() {
  const main = document.querySelector('main'); if (!main || $('#search-bar')) return;
  main.insertAdjacentHTML('afterbegin', `<div id="search-bar" class="search" role="search"><input id="search-input" type="search" autocomplete="off" aria-label="חיפוש בלשונית"><span class="count" id="search-count" aria-live="polite"></span></div>`);
}

function applySearch() {
  const tab = activeTab(), def = SEARCH_TABS[tab], bar = $('#search-bar'); if (!bar) return;
  bar.hidden = !def; if (!def) return;
  const input = $('#search-input'), q = norm(searchQuery[tab] || '');
  input.placeholder = `חיפוש ב${def[0]}… (לחיצה על / )`;
  const items = [...document.querySelectorAll(def[1])];
  let shown = 0;
  for (const el of items) { const hit = !q || q.split(' ').every(w => norm(el.textContent).includes(w)); el.hidden = !hit; if (hit) shown++; }
  $('#search-count').textContent = q ? (shown ? `${shown} מתוך ${items.length}` : 'אין תוצאות') : '';
}

mountSearch();
$('#search-input')?.addEventListener('input', e => { searchQuery[activeTab()] = e.target.value; applySearch(); });
document.addEventListener('click', e => { if (e.target.closest('#tabs button[data-tab]')) setTimeout(() => { const i = $('#search-input'); if (i) i.value = searchQuery[activeTab()] || ''; applySearch(); }, 0); });
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && SEARCH_TABS[activeTab()]) { e.preventDefault(); $('#search-input')?.focus(); }
  if (e.key === 'Escape' && e.target.id === 'search-input') { e.target.value = ''; searchQuery[activeTab()] = ''; applySearch(); }
});
let searchTimer;
new MutationObserver(muts => { if (muts.every(m => m.target.closest?.('#search-bar'))) return; clearTimeout(searchTimer); searchTimer = setTimeout(applySearch, 60); }).observe(document.querySelector('main'), { childList: true, subtree: true });
applySearch();
