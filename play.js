// play.js — Play tab (every card with game text) + Decks tab (deck builder).
// ADDED 2026-10-21. Jordan started playing the game, so the app now has:
//   * Play: every English card (not just chase prints) with cost, power,
//     counter, effect, trigger, block icon / Standard legality and the
//     cheapest price of any print -- filterable like a deck-building site.
//   * Decks: Leader + 50, rule checks (colors, 4 copies, banned cards and
//     pairs, Standard legality), cost curve, what you own vs. what you're
//     missing, and what the missing cards cost on TCGplayer right now.
// Data: data/cards-play-en.json (play_data.py on the collector side), only
// downloaded the first time one of these tabs is opened.
// "Have" counts and decks are saved on this device and synced to the
// signed-in account by firebase.js (the 'play-changed' event).

const PLAY_KEY = 'onepiece-play';
const MODE_KEY = 'onepiece-mode';
const PAGE = 120;
const COLORS = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'];

const PLAY = {
  loaded: false, loading: null,
  cards: [], byNum: new Map(), series: [], format: {}, generated: '',
  mode: 'collection',
  f: { q: '', colors: [], cat: '', cost: '', counter: '', set: '', legal: false, trigger: false, have: false, fits: true, sort: 'num' },
  shown: PAGE, list: [],
  deckId: null,        // deck being added to (Play tab) / edited (Decks tab)
  pickLeader: false,   // Play tab is choosing a Leader for a new deck
  ownedPrints: null,   // num -> collection prints marked owned
  openNum: null,
};

// ─── STORAGE ─────────────────────────────────────────────────────────────────
function playStore() {
  if (PLAY._store) return PLAY._store;
  let s = null;
  try { s = JSON.parse(localStorage.getItem(PLAY_KEY) || 'null'); } catch (e) {}
  PLAY._store = (s && typeof s === 'object') ? s : {};
  PLAY._store.have = PLAY._store.have || {};
  PLAY._store.decks = Array.isArray(PLAY._store.decks) ? PLAY._store.decks : [];
  PLAY._store.updated = PLAY._store.updated || 0;
  return PLAY._store;
}
function savePlayStore() {
  const s = playStore();
  s.updated = Date.now();
  try { localStorage.setItem(PLAY_KEY, JSON.stringify(s)); } catch (e) {}
  window.dispatchEvent(new CustomEvent('play-changed', { detail: s }));
}
// firebase.js calls this when the account's copy is newer.
window.applyRemotePlay = function(remote) {
  if (!remote || typeof remote !== 'object') return;
  PLAY._store = { have: remote.have || {}, decks: Array.isArray(remote.decks) ? remote.decks : [], updated: remote.updated || 0 };
  try { localStorage.setItem(PLAY_KEY, JSON.stringify(PLAY._store)); } catch (e) {}
  if (PLAY.mode === 'play') renderPlay(true);
  if (PLAY.mode === 'decks') renderDecks();
};
window.getLocalPlay = () => playStore();

