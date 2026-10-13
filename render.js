// render.js — set overview, set-detail drill-down (history-based back
// navigation), list/grid rendering, filtering/sorting.
//
// REBUILT 2026-10-13 for speed: every row and tile used to carry TWO full
// JSON copies of its card inside inline onclick='...' attributes (several
// MB of HTML for ~1,300 cards, re-parsed on every click). Rows now carry
// only a short data-key; one delegated click listener on #cardView looks
// the card up in CARD_BY_KEY. Same markup/classes otherwise, so the look
// is unchanged.

// ─── LOAD DATA ───────────────────────────────────────────────────────────────
function loadCards(cards) {
  ALL_CARDS = cards.filter(c => c.setId || c.name);
  CARD_BY_KEY = new Map(ALL_CARDS.map(c => [domKey(c), c]));
  updateStats();
  populateFilters();
  document.getElementById('toolbar').style.display = '';
  document.getElementById('noDataState').style.display = 'none';
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('cardView').style.display = '';
  updateCollectionValue();
  showQuickRow();
  if (READ_ONLY_SHARE) {
    if (!showOwnedOnly) toggleOwnedFilter();
    setView('grid');
  } else {
    setView(currentView || 'list');
  }
}

// ─── READ-ONLY SHARE UI ──────────────────────────────────────────────────────
function applyReadOnlyShareUI() {
  const headerBtnRow = document.getElementById('headerBtnRow');
  if (headerBtnRow) headerBtnRow.style.display = 'none';
  const versionReadOnly = document.getElementById('appVersionReadOnly');
  if (versionReadOnly) versionReadOnly.textContent = 'v' + APP_VERSION;
  document.body.classList.add('read-only-share');
}
window.applyReadOnlyShareUI = applyReadOnlyShareUI;

function updateStats() {
  document.getElementById('statCards').textContent = ALL_CARDS.length.toLocaleString();
}

