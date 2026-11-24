// Daybook: compact personal journal. Plain JavaScript, no framework.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';
import { loadState, saveState, clearState, askPersistent } from './store.js';
import { emptyDirty, emptyTomb, isDirty, syncNow, touch, removeRecord, touchProfile } from './sync-core.js';
import { configured, currentUser, signIn, signOutUser, backend } from './firebase.js';

/* ---------- constants ---------- */
const PALETTE = ['--c-work','--c-health','--c-personal','--c-ideas','--c-finance','--c-family','--c-red','--c-orange','--c-yellow','--c-lime','--c-mint','--c-cyan','--c-sky','--c-indigo','--c-violet','--c-rose','--c-brown','--c-olive','--c-slate'];
const MS_TYPES = [['education','Education','--c-ideas'],['career','Career','--c-work'],['family','Family','--c-family'],['health','Health','--c-health'],['home','Home & moves','--c-finance'],['travel','Travel','--c-personal']];
// Starter categories have fixed ids, so a new device and the account agree on them.
const STARTER_CATS = [
  { id: 'work', name: 'Work', c: '--c-work', tpl: 'Done today:\n- \n\nBlockers:\n- \n\nPlan for tomorrow:\n- ' },
  { id: 'health', name: 'Health', c: '--c-health', tpl: 'Blood pressure: \nWeight: \nSleep: \nMood: \n\nNotes:\n' },
  { id: 'personal', name: 'Personal', c: '--c-personal', tpl: 'Highlight of the day:\n\nGrateful for:\n\nOn my mind:\n' },
  { id: 'ideas', name: 'Ideas', c: '--c-ideas', tpl: 'Idea:\n\nWhy it matters:\n\nNext step:\n' },
  { id: 'finance', name: 'Finance', c: '--c-finance', tpl: 'Spent today: \nIncome: \nSaved: \n\nNotes:\n' }
];
const DAY = 864e5;
const PER = 52;
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ---------- state ---------- */
function emptyState() {
  return {
    v: 1, entries: [], cats: STARTER_CATS.map(c => ({ ...c, archived: false, mt: 0 })), milestones: [],
    birth: null, lifeYears: 90, profileMt: 0,
    tomb: emptyTomb(), dirty: emptyDirty(), sync: { uid: null, email: null, lastPull: 0, lastSync: 0 },
    drafts: {}, lastBackup: null
  };
}
let S = emptyState();
let saveT = null;
function store() { clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; saveState(S); }, 250); }
function flush() { clearTimeout(saveT); saveT = null; return saveState(S); }
// Save locally, then sync a moment later if something changed.
function save() { store(); if (isDirty(S)) queueSync(); }
addEventListener('pagehide', () => { flush(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
  else if (S.sync.uid && Date.now() - (S.sync.lastSync || 0) > 2 * 60 * 1000) doSync(true);
});

function deviceInfo() {
  let id = null; try { id = localStorage.getItem('daybook-device'); } catch (e) {}
  if (!id) { id = 'd' + Math.random().toString(36).slice(2, 10); try { localStorage.setItem('daybook-device', id); } catch (e) {} }
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const kind = /iPhone|iPad|Android/.test(ua) ? 'phone' : 'laptop';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return { id, kind, name: standalone ? `App on ${os}` : `${br} on ${os}` };
}
let DEVICE = deviceInfo();
const ui = { devices: [], syncing: false, syncErr: null, signingIn: false, confirmSignout: false };

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const iso = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const daysAgo = (n, h = 20, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.getTime(); };
const parseD = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const catOf = id => S.cats.find(c => c.id === id) || { name: 'Uncategorized', c: '--faint' };
const msType = id => MS_TYPES.find(t => t[0] === id) || MS_TYPES[1];
const fD = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fDY = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
function ago(t) { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago'; const d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago'); }
let tt; function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 3000); }
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/* ---------- navigation ---------- */
let backTo = 'home', tab = 'home';
function current() { return ['home', 'edit', 'settings', 'life'].find(v => !$('v-' + v).hidden); }
function show(v) {
  const main = v !== 'edit'; if (v === 'home' || v === 'life') tab = v;
  $('openSettings').setAttribute('aria-pressed', v === 'settings');
  $('mainTop').hidden = !main; document.body.classList.toggle('in-edit', !main);
  document.querySelectorAll('#bnav [data-nav]').forEach(b => b.setAttribute('aria-selected', b.dataset.nav === v));
  ['home', 'edit', 'settings', 'life'].forEach(x => $('v-' + x).hidden = x !== v);
  window.scrollTo(0, 0);
  if (v === 'home') renderHome(); if (v === 'settings') renderSettings(); if (v === 'life') renderLife();
}
// Redraw what's on screen after a sync brought in changes (never the editor, so typing is not disturbed).
function refresh() { const v = current(); if (v === 'home') renderHome(); else if (v === 'life') renderLife(); else if (v === 'settings') renderSettings(); }