// ─── DATA ────────────────────────────────────────────────────────────────────
async function loadPlayData() {
  if (PLAY.loaded) return;
  if (PLAY.loading) return PLAY.loading;
  PLAY.loading = (async () => {
    const ver = await fetchVersion();
    const r = await fetch(`data/cards-play-en.json?v=${encodeURIComponent(ver.play || '0')}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const F = d.fields;
    PLAY.cards = d.cards.map(row => {
      const c = {};
      for (let i = 0; i < F.length; i++) c[F[i]] = row[i];
      c.colors = (c.color || '').split('/').filter(Boolean);
      c.search = `${c.num} ${c.name} ${c.types} ${c.effect} ${c.trigger} ${c.attr}`.toLowerCase();
      return c;
    });
    PLAY.byNum = new Map(PLAY.cards.map(c => [c.num, c]));
    PLAY.series = d.series || [];
    PLAY.format = d.format || {};
    PLAY.generated = d.generated || '';
    PLAY.loaded = true;
    fillSetSelect();
  })();
  try { await PLAY.loading; } finally { PLAY.loading = null; }
}

const NUM_RE = /((?:OP|EB|ST|PRB|P)\d{0,2}-\d{3})/i;
async function computeOwnedPrints() {
  // English collection cards marked owned, counted per card number.
  let en = null;
  try {
    if (typeof _cardCache !== 'undefined' && _cardCache.en) en = _cardCache.en.cards;
    else {
      const keepOrder = SET_ORDER, keepMeta = DATA_META;
      en = (await fetchCards('en')).cards;
      if (LANG !== 'en') { SET_ORDER = keepOrder; DATA_META = keepMeta; }
    }
  } catch (e) { en = []; }
  const owned = getOwnedMap();
  const out = {};
  for (const c of en || []) {
    if (!owned[cardKey(c)]) continue;
    const m = (c.cardId || '').match(NUM_RE);
    if (m) out[m[1].toUpperCase()] = (out[m[1].toUpperCase()] || 0) + 1;
  }
  PLAY.ownedPrints = out;
}
function haveCount(num) {
  const h = playStore().have;
  if (h[num] != null) return h[num];
  return (PLAY.ownedPrints && PLAY.ownedPrints[num]) || 0;
}
function setHave(num, n) {
  playStore().have[num] = Math.max(0, Math.min(99, n));
  savePlayStore();
}

// ─── MODE TABS ───────────────────────────────────────────────────────────────
async function setMode(mode, opts = {}) {
  if (mode === PLAY.mode && !opts.force) return;
  if (READ_ONLY_SHARE && mode !== 'collection') return;
  if (document.getElementById('modalBackdrop').classList.contains('active')) closeModal(false);
  closePlayModal(true);
  PLAY.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  if (new URLSearchParams(location.search).has('tab')) {
    const u = new URL(location.href); u.searchParams.delete('tab');
    history.replaceState(history.state, '', u.toString());
  }
  document.body.classList.toggle('mode-play', mode === 'play');
  document.body.classList.toggle('mode-decks', mode === 'decks');
  document.body.classList.toggle('mode-alt', mode !== 'collection');
  document.querySelectorAll('[data-mode-btn]').forEach(b => {
    const on = b.dataset.modeBtn === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.getElementById('playView').hidden = mode !== 'play';
  document.getElementById('decksView').hidden = mode !== 'decks';
  if (mode === 'collection') {
    PLAY.deckId = null; PLAY.pickLeader = false;
    if (LANG !== 'en' || !ALL_CARDS.length) showLang(LANG);
    else render();
    return;
  }
  const holder = mode === 'play' ? document.getElementById('playGrid') : document.getElementById('decksBody');
  if (!PLAY.loaded) holder.innerHTML = '<div class="play-empty"><div class="spinner"></div>Loading every card…</div>';
  try {
    await loadPlayData();
    await computeOwnedPrints();
  } catch (e) {
    holder.innerHTML = '<div class="play-empty">Card text isn\'t available yet — it appears after the next daily collector run.</div>';
    return;
  }
  if (PLAY.mode !== mode) return;
  if (mode === 'play') { PLAY.shown = PAGE; renderPlay(); }
  else renderDecks();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ─── PLAY TAB: FILTERS ───────────────────────────────────────────────────────
function fillSetSelect() {
  const sel = document.getElementById('pSet');
  if (!sel) return;
  const groups = { booster: 'Booster packs', starter: 'Starter decks', promo: 'Promos', other: 'Other' };
  let html = '<option value="">All sets</option>';
  for (const [kind, label] of Object.entries(groups)) {
    const list = PLAY.series.filter(s => s.kind === kind);
    if (!list.length) continue;
    html += `<optgroup label="${label}">` + list.map(s =>
      `<option value="${escapeHtml(s.code || s.name)}">${escapeHtml((s.code ? s.code + ' · ' : '') + titleCase(s.name))}</option>`).join('') + '</optgroup>';
  }
  sel.innerHTML = html;
}
function titleCase(s) {
  return (s || '').toLowerCase().replace(/(^|[\s\-(/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

function activeDeck() { return PLAY.deckId ? playStore().decks.find(d => d.id === PLAY.deckId) : null; }

function leaderColors(deck) {
  const L = deck && PLAY.byNum.get(deck.leader);
  return L ? L.colors : [];
}
function fitsLeader(card, colors) {
  return card.colors.length > 0 && card.colors.every(c => colors.includes(c));
}

function playFiltered() {
  const f = PLAY.f;
  const q = f.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const deck = activeDeck();
  const lc = deck ? leaderColors(deck) : [];
  const setNums = f.set ? new Set((PLAY.series.find(s => (s.code || s.name) === f.set) || {}).cards || []) : null;
  let list = PLAY.cards.filter(c => {
    if (PLAY.pickLeader && c.cat !== 'Leader') return false;
    if (deck && !PLAY.pickLeader && c.cat === 'Leader') return false;
    if (deck && f.fits && !fitsLeader(c, lc)) return false;
    if (f.colors.length && !c.colors.some(x => f.colors.includes(x))) return false;
    if (f.cat && c.cat !== f.cat) return false;
    if (f.cost !== '') {
      const v = c.cat === 'Leader' ? c.life : c.cost;
      if (f.cost === '10' ? !(v >= 10) : v !== +f.cost) return false;
    }
    if (f.counter !== '' && (c.counter || 0) !== +f.counter) return false;
    if (setNums && !setNums.has(c.num)) return false;
    if (f.legal && !c.legal) return false;
    if (f.trigger && !c.trigger) return false;
    if (f.have && !haveCount(c.num)) return false;
    for (const t of terms) if (!c.search.includes(t)) return false;
    return true;
  });
  const by = {
    num: (a, b) => a.num.localeCompare(b.num),
    newest: (a, b) => (b.num.slice(0, 4) === a.num.slice(0, 4) ? a.num.localeCompare(b.num) : b.num.localeCompare(a.num)),
    cost: (a, b) => ((a.cost ?? a.life ?? 99) - (b.cost ?? b.life ?? 99)) || a.num.localeCompare(b.num),
    power: (a, b) => ((b.power || 0) - (a.power || 0)) || a.num.localeCompare(b.num),
    'price-asc': (a, b) => ((a.price ?? 1e9) - (b.price ?? 1e9)),
    'price-desc': (a, b) => ((b.price || 0) - (a.price || 0)),
    name: (a, b) => a.name.localeCompare(b.name) || a.num.localeCompare(b.num),
  }[f.sort] || ((a, b) => a.num.localeCompare(b.num));
  list.sort(by);
  return list;
}

function readPlayFilters() {
  const g = id => document.getElementById(id);
  const f = PLAY.f;
  f.q = g('pSearch').value;
  f.cat = g('pCat').value;
  f.cost = g('pCost').value;
  f.counter = g('pCounter').value;
  f.set = g('pSet').value;
  f.sort = g('pSort').value;
}
function syncPlayFilterUI() {
  const g = id => document.getElementById(id);
  const f = PLAY.f;
  g('pSearch').value = f.q; g('pCat').value = f.cat; g('pCost').value = f.cost;
  g('pCounter').value = f.counter; g('pSet').value = f.set; g('pSort').value = f.sort;
  document.querySelectorAll('[data-pcolor]').forEach(b => b.classList.toggle('active', f.colors.includes(b.dataset.pcolor)));
  ['legal', 'trigger', 'have', 'fits'].forEach(k => {
    const b = document.querySelector(`[data-ptoggle="${k}"]`);
    if (b) b.classList.toggle('active', !!f[k]);
  });
  const fitsBtn = document.querySelector('[data-ptoggle="fits"]');
  if (fitsBtn) fitsBtn.hidden = !activeDeck() || PLAY.pickLeader;
}

// ─── PLAY TAB: RENDER ────────────────────────────────────────────────────────
function money(v) { return v != null && v > 0 ? '$' + v.toFixed(2) : '—'; }

function playTileHtml(c, deck) {
  const have = haveCount(c.num);
  const inDeck = deck ? (deck.cards[c.num] || 0) : 0;
  const costLbl = c.cat === 'Leader' ? (c.life != null ? `♥${c.life}` : 'L') : (c.cost != null ? c.cost : '');
  const ctrl = deck && !PLAY.pickLeader ? `
    <div class="ptile-deck" data-stop>
      <button type="button" data-deck-dec="${c.num}" aria-label="Remove one">−</button>
      <span class="${inDeck ? 'on' : ''}">${inDeck}</span>
      <button type="button" data-deck-inc="${c.num}" aria-label="Add one">+</button>
    </div>` : '';
  return `<div class="ptile${c.legal ? '' : ' not-legal'}" data-pnum="${c.num}">
    <div class="ptile-img">
      <img loading="lazy" src="${escapeHtml(c.img)}" alt="${escapeHtml(c.name)}" onerror="this.onerror=null;this.src='https://optcgapi.com/media/static/Card_Images/${c.num}.jpg'">
      ${costLbl !== '' ? `<span class="ptile-cost">${costLbl}</span>` : ''}
      ${have ? `<span class="ptile-have" title="You have ${have}">×${have}</span>` : ''}
      ${c.legal ? '' : `<span class="ptile-flag">${PLAY.format.banned && PLAY.format.banned[c.num] ? 'Banned' : 'Not legal'}</span>`}
    </div>
    <div class="ptile-meta">
      <div class="ptile-name">${escapeHtml(c.name)}</div>
      <div class="ptile-sub"><span>${c.num}</span><span class="ptile-price">${money(c.price)}</span></div>
    </div>
    ${ctrl}
  </div>`;
}

function renderPlayBanner() {
  const el = document.getElementById('playBanner');
  const deck = activeDeck();
  if (PLAY.pickLeader) {
    el.hidden = false;
    el.innerHTML = `<span><b>New deck:</b> tap a Leader to start.</span><button type="button" class="vbtn" data-pact="cancel-pick">Cancel</button>`;
  } else if (deck) {
    const n = deckCount(deck);
    el.hidden = false;
    el.innerHTML = `<span>Adding to <b>${escapeHtml(deck.name)}</b> · <b class="${n === 50 ? 'ok' : ''}">${n}/50</b></span>
      <button type="button" class="vbtn active" data-pact="done-adding">✓ Done</button>`;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function renderPlay(keepScroll) {
  if (!PLAY.loaded) return;
  syncPlayFilterUI();
  renderPlayBanner();
  PLAY.list = playFiltered();
  const deck = activeDeck();
  const grid = document.getElementById('playGrid');
  const shown = PLAY.list.slice(0, PLAY.shown);
  grid.innerHTML = shown.length ? shown.map(c => playTileHtml(c, deck)).join('')
    : '<div class="play-empty">No cards match these filters.</div>';
  const legalNote = PLAY.format.standardMinBlock ? ` · Standard = block ${PLAY.format.standardMinBlock}+ and X` : '';
  document.getElementById('playCount').textContent =
    `${PLAY.list.length.toLocaleString()} card${PLAY.list.length === 1 ? '' : 's'}${legalNote}`;
  document.getElementById('playMore').hidden = PLAY.list.length <= PLAY.shown;
  if (!keepScroll) {/* leave scroll where it is; filters live at the top */}
}

function showMorePlay() {
  const deck = activeDeck();
  const grid = document.getElementById('playGrid');
  const next = PLAY.list.slice(PLAY.shown, PLAY.shown + PAGE);
  PLAY.shown += PAGE;
  grid.insertAdjacentHTML('beforeend', next.map(c => playTileHtml(c, deck)).join(''));
  document.getElementById('playMore').hidden = PLAY.list.length <= PLAY.shown;
}

function refreshPlayTile(num) {
  const c = PLAY.byNum.get(num);
  const el = document.querySelector(`.ptile[data-pnum="${num}"]`);
  if (c && el) el.outerHTML = playTileHtml(c, activeDeck());
  renderPlayBanner();
}

// ─── CARD DETAIL ─────────────────────────────────────────────────────────────
function fmtEffect(t) {
  return escapeHtml(t || '')
    .replace(/\[(Trigger)\]/g, '<span class="kw kw-trigger">$1</span>')
    .replace(/\[(Counter)\]/g, '<span class="kw kw-counter">$1</span>')
    .replace(/\[(On Play|When Attacking|On K\.O\.|Activate: ?Main|Main|End of Your Turn|On Block|Your Turn|Opponent's Turn|On Your Opponent's Attack|Once Per Turn)\]/g, '<span class="kw kw-timing">$1</span>')
    .replace(/\[(Blocker|Rush|Double Attack|Banish|Unblockable|Rush: Characters)\]/g, '<span class="kw kw-key">$1</span>')
    .replace(/\[(DON!! x\d+|DON!! −\d+|DON!! -\d+)\]/g, '<span class="kw kw-don">$1</span>')
    .replace(/\{([^}]+)\}/g, '<span class="kw-type">$1</span>')
    .replace(/\n/g, '<br>');
}

function collectorPrints(num) {
  const en = (typeof _cardCache !== 'undefined' && _cardCache.en) ? _cardCache.en.cards : [];
  return en.filter(c => ((c.cardId || '').match(NUM_RE) || [])[1] === num);
}

function openPlayCard(num, push = true) {
  const c = PLAY.byNum.get(num);
  if (!c) return;
  PLAY.openNum = num;
  const deck = activeDeck();
  const banned = PLAY.format.banned && PLAY.format.banned[num];
  const legal = banned ? '<span class="pchip bad">Banned</span>'
    : c.legal ? '<span class="pchip good">Standard legal</span>' : '<span class="pchip bad">Not Standard legal</span>';
  const stat = (k, v) => v == null || v === '' ? '' : `<div class="pstat"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`;
  const prints = collectorPrints(num);
  const setNames = (c.sets || []).map(code => {
    const s = PLAY.series.find(x => x.code === code);
    return `<span class="pset" title="${escapeHtml(s ? titleCase(s.name) : code)}">${escapeHtml(code)}</span>`;
  }).join('');
  const have = haveCount(num);
  const explicit = playStore().have[num] != null;
  const tcgUrl = c.tcg ? `https://www.tcgplayer.com/product/${c.tcg}` : buildTcgplayerUrl({ name: c.name, cardId: c.num, rawName: c.name });
  document.getElementById('pmBody').innerHTML = `
    <div class="pm-img"><img src="${escapeHtml(c.img)}" alt="${escapeHtml(c.name)}" onerror="this.onerror=null;this.src='https://optcgapi.com/media/static/Card_Images/${c.num}.jpg'"></div>
    <div class="pm-info">
      <div class="pm-num">${c.num} · ${escapeHtml(c.rarity)} · ${escapeHtml(c.cat)}</div>
      <div class="pm-name">${escapeHtml(c.name)}</div>
      <div class="pm-chips">${c.colors.map(x => `<span class="pchip color-${x.toLowerCase()}">${x}</span>`).join('')}
        <span class="pchip">Block ${escapeHtml(c.block || '?')}</span>${legal}</div>
      <div class="pstats">
        ${c.cat === 'Leader' ? stat('Life', c.life) : stat('Cost', c.cost)}
        ${stat('Power', c.power)}
        ${c.cat === 'Character' ? stat('Counter', c.counter ? '+' + c.counter : '—') : ''}
        ${stat('Attribute', c.attr)}
      </div>
      ${c.types ? `<div class="pm-types">${escapeHtml(c.types)}</div>` : ''}
      ${c.effect ? `<div class="pm-effect">${fmtEffect(c.effect)}</div>` : ''}
      ${c.trigger ? `<div class="pm-effect pm-trigger">${fmtEffect(c.trigger)}</div>` : ''}
      <div class="pm-row">
        <div class="pm-have">
          <span>I have</span>
          <button type="button" data-have-dec="${num}" aria-label="One less">−</button>
          <b>${have}</b>
          <button type="button" data-have-inc="${num}" aria-label="One more">+</button>
          ${explicit ? '' : (have ? '<small>from your collection</small>' : '')}
        </div>
        ${deck && c.cat !== 'Leader' ? `
        <div class="pm-have pm-deck">
          <span>In deck</span>
          <button type="button" data-deck-dec="${num}">−</button>
          <b>${deck.cards[num] || 0}</b>
          <button type="button" data-deck-inc="${num}">+</button>
        </div>` : ''}
      </div>
      <div class="pm-price">Cheapest copy: <b>${money(c.price)}</b>
        <a href="${escapeHtml(tcgUrl)}" target="_blank" rel="noopener">TCGplayer →</a></div>
      ${setNames ? `<div class="pm-sets">In: ${setNames}</div>` : ''}
      ${prints.length ? `<button type="button" class="vbtn pm-prints" data-pact="prints" data-num="${num}">See ${prints.length} collector print${prints.length === 1 ? '' : 's'} (alt arts, SPs…) →</button>` : ''}
      ${PLAY.pickLeader && c.cat === 'Leader' ? `<button type="button" class="vbtn active pm-prints" data-pact="pick" data-num="${num}">Build a deck with this Leader</button>` : ''}
    </div>`;
  const bd = document.getElementById('playModal');
  if (!bd.classList.contains('active')) {
    bd.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (push) history.pushState({ playModal: num }, '');
  }
}
function closePlayModal(silent) {
  const bd = document.getElementById('playModal');
  if (!bd || !bd.classList.contains('active')) return;
  bd.classList.remove('active');
  document.body.style.overflow = '';
  PLAY.openNum = null;
  if (!silent && history.state && history.state.playModal) history.back();
}
window.addEventListener('popstate', () => {
  const bd = document.getElementById('playModal');
  if (bd && bd.classList.contains('active')) closePlayModal(true);
});

// ─── DECKS ───────────────────────────────────────────────────────────────────
function deckCount(deck) { return Object.values(deck.cards).reduce((a, b) => a + b, 0); }

function changeDeck(num, delta) {
  const deck = activeDeck();
  if (!deck) return;
  const c = PLAY.byNum.get(num);
  if (!c || c.cat === 'Leader') return;
  const n = Math.max(0, Math.min(4, (deck.cards[num] || 0) + delta));
  if (n) deck.cards[num] = n; else delete deck.cards[num];
  deck.updated = Date.now();
  savePlayStore();
}

function newDeckFromLeader(num) {
  const L = PLAY.byNum.get(num);
  if (!L) return;
  const deck = { id: 'd' + Date.now().toString(36), name: L.name + ' deck', leader: num, cards: {}, updated: Date.now() };
  playStore().decks.unshift(deck);
  savePlayStore();
  PLAY.pickLeader = false;
  PLAY.deckId = deck.id;
  closePlayModal(true);
  setMode('decks', { force: true });
}

function deckIssues(deck) {
  const issues = [];
  const L = PLAY.byNum.get(deck.leader);
  const n = deckCount(deck);
  if (!L) issues.push('Pick a Leader.');
  if (n !== 50) issues.push(n < 50 ? `${50 - n} more card${50 - n === 1 ? '' : 's'} needed (decks are exactly 50).` : `${n - 50} card${n - 50 === 1 ? '' : 's'} over 50.`);
  const lc = L ? L.colors : [];
  const off = [], notLegal = [], banned = [];
  const B = PLAY.format.banned || {};
  if (B[deck.leader]) banned.push(L ? L.name : deck.leader);
  else if (L && !L.legal) notLegal.push(L.name + ' (Leader)');
  for (const num of Object.keys(deck.cards)) {
    const c = PLAY.byNum.get(num);
    if (!c) continue;
    if (L && !fitsLeader(c, lc)) off.push(c.name);
    if (B[num]) banned.push(c.name);
    else if (!c.legal) notLegal.push(c.name);
  }
  if (off.length) issues.push(`Not in your Leader's colors: ${off.join(', ')}.`);
  if (banned.length) issues.push(`Banned: ${banned.join(', ')}.`);
  for (const [a, b] of PLAY.format.bannedPairs || []) {
    const inA = a === deck.leader || deck.cards[a], inB = b === deck.leader || deck.cards[b];
    if (inA && inB) issues.push(`${PLAY.byNum.get(a)?.name || a} and ${PLAY.byNum.get(b)?.name || b} can't be in the same deck.`);
  }
  return { issues, notLegal };
}

function deckMoney(deck) {
  let missing = 0, cost = 0, unpriced = 0;
  const all = Object.entries(deck.cards).concat(deck.leader ? [[deck.leader, 1]] : []);
  for (const [num, q] of all) {
    const need = Math.max(0, q - haveCount(num));
    if (!need) continue;
    missing += need;
    const c = PLAY.byNum.get(num);
    if (c && c.price) cost += need * c.price; else unpriced += need;
  }
  return { missing, cost, unpriced };
}

function renderDecks() {
  const body = document.getElementById('decksBody');
  if (!PLAY.loaded) return;
  const deck = activeDeck();
  if (deck) { body.innerHTML = deckEditorHtml(deck); return; }
  const decks = playStore().decks;
  body.innerHTML = `
    <div class="decks-head">
      <div><div class="decks-title display">My Decks</div>
      <div class="decks-sub">Leader + 50 cards · checks colors, 4-copy limit, banned list and Standard blocks · prices are the cheapest copy on TCGplayer.</div></div>
      <div class="decks-actions">
        <button type="button" class="vbtn active" data-pact="new-deck">＋ New deck</button>
        <button type="button" class="vbtn" data-pact="import-new">⇩ Import list</button>
      </div>
    </div>
    ${decks.length ? `<div class="deck-list">${decks.map(d => {
      const L = PLAY.byNum.get(d.leader);
      const n = deckCount(d);
      const m = deckMoney(d);
      const ok = !deckIssues(d).issues.length;
      return `<button type="button" class="deck-card" data-open-deck="${d.id}">
        <img loading="lazy" src="${escapeHtml(L ? L.img : '')}" alt="">
        <div class="deck-card-info">
          <div class="deck-card-name">${escapeHtml(d.name)}</div>
          <div class="deck-card-sub">${L ? escapeHtml(L.color) + ' · ' : ''}${n}/50 ${ok ? '<span class="good">✓ legal</span>' : '<span class="warn">needs work</span>'}</div>
          <div class="deck-card-sub">${m.missing ? `Missing ${m.missing} · <b class="price">${money(m.cost)}</b> to finish` : '<span class="good">You own every card</span>'}</div>
        </div>
      </button>`;
    }).join('')}</div>` : `<div class="play-empty">No decks yet. Start one from a Leader, or paste a decklist you found online.</div>`}`;
}

function curveHtml(deck) {
  const buckets = new Array(11).fill(0);
  let counters = { 1000: 0, 2000: 0 }, triggers = 0, chars = 0, events = 0, stages = 0;
  for (const [num, q] of Object.entries(deck.cards)) {
    const c = PLAY.byNum.get(num);
    if (!c) continue;
    buckets[Math.min(10, c.cost || 0)] += q;
    if (c.counter === 1000) counters[1000] += q;
    if (c.counter === 2000) counters[2000] += q;
    if (c.trigger) triggers += q;
    if (c.cat === 'Character') chars += q; else if (c.cat === 'Event') events += q; else if (c.cat === 'Stage') stages += q;
  }
  const max = Math.max(1, ...buckets);
  return `<div class="curve">${buckets.map((v, i) => `
      <div class="curve-col"><div class="curve-n">${v || ''}</div>
      <div class="curve-bar" style="height:${Math.round(v / max * 70)}px"></div>
      <div class="curve-x">${i === 10 ? '10+' : i}</div></div>`).join('')}</div>
    <div class="deck-mix">${chars} Characters · ${events} Events · ${stages} Stages · Counters: ${counters[1000]}×1000, ${counters[2000]}×2000 · ${triggers} Triggers</div>`;
}

function deckEditorHtml(deck) {
  const L = PLAY.byNum.get(deck.leader);
  const n = deckCount(deck);
  const { issues, notLegal } = deckIssues(deck);
  const m = deckMoney(deck);
  const groups = { Character: [], Event: [], Stage: [] };
  for (const [num, q] of Object.entries(deck.cards)) {
    const c = PLAY.byNum.get(num);
    if (c) (groups[c.cat] || groups.Character).push([c, q]);
  }
  const row = ([c, q]) => {
    const have = haveCount(c.num);
    const need = Math.max(0, q - have);
    return `<div class="drow" data-pnum="${c.num}">
      <img loading="lazy" src="${escapeHtml(c.img)}" alt="">
      <div class="drow-q" data-stop>
        <button type="button" data-deck-dec="${c.num}">−</button><b>${q}</b><button type="button" data-deck-inc="${c.num}">+</button>
      </div>
      <div class="drow-name"><b>${escapeHtml(c.name)}</b><span>${c.num} · cost ${c.cost ?? '—'}${c.counter ? ' · +' + c.counter : ''}${c.trigger ? ' · Trigger' : ''}${c.legal ? '' : ' · <em>not legal</em>'}</span></div>
      <div class="drow-own ${need ? 'need' : 'ok'}">${need ? `need ${need}` : '✓ have'}</div>
      <div class="drow-price">${money(c.price)}</div>
    </div>`;
  };
  const sortRows = arr => arr.sort((a, b) => ((a[0].cost ?? 0) - (b[0].cost ?? 0)) || a[0].num.localeCompare(b[0].num));
  const section = (name, arr) => arr.length ? `<div class="dsec"><div class="dsec-h">${name} <span>${arr.reduce((s, x) => s + x[1], 0)}</span></div>${sortRows(arr).map(row).join('')}</div>` : '';
  const leaderNeed = L && haveCount(L.num) < 1;
  return `
    <div class="deck-top">
      <button type="button" class="vbtn" data-pact="back-decks">‹ All decks</button>
      <input class="deck-name" id="deckName" value="${escapeHtml(deck.name)}" aria-label="Deck name" maxlength="60">
    </div>
    <div class="deck-grid">
      <div class="deck-side">
        ${L ? `<div class="deck-leader" data-pnum="${L.num}"><img src="${escapeHtml(L.img)}" alt="${escapeHtml(L.name)}"></div>
        <div class="deck-leader-name">${escapeHtml(L.name)} <span>${L.num} · ${escapeHtml(L.color)}</span>${leaderNeed ? '<em class="need">need</em>' : ''}</div>` : ''}
        <div class="deck-stats">
          <div class="dstat ${n === 50 ? 'good' : ''}"><b>${n}</b><span>/ 50 cards</span></div>
          <div class="dstat ${m.missing ? '' : 'good'}"><b>${m.missing}</b><span>missing</span></div>
          <div class="dstat"><b class="price">${money(m.cost)}</b><span>to finish${m.unpriced ? ` (+${m.unpriced} unpriced)` : ''}</span></div>
        </div>
        <div class="deck-checks">${issues.length ? issues.map(i => `<div class="warn">⚠ ${escapeHtml(i)}</div>`).join('') : '<div class="good">✓ Deck is legal to play</div>'}
          ${notLegal.length ? `<div class="warn">⚠ Not Standard legal (fine for casual / Extra): ${escapeHtml(notLegal.join(', '))}.</div>` : ''}
        </div>
        ${curveHtml(deck)}
        <div class="deck-btns">
          <button type="button" class="vbtn active" data-pact="add-cards">＋ Add cards</button>
          <button type="button" class="vbtn" data-pact="import">⇩ Import</button>
          <button type="button" class="vbtn" data-pact="export">⇧ Copy list</button>
          <button type="button" class="vbtn" data-pact="shopping" ${m.missing ? '' : 'disabled'}>🛒 Copy shopping list</button>
          <button type="button" class="vbtn" data-pact="have-all">✓ I own this deck</button>
          <button type="button" class="reset-btn" data-pact="delete-deck">Delete deck</button>
        </div>
      </div>
      <div class="deck-main">
        ${n ? section('Characters', groups.Character) + section('Events', groups.Event) + section('Stages', groups.Stage)
          : '<div class="play-empty">Empty deck — tap “Add cards” to browse cards in your Leader\'s colors.</div>'}
      </div>
    </div>`;
}

// Decklist text: "4xOP01-016", "4 OP01-016", "OP01-016 x4", "1xOP09-042" (Leader).
function parseDeckList(text) {
  const out = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const m = line.match(/(?:(\d+)\s*x?\s*)?((?:OP|EB|ST|PRB|P)\d{0,2}-\d{3})(?:\s*x\s*(\d+))?/i);
    if (!m) continue;
    out.push([m[2].toUpperCase(), parseInt(m[1] || m[3] || '1', 10)]);
  }
  return out;
}
function deckToText(deck) {
  const lines = deck.leader ? [`1x${deck.leader}`] : [];
  for (const [num, q] of Object.entries(deck.cards).sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`${q}x${num}`);
  return lines.join('\n');
}
function applyDeckList(deck, entries) {
  const unknown = [];
  let leaderSet = false;
  deck.cards = {};
  for (const [num, q] of entries) {
    const c = PLAY.byNum.get(num);
    if (!c) { unknown.push(num); continue; }
    if (c.cat === 'Leader') { if (!leaderSet) { deck.leader = num; leaderSet = true; } continue; }
    deck.cards[num] = Math.min(4, (deck.cards[num] || 0) + q);
  }
  deck.updated = Date.now();
  return unknown;
}

function openImport(forNew) {
  const deck = activeDeck();
  document.getElementById('pmBody').innerHTML = `
    <div class="pm-info pm-import">
      <div class="pm-name">${forNew ? 'Import a decklist' : 'Replace this deck\'s list'}</div>
      <div class="decks-sub">Paste a list like <code>1xOP09-042</code> / <code>4xST25-002</code> — one card per line (the format OPTCG Sim, Limitless and most deck sites export). The Leader line sets the Leader.</div>
      <textarea id="importText" rows="12" placeholder="1xOP09-042&#10;4xST25-001&#10;4xST25-002">${forNew || !deck ? '' : escapeHtml(deckToText(deck))}</textarea>
      <div class="deck-btns"><button type="button" class="vbtn active" data-pact="do-import" data-new="${forNew ? 1 : 0}">Import</button></div>
      <div id="importMsg" class="decks-sub"></div>
    </div>`;
  const bd = document.getElementById('playModal');
  bd.classList.add('active');
  document.body.style.overflow = 'hidden';
  history.pushState({ playModal: 'import' }, '');
}

async function copyText(text, btn, okLabel) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e2) {}
    ta.remove();
  }
  if (btn) { const t = btn.textContent; btn.textContent = okLabel || '✓ Copied'; setTimeout(() => { btn.textContent = t; }, 1800); }
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────
function onPlayAction(act, el) {
  const deck = activeDeck();
  switch (act) {
    case 'new-deck':
      PLAY.pickLeader = true; PLAY.deckId = null;
      PLAY.f = { ...PLAY.f, cat: '', set: '', q: '', fits: true };
      setMode('play', { force: true });
      break;
    case 'cancel-pick':
      PLAY.pickLeader = false; setMode('decks', { force: true }); break;
    case 'pick': newDeckFromLeader(el.dataset.num); break;
    case 'done-adding': setMode('decks', { force: true }); break;
    case 'back-decks': PLAY.deckId = null; renderDecks(); window.scrollTo({ top: 0, behavior: 'instant' }); break;
    case 'add-cards':
      PLAY.f = { ...PLAY.f, cat: '', set: '', q: '', colors: [], fits: true, legal: false };
      setMode('play', { force: true });
      break;
    case 'import': openImport(false); break;
    case 'import-new': openImport(true); break;
    case 'do-import': {
      const entries = parseDeckList(document.getElementById('importText').value);
      if (!entries.length) { document.getElementById('importMsg').textContent = 'No card numbers found.'; return; }
      let d = deck;
      if (el.dataset.new === '1' || !d) {
        d = { id: 'd' + Date.now().toString(36), name: 'Imported deck', leader: '', cards: {}, updated: Date.now() };
        playStore().decks.unshift(d);
      }
      const unknown = applyDeckList(d, entries);
      if (d.name === 'Imported deck' && PLAY.byNum.get(d.leader)) d.name = PLAY.byNum.get(d.leader).name + ' deck';
      PLAY.deckId = d.id;
      savePlayStore();
      closePlayModal();
      renderDecks();
      if (unknown.length) setTimeout(() => alert(`Couldn't find: ${unknown.join(', ')} (not in the English card list yet?)`), 50);
      break;
    }
    case 'export': if (deck) copyText(deckToText(deck), el, '✓ List copied'); break;
    case 'shopping': {
      if (!deck) break;
      const lines = [];
      let total = 0;
      const all = Object.entries(deck.cards).concat(deck.leader ? [[deck.leader, 1]] : []);
      for (const [num, q] of all) {
        const need = Math.max(0, q - haveCount(num));
        if (!need) continue;
        const c = PLAY.byNum.get(num);
        if (c && c.price) total += need * c.price;
        lines.push(`${need}x ${num} ${c ? c.name : ''} — ${c && c.price ? money(c.price) + ' ea' : 'no price'}`);
      }
      lines.push(`Total: ${money(total)} (cheapest TCGplayer market prices)`);
      copyText(`${deck.name} — cards I still need\n` + lines.join('\n'), el, '✓ Shopping list copied');
      break;
    }
    case 'have-all': {
      if (!deck || !confirm('Set "I have" to at least the deck\'s count for every card in this deck?')) break;
      const h = playStore().have;
      for (const [num, q] of Object.entries(deck.cards)) h[num] = Math.max(haveCount(num), q);
      if (deck.leader) h[deck.leader] = Math.max(haveCount(deck.leader), 1);
      savePlayStore(); renderDecks();
      break;
    }
    case 'delete-deck':
      if (!deck || !confirm(`Delete "${deck.name}"?`)) break;
      playStore().decks = playStore().decks.filter(d => d.id !== deck.id);
      PLAY.deckId = null; savePlayStore(); renderDecks();
      break;
    case 'prints': {
      const num = el.dataset.num;
      closePlayModal(true);
      setMode('collection');
      if (LANG !== 'en') setLang('en');
      const s = document.getElementById('search');
      s.value = num;
      document.getElementById('searchWrap').classList.add('has-text');
      setTimeout(render, LANG === 'en' ? 0 : 600);
      break;
    }
  }
}

