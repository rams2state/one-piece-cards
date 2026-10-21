// data.js — data loading, card normalization, owned-card storage, and the
// small set of cross-cutting globals every other file reads/writes.
//
// REBUILT 2026-10-13: the app now reads compact JSON (data/cards-en.json,
// data/cards-jp.json) written by the collector, instead of parsing the
// full 565 KB CSV + 490 KB price history on every visit. Set order also
// comes from the data file now, so a new set (EB-05, OP-18, ...) shows up
// in the right place without editing this file. See site_data.py on the
// collector side for the file format.

const APP_VERSION = '2.1.0';

// ─── GLOBAL STATE ────────────────────────────────────────────────────────────
let ALL_CARDS = [];
let CARD_BY_KEY = new Map();    // cardKey -> card, for click handling
let SET_ORDER = [];             // set IDs in display order (from the data file)
let currentView = 'list';       // 'list' | 'grid'
let showOwnedOnly = false;
let DATA_META = {};             // { generated, fx, ... } from the loaded file
const READ_ONLY_SHARE = !!(new URLSearchParams(window.location.search).get('share'));

// ─── LANGUAGE (EN / JP) ──────────────────────────────────────────────────────
const LANG_KEY = 'onepiece-binder-lang';
let LANG = (() => {
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'jp' || q === 'en') return q;
  try { return localStorage.getItem(LANG_KEY) === 'jp' ? 'jp' : 'en'; } catch (e) { return 'en'; }
})();
function isJP() { return LANG === 'jp'; }

document.getElementById('appVersion').textContent = 'v' + APP_VERSION;

function isStarterSet(setId) { return /^ST-/.test(setId || ''); }
function setSortIndex(setId) {
  const i = SET_ORDER.indexOf(setId);
  return i === -1 ? 9999 : i;
}

// ─── CARD NORMALIZATION ──────────────────────────────────────────────────────
// Strips the "(Parallel)"/"(SP)" markers some English card names have, so
// display names and store searches work off a clean base name while still
// knowing (via isSpecial) that the marker applied.
function stripNameMarkers(name) {
  return (name || '')
    .replace(/\s*\(Parallel\)\s*/gi, ' ')
    .replace(/\s*\(SP\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function fmtPrice(v) { return v != null && v > 0 ? `$${v.toFixed(2)}` : 'N/A'; }

function normalizeEn(r, setNames, imgBase) {
  const rawName = r.name || '';
  // Gap-fill cards (r.src === 'pc', see en_gapfill.py) have a "PC-<id>"
  // key plus a real card number in r.num used for sorting/display.
  const isPc = r.src === 'pc' || r.src === 'tcg';   // added by tcg_source.py / en_gapfill.py
  return {
    lang: 'en',
    uid: isPc ? r.id : undefined,
    src: r.src || '',
    pcPath: r.pc || '',
    tcgId: r.tcg || '',
    cardId: isPc && r.num ? r.num + '_p9' : r.id,
    name: stripNameMarkers(rawName),
    rawName,
    isSpecial: /\(SP\)/i.test(rawName) || r.print === 'sp',
    print: r.print || (r.parallel ? 'alt' : 'base'),   // see site_data.print_type()
    isParallel: !!r.parallel,
    setId: r.setId,
    set: setNames[r.setId] || r.setId,
    rarity: r.rarity || '',
    color: r.color || '',
    cardType: r.type || '',
    pic: r.img ? (/^https?:/.test(r.img) ? r.img : imgBase + r.img) : '',
    price: fmtPrice(r.price),
    priceVal: r.price || 0,
    p7: r.p7,
    lastPriced: r.lastPriced || '',
  };
}

// Japanese cards: name carries the print label in brackets
// ("Shanks [Manga]"); "num" is the card number plus a print suffix
// (_p1 alt, _p2 super alt, _p3 manga, _p4 SP, _p5 TR, _p6 Pandaman) so the
// same sorting/print-badge logic as English works unchanged.
function normalizeJp(r, setNames, imgBase, fx) {
  const rawName = r.name || '';
  const jpyUsd = r.jpy && fx ? r.jpy * fx : null;
  return {
    lang: 'jp',
    uid: r.id,
    cardId: r.num || r.id,
    name: rawName.replace(/\s*\[[^\]]+\]\s*$/, ''),
    rawName,
    variant: r.variant || '',
    print: r.setId === 'OP-PR' ? 'promo' : ({ other: 'event', pandaman: 'alt' }[r.variant] || r.variant || 'base'),
    isSpecial: r.variant === 'sp',
    isParallel: !!r.variant && r.variant !== 'base' && r.variant !== 'don',
    setId: r.setId,
    set: setNames[r.setId] || r.setId,
    rarity: r.rarity || '',
    color: '',
    cardType: '',
    pic: r.img ? `${imgBase}${r.img}/240.jpg` : '',
    picLarge: r.img ? `${imgBase}${r.img}/1600.jpg` : '',
    price: fmtPrice(r.price),
    priceVal: r.price || 0,
    p7: r.p7,
    lastPriced: r.lastPriced || '',
    jpy: r.jpy || null,
    jpyUsd,
    pcPath: r.pc || '',
    yyPath: r.yy || '',
  };
}

function normalizeDataFile(d) {
  const fields = d.fields;
  const setNames = {};
  for (const s of d.sets || []) setNames[s.id] = s.name;
  SET_ORDER = (d.sets || []).map(s => s.id);
  DATA_META = { generated: d.generated, fx: d.fx, lang: d.lang };
  const out = [];
  for (const row of d.cards) {
    const r = {};
    for (let i = 0; i < fields.length; i++) r[fields[i]] = row[i];
    out.push(d.lang === 'jp' ? normalizeJp(r, setNames, d.imgBase, d.fx) : normalizeEn(r, setNames, d.imgBase));
  }
  return out;
}

// ─── OWNED-CARD STORAGE (localStorage-first, event-driven Firestore sync) ───
// Storage shape: { [cardKey]: { addedAt: <ms>, purchasePrice?: <number> } }
// English keys are the plain card ID (unchanged from v1, so existing owned
// lists carry over). Japanese keys are "JP-<id>", so both live in the same
// synced map without ever colliding.
const OWNED_KEY = 'onepiece-rarity-binder-owned';
let _ownedCache = null;

function getOwnedMap() {
  if (_ownedCache) return _ownedCache;
  try { _ownedCache = JSON.parse(localStorage.getItem(OWNED_KEY) || '{}'); }
  catch (e) { _ownedCache = {}; }
  return _ownedCache;
}
function saveOwnedMap(map) {
  _ownedCache = map;
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(map)); } catch (e) {}
}
// firebase.js writes localStorage directly when a remote change arrives.
window.invalidateOwnedCache = function() { _ownedCache = null; };
window.addEventListener('storage', e => { if (e.key === OWNED_KEY) _ownedCache = null; });