function populateFilters() {
  const rarities = [...new Set(ALL_CARDS.map(c => c.rarity).filter(Boolean))]
    .sort((a, b) => rarityRank(a) - rarityRank(b));
  const rarEl = document.getElementById('rarityFilter');
  const prevRar = rarEl.value;
  rarEl.innerHTML = '<option value="">All Rarities</option>' +
    rarities.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(RARITY_DISPLAY[r] || r)}</option>`).join('');
  rarEl.value = rarities.includes(prevRar) ? prevRar : '';

  // Colors only exist in the English data; the Japanese side uses this
  // same dropdown as a "print type" filter instead.
  const colorEl = document.getElementById('eraFilter'); // reused select — "colorFilter" role
  if (isJP()) {
    const order = ['base', 'alt', 'superalt', 'manga', 'sp', 'tr', 'pandaman', 'don', 'other'];
    const label = { base: 'Regular print', alt: 'Alt Art', superalt: 'Super Alt Art', manga: 'Manga',
                    sp: 'SP', tr: 'TR', pandaman: 'Pandaman', don: 'DON!!', other: 'Other' };
    const present = new Set(ALL_CARDS.map(c => c.variant));
    colorEl.innerHTML = '<option value="">All Prints</option>' +
      order.filter(v => present.has(v)).map(v => `<option value="${v}">${label[v]}</option>`).join('');
  } else {
    const colors = [...new Set(ALL_CARDS.map(c => c.color).filter(Boolean))].sort();
    colorEl.innerHTML = '<option value="">All Colors</option>' +
      colors.map(cl => `<option value="${escapeHtml(cl)}">${escapeHtml(cl)}</option>`).join('');
  }
  colorEl.value = '';
  syncMobileFilters();
}

function isFiltersActive() {
  const search = document.getElementById('search').value;
  const color = document.getElementById('eraFilter').value;
  const rarity = document.getElementById('rarityFilter').value;
  const sort = document.getElementById('sortBy').value;
  return search || color || rarity || sort !== 'date-asc' || showOwnedOnly || !!_trendMode;
}

function updateResetBtn() {
  const show = isFiltersActive();
  ['resetBtn', 'resetBtnM'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = show ? '1' : '0.4';
    el.style.borderColor = show ? '#f87171' : '';
    el.style.color = show ? '#f87171' : '';
    el.style.background = show ? '#f8717112' : '';
  });
}

function showQuickRow() {
  const qr = document.getElementById('quickRow');
  if (qr) qr.classList.add('visible');
}

function resetFilters() {
  document.getElementById('search').value = '';
  document.getElementById('searchWrap').classList.remove('has-text');
  document.getElementById('eraFilter').value = '';
  document.getElementById('rarityFilter').value = '';
  document.getElementById('sortBy').value = 'date-asc';
  ['eraFilterM', 'rarityFilterM', 'sortByM'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'sortByM' ? 'date-asc' : '';
  });
  if (showOwnedOnly && !READ_ONLY_SHARE) toggleOwnedFilter();
  if (_trendMode) {
    _trendMode = null;
    ['btnGainers', 'btnDrops', 'btnGainersM', 'btnDropsM'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active-gainers', 'active-drops');
    });
    updateNowBtn();
  }
  if (currentView === 'grid' && !READ_ONLY_SHARE) applyViewState('list');
  updateResetBtn();
  if (_activeSet) {
    history.back();
  } else {
    render();
  }
}

// ─── FILTER + SORT ───────────────────────────────────────────────────────────
const normalizeSearchText = s => (s || '').toLowerCase();

function getFiltered() {
  const q = normalizeSearchText(document.getElementById('search').value.trim());
  const colorOrPrint = document.getElementById('eraFilter').value;
  const rarity = document.getElementById('rarityFilter').value;
  const sort = document.getElementById('sortBy').value;
  const owned = showOwnedOnly ? getOwnedMap() : null;

  let cards = ALL_CARDS.filter(c => {
    if (owned && !owned[cardKey(c)]) return false;
    if (colorOrPrint && (isJP() ? c.variant : c.color) !== colorOrPrint) return false;
    if (rarity && c.rarity !== rarity) return false;
    if (q) {
      if (!c._hay) c._hay = normalizeSearchText(`${c.rawName || c.name} ${c.set} ${c.setId} ${c.rarity} ${c.cardType} ${c.cardId}`);
      if (!c._hay.includes(q)) return false;
    }
    return true;
  });

  const setGroupKey = c => c.setId || '';
  cards.sort((a, b) => {
    if (sort === 'date-asc') {
      return setSortIndex(a.setId) - setSortIndex(b.setId)
        || setGroupKey(a).localeCompare(setGroupKey(b))
        || cardNumSort(a, b);
    }
    if (sort === 'date-desc') {
      return setSortIndex(b.setId) - setSortIndex(a.setId)
        || setGroupKey(b).localeCompare(setGroupKey(a))
        || cardNumSort(b, a);
    }
    if (sort === 'price-desc') return priceVal(b.price) - priceVal(a.price);
    if (sort === 'price-asc') {
      const av = priceVal(a.price), bv = priceVal(b.price);
      if (av < 0 && bv < 0) return 0;
      if (av < 0) return 1;
      if (bv < 0) return -1;
      return av - bv;
    }
    if (sort === 'recent-purchase') return ownedAddedAt(b) - ownedAddedAt(a);
    return 0;
  });

  return cards;
}

let _activeSet = null; // { setId } or null
let _trendMode = null;

function toggleNow() {
  if (!_trendMode) setTrend('gainers');
  else if (_trendMode === 'gainers') setTrend('drops');
  else setTrend(null);
}

function updateNowBtn() {
  ['btnNow', 'btnNowDesktop'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (_trendMode === 'gainers') {
      btn.textContent = '📈 Gainers'; btn.classList.add('active-gainers'); btn.classList.remove('active-drops');
    } else if (_trendMode === 'drops') {
      btn.textContent = '📉 Losers'; btn.classList.add('active-drops'); btn.classList.remove('active-gainers');
    } else {
      btn.textContent = '⚡ Now'; btn.classList.remove('active-gainers', 'active-drops');
    }
  });
}

function setTrend(mode) {
  if (mode === null || _trendMode === mode) {
    _trendMode = null;
    ['btnGainers', 'btnDrops', 'btnGainersM', 'btnDropsM'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active-gainers', 'active-drops');
    });
  } else {
    _trendMode = mode;
    _activeSet = null;
    if (currentView === 'grid') applyViewState('list');
    ['btnGainers', 'btnGainersM'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('active-gainers', mode === 'gainers');
      el.classList.remove('active-drops');
    });
    ['btnDrops', 'btnDropsM'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('active-drops', mode === 'drops');
      el.classList.remove('active-gainers');
    });
  }
  updateNowBtn();
  render();
}

// Same-number prints (base, parallel, alt-art, manga, reprint) sort
// deterministically: base first, then by suffix (_p1, _p2, _r1...), so
// every print of a card is grouped and always in the same order.
function cardNumSort(a, b) {
  const parse = id => { const m = (id || '').match(/-(\d+)/); return m ? parseInt(m[1], 10) : 0; };
  const numA = parse(a.cardId), numB = parse(b.cardId);
  if (numA !== numB) return numA - numB;
  const suffix = id => { const m = (id || '').match(/_(p|r)(\d+)$/i); return m ? [m[1].toLowerCase(), parseInt(m[2], 10)] : ['', 0]; };
  const [typeA, ordA] = suffix(a.cardId);
  const [typeB, ordB] = suffix(b.cardId);
  if (typeA !== typeB) return typeA.localeCompare(typeB);
  if (ordA !== ordB) return ordA - ordB;
  return (a.rawName || '').localeCompare(b.rawName || '');
}

// Short print-variant label for a row ("Alt Art", "Manga", ...).
function printBadge(c) {
  if (c.lang === 'jp') {
    return { alt: 'Alt Art', superalt: 'Super Alt', manga: 'Manga', sp: 'SP', tr: 'TR',
             pandaman: 'Pandaman', other: 'Special' }[c.variant] || '';
  }
  const m = (c.cardId || '').match(/_(p|r)(\d+)$/i);
  if (!m) return '';
  const name = c.rawName || c.name || '';
  if (/super alternate|super leader/i.test(name)) return 'Super Alt';
  if (/manga/i.test(name)) return 'Manga';
  if (/alternate art/i.test(name)) return 'Alt Art';
  if (/reprint/i.test(name)) return 'Reprint';
  if (c.isSpecial) return 'SP';
  return 'Parallel';
}

// ─── SHARED ROW / TILE MARKUP ────────────────────────────────────────────────
function thumbHtml(c) {
  return c.pic
    ? `<img class="crow-thumb" src="${escapeHtml(c.pic)}" alt="" loading="lazy" decoding="async" referrerpolicy="origin" onerror="this.style.display='none'">`
    : `<div class="crow-thumb-empty">?</div>`;
}
function badgeHtml(c) {
  const b = printBadge(c);
  return b ? `<span class="crow-print-badge">${b}</span>` : '';
}
function priceText(c) { return c.price !== 'N/A' ? c.price : '—'; }

// "#022" for a card from the set being viewed; the full number for a
// reprint from another set (e.g. an EB04 SP inside a Japanese OP-17 list).
function shortNum(c) {
  const num = (c.cardId || '').replace(/_(p|r)\d+$/i, '');
  if (c.lang === 'jp' && !num.startsWith((c.setId || '').replace('-', ''))) return num;
  return num.replace(/^[A-Z0-9]+-/, '#');
}

// opts: { rank, numCol, extraPriceHtml, showChange }
function rowHtml(c, opts = {}) {
  const owned = isOwned(c);
  const key = domKey(c);
  const mid = opts.numCol
    ? `<span class="crow-num">${escapeHtml(shortNum(c))}</span>
       <span class="crow-name">${escapeHtml(c.name || '—')}${badgeHtml(c)}</span>`
    : `<div style="flex:1;min-width:0;">
        <div class="crow-name">${escapeHtml(c.name || '—')}${badgeHtml(c)}</div>
        <div class="crow-set">${escapeHtml(c.set)}</div>
      </div>`;
  return `<div class="card-row${owned ? ' owned' : ''}" id="row-${key}" data-key="${key}">
      ${opts.rank ? `<span class="trend-rank">${opts.rank}</span>` : ''}
      <div class="crow-check${owned ? ' owned' : ''}" data-act="own">${owned ? '✓' : ''}</div>
      ${thumbHtml(c)}
      ${mid}
      <div class="crow-price-wrap">
        <span class="crow-price">${priceText(c)}</span>${staleWarningIcon(c)}${opts.showChange ? priceChangeBadge(c) : ''}
        ${opts.extraPriceHtml || ''}
        ${jpMarketLine(c)}
        ${seventyPercentBadgeHtml(c)}
      </div>
    </div>`;
}

function renderTileHtml(c) {
  const owned = isOwned(c);
  const key = domKey(c);
  const imgTag = c.pic
    ? `<img src="${escapeHtml(c.pic)}" alt="" loading="lazy" decoding="async" referrerpolicy="origin" onerror="this.style.background='var(--panel2)';this.removeAttribute('src')">`
    : `<div style="aspect-ratio:2.5/3.5;background:var(--panel2);display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px;">No Image</div>`;
  return `<div class="card-tile${owned ? ' owned' : ''}" id="tile-${key}" data-key="${key}">
      ${imgTag}
      <div class="tile-check" data-act="own">${owned ? '✓' : ''}</div>
      <div class="tile-info">
        <div class="tile-name" title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '—')}${badgeHtml(c)}</div>
        <div class="tile-set" title="${escapeHtml(c.set)}">${escapeHtml(c.set)}</div>
        <div class="tile-footer">
          <div class="tile-price-row"><span class="tile-price">${priceText(c)}</span>${staleWarningIcon(c)}${seventyPercentBadgeHtml(c)}${priceChangeBadge(c)}</div>
          ${jpMarketLine(c, 'jp-market jp-market--tile')}
        </div>
      </div>
    </div>`;
}

// One listener for every row, tile, owned-check and set tile in the view.
document.getElementById('cardView').addEventListener('click', e => {
  const setTile = e.target.closest('[data-set]');
  if (setTile) { openSetDetail(setTile.dataset.set); return; }
  const host = e.target.closest('[data-key]');
  if (!host) return;
  const c = CARD_BY_KEY.get(host.dataset.key);
  if (!c) return;
  if (e.target.closest('[data-act="own"]')) handleToggle(c);
  else openModal(c);
});

// ─── TREND (GAINERS / LOSERS) ────────────────────────────────────────────────
function renderTrend(el) {
  const MIN_PRICE = 2.00;
  const withChange = [];
  for (const c of getFiltered()) {
    const cv = priceVal(c.price), pv = getPriceNDaysAgo(c);
    if (cv > 0 && pv !== null && Math.max(cv, pv) >= MIN_PRICE) {
      withChange.push({ c, delta: cv - pv, pct: (cv - pv) / pv * 100, pv });
    }
  }
  const emptyMsg = t => `<div class="empty"><div class="display">${t}</div><p>Prices need about a week of daily runs before movement shows up.</p></div>`;
  if (withChange.length === 0) { el.innerHTML = emptyMsg('No price changes yet'); return; }
  const TOP_N = 25;
  let sorted, title, titleColor, subtitle;
  if (_trendMode === 'gainers') {
    sorted = withChange.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta || b.pct - a.pct).slice(0, TOP_N);
    title = '📈 Top Gainers'; titleColor = '#4ade80';
    subtitle = `Top ${sorted.length} biggest price increases (min $${MIN_PRICE} card)`;
  } else {
    sorted = withChange.filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta || a.pct - b.pct).slice(0, TOP_N);
    title = '📉 Top Losers'; titleColor = '#f87171';
    subtitle = `Top ${sorted.length} biggest price decreases (min $${MIN_PRICE} card)`;
  }
  if (sorted.length === 0) { el.innerHTML = emptyMsg(_trendMode === 'gainers' ? 'No gainers yet' : 'No losers yet'); return; }
  _setDetailOrder = sorted.map(x => x.c);
  let html = `<div class="trend-section">
    <div class="trend-header">
      <div class="trend-title" style="color:${titleColor};">${title}</div>
      <div class="trend-sub">${subtitle}</div>
    </div>`;
  sorted.forEach((x, i) => {
    const sign = x.delta >= 0 ? '+' : '';
    const cls = x.delta >= 0 ? 'price-up' : 'price-down';
    const arrow = x.delta >= 0 ? '↑' : '↓';
    const extra = `<div style="font-size:10px;color:var(--dim);text-align:right;">was $${x.pv.toFixed(2)} (7d ago)</div>
      <span class="price-change ${cls}"><span class="price-change-period">7D</span> ${arrow} ${sign}$${Math.abs(x.delta).toFixed(2)} (${sign}${x.pct.toFixed(1)}%)</span>`;
    html += rowHtml(x.c, { rank: i + 1, extraPriceHtml: extra });
  });
  el.innerHTML = html + `</div>`;
}

// Long flat lists (e.g. "price high to low" over every card) are capped so
// the page stays fast; search or filter to narrow further.
const FLAT_CAP = 300;
function capNote(total) {
  return total > FLAT_CAP
    ? `<div class="empty" style="padding:18px 0;"><p>Showing the top ${FLAT_CAP} of ${total}. Search or filter to narrow it down.</p></div>`
    : '';
}

function renderFlatList(cards, el, title) {
  _setDetailOrder = cards.slice(0, FLAT_CAP);
  let html = `<div class="trend-section">
    <div class="trend-header">
      <div class="trend-title">${title}</div>
      <div class="trend-sub">${cards.length} card${cards.length !== 1 ? 's' : ''}</div>
    </div>`;
  _setDetailOrder.forEach((c, i) => { html += rowHtml(c, { rank: i + 1 }); });
  el.innerHTML = html + capNote(cards.length) + `</div>`;
}

const FLAT_SORTS = new Set(['price-desc', 'price-asc', 'recent-purchase']);
const FLAT_SORT_TITLES = {
  'price-desc': 'Price: High to Low',
  'price-asc': 'Price: Low to High',
  'recent-purchase': 'Recent Purchases',
};

let _renderPending = false;
let _lastRenderedSet = null;
function render() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(_doRender);
}
function _doRender() {
  _renderPending = false;
  if (!ALL_CARDS.length) return;
  updateResetBtn();
  const el = document.getElementById('cardView');
  if (_trendMode && currentView !== 'grid') { _lastRenderedSet = null; renderTrend(el); return; }
  const cards = getFiltered();
  if (cards.length === 0) {
    el.innerHTML = `<div class="empty"><div class="display">No cards found</div><p>Try adjusting your search or filters.</p></div>`;
    _activeSet = null;
    _lastRenderedSet = null;
    return;
  }
  if (currentView === 'grid') {
    _setDetailOrder = null;
    _lastRenderedSet = null;
    if (_activeSet) {
      const gridCards = cards.filter(c => c.setId === _activeSet.setId);
      renderGrid(gridCards.length > 0 ? gridCards : cards, el);
    } else {
      const q = document.getElementById('search').value.trim();
      const hasFilter = !!q || !!document.getElementById('eraFilter').value ||
        !!document.getElementById('rarityFilter').value || showOwnedOnly;
      if (!hasFilter) {
        el.innerHTML = `<div class="empty"><div class="display">Search to explore</div><p>Type a card name, number or set — or apply a filter — to see results in grid view.</p></div>`;
      } else {
        const sortValueGrid = document.getElementById('sortBy').value;
        if (FLAT_SORTS.has(sortValueGrid)) renderGridFlat(cards, el, FLAT_SORT_TITLES[sortValueGrid]);
        else renderGrid(cards, el);
      }
    }
    return;
  }
  const sortValue = document.getElementById('sortBy').value;
  if (FLAT_SORTS.has(sortValue) && !_activeSet) {
    _lastRenderedSet = null;
    renderFlatList(cards, el, FLAT_SORT_TITLES[sortValue]);
    return;
  }
  if (_activeSet) {
    const setCards = cards.filter(c => c.setId === _activeSet.setId);
    if (setCards.length > 0) {
      const setKey = LANG + ':' + _activeSet.setId;
      if (_lastRenderedSet === setKey) {
        filterSetDetailInPlace(setCards);
      } else {
        _lastRenderedSet = setKey;
        renderSetDetail(setCards, el);
      }
      return;
    }
    _activeSet = null;
  }
  _lastRenderedSet = null;
  _setDetailOrder = null;
  renderSetOverview(cards, el);
}

function filterSetDetailInPlace(visibleCards) {
  const visibleKeys = new Set(visibleCards.map(domKey));
  const el = document.getElementById('cardView');
  el.querySelectorAll('.card-row[data-key]').forEach(row => {
    row.style.display = visibleKeys.has(row.dataset.key) ? '' : 'none';
  });
  el.querySelectorAll('.rarity-group').forEach(group => {
    const hasVisible = [...group.querySelectorAll('.card-row')].some(r => r.style.display !== 'none');
    group.style.display = hasVisible ? '' : 'none';
  });
}

// Re-applies owned checkmarks to whatever is on screen (used after a
// remote sync changes the owned list).
function refreshOwnedMarks() {
  document.querySelectorAll('#cardView [data-key]').forEach(host => {
    const c = CARD_BY_KEY.get(host.dataset.key);
    if (c) markOwned(c);
  });
}

// ─── SET GROUPING ────────────────────────────────────────────────────────────
function buildSetGroups(cards) {
  const bySet = {};
  const setOrder = [];
  for (const c of cards) {
    const sid = c.setId || 'Unknown';
    if (!bySet[sid]) { bySet[sid] = { setName: c.set, cards: [] }; setOrder.push(sid); }
    bySet[sid].cards.push(c);
  }
  setOrder.sort((a, b) => setSortIndex(a) - setSortIndex(b));
  return { bySet, setOrder };
}

function rarityPillsForCards(cards) {
  const counts = {};
  for (const c of cards) {
    const r = c.rarity || 'Unknown';
    counts[r] = (counts[r] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => rarityRank(a) - rarityRank(b)).map(r => {
    const color = rarityColor(r);
    return `<span class="set-ov-pill" style="background:${color}22;color:${color};">${counts[r]} ${escapeHtml(r)}</span>`;
  }).join('');
}

function renderSetOverview(cards, el) {
  const { bySet, setOrder } = buildSetGroups(cards);
  const mainSets = setOrder.filter(sid => !isStarterSet(sid));
  const starterSets = setOrder.filter(sid => isStarterSet(sid));

  function renderSection(title, sets) {
    if (sets.length === 0) return '';
    const total = sets.reduce((sum, sid) => sum + bySet[sid].cards.length, 0);
    let html = `<div class="era-section">
      <div class="era-header">
        <div class="era-title">${title}</div>
        <div class="era-count">${total} card${total !== 1 ? 's' : ''}</div>
      </div>
      <div class="set-overview-grid">`;
    for (const sid of sets) {
      const data = bySet[sid];
      const setTotal = data.cards.length;
      html += `<div class="set-ov-card" data-set="${escapeHtml(sid)}">
        <div class="set-ov-top">
          <span class="set-ov-code">${escapeHtml(sid)}</span>
          <span class="set-ov-year"></span>
        </div>
        <div class="set-ov-name-row">
          <div class="set-ov-name">${escapeHtml(data.setName)}</div>
        </div>
        <div class="set-ov-total">${setTotal} card${setTotal !== 1 ? 's' : ''}</div>
        <div class="set-ov-pills">${rarityPillsForCards(data.cards)}</div>
      </div>`;
    }
    return html + `</div></div>`;
  }

  el.innerHTML = renderSection(isJP() ? 'Japanese Sets' : 'Main Sets', mainSets) +
                 renderSection('Starter Decks', starterSets);
}

function openSetDetail(setId) {
  sessionStorage.setItem('overviewScroll', window.scrollY);
  history.pushState({ setDetail: true }, '');
  _lastRenderedSet = null;
  _activeSet = { setId };
  render();
  window.scrollTo(0, 0);
}

function renderSetDetail(cards, el) {
  const setId = _activeSet.setId;
  const setName = cards[0]?.set || setId;
  const byRarity = {};
  for (const c of cards) {
    const r = c.rarity || 'Unknown';
    (byRarity[r] = byRarity[r] || []).push(c);
  }
  const rarityOrder = Object.keys(byRarity).sort((a, b) => rarityRank(a) - rarityRank(b));

  let html = `<div class="set-detail-header">
    <button class="set-detail-back" onclick="history.back()">← All Sets</button>
    <div class="set-detail-info">
      <div class="set-detail-era">${escapeHtml(setId)} · ${cards.length} cards</div>
      <div class="set-detail-name-row">
        <div class="set-detail-name">${escapeHtml(setName)}</div>
      </div>
    </div>
  </div>`;

  const onScreenOrder = [];
  for (const r of rarityOrder) {
    const rarCards = [...byRarity[r]].sort(cardNumSort);
    const color = rarityColor(r);
    html += `<div class="rarity-group">
      <div class="rarity-group-header">
        <span class="rarity-group-label" style="color:${color};">${escapeHtml(RARITY_DISPLAY[r] || r)} (${escapeHtml(r)})</span>
        <span class="rarity-group-count">(${rarCards.length})</span>
      </div>
      <div class="detail-card-grid">`;
    for (const c of rarCards) {
      onScreenOrder.push(c);
      html += rowHtml(c, { numCol: true, showChange: true });
    }
    html += `</div></div>`;
  }
  _setDetailOrder = onScreenOrder;
  el.innerHTML = html;
}

function renderGridFlat(cards, el, title) {
  let html = `<div class="era-section">
      <div class="era-header">
        <div class="era-title">${title}</div>
        <div class="era-count">${cards.length} card${cards.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="card-grid">`;
  for (const c of cards.slice(0, FLAT_CAP)) html += renderTileHtml(c);
  el.innerHTML = html + `</div>` + capNote(cards.length) + `</div>`;
}

function renderGrid(cards, el) {
  const { bySet, setOrder } = buildSetGroups(cards);
  let html = '';
  for (const sid of setOrder) {
    const data = bySet[sid];
    html += `<div class="era-section">
      <div class="era-header">
        <div class="era-title">${escapeHtml(data.setName)}</div>
        <div class="era-count">${data.cards.length} card${data.cards.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="card-grid">`;
    for (const c of data.cards) html += renderTileHtml(c);
    html += `</div></div>`;
  }
  el.innerHTML = html;
}

function markOwned(c) {
  const key = domKey(c);
  const owned = isOwned(c);
  const row = document.getElementById('row-' + key);
  if (row) {
    row.classList.toggle('owned', owned);
    const chk = row.querySelector('.crow-check');
    if (chk) { chk.textContent = owned ? '✓' : ''; chk.classList.toggle('owned', owned); }
  }
  const tile = document.getElementById('tile-' + key);
  if (tile) {
    tile.classList.toggle('owned', owned);
    const chk = tile.querySelector('.tile-check');
    if (chk) chk.textContent = owned ? '✓' : '';
  }
}

function handleToggle(c) {
  const justAdded = toggleOwned(c);
  markOwned(c);
  if (justAdded) {
    openModal(c);
    showPurchasePrompt();
  }
}

function handleSortChange() {
  const sortValue = document.getElementById('sortBy').value;
  if (sortValue === 'recent-purchase' && !showOwnedOnly) {
    showOwnedOnly = true;
    document.getElementById('statOwnedBox').classList.toggle('active', true);
  }
  render();
}

// ─── MOBILE FILTER DRAWER ────────────────────────────────────────────────────
function toggleFilterDrawer() {
  const drawer = document.getElementById('filterDrawer');
  const btn = document.getElementById('filterToggleBtn');
  const open = drawer.classList.toggle('open');
  btn.classList.toggle('active', open);
  btn.textContent = open ? '✕ Close' : '⚙ Filters';
}

function syncMobileFilters() {
  const desktopColor = document.getElementById('eraFilter');
  document.getElementById('eraFilterM').innerHTML = desktopColor ? desktopColor.innerHTML : '';
  const desktopRar = document.getElementById('rarityFilter');
  document.getElementById('rarityFilterM').innerHTML = desktopRar ? desktopRar.innerHTML : '';
}

function applyViewState(v) {
  currentView = v;
  ['btnList', 'btnGrid', 'btnListM', 'btnGridM', 'btnListQ', 'btnGridQ'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', id.startsWith(v === 'list' ? 'btnList' : 'btnGrid'));
  });
}

function setView(v) {
  _trendMode = null;
  applyViewState(v);
  updateNowBtn();
  const gEl = document.getElementById('btnGainers');
  const dEl = document.getElementById('btnDrops');
  if (gEl) gEl.classList.remove('active-gainers');
  if (dEl) dEl.classList.remove('active-drops');
  render();
}