function initPlay() {
  // mode tabs
  document.querySelectorAll('[data-mode-btn]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.modeBtn === 'decks') { PLAY.pickLeader = false; }
    if (b.dataset.modeBtn === 'play' && PLAY.mode === 'decks') { PLAY.deckId = null; }
    setMode(b.dataset.modeBtn);
  }));
  if (READ_ONLY_SHARE) { const t = document.getElementById('modeTabs'); if (t) t.style.display = 'none'; }

  // filters
  let deb = null;
  document.getElementById('pSearch').addEventListener('input', () => {
    clearTimeout(deb);
    deb = setTimeout(() => { readPlayFilters(); PLAY.shown = PAGE; renderPlay(); }, 250);
  });
  ['pCat', 'pCost', 'pCounter', 'pSet', 'pSort'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { readPlayFilters(); PLAY.shown = PAGE; renderPlay(); }));
  document.getElementById('playFilters').addEventListener('click', e => {
    const col = e.target.closest('[data-pcolor]');
    const tog = e.target.closest('[data-ptoggle]');
    if (col) {
      const v = col.dataset.pcolor, f = PLAY.f;
      f.colors = f.colors.includes(v) ? f.colors.filter(x => x !== v) : f.colors.concat(v);
    } else if (tog) {
      PLAY.f[tog.dataset.ptoggle] = !PLAY.f[tog.dataset.ptoggle];
    } else if (e.target.closest('[data-pact="reset"]')) {
      PLAY.f = { q: '', colors: [], cat: '', cost: '', counter: '', set: '', legal: false, trigger: false, have: false, fits: true, sort: PLAY.f.sort };
    } else if (e.target.closest('#pFiltersToggle')) {
      document.getElementById('playFilters').classList.toggle('open');
      return;
    } else return;
    PLAY.shown = PAGE;
    renderPlay();
  });
  document.getElementById('playMore').addEventListener('click', showMorePlay);

  // one delegated handler for tiles, steppers, decks and the card modal
  document.addEventListener('click', e => {
    if (PLAY.mode === 'collection') return;
    const t = e.target;
    const act = t.closest('[data-pact]');
    if (act && !act.closest('#playFilters')) { e.preventDefault(); onPlayAction(act.dataset.pact, act); return; }
    const inc = t.closest('[data-deck-inc]'), dec = t.closest('[data-deck-dec]');
    if (inc || dec) {
      const num = (inc || dec).dataset[inc ? 'deckInc' : 'deckDec'];
      changeDeck(num, inc ? 1 : -1);
      if (PLAY.mode === 'play') refreshPlayTile(num); else renderDecks();
      if (PLAY.openNum === num) openPlayCard(num, false);
      return;
    }
    const hi = t.closest('[data-have-inc]'), hd = t.closest('[data-have-dec]');
    if (hi || hd) {
      const num = (hi || hd).dataset[hi ? 'haveInc' : 'haveDec'];
      setHave(num, haveCount(num) + (hi ? 1 : -1));
      openPlayCard(num, false);
      if (PLAY.mode === 'play') refreshPlayTile(num); else renderDecks();
      return;
    }
    const od = t.closest('[data-open-deck]');
    if (od) { PLAY.deckId = od.dataset.openDeck; renderDecks(); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
    if (t.closest('[data-stop]')) return;
    const tile = t.closest('[data-pnum]');
    if (tile && !t.closest('#playModal')) {
      const num = tile.dataset.pnum;
      if (PLAY.pickLeader && PLAY.byNum.get(num)?.cat === 'Leader') { newDeckFromLeader(num); return; }
      openPlayCard(num);
      return;
    }
    if (t.id === 'playModal' || t.closest('.pm-close')) closePlayModal();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'deckName') {
      const d = activeDeck();
      if (d) { d.name = e.target.value.trim() || 'Untitled deck'; d.updated = Date.now(); savePlayStore(); }
    }
  });
  window.addEventListener('owned-changed', () => { if (PLAY.loaded) computeOwnedPrints(); });

  // Start in the tab used last (or ?tab=play / ?tab=decks)
  const q = new URLSearchParams(location.search).get('tab');
  let start = q;
  if (!start) { try { start = localStorage.getItem(MODE_KEY); } catch (e) {} }
  if ((start === 'play' || start === 'decks') && !READ_ONLY_SHARE) setMode(start, { force: true });
}

initPlay();