/* ---------- journal list ---------- */
let filter = 'all', q = '', editing = null, edCat = null, lastTpl = '';
let tagF = '', showArch = false, dFrom = '', dTo = '', calM = null, dragA = null, dragB = null, dragging = false, calMode = 'days';
function rangeBounds() { if (!dFrom) return [-Infinity, Infinity]; return [parseD(dFrom), parseD(dTo) + DAY - 1]; }
const terms = () => q.toLowerCase().split(/\s+/).filter(Boolean);
function hl(text, ts) { const h = esc(text); if (!ts.length) return h; const re = new RegExp('(' + ts.map(t => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi'); return h.replace(re, '<mark>$1</mark>'); }
function snippet(e, ts) { const b = e.body; if (!ts.length) return b; const i = b.toLowerCase().indexOf(ts[0]); if (i < 50) return b; return '…' + b.slice(b.lastIndexOf(' ', i - 30) + 1); }

function renderHome() {
  if (calM) {
    const d = dFrom ? new Date(parseD(dFrom)) : null;
    if (d && (d.getMonth() !== calM.getMonth() || d.getFullYear() !== calM.getFullYear())) { calM = new Date(d.getFullYear(), d.getMonth(), 1); renderCal(); }
    else if (calMode === 'days' && $('calDays').children.length) paintCal();
  }
  if (filter !== 'all' && !S.cats.some(c => c.id === filter)) filter = 'all';
  const ts = terms();
  const match = e => { const hay = (e.title + ' ' + e.body + ' ' + e.tags.join(' ') + ' ' + catOf(e.cat).name).toLowerCase(); return ts.every(t => hay.includes(t)); };
  const [ra, rb] = rangeBounds();
  const searched = S.entries.filter(e => e.ts >= ra && e.ts <= rb && match(e) && (!tagF || e.tags.some(t => t.toLowerCase() === tagF)));
  const arch = S.cats.filter(c => c.archived);
  const chipH = c => `<button class="chip${c.archived ? ' archived' : ''}" data-f="${esc(c.id)}" aria-pressed="${filter === c.id}"${c.c ? ` title="${c.archived ? 'Archived · ' : ''}Hold or right-click to edit"` : ''}>${c.c ? `<span class="cdot" style="--c:var(${c.c})"></span>` : ''}${esc(c.name)}</button>`;
  $('chips').innerHTML = [{ id: 'all', name: 'All' }, ...S.cats.filter(c => !c.archived)].map(chipH).join('')
    + '<button class="chip add" data-add="1" aria-label="Add category" title="Add category">+</button>'
    + (arch.length ? `<button class="chip arch-t" data-arch="1" aria-pressed="${showArch}" title="${showArch ? 'Hide' : 'Show'} archived categories">${showArch ? 'Hide archived' : 'Archived'}</button>` + (showArch ? arch.map(chipH).join('') : '') : '');
  const list = searched.filter(e => filter === 'all' || e.cat === filter).sort((a, b) => b.ts - a.ts);
  $('countLine').textContent = ts.length ? `Results for "${q.trim()}"` : ''; $('countLine').parentElement.hidden = !ts.length;
  $('dateBtn').setAttribute('aria-pressed', !!dFrom); $('dayBar').hidden = !dFrom;
  if (dFrom) {
    const one = dFrom === dTo, n = Math.round((parseD(dTo) - parseD(dFrom)) / DAY) + 1;
    $('dayLabel').textContent = one ? new Date(parseD(dFrom)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${fD(parseD(dFrom))} – ${fDY(parseD(dTo))} · ${n} days`;
  }
  const nd = (S.drafts || {}).new;
  $('draftSlot').innerHTML = nd ? `<button class="draft-card" id="draftCard"><span class="dc-l">Unsaved draft</span><span class="dc-t">${esc(nd.title.trim() || nd.body.trim().split('\n')[0] || 'Untitled')}</span><span class="dc-a">Continue ›</span></button>` : '';
  $('tagBar').hidden = !tagF; if (tagF) $('tagLabel').textContent = 'Tag #' + tagF;
  $('qClear').hidden = !q;
  if (!list.length) {
    $('list').innerHTML = (ts.length || dFrom || tagF)
      ? `<div class="empty">${dFrom && !ts.length ? (dFrom === dTo ? '<b>No entries on this day</b>Use ‹ › to check the days around it.' : '<b>No entries in this period</b>Use ‹ › to move to the next period.') : '<b>No matching entries</b>Try other keywords, another category or another date.'}</div>`
      : `<div class="empty"><b>No entries yet</b>Tap New entry to write your first one.</div>`;
    return;
  }
  const groups = {}; list.forEach(e => { const k = iso(e.ts); (groups[k] = groups[k] || []).push(e); });
  const today = iso(Date.now()), yest = iso(daysAgo(1));
  $('list').innerHTML = Object.entries(groups).map(([k, es]) => {
    const d = new Date(es[0].ts); const lbl = k === today ? 'Today' : k === yest ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long' });
    return `<div class="day"><h3>${lbl}<span class="d">${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></h3><div class="card">${es.map(e => {
      const c = catOf(e.cat);
      return `<button class="entry" data-id="${esc(e.id)}"><span class="meta"><span class="cdot" style="--c:var(${c.c})"></span>${esc(c.name)}<span class="t">${new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></span><span class="ttl">${hl(e.title || 'Untitled', ts)}</span><span class="snip">${hl(snippet(e, ts), ts)}</span>${e.tags.length ? `<span class="tags">${e.tags.map(t => `<span class="tag${t.toLowerCase() === tagF ? ' on' : ''}" data-tag="${esc(t)}" title="Show all #${esc(t)}">#${hl(t, ts)}</span>`).join('')}</span>` : ''}</button>`;
    }).join('')}</div></div>`;
  }).join('');
}

$('q').addEventListener('input', e => { q = e.target.value; renderHome(); });
$('qClear').onclick = e => { e.preventDefault(); q = ''; $('q').value = ''; renderHome(); $('q').focus(); };
$('chips').addEventListener('click', e => {
  if (e.target.closest('[data-arch]')) { showArch = !showArch; if (!showArch && catOf(filter).archived) filter = 'all'; renderHome(); return; }
  if (e.target.closest('[data-add]')) { openCatModal('add'); return; }
  const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; renderHome(); }
});
$('list').addEventListener('click', e => {
  const tg = e.target.closest('[data-tag]'); if (tg) { tagF = tg.dataset.tag.toLowerCase(); renderHome(); window.scrollTo({ top: 0 }); return; }
  const b = e.target.closest('[data-id]'); if (b) openEditor(b.dataset.id);
});
$('newBtn').onclick = () => openEditor(null);
$('tagClear').onclick = () => { tagF = ''; renderHome(); };
$('draftSlot').addEventListener('click', e => { if (e.target.closest('#draftCard')) openEditor(null); });

/* ---------- calendar: tap = one day, drag = range, title = jump by month / year ---------- */
function renderCal() {
  const y = calM.getFullYear(), m = calM.getMonth(), off = (new Date(y, m, 1).getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate(), now = new Date();
  const g = $('calDays'); g.classList.toggle('grid3', calMode !== 'days'); $('calWd').hidden = calMode !== 'days';
  $('calHint').textContent = calMode === 'days' ? 'Tap a day, or drag across days' : calMode === 'months' ? 'Choose a month' : 'Choose a year';
  if (calMode === 'months') {
    $('calTitle').textContent = String(y);
    const hm = new Set(S.entries.map(e => { const d = new Date(e.ts); return d.getFullYear() + '-' + d.getMonth(); }));
    g.innerHTML = MON.map((l, i) => `<button class="cm${hm.has(y + '-' + i) ? ' has' : ''}${y === now.getFullYear() && i === now.getMonth() ? ' cur' : ''}${i === m ? ' on' : ''}" data-m="${i}">${l}</button>`).join('');
    return;
  }
  if (calMode === 'years') {
    const y0 = y - (y % 12); $('calTitle').textContent = `${y0} – ${y0 + 11}`;
    const hy = new Set(S.entries.map(e => new Date(e.ts).getFullYear())); let h = '';
    for (let k = y0; k < y0 + 12; k++) h += `<button class="cm${hy.has(k) ? ' has' : ''}${k === now.getFullYear() ? ' cur' : ''}${k === y ? ' on' : ''}" data-y="${k}">${k}</button>`;
    g.innerHTML = h; return;
  }
  $('calTitle').textContent = calM.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const has = new Set(S.entries.map(e => iso(e.ts))), today = iso(Date.now()); let h = '';
  for (let i = 0; i < off; i++) h += '<span></span>';
  for (let d = 1; d <= n; d++) { const k = iso(new Date(y, m, d)); h += `<button class="cd${has.has(k) ? ' has' : ''}${k === today ? ' today' : ''}" data-d="${k}">${d}</button>`; }
  g.innerHTML = h; paintCal();
}
function paintCal() {
  let a = dragging ? dragA : dFrom, b = dragging ? dragB : dTo; if (a && b && a > b) [a, b] = [b, a];
  $('calDays').querySelectorAll('[data-d]').forEach(c => { const k = c.dataset.d; c.classList.toggle('sel', !!a && k >= a && k <= b); c.classList.toggle('a', k === a); c.classList.toggle('b', k === b); });
}
function closeCal() { $('calPop').hidden = true; $('dateBtn').setAttribute('aria-expanded', 'false'); }
$('dateBtn').onclick = () => {
  const p = $('calPop'); if (!p.hidden) { closeCal(); return; }
  const base = dFrom ? new Date(parseD(dFrom)) : new Date(); calM = new Date(base.getFullYear(), base.getMonth(), 1); calMode = 'days'; renderCal();
  p.hidden = false; $('dateBtn').setAttribute('aria-expanded', 'true');
};
const calStep = dir => { const y = calM.getFullYear(), m = calM.getMonth(); calM = calMode === 'days' ? new Date(y, m + dir, 1) : calMode === 'months' ? new Date(y + dir, m, 1) : new Date(y + dir * 12, m, 1); renderCal(); };
$('calPrev').onclick = () => calStep(-1); $('calNext').onclick = () => calStep(1);
$('calTitle').onclick = () => { calMode = calMode === 'days' ? 'months' : 'years'; renderCal(); };
$('calToday').onclick = () => { const n = new Date(); calM = new Date(n.getFullYear(), n.getMonth(), 1); calMode = 'days'; renderCal(); };
const cd = $('calDays');
cd.addEventListener('click', e => {
  const mb = e.target.closest('[data-m]'), yb = e.target.closest('[data-y]');
  if (mb) { calM = new Date(calM.getFullYear(), +mb.dataset.m, 1); calMode = 'days'; renderCal(); }
  else if (yb) { calM = new Date(+yb.dataset.y, calM.getMonth(), 1); calMode = 'months'; renderCal(); }
});
cd.addEventListener('pointerdown', e => { const c = e.target.closest('[data-d]'); if (!c) return; e.preventDefault(); dragging = true; dragA = dragB = c.dataset.d; try { cd.setPointerCapture(e.pointerId); } catch (_) {} paintCal(); });
cd.addEventListener('pointermove', e => { if (!dragging) return; const el = document.elementFromPoint(e.clientX, e.clientY); const c = el && el.closest && el.closest('#calDays [data-d]'); if (c && c.dataset.d !== dragB) { dragB = c.dataset.d; paintCal(); } });
cd.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; [dFrom, dTo] = [dragA, dragB].sort(); closeCal(); renderHome(); });
cd.addEventListener('pointercancel', () => { dragging = false; paintCal(); });
cd.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const c = e.target.closest('[data-d]'); if (c) { e.preventDefault(); dFrom = dTo = c.dataset.d; closeCal(); renderHome(); } } });
const shiftRange = dir => { const span = Math.round((parseD(dTo) - parseD(dFrom)) / DAY) + 1; dFrom = iso(parseD(dFrom) + dir * span * DAY + 36e5); dTo = iso(parseD(dTo) + dir * span * DAY + 36e5); renderHome(); };
$('dayPrev').onclick = () => shiftRange(-1); $('dayNext').onclick = () => shiftRange(1);
$('dayClear').onclick = () => { dFrom = dTo = ''; renderHome(); };

/* ---------- editor ---------- */
function renderEdCats() {
  $('edCats').innerHTML = S.cats.filter(c => !c.archived || c.id === edCat).map(c => `<button class="chip" role="radio" data-c="${esc(c.id)}" style="--c:var(${c.c})" aria-pressed="${edCat === c.id}" aria-checked="${edCat === c.id}"><span class="cdot" style="${edCat === c.id ? 'background:var(--bg)' : ''}"></span>${esc(c.name)}</button>`).join('')
    + '<button class="chip add" data-add="1" aria-label="Add category" title="Add category">+</button>';
  updateTplRow();
}
function updateTplRow() { const t = catOf(edCat).tpl; $('tplInsert').hidden = !t; $('tplEdit').textContent = t ? 'Edit template' : 'Add template'; $('tplEdit').hidden = !edCat; $('tplMore').hidden = !edCat; }
function setEdCat(id) { setTimeout(writeDraft, 0); const b = $('edBody'); if (!b.value.trim() || b.value === lastTpl) { const t = catOf(id).tpl || ''; b.value = t; lastTpl = t; wc(); autoGrow(); } edCat = id; renderEdCats(); }
function openEditor(id) {
  backTo = $('v-life').hidden ? 'home' : 'life';
  editing = id ? S.entries.find(e => e.id === id) : null;
  if (id && !editing) { toast('This entry was deleted on another device'); return; }
  const firstActive = (S.cats.find(c => !c.archived) || {}).id || null;
  edCat = editing ? editing.cat : (filter !== 'all' && !catOf(filter).archived ? filter : firstActive);
  $('edHead').textContent = editing ? 'Edit entry' : 'New entry';
  $('edDate').value = iso(editing ? editing.ts : Date.now());
  $('edTitle').value = editing ? editing.title : '';
  lastTpl = catOf(edCat).tpl || '';
  $('edBody').value = editing ? editing.body : lastTpl;
  $('edTags').value = editing ? editing.tags.join(', ') : '';
  $('edDelete').hidden = !editing; $('delConfirm').hidden = true;
  const dr = (S.drafts || {})[draftKey()];
  if (dr) { $('edDate').value = dr.date; edCat = S.cats.some(c => c.id === dr.cat) ? dr.cat : edCat; $('edTitle').value = dr.title; $('edBody').value = dr.body; $('edTags').value = dr.tags; }
  $('edDiscard').hidden = !dr; $('edDraft').textContent = dr ? '· Draft restored' : '';
  $('tplMenu').hidden = true; renderEdCats(); wc(); show('edit'); autoGrow();
  if (dr) toast('Restored your unsaved draft');
  if (!editing) setTimeout(() => $('edTitle').focus(), 50);
}
// Autosave: unsaved text is kept per entry ("new" for a new one), on this device only.
const draftKey = () => editing ? editing.id : 'new';
function edValues() { return { date: $('edDate').value, cat: edCat, title: $('edTitle').value, body: $('edBody').value, tags: $('edTags').value }; }
function pristine(v) {
  if (editing) return v.title === editing.title && v.body === editing.body && v.tags === editing.tags.join(', ') && v.cat === editing.cat && v.date === iso(editing.ts);
  return !v.title.trim() && (!v.body.trim() || v.body === lastTpl) && !v.tags.trim();
}
let draftT = null;
function writeDraft() {
  clearTimeout(draftT);
  draftT = setTimeout(() => {
    if ($('v-edit').hidden) return; S.drafts = S.drafts || {}; const v = edValues(), k = draftKey();
    if (pristine(v)) { delete S.drafts[k]; $('edDraft').textContent = ''; $('edDiscard').hidden = true; }
    else { S.drafts[k] = { ...v, at: Date.now() }; $('edDraft').textContent = '· Draft saved'; $('edDiscard').hidden = false; }
    store();
  }, 500);
}
function clearDraft(k) { if (S.drafts && S.drafts[k]) { delete S.drafts[k]; store(); } }
['edTitle', 'edBody', 'edTags'].forEach(id => $(id).addEventListener('input', writeDraft)); $('edDate').addEventListener('change', writeDraft);
$('edDiscard').onclick = () => { clearTimeout(draftT); clearDraft(draftKey()); openEditor(editing ? editing.id : null); toast('Draft discarded'); };
function wc() { const n = $('edBody').value.trim().split(/\s+/).filter(Boolean).length; $('edCount').textContent = n + (n === 1 ? ' word' : ' words'); }
function autoGrow() { const t = $('edBody'); t.style.height = 'auto'; t.style.height = Math.max(240, t.scrollHeight) + 'px'; }
$('edBody').addEventListener('input', () => { wc(); autoGrow(); });
$('edCats').addEventListener('click', ev => { if (ev.target.closest('[data-add]')) { openCatModal('add'); return; } const b = ev.target.closest('[data-c]'); if (b) setEdCat(b.dataset.c); });
$('tplMore').onclick = () => { const m = $('tplMenu'); m.hidden = !m.hidden; $('tplMore').setAttribute('aria-expanded', !m.hidden); };
document.addEventListener('click', e => { if (!e.target.closest('.tpl-wrap')) { $('tplMenu').hidden = true; $('tplMore').setAttribute('aria-expanded', 'false'); } });
$('tplInsert').onclick = () => { $('tplMenu').hidden = true; const t = catOf(edCat).tpl || '', b = $('edBody'); b.value = b.value.trim() ? b.value.replace(/\s+$/, '') + '\n\n' + t : t; lastTpl = b.value === t ? t : lastTpl; wc(); autoGrow(); b.focus(); writeDraft(); };
$('tplEdit').onclick = () => { $('tplMenu').hidden = true; openCatModal('tpl', edCat); };
$('edSave').onclick = () => {
  const title = $('edTitle').value.trim(), body = $('edBody').value.trim();
  if (!title && (!body || body === lastTpl.trim())) { toast('Write a title or some text before saving'); return; }
  const [y, m, d] = $('edDate').value.split('-').map(Number); const base = editing ? new Date(editing.ts) : new Date();
  const ts = $('edDate').value ? new Date(y, m - 1, d, base.getHours(), base.getMinutes()).getTime() : Date.now();
  const tags = $('edTags').value.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
  clearTimeout(draftT); clearDraft(draftKey());
  let e = editing;
  if (e) Object.assign(e, { title, body, tags, ts, cat: edCat });
  else { e = { id: newId('e'), ts, cat: edCat, title, body, tags }; S.entries.push(e); }
  touch(S, 'entries', e); save(); show(backTo); toast(editing ? 'Entry updated' : 'Entry saved');
};
$('edDelete').onclick = () => $('delConfirm').hidden = false;
$('delNo').onclick = () => $('delConfirm').hidden = true;
$('delYes').onclick = () => { clearTimeout(draftT); clearDraft(draftKey()); removeRecord(S, 'entries', editing.id); save(); show(backTo); toast('Entry deleted'); };
$('edBack').onclick = () => {
  clearTimeout(draftT); const v = edValues(), k = draftKey(); S.drafts = S.drafts || {};
  if (pristine(v)) delete S.drafts[k]; else S.drafts[k] = { ...v, at: Date.now() };
  store(); show(backTo); if (S.drafts[k]) toast('Draft saved. Continue anytime.');
};

/* ---------- categories: add, edit, template, archive, delete ---------- */
const cm = { mode: 'add', color: PALETTE[0], cat: null, delArm: false };
function renderSwatches() { $('cmColors').innerHTML = PALETTE.map(p => `<button type="button" class="sw" role="radio" data-p="${p}" style="--c:var(${p})" aria-checked="${cm.color === p}" aria-pressed="${cm.color === p}" aria-label="Color ${p.slice(4)}"></button>`).join(''); }
function openCatModal(mode, catId) {
  cm.mode = mode; cm.cat = catId; cm.delArm = false;
  $('cmNew').hidden = mode === 'tpl'; $('cmDel').hidden = mode !== 'edit'; $('cmDel').textContent = 'Delete'; $('cmInfo').hidden = true; $('cmTip').hidden = mode !== 'add';
  const c = catOf(catId);
  if (mode === 'add') { $('cmTitle').textContent = 'New category'; $('cmSave').textContent = 'Add category'; $('cmName').value = ''; $('cmTpl').value = ''; cm.color = PALETTE[S.cats.length % PALETTE.length]; }
  else if (mode === 'edit') { $('cmTitle').textContent = 'Edit category'; $('cmSave').textContent = 'Save'; $('cmName').value = c.name; $('cmTpl').value = c.tpl || ''; cm.color = c.c; }
  else { $('cmTitle').textContent = 'Template · ' + c.name; $('cmSave').textContent = 'Save template'; $('cmTpl').value = c.tpl || ''; }
  renderSwatches(); $('cmArch').hidden = mode !== 'edit'; $('cmArch').textContent = c.archived ? 'Unarchive' : 'Archive';
  $('catModal').hidden = false; if (mode !== 'edit') setTimeout(() => (mode === 'tpl' ? $('cmTpl') : $('cmName')).focus(), 50);
}
function afterCatChange() { if (!$('v-edit').hidden) renderEdCats(); else renderHome(); }
$('cmDel').onclick = () => {
  const c = S.cats.find(x => x.id === cm.cat); if (!c) return; const n = S.entries.filter(e => e.cat === c.id).length;
  if (!cm.delArm) { cm.delArm = true; $('cmDel').textContent = 'Tap again to delete'; $('cmInfo').textContent = n ? `${n} entr${n === 1 ? 'y' : 'ies'} will move to Uncategorized. They stay visible under All.` : 'This category has no entries.'; $('cmInfo').hidden = false; return; }
  S.entries.forEach(e => { if (e.cat === c.id) { e.cat = null; touch(S, 'entries', e); } });
  removeRecord(S, 'cats', c.id); if (filter === c.id) filter = 'all';
  if (edCat === c.id) edCat = (S.cats.find(x => !x.archived) || {}).id || null;
  save(); $('catModal').hidden = true; afterCatChange(); toast(`Deleted "${c.name}"`);
};
$('cmArch').onclick = () => {
  const c = S.cats.find(x => x.id === cm.cat); if (!c) return; c.archived = !c.archived; touch(S, 'cats', c);
  if (c.archived && filter === c.id && !showArch) filter = 'all'; save(); $('catModal').hidden = true; afterCatChange();
  toast(c.archived ? `Archived "${c.name}". Its entries stay under All.` : `"${c.name}" is back in your categories`);
};
let lpFired = false;
function bindLongPress(el, attr) {
  let t = null, sx = 0, sy = 0; const idOf = e => { const b = e.target.closest(`[${attr}]`); const id = b && b.getAttribute(attr); return id && id !== 'all' ? id : null; };
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointerdown', e => { lpFired = false; const id = idOf(e); if (!id || e.button !== 0) return; sx = e.clientX; sy = e.clientY; t = setTimeout(() => { t = null; lpFired = true; try { navigator.vibrate && navigator.vibrate(15); } catch (_) {} openCatModal('edit', id); }, 500); });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, cancel));
  el.addEventListener('contextmenu', e => { const id = idOf(e); if (!id) return; e.preventDefault(); cancel(); openCatModal('edit', id); });
  el.addEventListener('click', e => { if (lpFired) { lpFired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}
bindLongPress($('chips'), 'data-f'); bindLongPress($('edCats'), 'data-c');
$('cmColors').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { cm.color = b.dataset.p; renderSwatches(); } });
$('cmClose').onclick = () => $('catModal').hidden = true;
$('catModal').addEventListener('click', e => { if (e.target.id === 'catModal') $('catModal').hidden = true; });
$('catForm').addEventListener('submit', e => {
  e.preventDefault(); const tpl = $('cmTpl').value.replace(/\s+$/, ''); const inEditor = !$('v-edit').hidden;
  if (cm.mode === 'add') {
    const name = $('cmName').value.trim(); if (!name) { toast('Give the category a name'); $('cmName').focus(); return; }
    if (S.cats.some(c => c.name.toLowerCase() === name.toLowerCase())) { toast(`"${name}" already exists`); return; }
    const c = { id: newId('c'), name, c: cm.color, tpl, archived: false }; S.cats.push(c); touch(S, 'cats', c); save(); $('catModal').hidden = true;
    if (inEditor) setEdCat(c.id); else renderHome(); toast(`Added "${name}"`);
    return;
  }
  const c = S.cats.find(x => x.id === cm.cat); if (!c) return;
  if (cm.mode === 'edit') {
    const name = $('cmName').value.trim(); if (!name) { toast('Give the category a name'); $('cmName').focus(); return; }
    if (S.cats.some(x => x !== c && x.name.toLowerCase() === name.toLowerCase())) { toast(`"${name}" already exists`); return; }
    c.name = name; c.c = cm.color;
  }
  const old = c.tpl || ''; c.tpl = tpl; touch(S, 'cats', c); save(); $('catModal').hidden = true;
  const b = $('edBody'); if (inEditor && edCat === c.id && (!b.value.trim() || b.value === old)) { b.value = tpl; lastTpl = tpl; wc(); autoGrow(); }
  afterCatChange(); toast(cm.mode === 'edit' ? 'Category saved' : 'Template saved');
});

/* ---------- sync ---------- */
let syncT = null;
function queueSync(delay) { if (!S.sync.uid) return; clearTimeout(syncT); syncT = setTimeout(() => doSync(true), delay || 1500); }
function errMsg(e) {
  const c = (e && e.code) || '';
  if (c.includes('permission-denied') || c.includes('unauthenticated')) return 'Sync was refused. Sign out and sign in again.';
  if (c.includes('unavailable') || c.includes('network') || !navigator.onLine) return "Couldn't reach the server. Your changes are saved; they will sync when you're online.";
  return 'Sync failed. Try again in a moment.';
}
function setSyncSpin(on) { [$('syncBtn')].forEach(b => b.classList.toggle('spin', on)); }
async function doSync(quiet) {
  if (ui.syncing) return;
  if (!configured) { if (!quiet) toast('Sync is not set up yet.'); return; }
  if (!S.sync.uid) { if (!quiet) { toast('Sign in to sync between your devices'); show('settings'); } return; }
  if (!navigator.onLine) { if (!quiet) toast("You're offline. Your changes are saved and will sync later."); return; }
  ui.syncing = true; ui.syncErr = null; setSyncSpin(true); if (current() === 'settings') renderSettings();
  try {
    const r = await syncNow(S, await backend(S.sync.uid), DEVICE);
    if (r.revoked) { ui.syncing = false; setSyncSpin(false); await localSignOut('This device was removed from your account. Sign in again to keep using sync.'); return; }
    ui.devices = r.devices; await flush();
    if (!quiet) toast(r.pushed ? `Synced · ${r.pushed} change${r.pushed > 1 ? 's' : ''} uploaded` : 'Synced · everything is up to date');
  } catch (e) { console.error(e); ui.syncErr = errMsg(e); if (!quiet) toast(ui.syncErr); }
  ui.syncing = false; setSyncSpin(false); refresh();
}
$('syncBtn').onclick = () => doSync(false);
addEventListener('online', () => doSync(true));

async function localSignOut(msg) {
  try { await signOutUser(); } catch (e) {}
  await clearState(); S = emptyState(); ui.devices = []; ui.confirmSignout = false;
  try { localStorage.removeItem('daybook-device'); } catch (e) {}
  DEVICE = deviceInfo(); show('settings'); toast(msg);
}

/* ---------- settings ---------- */
const ICON = { laptop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>', phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>' };
let devArm = null;
function renderSyncBox() {
  const sy = S.sync, box = $('syncBox');
  if (!configured) { box.innerHTML = '<div class="strong">Sync is not set up</div><div class="sub">Your journal is saved on this device only.</div>'; return; }
  if (!sy.uid) {
    box.innerHTML = `<div class="row"><div class="grow"><div class="strong">Not signed in</div><div class="sub">Your journal is saved on this device only. Sign in to sync it between your phone and laptop.</div></div></div>
      <div style="margin-top:12px"><button class="btn primary" id="signInBtn" ${ui.signingIn ? 'disabled' : ''}>${ui.signingIn ? 'Signing in…' : 'Sign in with Google'}</button></div>`;
    return;
  }
  const status = ui.syncing ? 'Syncing…' : ui.syncErr ? `<span class="acct-err">${esc(ui.syncErr)}</span>` : sy.lastSync ? `Synced ${ago(sy.lastSync)}` : 'Not synced yet';
  box.innerHTML = `<div class="row"><div class="grow"><div class="strong">${esc(sy.email)}</div><div class="sub">${status}</div></div><button class="btn" id="stSync" ${ui.syncing ? 'disabled' : ''}>Sync</button></div>
    <div class="sub" style="margin-top:6px">Syncs automatically when the app opens and after every change.</div>
    ${ui.confirmSignout
      ? `<div class="confirm"><span class="sub" style="flex:1">Sign out and remove the journal from this device? Your changes are synced first, so nothing is lost.</span><button class="btn" id="soNo">Cancel</button><button class="btn danger" id="soYes">Sign out</button></div>`
      : `<div style="margin-top:14px"><button class="link-danger" id="signOut">Sign out</button><div class="sub">Removes data from this device; your data on the server stays safe.</div></div>`}`;
}
function renderSettings() {
  renderSyncBox();
  $('devSec').hidden = !S.sync.uid;
  const list = [...ui.devices].sort((a, b) => (b.id === DEVICE.id) - (a.id === DEVICE.id) || (b.last || 0) - (a.last || 0));
  $('devices').innerHTML = list.length ? list.map(d => {
    const me = d.id === DEVICE.id;
    return `<div class="li"><span class="dev-ic">${ICON[d.kind === 'phone' ? 'phone' : 'laptop']}</span><div class="grow"><div class="strong">${esc(d.name || 'Device')}${me ? '<span class="badge">this device</span>' : ''}</div><div class="sub">Last synced ${ago(d.last)}</div></div>${me ? '' : `<button class="btn sm-btn${devArm === d.id ? ' danger' : ''}" data-rmdev="${esc(d.id)}">${devArm === d.id ? 'Confirm' : 'Remove'}</button>`}</div>`;
  }).join('') : '<div class="sub" style="padding:12px 0">Tap Sync to see the devices that use this account.</div>';
  $('lfBirth').value = S.birth || ''; $('lfBirth').max = iso(Date.now()); $('lfYears').value = String(S.lifeYears);
  ['lfBirth', 'lfYears'].forEach(id => lockField(id, true));
  $('csvSub').textContent = 'Open in Excel or Google Sheets';
  $('bkSub').textContent = S.lastBackup ? 'Last backup ' + ago(S.lastBackup) : 'Never backed up';
  $('aboutBox').textContent = `Daybook · version 1.0${navigator.onLine ? '' : ' · offline'} · Entries are saved on this device first, then synced to your account.`;
}
$('syncBox').addEventListener('click', e => {
  const id = e.target.closest('button') && e.target.closest('button').id; if (!id) return;
  if (id === 'stSync') doSync(false);
  if (id === 'signOut') { ui.confirmSignout = true; renderSettings(); }
  if (id === 'soNo') { ui.confirmSignout = false; renderSettings(); }
  if (id === 'soYes') (async () => {
    if (isDirty(S)) await doSync(true);
    if (isDirty(S)) { toast("Couldn't sync your latest changes. Connect to the internet, then sign out again."); return; }
    await localSignOut('Signed out');
  })();
  if (id === 'signInBtn') (async () => {
    ui.signingIn = true; renderSettings();
    try { const u = await signIn(); if (u) { S.sync.uid = u.uid; S.sync.email = u.email; await flush(); ui.signingIn = false; await doSync(false); } }
    catch (err) { console.error(err); toast(err && err.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled' : err && err.code === 'auth/unauthorized-domain' ? 'This web address is not allowed to sign in yet. Add it under Firebase → Authentication → Settings → Authorized domains.' : "Sign-in didn't work. Try again."); }
    ui.signingIn = false; renderSettings();
  })();
});
$('devices').addEventListener('click', async e => {
  const b = e.target.closest('[data-rmdev]'); if (!b) return; const id = b.dataset.rmdev;
  if (devArm !== id) { devArm = id; renderSettings(); return; }
  const d = ui.devices.find(x => x.id === id);
  try { await (await backend(S.sync.uid)).removeDevice(id); ui.devices = ui.devices.filter(x => x.id !== id); devArm = null; renderSettings(); toast(`${d ? d.name : 'Device'} removed. It will be signed out the next time it opens Daybook.`); }
  catch (err) { console.error(err); toast("Couldn't remove the device. Try again when you're online."); }
});

// Birth date / life expectancy: locked until the pencil is tapped.
const PEN_SVG = document.querySelector('.pen').innerHTML, CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
function lockField(id, lock) {
  const inp = $(id), b = document.querySelector(`[data-pen="${id}"]`); inp.disabled = lock; b.setAttribute('aria-pressed', !lock); b.innerHTML = lock ? PEN_SVG : CHECK_SVG; b.title = lock ? 'Edit' : 'Done';
  if (!lock) { inp.focus(); try { if (inp.type === 'date') inp.showPicker(); } catch (_) {} }
}
document.querySelectorAll('[data-pen]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.pen; if ($(id).disabled) lockField(id, false); else { $(id).dispatchEvent(new Event('change')); lockField(id, true); } }));
['lfBirth', 'lfYears'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $(id).dispatchEvent(new Event('change')); lockField(id, true); } if (e.key === 'Escape') { lockField(id, true); renderSettings(); } }));
function setBirth(v) {
  if (!v || parseD(v) > Date.now()) { toast('Choose a birth date in the past'); return false; }
  if (v === S.birth) return true;
  S.birth = v; touchProfile(S); selWk = null; save(); toast('Birth date saved'); return true;
}
$('lfBirth').addEventListener('change', e => { if (!setBirth(e.target.value)) e.target.value = S.birth || ''; });
$('lfYears').addEventListener('change', e => {
  const v = Math.round(Number(e.target.value)), age = S.birth ? ageAt(Date.now()) : 0;
  if (!Number.isFinite(v) || v <= age || v > 120) { toast(`Enter an age between ${age + 1} and 120`); e.target.value = String(S.lifeYears); return; }
  if (v === S.lifeYears) return; S.lifeYears = v; touchProfile(S); save(); toast(`Life expectancy set to ${v} years`);
});

/* ---------- data: export, backup, restore ---------- */
const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
$('expCsv').onclick = () => {
  const rows = [['date', 'time', 'category', 'title', 'text', 'tags'], ...[...S.entries].sort((a, b) => a.ts - b.ts).map(e => [iso(e.ts), new Date(e.ts).toTimeString().slice(0, 5), catOf(e.cat).name, e.title, e.body, e.tags.join('; ')])];
  download(`daybook-${iso(Date.now())}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  toast(`Exported ${S.entries.length} entries`);
};
$('expJson').onclick = () => {
  const data = { app: 'daybook', version: 1, exported: new Date().toISOString(), cats: S.cats, entries: S.entries, birth: S.birth, lifeYears: S.lifeYears, milestones: S.milestones };
  download(`daybook-backup-${iso(Date.now())}.json`, JSON.stringify(data, null, 2), 'application/json');
  S.lastBackup = Date.now(); store(); renderSettings(); toast('Backup saved. Keep the file in Google Drive.');
};
// Restore adds the backup's records (and updates ones with the same id); nothing else is deleted.
$('restoreFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return; const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result); if (!Array.isArray(d.entries) || !Array.isArray(d.cats)) throw 0;
      const up = (kind, list, norm) => list.forEach(x => { if (!x || !x.id) return; const o = norm(x); const i = S[kind].findIndex(y => y.id === o.id); if (i >= 0) S[kind][i] = Object.assign(S[kind][i], o); else S[kind].push(o); touch(S, kind, i >= 0 ? S[kind][i] : o); });
      up('cats', d.cats, x => ({ id: String(x.id), name: x.name || 'Category', c: PALETTE.includes(x.c) ? x.c : '--c-slate', tpl: x.tpl || '', archived: !!x.archived }));
      up('entries', d.entries, x => ({ id: String(x.id), ts: Number(x.ts) || Date.now(), cat: x.cat ?? null, title: x.title || '', body: x.body || '', tags: Array.isArray(x.tags) ? x.tags.map(String) : [] }));
      if (Array.isArray(d.milestones)) up('milestones', d.milestones, x => ({ id: String(x.id), date: x.date, title: x.title || '', type: x.type || 'career', note: x.note || '' }));
      if (d.birth) { S.birth = d.birth; if (d.lifeYears) S.lifeYears = d.lifeYears; touchProfile(S); }
      save(); renderSettings(); toast(`Restored ${d.entries.length} entries`);
    } catch (_) { toast('That file is not a Daybook backup. Choose a .json file made by Backup.'); }
  };
  r.readAsText(f); e.target.value = '';
});

/* ---------- life calendar: one row = one year (Jan–Dec), one square = one week ---------- */
let selWk = null;
function rowStart(yr) { return new Date(Number(S.birth.slice(0, 4)) + yr, 0, 1).getTime(); }
function ymd(a, b) { const A = new Date(a), B = new Date(b); let y = B.getFullYear() - A.getFullYear(), m = B.getMonth() - A.getMonth(), d = B.getDate() - A.getDate(); if (d < 0) { m--; d += new Date(B.getFullYear(), B.getMonth(), 0).getDate(); } if (m < 0) { y--; m += 12; } return { y, m, d }; }
function ageAt(ts) { const [Y, M, D] = S.birth.split('-').map(Number); const d = new Date(ts); let a = d.getFullYear() - Y; if (d.getMonth() < M - 1 || (d.getMonth() === M - 1 && d.getDate() < D)) a--; return a; }
function wkStart(i) { return rowStart(Math.floor(i / 52)) + (i % 52) * 7 * DAY; }
function wkEnd(i) { return i % 52 === 51 ? rowStart(Math.floor(i / 52) + 1) - DAY : wkStart(i) + 6 * DAY; }
function wkIndex(ts) { if (ts < parseD(S.birth)) return -1; const y = new Date(ts).getFullYear() - Number(S.birth.slice(0, 4)); return y * 52 + Math.min(51, Math.floor((ts - rowStart(y)) / (7 * DAY))); }
function monthMarks() { const out = {}; MON.forEach((n, k) => { out[Math.round((new Date(2001, k, 1) - new Date(2001, 0, 1)) / (7 * DAY))] = n; }); return out; }
const msIdx = m => wkIndex(parseD(m.date));

function renderLife() {
  const none = !S.birth;
  $('lifeEmpty').hidden = !none;
  ['lfStats', 'lifeGrid'].forEach(id => $(id).hidden = none);
  document.querySelectorAll('.tg-wk,.tg-ms').forEach(el => el.hidden = none);
  $('msAddTop').hidden = none;
  if (none) { $('lifeBirthNew').max = iso(Date.now()); return; }
  const N = S.lifeYears * PER, now = wkIndex(Date.now()), bI = wkIndex(parseD(S.birth)), lived = Math.max(0, now - bI + 1);
  const [BY, BM, BD] = S.birth.split('-').map(Number), left = Math.max(0, Math.round((new Date(BY + S.lifeYears, BM - 1, BD) - Date.now()) / (7 * DAY)));
  if (selWk == null || selWk >= N || selWk < bI) selWk = Math.min(Math.max(now, bI), N - 1);
  const A = ymd(parseD(S.birth), Date.now()), L = ymd(Date.now(), new Date(BY + S.lifeYears, BM - 1, BD).getTime());
  $('lfStats').innerHTML = `<div class="stat"><b>${A.y}</b><span>years old</span><em>${A.m} mos ${A.d} days</em></div><div class="stat"><b>${lived.toLocaleString('en')}</b><span>weeks lived</span><em>${A.y} yrs ${A.m} mos</em></div><div class="stat"><b>${left.toLocaleString('en')}</b><span>weeks to ${S.lifeYears}</span><em>${Math.max(0, L.y)} yrs ${L.y < 0 ? 0 : L.m} mos</em></div>`;
  const jw = new Set(S.entries.map(e => wkIndex(e.ts))); const mw = {}; S.milestones.forEach(m => { (mw[msIdx(m)] = mw[msIdx(m)] || []).push(m); });
  const mk = monthMarks(); let h = '<div class="wk-axis"><span></span>'; for (let w = 0; w < 52; w++) h += `<span>${mk[w] || ''}</span>`; h += '</div>';
  for (let y = 0; y < S.lifeYears; y++) {
    h += `<div class="yr${y && y % 10 === 0 ? ' dec' : ''}" title="${BY + y} · turning ${y}"><b>${y % 5 === 0 ? y : ''}</b>`;
    for (let w = 0; w < PER; w++) {
      const i = y * PER + w; if (i < bI) { h += '<div class="wk pre"></div>'; continue; }
      let c = i < now ? (jw.has(i) ? 'wk j' : 'wk p') : i === now ? 'wk now' : 'wk', st = '';
      if (mw[i]) { c += ' m'; st = ` style="--c:var(${msType(mw[i][0].type)[2]})"`; }
      if (i === selWk) c += ' sel'; h += `<div class="${c}" data-i="${i}"${st}></div>`;
    }
    h += '</div>';
  }
  $('lifeGrid').innerHTML = h; renderWkDetail(); renderMsList();
}
function selectWk(i) { const N = S.lifeYears * PER; i = Math.max(wkIndex(parseD(S.birth)), Math.min(N - 1, i)); const old = $('lifeGrid').querySelector('.sel'); if (old) old.classList.remove('sel'); selWk = i; const el = $('lifeGrid').querySelector(`[data-i="${i}"]`); if (el) el.classList.add('sel'); renderWkDetail(); }
function renderWkDetail() {
  const i = selWk, w = i % PER, s = wkStart(i), e = wkEnd(i), now = wkIndex(Date.now()), sd = new Date(s), ed = new Date(e);
  const range = sd.getMonth() === ed.getMonth() ? `${sd.getDate()} – ${fDY(e)}` : sd.getFullYear() === ed.getFullYear() ? `${fD(s)} – ${fDY(e)}` : `${fDY(s)} – ${fDY(e)}`;
  const ms = S.milestones.filter(m => msIdx(m) === i);
  const es = S.entries.filter(x => x.ts >= s && x.ts < e + DAY).sort((a, b) => a.ts - b.ts);
  const items = ms.map(m => { const t = msType(m.type); return `<button class="cli" data-ms="${esc(m.id)}"><span class="cdot" style="--c:var(${t[2]})"></span><span class="t">${esc(m.title)}</span><span class="r">★ ${fD(parseD(m.date))}</span></button>`; }).join('')
    + es.map(x => { const c = catOf(x.cat); return `<button class="cli" data-entry="${esc(x.id)}"><span class="cdot" style="--c:var(${c.c})"></span><span class="t">${esc(x.title || 'Untitled')}</span><span class="r">${fD(x.ts)}</span></button>`; }).join('');
  const age = ymd(parseD(S.birth), Math.max(s, parseD(S.birth)));
  $('wkDetail').innerHTML = `<div class="wk-head"><button class="icon-btn xs" data-nav="-1" aria-label="Previous week">‹</button><div class="grow"><div class="wk-t">${range}</div><div class="wk-s">Week ${w + 1} · Age ${age.y}y ${age.m}m${i === now ? ' · <b>This week</b>' : ''}</div></div><button class="icon-btn xs" data-nav="1" aria-label="Next week">›</button></div>
  ${items ? `<div class="cl">${items}</div>` : `<div class="wk-empty">${i > now ? 'Still ahead.' : 'Nothing recorded.'}</div>`}`;
  const n = ms.length + es.length; $('wkN').textContent = n ? String(n) : '';
}
function renderMsList() {
  const list = [...S.milestones].sort((a, b) => a.date.localeCompare(b.date)); $('msN').textContent = list.length ? String(list.length) : '';
  $('msList').innerHTML = list.length ? list.map(m => { const t = msType(m.type), d = parseD(m.date); return `<button class="cli" data-jump="${esc(m.id)}" title="${t[1]}"><span class="cdot" style="--c:var(${t[2]})"></span><span class="t">${esc(m.title)}</span><span class="r">${new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · ${ageAt(d)}y</span></button>`; }).join('')
    : '<div class="wk-empty">No milestones yet. Add moments like your first job or moving house.</div>';
}
$('lifeBirthSave').onclick = () => { if (setBirth($('lifeBirthNew').value)) renderLife(); };
const TGK = 'daybook-toggles';
function setTg(btn, open) { btn.setAttribute('aria-expanded', open); $(btn.getAttribute('aria-controls')).hidden = !open; }
try { const st = JSON.parse(localStorage.getItem(TGK) || '{}'); document.querySelectorAll('[data-tg]').forEach(b => { if (st[b.dataset.tg] === false) setTg(b, false); }); } catch (_) {}
document.querySelectorAll('[data-tg]').forEach(b => b.addEventListener('click', () => {
  const open = b.getAttribute('aria-expanded') !== 'true'; setTg(b, open);
  try { const st = JSON.parse(localStorage.getItem(TGK) || '{}'); st[b.dataset.tg] = open; localStorage.setItem(TGK, JSON.stringify(st)); } catch (_) {}
}));
$('openSettings').onclick = () => show($('v-settings').hidden ? 'settings' : tab);
$('bnav').addEventListener('click', e => { const b = e.target.closest('[data-nav]'); if (b) show(b.dataset.nav); });
$('lifeGrid').addEventListener('click', e => { const c = e.target.closest('[data-i]'); if (c) selectWk(+c.dataset.i); });
$('wkDetail').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.nav) selectWk(selWk + Number(t.dataset.nav));
  else if (t.dataset.ms) openMs(t.dataset.ms);
  else if (t.dataset.entry) openEditor(t.dataset.entry);
});
$('msList').addEventListener('click', e => {
  const b = e.target.closest('[data-jump]'); if (!b) return; const m = S.milestones.find(x => x.id === b.dataset.jump); if (!m) return; const i = msIdx(m);
  if (i < 0 || i >= S.lifeYears * PER) { openMs(m.id); return; }
  selectWk(i); $('wkDetail').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
});
$('msAddTop').onclick = () => openMs(null);

