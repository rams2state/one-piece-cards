// vendor.js — selling side (ADDED 2026-11-02, reworked same day per Jordan).
//
//  * Vendor tab: the cards you have for sale, each with a condition and a
//    price. Near Mint = daily market price + 10% (rounded up to the whole
//    dollar; under $5 up to the next 50¢). Played cards (LP/MP/HP/DMG) or
//    anything you want to override: your own price.
//  * Every sticker's QR points at the ITEM, not at a price
//    (?b=<item>&v=<your seller id>&k=<card>&c=<condition>). The scan page
//    reads your current price / condition / stock from a public copy of
//    the list (Firestore shares/v_<seller id>, written whenever you change
//    something while signed in). So a sticker is printed ONCE: change the
//    price or condition later and customers see the new one.
//  * Stickers print on 4×6 thermal labels, packed as many per sheet as
//    still scan reliably (24 / 18 / 12 / 8 per sheet, with cut lines).
//  * Cart: customers tap "Add to cart" on each card they scan; the cart
//    shows the running total and a "Checkout" QR. You scan that QR with
//    your phone and see the same list + total, then mark it all sold.
// Your full list (incl. sales) is private (users/<uid>/data/vendor);
// only item -> card / condition / price / stock is public.

const VENDOR_KEY = 'onepiece-vendor';
const LABEL_KEY = 'onepiece-label-size';
const CART_KEY = 'onepiece-cart';
const MARKUP = 1.10;
const FS_KEY = 'AIzaSyDH-iHu_KxWR2rQEjN0MrxVBuXocZxITno';
const FS_DOC = 'https://firestore.googleapis.com/v1/projects/one-piece-rarity-binder/databases/(default)/documents/shares/';
const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const COND_LABEL = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };
// Sheets: one 4"×6" label, cut into cells. Smallest cell still scans
// (QR ≈ 0.8"); bigger cells add the card name / number / condition.
const LABEL_SIZES = {
  '4x6-18': { sheet: true, cols: 3, rows: 6, name: '4×6 sheet — 18 stickers (1.33" × 1")' },
  '4x6-24': { sheet: true, cols: 4, rows: 6, name: '4×6 sheet — 24 stickers (1" × 1", QR + number)' },
  '4x6-12': { sheet: true, cols: 2, rows: 6, name: '4×6 sheet — 12 stickers (2" × 1", with name)' },
  '4x6-8':  { sheet: true, cols: 2, rows: 4, name: '4×6 sheet — 8 stickers (2" × 1.5", large)' },
};

const BUY_PARAMS = new URLSearchParams(location.search);

// ─── PRICE ───────────────────────────────────────────────────────────────────
function vendorAutoPrice(market) {
  if (!market || market <= 0) return null;
  const x = market * MARKUP;
  return x < 5 ? Math.ceil(x * 2 - 1e-9) / 2 : Math.ceil(x - 1e-9);
}
function vendorMoney(v) {
  if (v == null) return '—';
  return '$' + (Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2));
}
function itemPrice(item, card) {
  if (item.price != null && item.price !== '') return +item.price;
  if (item.cond !== 'NM') return null;          // played cards: priced by you
  return vendorAutoPrice(card ? card.priceVal : 0);
}

// ─── STORAGE ─────────────────────────────────────────────────────────────────
let _vstore = null;
function randId(n) {
  let s = '';
  while (s.length < n) s += Math.random().toString(36).slice(2);
  return s.slice(0, n);
}
function normalizeVendor(s) {
  s = (s && typeof s === 'object') ? s : {};
  s.items = Array.isArray(s.items) ? s.items : [];
  s.sales = Array.isArray(s.sales) ? s.sales : [];
  s.updated = s.updated || 0;
  for (const it of s.items) {
    // older items: needsPrint flag -> printed count
    if (it.printed == null) it.printed = it.needsPrint ? 0 : it.qty;
    delete it.needsPrint;
  }
  return s;
}
function vendorStore() {
  if (_vstore) return _vstore;
  let s = null;
  try { s = JSON.parse(localStorage.getItem(VENDOR_KEY) || 'null'); } catch (e) {}
  _vstore = normalizeVendor(s);
  if (!_vstore.pubId) { _vstore.pubId = randId(8); try { localStorage.setItem(VENDOR_KEY, JSON.stringify(_vstore)); } catch (e) {} }
  return _vstore;
}
// What customers can see: item -> card, condition, your price, stock.
function vendorPublicDoc() {
  const s = vendorStore();
  const items = {};
  for (const it of s.items) items[it.id] = { k: it.key, c: it.cond, p: it.price ?? null, q: it.qty };
  return { id: 'v_' + s.pubId, data: { kind: 'vendor', items, updated: s.updated } };
}
function saveVendor() {
  const s = vendorStore();
  s.updated = Date.now();
  try { localStorage.setItem(VENDOR_KEY, JSON.stringify(s)); } catch (e) {}
  window.dispatchEvent(new CustomEvent('vendor-changed', { detail: s }));
}
window.getLocalVendor = () => vendorStore();
window.vendorPublicDoc = vendorPublicDoc;
window.applyRemoteVendor = function(remote) {
  if (!remote || typeof remote !== 'object') return;
  const keepPub = vendorStore().pubId;
  _vstore = normalizeVendor({ ...remote });
  if (!_vstore.pubId) _vstore.pubId = keepPub;   // keeps already-printed stickers valid
  try { localStorage.setItem(VENDOR_KEY, JSON.stringify(_vstore)); } catch (e) {}
  if (typeof PLAY !== 'undefined' && PLAY.mode === 'vendor') renderVendor();
  if (window.BUY_MODE) renderBuyPage();
};
function needStickers(it) { return Math.max(0, it.qty - (it.printed || 0)); }