function cardKey(c) {
  if (c.lang === 'jp') return 'JP-' + c.uid;
  if (c.uid) return c.uid;            // English gap-fill card ("PC-...")
  return c.cardId || `${c.name}_${c.set}`;
}
function domKey(c) { return cardKey(c).replace(/[^a-z0-9]/gi, '_'); }

function isOwned(c) { return !!getOwnedMap()[cardKey(c)]; }
function ownedAddedAt(c) {
  const e = getOwnedMap()[cardKey(c)];
  return e && e.addedAt ? e.addedAt : 0;
}
function ownedPurchasePrice(c) {
  const e = getOwnedMap()[cardKey(c)];
  return e && typeof e.purchasePrice === 'number' ? e.purchasePrice : null;
}
function setPurchasePrice(c, val) {
  const map = { ...getOwnedMap() };
  const key = cardKey(c);
  map[key] = { ...(map[key] || { addedAt: Date.now() }), purchasePrice: val };
  saveOwnedMap(map);
  window.dispatchEvent(new CustomEvent('owned-changed', {
    detail: { key, action: 'add', meta: map[key] }
  }));
}

// Returns true if this call just ADDED the card to owned (so callers can
// show the purchase-price prompt only on a genuine new add, never on remove).
function toggleOwned(c) {
  if (READ_ONLY_SHARE) return false;
  const map = { ...getOwnedMap() };
  const key = cardKey(c);
  const adding = !map[key];
  let meta = null;
  if (adding) { meta = { addedAt: Date.now() }; map[key] = meta; }
  else delete map[key];
  saveOwnedMap(map);
  updateCollectionValue();
  window.dispatchEvent(new CustomEvent('owned-changed', {
    detail: { key, action: adding ? 'add' : 'remove', meta }
  }));
  return adding;
}

// Used by firebase.js's read-only share view to apply someone else's owned
// data directly (a visitor viewing someone ELSE's collection).
function normalizeOwnedData(raw) {
  if (Array.isArray(raw)) {
    const now = Date.now();
    const obj = {};
    for (const key of raw) obj[key] = { addedAt: now };
    return obj;
  }
  return raw && typeof raw === 'object' ? raw : {};
}
window.setSharedOwned = function(raw) {
  saveOwnedMap(normalizeOwnedData(raw));
  updateCollectionValue();
  if (typeof render === 'function') render();
};

function toggleOwnedFilter() {
  if (READ_ONLY_SHARE) return; // permanently locked on in share view
  showOwnedOnly = !showOwnedOnly;
  document.getElementById('statOwnedBox').classList.toggle('active', showOwnedOnly);
  render();
}

function updateCollectionValue() {
  const map = getOwnedMap();
  let count = 0, value = 0;
  for (const c of ALL_CARDS) {
    if (map[cardKey(c)]) { count++; value += c.priceVal || 0; }
  }
  const ownedEl = document.getElementById('statOwned');
  const valEl = document.getElementById('statValue');
  if (ownedEl) ownedEl.textContent = count.toLocaleString();
  if (valEl) valEl.textContent = '$' + value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── DATE HELPERS ────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((now - d) / 86400000);
}
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ─── PRINT TYPES (ADDED 2026-10-19) ──────────────────────────────────────────
// One label per print type, shown as a pill on cards and used by the Print
// filter. English types come from the collector (site_data.print_type);
// Japanese ones from the PriceCharting print label.
const PRINT_LABEL = {
  base: 'Regular', alt: 'Alt Art', sp: 'SP', manga: 'Manga', superalt: 'Super Alt', tr: 'TR',
  wanted: 'Wanted', foil: 'Foil', reprint: 'Reprint', gold: 'Gold', boxtopper: 'Box Topper',
  promo: 'Promo', event: 'Event', don: 'DON!!', special: 'Special',
};
const PRINT_ORDER = ['manga', 'superalt', 'sp', 'tr', 'special', 'gold', 'wanted', 'alt', 'event', 'promo',
                     'boxtopper', 'foil', 'reprint', 'don', 'base'];
