// data.js — CSV parsing, card normalization, owned-card storage, and the
// small set of cross-cutting globals every other file reads/writes.
// Mirrors the Pokémon app's (unshipped in this handoff, but referenced by
// every other file) data.js: normalizeCard(), parseCSV(), ALL_CARDS,
// currentView, showOwnedOnly, PRICE_HISTORY, READ_ONLY_SHARE, cardKey(),
// isOwned()/toggleOwned(), ownedAddedAt()/ownedPurchasePrice()/setPurchasePrice(),
// daysSince()/formatDateDisplay(), APP_VERSION, updateCollectionValue().

const APP_VERSION = '1.0.0';

// ─── GLOBAL STATE ────────────────────────────────────────────────────────────
let ALL_CARDS = [];
let currentView = 'list'; // 'list' | 'grid'
let showOwnedOnly = false;
let PRICE_HISTORY = {};
const READ_ONLY_SHARE = !!(new URLSearchParams(window.location.search).get('share'));

document.getElementById('appVersion').textContent = 'v' + APP_VERSION;

// ─── SET ORDER (chronological-as-best-effort) ───────────────────────────────
// Main Sets: OP-01..OP-17 in numeric order, with Extra Boosters and Premium
// Boosters interspersed roughly where they released, and the hybrid
// OP14-EB04/OP15-EB04 sets near OP-14/OP-15's release window.
const MAIN_SET_ORDER = [
  'OP-01', 'OP-02', 'EB-01', 'OP-03', 'OP-04', 'OP-05', 'OP-06', 'EB-02',
  'OP-07', 'OP-08', 'OP-09', 'OP-10', 'EB-03', 'OP-11', 'OP-12', 'OP-13',
  'OP14-EB04', 'OP15-EB04', 'PRB-01', 'OP-16', 'OP-17', 'PRB-02',
];
const STARTER_SET_ORDER = [
  'ST-01','ST-02','ST-03','ST-04','ST-05','ST-06','ST-07','ST-08','ST-09','ST-10',
  'ST-11','ST-12','ST-13','ST-14','ST-15','ST-16','ST-17','ST-18','ST-19','ST-20',
  'ST-21','ST-22','ST-23','ST-24','ST-25','ST-26','ST-27','ST-28','ST-29','ST-30',
  'ST-31','ST-32','ST-33','ST-34','ST-35','ST-36',
];
function isStarterSet(setId) { return /^ST-/.test(setId || ''); }
function setSortIndex(setId) {
  const mi = MAIN_SET_ORDER.indexOf(setId);
  if (mi !== -1) return mi;
  const si = STARTER_SET_ORDER.indexOf(setId);
  if (si !== -1) return 1000 + si;
  return 9999;
}

// ─── CSV PARSING (RFC4180-ish, handles quoted fields with embedded commas,
// quotes, and newlines — the CSV has both, e.g. Kid's name has embedded
// quotes and Card Text has commas/newlines) ──────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings up front so \r\n inside quoted fields doesn't
  // trip the parser.
  const s = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0].trim() === '') continue; // blank line
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = (cells[c] || '').trim();
    out.push(obj);
  }
  return out;
}

// ─── CARD NORMALIZATION ──────────────────────────────────────────────────────
// Strips the "(Parallel)"/"(SP)" markers some Card Names have, so display
// names, TCGplayer/PriceCharting/eBay queries all work off a clean base name
// while still knowing (via isParallel/isSpecial) that the marker applied.
function stripNameMarkers(name) {
  return (name || '')
    .replace(/\s*\(Parallel\)\s*/gi, ' ')
    .replace(/\s*\(SP\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCard(raw) {
  const cardId = raw['Card ID'] || '';
  const rawName = raw['Card Name'] || '';
  const isSpecial = /\(SP\)/i.test(rawName);
  const isParallelFlag = (raw['Is Parallel'] || '').trim().toLowerCase() === 'yes';
  const cleanName = stripNameMarkers(rawName);
  const marketPrice = parseFloat(raw['Market Price']);
  const price = !isNaN(marketPrice) && marketPrice > 0 ? `$${marketPrice.toFixed(2)}` : 'N/A';
  const invPrice = parseFloat(raw['Inventory Price']);

  return {
    cardId,
    name: cleanName,
    rawName,
    isSpecial,
    isParallel: isParallelFlag,
    setId: raw['Set ID'] || '',
    set: raw['Set Name'] || '',
    rarity: raw['Rarity'] || '',
    color: raw['Color'] || '',
    cardType: raw['Type'] || '',
    cost: raw['Cost'] || '',
    power: raw['Power'] || '',
    life: raw['Life'] || '',
    counter: raw['Counter'] || '',
    attribute: raw['Attribute'] || '',
    subTypes: raw['Sub Types'] || '',
    text: raw['Card Text'] || '',
    pic: raw['Image URL'] || raw['Picture URL'] || '',
    price,
    priceVal: !isNaN(marketPrice) ? marketPrice : 0,
    invPrice: !isNaN(invPrice) ? invPrice : null,
    lastPriced: raw['Last Priced'] || '',
  };
}

// ─── OWNED-CARD STORAGE (localStorage-first, event-driven Firestore sync) ───
// Storage shape: { [cardId]: { addedAt: <ms>, purchasePrice?: <number> } }
const OWNED_KEY = 'onepiece-rarity-binder-owned';

function getOwnedMap() {
  try { return JSON.parse(localStorage.getItem(OWNED_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveOwnedMap(map) {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(map)); } catch (e) {}
}
function cardKey(c) { return c.cardId || `${c.name}_${c.set}`; }

function isOwned(c) {
  const map = getOwnedMap();
  return !!map[cardKey(c)];
}
function ownedAddedAt(c) {
  const map = getOwnedMap();
  const e = map[cardKey(c)];
  return e && e.addedAt ? e.addedAt : 0;
}
function ownedPurchasePrice(c) {
  const map = getOwnedMap();
  const e = map[cardKey(c)];
  return e && typeof e.purchasePrice === 'number' ? e.purchasePrice : null;
}
function setPurchasePrice(c, val) {
  const map = getOwnedMap();
  const key = cardKey(c);
  if (!map[key]) map[key] = { addedAt: Date.now() };
  map[key].purchasePrice = val;
  saveOwnedMap(map);
  window.dispatchEvent(new CustomEvent('owned-changed', {
    detail: { key, action: 'add', meta: map[key] }
  }));
}

// Returns true if this call just ADDED the card to owned (so callers can
// show the purchase-price prompt only on a genuine new add, never on remove).
function toggleOwned(c) {
  if (READ_ONLY_SHARE) return false;
  const map = getOwnedMap();
  const key = cardKey(c);
  if (map[key]) {
    delete map[key];
    saveOwnedMap(map);
    updateCollectionValue();
    window.dispatchEvent(new CustomEvent('owned-changed', {
      detail: { key, action: 'remove', meta: null }
    }));
    return false;
  } else {
    const meta = { addedAt: Date.now() };
    map[key] = meta;
    saveOwnedMap(map);
    updateCollectionValue();
    window.dispatchEvent(new CustomEvent('owned-changed', {
      detail: { key, action: 'add', meta }
    }));
    return true;
  }
}

// Used by firebase.js's read-only share view to apply someone else's owned
// data directly (bypasses localStorage entirely — this is a visitor viewing
// someone ELSE's collection).
let _sharedOwnedMap = null;
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
  _sharedOwnedMap = normalizeOwnedData(raw);
  saveOwnedMap(_sharedOwnedMap);
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
    if (map[cardKey(c)]) {
      count++;
      value += c.priceVal || 0;
    }
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