// ─── PUBLIC LIST (read by the scan page, no sign-in needed) ──────────────────
function fsDecode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return +v.integerValue;
  if ('doubleValue' in v) return +v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = fsDecode(x);
    return o;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsDecode);
  return null;
}
const _pubCache = {};
async function fetchPublicList(vid) {
  if (!vid || !/^[a-z0-9]{4,16}$/i.test(vid)) return null;
  if (_pubCache[vid]) return _pubCache[vid];
  _pubCache[vid] = (async () => {
    try {
      const r = await fetch(`${FS_DOC}v_${vid}?key=${FS_KEY}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      const o = {};
      for (const [k, x] of Object.entries(j.fields || {})) o[k] = fsDecode(x);
      return o;
    } catch (e) { return null; }
  })();
  return _pubCache[vid];
}

// ─── CARD LOOKUP (both languages) ────────────────────────────────────────────
async function vendorLoad(lang) {
  const keepOrder = SET_ORDER, keepMeta = DATA_META;
  const d = await fetchCards(lang);
  if (lang !== LANG) { SET_ORDER = keepOrder; DATA_META = keepMeta; }
  return d.cards;
}
function langOfKey(key) { return /^JP-/.test(key || '') ? 'jp' : 'en'; }
async function findCard(key) {
  if (!key) return null;
  const cards = await vendorLoad(langOfKey(key));
  return cards.find(c => cardKey(c) === key) || null;
}
function cardFromCache(key) {
  const d = _cardCache[langOfKey(key)];
  return d ? d.cards.find(c => cardKey(c) === key) || null : null;
}

function buyUrl(item) {
  const u = new URL(location.origin + location.pathname);
  u.searchParams.set('b', item.id);
  u.searchParams.set('v', vendorStore().pubId);
  u.searchParams.set('k', item.key);       // fallback if the live list can't be read
  if (item.cond !== 'NM') u.searchParams.set('c', item.cond);
  return u.toString();
}

// ─── ADD FROM THE CARD DETAIL (Collection tab) ───────────────────────────────
function openSellFromModal() {
  if (!_modalCard || READ_ONLY_SHARE) return;
  const el = document.getElementById('mSellForm');
  const c = _modalCard;
  const auto = vendorAutoPrice(c.priceVal);
  el.innerHTML = `
    <div class="sell-title">🏷 Add to your for-sale list</div>
    <div class="sell-row">
      <label>Condition
        <select id="sellCond">${CONDITIONS.map(k => `<option value="${k}">${k} · ${COND_LABEL[k]}</option>`).join('')}</select>
      </label>
      <label>Copies <input id="sellQty" type="number" min="1" max="99" value="1" inputmode="numeric"></label>
    </div>
    <label class="sell-price">Your price
      <input id="sellPrice" type="number" min="0" step="0.5" inputmode="decimal" placeholder="Auto: ${vendorMoney(auto)} (market +10%)">
    </label>
    <div class="sell-hint" id="sellHint">Near Mint: leave blank to follow the market price +10% every day.</div>
    <div class="sell-btns">
      <button type="button" class="modal-purchase-save" onclick="addSellItem()">Add</button>
      <button type="button" class="modal-purchase-skip" onclick="document.getElementById('mSellForm').style.display='none'">Cancel</button>
    </div>`;
  el.style.display = 'block';
  document.getElementById('sellCond').addEventListener('change', e => {
    const nm = e.target.value === 'NM';
    document.getElementById('sellHint').textContent = nm
      ? 'Near Mint: leave blank to follow the market price +10% every day.'
      : 'Played cards: set your price (TCGplayer data is Near Mint only).';
    document.getElementById('sellPrice').placeholder = nm ? `Auto: ${vendorMoney(auto)} (market +10%)` : 'Required, e.g. 18';
  });
}

function addSellItem() {
  const c = _modalCard;
  if (!c) return;
  const cond = document.getElementById('sellCond').value;
  const priceRaw = document.getElementById('sellPrice').value.trim();
  const qty = Math.max(1, Math.min(99, parseInt(document.getElementById('sellQty').value, 10) || 1));
  if (cond !== 'NM' && priceRaw === '') {
    document.getElementById('sellHint').innerHTML = '<b style="color:#f87171">Set a price for played cards.</b>';
    return;
  }
  vendorStore().items.unshift({
    id: randId(6), key: cardKey(c), lang: c.lang || 'en', cond,
    price: priceRaw === '' ? null : Math.round(parseFloat(priceRaw) * 100) / 100,
    qty, printed: 0, added: Date.now(),
  });
  saveVendor();
  const el = document.getElementById('mSellForm');
  el.innerHTML = `<div class="sell-title">✓ Added ${qty > 1 ? qty + ' copies' : ''} — print its sticker from the 🏷 Vendor tab.</div>`;
  setTimeout(() => { el.style.display = 'none'; }, 2500);
}

// ─── VENDOR TAB ──────────────────────────────────────────────────────────────
const VUI = { q: '', selected: new Set(), loaded: false };

async function enterVendor() {
  const body = document.getElementById('vendorBody');
  if (!VUI.loaded) body.innerHTML = '<div class="play-empty"><div class="spinner"></div>Loading prices…</div>';
  try { await vendorLoad('en'); } catch (e) {}
  if (vendorStore().items.some(i => i.lang === 'jp')) { try { await vendorLoad('jp'); } catch (e) {} }
  VUI.loaded = true;
  renderVendor();
}

function labelSize() {
  let k = null;
  try { k = localStorage.getItem(LABEL_KEY); } catch (e) {}
  return LABEL_SIZES[k] ? k : '4x6-18';
}

function syncStatusHtml() {
  if (!window._fbSignedIn) return '<div class="vsync warn">⚠ Sign in (top right) so price and condition changes reach your stickers. Until then customers only see Near Mint auto prices.</div>';
  if (window._vendorPublishOk === false) return '<div class="vsync warn">⚠ Couldn\'t publish your prices — check your connection. Customers see the last published prices.</div>';
  return '<div class="vsync good">✓ Live: price and condition changes show up on your stickers right away — no reprinting.</div>';
}

function renderVendor() {
  const body = document.getElementById('vendorBody');
  if (!body || !VUI.loaded) return;
  const s = vendorStore();
  const items = s.items.filter(i => i.qty > 0);
  let stockValue = 0, unpriced = 0, count = 0;
  for (const it of items) {
    const p = itemPrice(it, cardFromCache(it.key));
    count += it.qty;
    if (p == null) unpriced += it.qty; else stockValue += p * it.qty;
  }
  const soldTotal = s.sales.reduce((a, x) => a + (x.price || 0), 0);
  const needPrint = items.reduce((a, i) => a + needStickers(i), 0);
  const size = LABEL_SIZES[labelSize()];
  const perSheet = size.cols * size.rows;
  const rows = items.map(it => {
    const c = cardFromCache(it.key);
    const p = itemPrice(it, c);
    const auto = c ? vendorAutoPrice(c.priceVal) : null;
    const sel = VUI.selected.has(it.id);
    const need = needStickers(it);
    return `<div class="vrow${need ? ' needs-print' : ''}" data-vid="${it.id}">
      <input type="checkbox" class="vsel" data-vact="select" ${sel ? 'checked' : ''} aria-label="Select for printing">
      <img loading="lazy" src="${escapeHtml(c ? c.pic : '')}" alt="">
      <div class="vname"><b>${escapeHtml(c ? c.name : it.key)}</b>
        <span>${escapeHtml(c ? (c.cardId || '').replace(/_p\d+$/, '') + ' · ' + (c.setId || '') : '')}${c && c.print && c.print !== 'base' ? ' · ' + escapeHtml(PRINT_LABEL[c.print] || '') : ''}${it.lang === 'jp' ? ' · 🇯🇵 JP' : ''}</span>
        ${need ? `<em>${need} sticker${need === 1 ? '' : 's'} to print</em>` : ''}</div>
      <select class="vcond" data-vact="cond" aria-label="Condition">${CONDITIONS.map(k => `<option ${k === it.cond ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <div class="vprice">
        <input type="number" min="0" step="0.5" inputmode="decimal" data-vact="price" value="${it.price ?? ''}"
          placeholder="${it.cond === 'NM' ? 'Auto ' + vendorMoney(auto) : 'Set price'}" aria-label="Your price">
        <span class="${p == null ? 'warn' : ''}">${p == null ? 'no price' : (it.price == null ? 'auto' : 'your price')}</span>
      </div>
      <div class="vqty"><button type="button" data-vact="dec">−</button><b>${it.qty}</b><button type="button" data-vact="inc">+</button></div>
      <button type="button" class="vbtn vsold" data-vact="sold">Sold ${p != null ? vendorMoney(p) : ''}</button>
      <button type="button" class="vdel" data-vact="delete" aria-label="Remove">✕</button>
    </div>`;
  }).join('');
  body.innerHTML = `
    <div class="decks-head">
      <div><div class="decks-title display">Vendor</div>
        <div class="decks-sub">Near Mint = market +10%, rounded up, updated daily. Played cards use your price. Add cards from any card in Collection (🏷 Sell), or search below.</div></div>
    </div>
    ${syncStatusHtml()}
    <div class="vstats">
      <div class="dstat"><b>${count}</b><span>cards for sale</span></div>
      <div class="dstat"><b class="price">${vendorMoney(Math.round(stockValue))}</b><span>at your prices${unpriced ? ` (+${unpriced} unpriced)` : ''}</span></div>
      <div class="dstat"><b>${s.sales.length}</b><span>sold · ${vendorMoney(Math.round(soldTotal * 100) / 100)}</span></div>
    </div>
    <div class="vadd">
      <input id="vSearch" type="search" placeholder="Add a card: search name or number…" value="${escapeHtml(VUI.q)}" autocomplete="off">
      <div class="vresults" id="vResults"></div>
    </div>
    <div class="vprint">
      <label>Stickers <select id="vLabel">${Object.entries(LABEL_SIZES).map(([k, v]) =>
        `<option value="${k}" ${k === labelSize() ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <button type="button" class="vbtn active" data-vact="print-new" ${needPrint ? '' : 'disabled'}>🖨 Print new (${needPrint}${needPrint ? ` · ${Math.ceil(needPrint / perSheet)} sheet${Math.ceil(needPrint / perSheet) === 1 ? '' : 's'}` : ''})</button>
      <button type="button" class="vbtn" data-vact="print-selected" ${VUI.selected.size ? '' : 'disabled'}>🖨 Reprint selected (${VUI.selected.size})</button>
      <button type="button" class="vbtn" data-vact="select-all">${VUI.selected.size && VUI.selected.size === items.length ? 'Select none' : 'Select all'}</button>
    </div>
    ${items.length ? `<div class="vlist">${rows}</div>` : '<div class="play-empty">Nothing for sale yet.</div>'}
    ${s.sales.length ? `<details class="vsales"><summary>Sales history (${s.sales.length})</summary>${s.sales.slice(0, 300).map(x => {
      const c = cardFromCache(x.key);
      return `<div class="vsale"><span>${new Date(x.at).toLocaleDateString()}</span><b>${escapeHtml(c ? c.name : x.key)}</b><span>${x.cond}</span><span class="price">${vendorMoney(x.price)}</span></div>`;
    }).join('')}</details>` : ''}`;
  renderVendorResults();
}

function renderVendorResults() {
  const box = document.getElementById('vResults');
  if (!box) return;
  const q = VUI.q.trim().toLowerCase();
  if (q.length < 2) { box.innerHTML = ''; return; }
  const pools = ['en', 'jp'].map(l => (_cardCache[l] ? _cardCache[l].cards : []));
  const terms = q.split(/\s+/);
  const hits = [];
  for (const pool of pools) for (const c of pool) {
    const hay = c._vhay || (c._vhay = `${c.rawName || c.name} ${c.cardId} ${c.setId} ${c.set}`.toLowerCase());
    if (terms.every(t => hay.includes(t))) { hits.push(c); if (hits.length >= 24) break; }
  }
  box.innerHTML = hits.map(c => `<button type="button" class="vhit" data-vadd="${escapeHtml(cardKey(c))}">
      <img loading="lazy" src="${escapeHtml(c.pic)}" alt=""><span><b>${escapeHtml(c.rawName || c.name)}</b>
      <small>${escapeHtml((c.cardId || '').replace(/_p\d+$/, ''))} · ${escapeHtml(c.setId)}${c.lang === 'jp' ? ' · 🇯🇵' : ''} · ${escapeHtml(c.price)}</small></span></button>`).join('')
    || '<div class="decks-sub">No matches.</div>';
}

function recordSale(it, price, extra = {}) {
  const s = vendorStore();
  s.sales.unshift({ key: it.key, cond: it.cond, price, at: Date.now(), id: it.id, ...extra });
  it.qty = Math.max(0, it.qty - 1);
  it.printed = Math.max(0, (it.printed || 0) - 1);   // its sticker left with the card
}

async function onVendorAction(act, row, el) {
  const s = vendorStore();
  const it = row ? s.items.find(i => i.id === row.dataset.vid) : null;
  switch (act) {
    case 'select': if (it) { el.checked ? VUI.selected.add(it.id) : VUI.selected.delete(it.id); } renderVendor(); return;
    case 'select-all': {
      const ids = s.items.filter(i => i.qty > 0).map(i => i.id);
      VUI.selected = VUI.selected.size === ids.length ? new Set() : new Set(ids);
      renderVendor(); return;
    }
    case 'inc': case 'dec':
      if (!it) return;
      it.qty = Math.max(0, Math.min(99, it.qty + (act === 'inc' ? 1 : -1)));
      it.printed = Math.min(it.printed || 0, it.qty);
      break;
    case 'sold': {
      if (!it) return;
      const p = itemPrice(it, cardFromCache(it.key));
      const got = prompt('Sold for how much?', p != null ? String(p) : '');
      if (got === null) return;
      recordSale(it, parseFloat(got) || 0);
      break;
    }
    case 'delete':
      if (!it || !confirm('Remove this card from your for-sale list?')) return;
      s.items = s.items.filter(i => i !== it);
      VUI.selected.delete(it.id);
      break;
    case 'print-new':
      printStickers(s.items.filter(i => i.qty > 0 && needStickers(i)).map(i => [i, needStickers(i)]), true); return;
    case 'print-selected':
      printStickers(s.items.filter(i => i.qty > 0 && VUI.selected.has(i.id)).map(i => [i, i.qty]), false); return;
    case 'load-jp': try { await vendorLoad('jp'); } catch (e) {} renderVendorResults(); return;
    default: return;
  }
  saveVendor();
  renderVendor();
}

function onVendorChange(act, row, el) {
  const it = vendorStore().items.find(i => i.id === row.dataset.vid);
  if (!it) return;
  if (act === 'cond') it.cond = el.value;
  else if (act === 'price') {
    const v = el.value.trim();
    it.price = v === '' ? null : Math.round(parseFloat(v) * 100) / 100;
  }
  saveVendor();      // published to the stickers -- no reprint needed
  renderVendor();
}

function addVendorCard(key) {
  const c = cardFromCache(key);
  if (!c) return;
  const existing = vendorStore().items.find(i => i.key === key && i.cond === 'NM' && i.price == null);
  if (existing) existing.qty += 1;
  else vendorStore().items.unshift({ id: randId(6), key, lang: c.lang || 'en', cond: 'NM', price: null, qty: 1, printed: 0, added: Date.now() });
  VUI.q = '';
  saveVendor();
  renderVendor();
}

// ─── STICKERS (4×6 thermal label, cut into cells) ────────────────────────────
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

function stickerCell(it, size) {
  const c = cardFromCache(it.key);
  const num = c ? (c.cardId || '').replace(/_p\d+$/, '') : '';
  const printLbl = c && c.print && c.print !== 'base' ? (PRINT_LABEL[c.print] || '') : '';
  const svg = qrSvg(buyUrl(it));
  if (size.cols >= 3) {
    // 1"-wide or 1.33"-wide cell: QR on top, number + condition under it
    return `<div class="lbl lbl-small"><div class="lbl-qr">${svg}</div>
      <div class="lbl-tiny">${escapeHtml(num)}${it.cond !== 'NM' ? ' ' + it.cond : ''}${it.lang === 'jp' ? ' JP' : ''}</div></div>`;
  }
  return `<div class="lbl lbl-wide"><div class="lbl-qr">${svg}</div><div class="lbl-txt">
      <div class="lbl-name">${escapeHtml(c ? c.name : '')}</div>
      <div class="lbl-sub">${escapeHtml(num)}${printLbl ? ' · ' + escapeHtml(printLbl) : ''}${it.lang === 'jp' ? ' · JP' : ''}</div>
      <div class="lbl-cond">${it.cond} · Scan for price</div></div></div>`;
}

function printStickers(list, markPrinted) {
  if (!list.length) return;
  const size = LABEL_SIZES[labelSize()];
  const per = size.cols * size.rows;
  const cells = [];
  for (const [it, n] of list) for (let k = 0; k < n; k++) cells.push(stickerCell(it, size));
  const sheets = [];
  for (let i = 0; i < cells.length; i += per) {
    const chunk = cells.slice(i, i + per);
    while (chunk.length < per) chunk.push('<div class="lbl lbl-empty"></div>');
    sheets.push(`<div class="sheet">${chunk.join('')}</div>`);
  }
  document.getElementById('printArea').innerHTML = sheets.join('');
  const cw = 4 / size.cols, ch = 6 / size.rows;
  const qr = size.cols >= 3 ? Math.min(cw, ch) - 0.2 : Math.min(ch - 0.12, 1.1);
  let st = document.getElementById('labelPageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'labelPageStyle'; document.head.appendChild(st); }
  st.textContent = `@page{size:4in 6in;margin:0}
    #printArea .sheet{grid-template-columns:repeat(${size.cols},${cw}in);grid-template-rows:repeat(${size.rows},${ch}in);}
    #printArea .lbl-qr{width:${qr}in;height:${qr}in;}`;
  document.body.classList.add('printing-labels');
  let handled = false;
  const done = () => {
    if (handled) return;
    handled = true;
    document.body.classList.remove('printing-labels');
    if (markPrinted) for (const [it, n] of list) it.printed = Math.min(it.qty, (it.printed || 0) + n);
    saveVendor();
    renderVendor();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

// ─── CUSTOMER CART ───────────────────────────────────────────────────────────
function cartLoad() {
  try { const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(c) ? c : []; }
  catch (e) { return []; }
}
function cartSave(c) { try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch (e) {} }
function cartId(e) { return `${e.v || ''}:${e.b || e.k}:${e.c || ''}`; }

// One scanned sticker -> { v, b, k, c } resolved against the live list.
async function resolveEntry(e) {
  const pub = e.v ? await fetchPublicList(e.v) : null;
  const live = pub && pub.items ? pub.items[e.b] : null;
  const key = (live && live.k) || e.k;
  const cond = (live && live.c) || e.c || 'NM';
  const item = { cond, price: live ? live.p : null };
  let card = null;
  try { card = await findCard(key); } catch (x) {}
  const meta = card ? (_cardCache[card.lang || 'en'] || {}).meta : null;
  return { entry: e, key, cond, card, live, soldOut: !!live && live.q <= 0,
           price: card ? itemPrice(item, card) : (item.price ?? null), fixed: item.price != null, meta };
}

function entryFromParams(p) {
  if (p.has('buy')) return { k: p.get('buy'), c: p.get('c') || 'NM', b: p.get('i') || '', v: '' };  // first stickers
  return { b: p.get('b') || '', v: p.get('v') || '', k: p.get('k') || '', c: p.get('c') || 'NM' };
}

function cartBarHtml(cart, total, unpriced) {
  if (!cart.length) return '';
  return `<button type="button" class="cart-bar" data-cart="open">🛒 ${cart.length} card${cart.length === 1 ? '' : 's'} ·
    <b>${vendorMoney(Math.round(total * 100) / 100)}</b>${unpriced ? ' + ask' : ''}<span>View cart ›</span></button>`;
}

async function cartTotals(cart) {
  const rs = await Promise.all(cart.map(resolveEntry));
  let total = 0, unpriced = 0;
  for (const r of rs) { if (r.price == null || r.soldOut) unpriced++; else total += r.price; }
  return { rs, total, unpriced };
}

// ─── SCAN PAGE (?b=… / ?buy=…), CART (?cart), SELLER CHECKOUT (?checkout=…) ──
async function renderBuyPage() {
  const view = document.getElementById('buyView');
  if (BUY_PARAMS.has('checkout')) return renderCheckout(view);
  if (BUY_PARAMS.has('cart')) return renderCart(view);
  const e = entryFromParams(BUY_PARAMS);
  const r = await resolveEntry(e);
  const cart = cartLoad();
  const { total, unpriced } = await cartTotals(cart);
  const c = r.card;
  if (!c) {
    view.innerHTML = '<div class="buy-card"><div class="buy-name">Card not found</div><p class="decks-sub">Ask the seller about this one.</p></div>' + cartBarHtml(cart, total, unpriced);
    return;
  }
  const inCart = cart.some(x => cartId(x) === cartId(e));
  const mine = vendorStore().items.find(i => i.id === e.b && (!e.v || e.v === vendorStore().pubId));
  const num = (c.cardId || '').replace(/_p\d+$/, '');
  const printLbl = c.print && c.print !== 'base' ? PRINT_LABEL[c.print] : '';
  view.innerHTML = `
    <div class="buy-card">
      <div class="buy-img"><img src="${escapeHtml(c.picLarge || c.pic)}" alt="${escapeHtml(c.name)}"
        onerror="if(this.src!=='${escapeHtml(c.pic)}')this.src='${escapeHtml(c.pic)}'"></div>
      <div class="buy-info">
        <div class="buy-name">${escapeHtml(c.name)}</div>
        <div class="buy-set">${escapeHtml(c.set || '')}${c.setId ? ` <span>${escapeHtml(c.setId)}</span>` : ''}</div>
        <div class="buy-chips">
          <span class="pchip">${escapeHtml(num)}</span>
          ${c.rarity ? `<span class="pchip">${escapeHtml(RARITY_DISPLAY[c.rarity] || c.rarity)}</span>` : ''}
          ${printLbl ? `<span class="pchip">${escapeHtml(printLbl)}</span>` : ''}
          ${c.lang === 'jp' ? '<span class="pchip">🇯🇵 Japanese</span>' : ''}
          <span class="pchip ${r.cond === 'NM' ? 'good' : 'warn-chip'}">${COND_LABEL[r.cond] || r.cond}</span>
        </div>
        <div class="buy-price">${r.soldOut ? 'Sold' : (r.price != null ? vendorMoney(r.price) : 'Ask for price')}</div>
        ${r.price != null && !r.fixed && r.meta && r.meta.generated ? `<div class="buy-note">Price updated ${escapeHtml(formatDateDisplay(r.meta.generated))}</div>` : ''}
        ${r.soldOut ? '' : `<button type="button" class="vbtn ${inCart ? '' : 'active'} buy-add" data-cart="${inCart ? 'remove-this' : 'add'}">${inCart ? '✓ In your cart — remove' : '🛒 Add to cart'}</button>`}
        ${mine ? `<div class="buy-vendor">
            <div>Seller view · Market: <b>${escapeHtml(c.price)}</b> · You have ${mine.qty} · ${mine.price == null ? 'auto price' : 'your price'}</div>
            ${mine.qty > 0 ? `<button type="button" class="vbtn" id="buySold">Mark one sold</button>` : ''}
          </div>` : ''}
      </div>
    </div>
    ${cartBarHtml(cart, total, unpriced)}`;
  document.title = `${c.name} — ${r.price != null ? vendorMoney(r.price) : 'Ask for price'}`;
  const sold = document.getElementById('buySold');
  if (sold) sold.onclick = () => {
    const got = prompt('Sold for how much?', r.price != null ? String(r.price) : '');
    if (got === null) return;
    recordSale(mine, parseFloat(got) || 0);
    saveVendor();
    renderBuyPage();
  };
}

async function renderCart(view) {
  const cart = cartLoad();
  if (!cart.length) {
    view.innerHTML = '<div class="buy-card"><div class="buy-name">Your cart is empty</div><p class="decks-sub">Scan a card\'s sticker and tap “Add to cart”.</p></div>';
    return;
  }
  view.innerHTML = '<div class="play-empty"><div class="spinner"></div>Loading your cart…</div>';
  const { rs, total, unpriced } = await cartTotals(cart);
  const vids = [...new Set(cart.map(e => e.v).filter(Boolean))];
  const u = new URL(location.origin + location.pathname);
  // compact: v~b~k~c per card (k kept so old / offline stickers still work)
  u.searchParams.set('checkout', cart.map(e => [e.v || '', e.b || '', e.v ? '' : e.k, e.c && e.c !== 'NM' && !e.v ? e.c : ''].join('~').replace(/~+$/, '')).join('.'));
  view.innerHTML = `
    <div class="cart">
      <div class="buy-name">Your cart</div>
      <div class="cart-list">${rs.map((r, i) => `
        <div class="cart-row">
          <img src="${escapeHtml(r.card ? r.card.pic : '')}" alt="">
          <div class="cart-name"><b>${escapeHtml(r.card ? r.card.name : r.key)}</b>
            <span>${escapeHtml(r.card ? (r.card.cardId || '').replace(/_p\d+$/, '') : '')} · ${escapeHtml(r.cond)}</span></div>
          <div class="cart-price">${r.soldOut ? '<span class="warn">sold</span>' : (r.price != null ? vendorMoney(r.price) : '<span class="warn">ask</span>')}</div>
          <button type="button" class="vdel" data-cart="remove" data-i="${i}" aria-label="Remove">✕</button>
        </div>`).join('')}</div>
      <div class="cart-total"><span>Total</span><b>${vendorMoney(Math.round(total * 100) / 100)}</b></div>
      ${unpriced ? `<div class="buy-note">${unpriced} card${unpriced === 1 ? '' : 's'} not included — ask the seller.</div>` : ''}
      <div class="cart-checkout">
        <div class="cart-qr">${qrSvg(u.toString())}</div>
        <div class="buy-note">Ready to buy? Show this code to the seller — it shows them the same cards and total.</div>
      </div>
      <div class="deck-btns" style="justify-content:center">
        <button type="button" class="vbtn" data-cart="back">‹ Keep shopping</button>
        <button type="button" class="reset-btn" data-cart="clear">Empty cart</button>
      </div>
      ${vids.length > 1 ? '<div class="buy-note">Cards from more than one seller are in this cart.</div>' : ''}
    </div>`;
}

async function renderCheckout(view) {
  const raw = BUY_PARAMS.get('checkout') || '';
  const entries = raw.split('.').filter(Boolean).map(s => {
    const [v, b, k, c] = s.split('~');
    return { v: v || '', b: b || '', k: k || '', c: c || 'NM' };
  });
  view.innerHTML = '<div class="play-empty"><div class="spinner"></div>Loading…</div>';
  const { rs, total, unpriced } = await cartTotals(entries);
  const s = vendorStore();
  const mineCount = rs.filter(r => s.items.some(i => i.id === r.entry.b)).length;
  view.innerHTML = `
    <div class="cart">
      <div class="buy-name">Checkout</div>
      <div class="cart-list">${rs.map((r, i) => {
        const mine = s.items.find(it => it.id === r.entry.b);
        return `<div class="cart-row">
          <img src="${escapeHtml(r.card ? r.card.pic : '')}" alt="">
          <div class="cart-name"><b>${escapeHtml(r.card ? r.card.name : r.key)}</b>
            <span>${escapeHtml(r.card ? (r.card.cardId || '').replace(/_p\d+$/, '') : '')} · ${escapeHtml(r.cond)}${mine ? ` · market ${escapeHtml(r.card ? r.card.price : '')} · ${mine.qty} in stock` : ''}</span></div>
          <div class="cart-price"><input type="number" step="0.5" min="0" inputmode="decimal" class="co-price" data-i="${i}" value="${r.price ?? ''}" placeholder="price"></div>
        </div>`;
      }).join('')}</div>
      <div class="cart-total"><span>Total</span><b id="coTotal">${vendorMoney(Math.round(total * 100) / 100)}</b></div>
      ${unpriced ? `<div class="buy-note">${unpriced} card${unpriced === 1 ? '' : 's'} need a price — type it in above.</div>` : ''}
      ${mineCount ? `<div class="deck-btns" style="justify-content:center"><button type="button" class="vbtn active" id="coSold">✓ Mark all ${mineCount} sold</button></div>`
        : '<div class="buy-note">Open this on the phone you sell from (signed in) to mark these sold.</div>'}
    </div>`;
  const recalc = () => {
    let t = 0;
    view.querySelectorAll('.co-price').forEach(inp => { t += parseFloat(inp.value) || 0; });
    document.getElementById('coTotal').textContent = vendorMoney(Math.round(t * 100) / 100);
  };
  view.querySelectorAll('.co-price').forEach(inp => inp.addEventListener('input', recalc));
  recalc();
  const btn = document.getElementById('coSold');
  if (btn) btn.onclick = () => {
    const order = 'o' + Date.now().toString(36);
    view.querySelectorAll('.co-price').forEach(inp => {
      const r = rs[+inp.dataset.i];
      const it = s.items.find(x => x.id === r.entry.b);
      if (it && it.qty > 0) recordSale(it, parseFloat(inp.value) || 0, { order });
    });
    saveVendor();
    btn.outerHTML = '<div class="good" style="text-align:center;font-weight:800">✓ Sold — removed from your stock</div>';
  };
}

// ─── WIRING ──────────────────────────────────────────────────────────────────
async function onCartAction(act, el) {
  let cart = cartLoad();
  if (act === 'add' || act === 'remove-this') {
    const e = entryFromParams(BUY_PARAMS);
    cart = cart.filter(x => cartId(x) !== cartId(e));
    if (act === 'add') cart.push(e);
    cartSave(cart);
    renderBuyPage();
  } else if (act === 'remove') {
    cart.splice(+el.dataset.i, 1); cartSave(cart); renderCart(document.getElementById('buyView'));
  } else if (act === 'clear') {
    if (!confirm('Empty your cart?')) return;
    cartSave([]); renderCart(document.getElementById('buyView'));
  } else if (act === 'open') {
    location.href = location.pathname + '?cart=1';
  } else if (act === 'back') {
    history.length > 1 ? history.back() : (location.href = location.pathname);
  }
}

function initVendor() {
  document.addEventListener('click', e => {
    const cartBtn = e.target.closest('[data-cart]');
    if (cartBtn) { onCartAction(cartBtn.dataset.cart, cartBtn); return; }
    const add = e.target.closest('[data-vadd]');
    if (add) { addVendorCard(add.dataset.vadd); return; }
    const a = e.target.closest('[data-vact]');
    if (!a || !a.closest('#vendorView')) return;
    if (a.tagName === 'SELECT' || (a.tagName === 'INPUT' && a.type !== 'checkbox')) return;
    onVendorAction(a.dataset.vact, a.closest('[data-vid]'), a);
  });
  document.addEventListener('change', e => {
    const a = e.target;
    if (a.id === 'vLabel') { try { localStorage.setItem(LABEL_KEY, a.value); } catch (x) {} renderVendor(); return; }
    if (!a.closest || !a.closest('#vendorView')) return;
    const act = a.dataset && a.dataset.vact;
    if (act === 'cond' || act === 'price') onVendorChange(act, a.closest('[data-vid]'), a);
  });
  let deb = null;
  document.addEventListener('input', e => {
    if (e.target.id !== 'vSearch') return;
    VUI.q = e.target.value;
    clearTimeout(deb);
    deb = setTimeout(renderVendorResults, 200);
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('printing-labels'));
  window.addEventListener('vendor-sync-status', () => { if (typeof PLAY !== 'undefined' && PLAY.mode === 'vendor') renderVendor(); });
  if (READ_ONLY_SHARE) { const s = document.getElementById('mSell'); if (s) s.style.display = 'none'; }
  if (window.BUY_MODE) {
    document.body.classList.add('buy-mode');
    renderBuyPage();
  }
}
initVendor();