let msEdit = null, msTypeSel = 'career', msDelArm = false;
function renderMsTypes() { $('msTypes').innerHTML = MS_TYPES.map(([id, n, c]) => `<button type="button" class="chip" role="radio" data-t="${id}" style="--c:var(${c})" aria-checked="${msTypeSel === id}" aria-pressed="${msTypeSel === id}"><span class="cdot" style="${msTypeSel === id ? 'background:var(--bg)' : ''}"></span>${n}</button>`).join(''); }
function msAgeLine() { const v = $('msDate').value; if (!v) { $('msAge').textContent = ''; return; } const i = wkIndex(parseD(v)); $('msAge').textContent = i < 0 ? 'This date is before your birth date.' : `At age ${ageAt(parseD(v))} · week ${i % PER + 1} of ${v.slice(0, 4)}`; }
function openMs(id, date) {
  msEdit = id ? S.milestones.find(m => m.id === id) : null; msTypeSel = msEdit ? msEdit.type : 'career'; msDelArm = false;
  $('msHead').textContent = msEdit ? 'Edit milestone' : 'New milestone'; $('msTitle').value = msEdit ? msEdit.title : ''; $('msDate').value = msEdit ? msEdit.date : (date || iso(Date.now())); $('msNote').value = msEdit ? msEdit.note : '';
  $('msDel').hidden = !msEdit; $('msDel').textContent = 'Delete'; renderMsTypes(); msAgeLine(); $('msModal').hidden = false; setTimeout(() => $('msTitle').focus(), 50);
}
$('msTypes').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { msTypeSel = b.dataset.t; renderMsTypes(); } });
$('msDate').addEventListener('input', msAgeLine);
$('msClose').onclick = () => $('msModal').hidden = true;
$('msModal').addEventListener('click', e => { if (e.target.id === 'msModal') $('msModal').hidden = true; });
$('msDel').onclick = () => { if (!msDelArm) { msDelArm = true; $('msDel').textContent = 'Tap again to delete'; return; } removeRecord(S, 'milestones', msEdit.id); save(); $('msModal').hidden = true; renderLife(); toast('Milestone deleted'); };
$('msForm').addEventListener('submit', e => {
  e.preventDefault(); const title = $('msTitle').value.trim(), date = $('msDate').value;
  if (!title) { toast('Describe what happened'); $('msTitle').focus(); return; }
  if (!date) { toast('Choose a date'); return; }
  if (wkIndex(parseD(date)) < 0) { toast('This date is before your birth date'); return; }
  const note = $('msNote').value.trim(); let m = msEdit;
  if (m) Object.assign(m, { title, date, type: msTypeSel, note }); else { m = { id: newId('m'), title, date, type: msTypeSel, note }; S.milestones.push(m); }
  touch(S, 'milestones', m); save(); $('msModal').hidden = true; selWk = wkIndex(parseD(date)); renderLife(); toast(msEdit ? 'Milestone updated' : 'Milestone added');
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('catModal').hidden = true; $('msModal').hidden = true; } });

/* ---------- start ---------- */
async function boot() {
  const st = await loadState();
  if (st && st.v === 1) {
    S = Object.assign(emptyState(), st);
    S.dirty = Object.assign(emptyDirty(), st.dirty || {}); S.tomb = Object.assign(emptyTomb(), st.tomb || {});
    S.sync = Object.assign(emptyState().sync, st.sync || {});
  }
  calM = new Date(new Date().getFullYear(), new Date().getMonth(), 1); renderCal();
  renderHome();
  askPersistent();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (!configured) return;
  try {
    const u = await currentUser();
    if (u) {
      if (S.sync.uid && S.sync.uid !== u.uid) { await clearState(); S = emptyState(); }
      S.sync.uid = u.uid; S.sync.email = u.email; store(); refresh();
      doSync(true);
    } else if (S.sync.uid) { S.sync.uid = null; store(); refresh(); }
  } catch (e) { console.warn('Sign-in check failed', e); }
}
boot();
