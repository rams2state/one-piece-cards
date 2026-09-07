// render.js — set overview, set-detail drill-down (history-based back
// navigation), list/grid rendering, filtering/sorting. Mirrors Pokémon's
// render.js structure; adapted for One Piece's flat rarity space and its
// two-section overview (Main Sets vs Starter Decks) instead of Pokémon's
// era-grouped overview.

// ─── LOAD DATA ───────────────────────────────────────────────────────────────
function loadCards(rawCards) {
  ALL_CARDS = rawCards.map(normalizeCard).filter(c => c.setId || c.name);
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
    setView('list');
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
  rarEl.innerHTML = '<option value="">All Rarities</option>' +
    rarities.map(r => `<option value="${r}">${RARITY_DISPLAY[r] || r}</option>`).join('');

  const colors = [...new Set(ALL_CARDS.map(c => c.color).filter(Boolean))].sort();
  const colorEl = document.getElementById('eraFilter'); // reused select — "colorFilter" role
  colorEl.innerHTML = '<option value="">All Colors</option>' +
    colors.map(cl => `<option value="${cl}">${cl}</option>`).join('');
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
  const q = normalizeSearchText(document.getElementById('search').value);
  const color = document.getElementById('eraFilter').value;
  const rarity = document.getElementById('rarityFilter').value;
  const sort = document.getElementById('sortBy').value;

  let cards = ALL_CARDS.filter(c => {
    if (showOwnedOnly && !isOwned(c)) return false;
    if (color && c.color !== color) return false;
    if (rarity && c.rarity !== rarity) return false;
    if (q) {
      const haystack = normalizeSearchText(`${c.name} ${c.set} ${c.rarity} ${c.cardType}`);
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const setGroupKey = c => c.setId || '';

  // Uses the same cardNumSort() as set-detail (see its definition below for
  // why: same-number prints -- base/parallel/alt-art/manga/reprint -- need
  // a deterministic tie-break, not just a raw number compare, so an
  // alt-art print doesn't drift to an unpredictable spot relative to its
  // base print across reloads.
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
    if (sort === 'recent-purchase') {
      return ownedAddedAt(b) - ownedAddedAt(a);
    }
    return 0;
  });

  return cards;
}

let _activeSet = null; // { set } or null — "set" is the Set ID
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

// FIXED 2026-09-06: cardNumSort used to sort purely by the numeric card
// number (e.g. "120" from "OP01-120"), which put every print of the same
// card -- base, parallel, alt-art, manga, reprint -- at the exact same
// sort key. Array.sort() isn't guaranteed stable across engines for a
// tie, so an alt-art print (like OP01-120_p2, "Shanks (Manga) (Alternate
// Art)", $1,532.80) could land ANYWHERE relative to its base print with
// no visual cue explaining why -- caught 2026-09-06 when Jordan couldn't
// find that alt-art in the set view even though it was correctly in the
// CSV the whole time. Now sorts same-number prints deterministically:
// base print first, then by suffix (_p1, _p2, _r1, ...) in order, so
// every print of a card is grouped together and always in the same order
// on every load. Hoisted to module scope (was nested in renderSetDetail)
// so renderTrend/renderFlatList can use the matching printBadge() below.
function cardNumSort(a, b) {
  const parse = id => { const m = (id || '').match(/-(\d+)/); return m ? parseInt(m[1], 10) : 0; };
  const numA = parse(a.cardId), numB = parse(b.cardId);
  if (numA !== numB) return numA - numB;
  const suffix = id => { const m = (id || '').match(/_(p|r)(\d+)$/i); return m ? [m[1].toLowerCase(), parseInt(m[2], 10)] : ['', 0]; };
  const [typeA, ordA] = suffix(a.cardId);
  const [typeB, ordB] = suffix(b.cardId);
  if (typeA !== typeB) return typeA.localeCompare(typeB); // '' (base) sorts before 'p'/'r'
  return ordA - ordB;
}

// Short, unambiguous print-variant label for a list row -- replaces the
// old bare "_p1"/"_p2" suffix on the number badge (which read as
// meaningless noise, not as "this is a different, much rarer print").
function printBadge(c) {
  const m = (c.cardId || '').match(/_(p|r)(\d+)$/i);
  if (!m) return '';
  const name = c.rawName || c.name || '';
  if (/manga/i.test(name)) return 'Manga';
  if (/alternate art/i.test(name)) return 'Alt Art';
  if (/reprint/i.test(name)) return 'Reprint';
  if (c.isSpecial) return 'SP';
  return 'Parallel';
}

function renderTrend(el) {
  const MIN_PRICE = 2.00;
  const withChange = ALL_CARDS
    .map(c => {
      const cv = priceVal(c.price), pv = getPriceNDaysAgo(c.cardId, 7);
      return { ...c, _pv7: pv, _cv: cv };
    })
    .filter(c => c._cv > 0 && c._pv7 !== null && c._pv7 > 0 && Math.max(c._cv, c._pv7) >= MIN_PRICE)
    .map(c => {
      const delta = c._cv - c._pv7;
      const pct = (delta / c._pv7) * 100;
      return { ...c, _delta: delta, _pct: pct, _pv: c._pv7 };
    });

  if (withChange.length === 0) {
    el.innerHTML = `<div class="empty"><div class="display">No price changes yet</div><p>Run the collector daily for at least 7 days to see price movement.</p></div>`;
    return;
  }

  const TOP_N = 25;
  let sorted, title, titleColor, subtitle;
  if (_trendMode === 'gainers') {
    sorted = [...withChange].filter(c => c._delta > 0).sort((a, b) => b._delta - a._delta || b._pct - a._pct).slice(0, TOP_N);
    title = '📈 Top Gainers'; titleColor = '#4ade80';
    subtitle = `Top ${sorted.length} biggest price increases (min $${MIN_PRICE} card)`;
  } else {
    sorted = [...withChange].filter(c => c._delta < 0).sort((a, b) => a._delta - b._delta || a._pct - b._pct).slice(0, TOP_N);
    title = '📉 Top Losers'; titleColor = '#f87171';
    subtitle = `Top ${sorted.length} biggest price decreases (min $${MIN_PRICE} card)`;
  }
  if (sorted.length === 0) {
    el.innerHTML = `<div class="empty"><div class="display">${_trendMode === 'gainers' ? 'No gainers yet' : 'No losers yet'}</div><p>Run the collector daily for at least 7 days to see price movement.</p></div>`;
    return;
  }
  let html = `<div class="trend-section">
    <div class="trend-header">
      <div class="trend-title" style="color:${titleColor};">${title}</div>
      <div class="trend-sub">${subtitle}</div>
    </div>`;
  sorted.forEach((c, i) => {
    const owned = isOwned(c);
    const cdata = JSON.stringify(c).replace(/'/g, '&#39;');
    const key = cardKey(c).replace(/[^a-z0-9]/gi, '_');
    const sign = c._delta >= 0 ? '+' : '';
    const cls = c._delta >= 0 ? 'price-up' : 'price-down';
    const arrow = c._delta >= 0 ? '↑' : '↓';
    const badge = `<span class="price-change ${cls}"><span class="price-change-period">7D</span> ${arrow} ${sign}$${Math.abs(c._delta).toFixed(2)} (${sign}${c._pct.toFixed(1)}%)</span>`;
    const thumbHtml = c.pic ? `<img class="crow-thumb" src="${c.pic}" alt="${c.name || ''}" loading="lazy" referrerpolicy="origin" onerror="this.style.display='none'">` : `<div class="crow-thumb-empty">?</div>`;
    const pBadgeHtml1 = printBadge(c) ? `<span class="crow-print-badge">${printBadge(c)}</span>` : '';
    html += `<div class="card-row${owned ? ' owned' : ''}" id="row-${key}" onclick='openModal(${cdata})'>
      <span class="trend-rank">${i + 1}</span>
      <div class="crow-check${owned ? ' owned' : ''}" onclick='event.stopPropagation();handleToggle(${cdata})'>${owned ? '✓' : ''}</div>
      ${thumbHtml}
      <div style="flex:1;min-width:0;">
        <div class="crow-name">${c.name || '—'}${pBadgeHtml1}</div>
        <div class="crow-set">${c.set}</div>
      </div>
      <div class="crow-price-wrap">
        <span class="crow-price">${c.price !== 'N/A' ? c.price : '—'}</span>${staleWarningIcon(c)}
        <div style="font-size:10px;color:var(--dim);text-align:right;">was $${c._pv.toFixed(2)} (7d ago)</div>
        ${badge}
        ${seventyPercentBadgeHtml(c)}
      </div>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
}

function renderFlatList(cards, el, title) {
  let html = `<div class="trend-section">
    <div class="trend-header">
      <div class="trend-title">${title}</div>
      <div class="trend-sub">${cards.length} card${cards.length !== 1 ? 's' : ''}</div>
    </div>`;
  cards.forEach((c, i) => {
    const owned = isOwned(c);
    const cdata = JSON.stringify(c).replace(/'/g, '&#39;');
    const key = cardKey(c).replace(/[^a-z0-9]/gi, '_');
    const thumbHtml = c.pic ? `<img class="crow-thumb" src="${c.pic}" alt="${c.name || ''}" loading="lazy" referrerpolicy="origin" onerror="this.style.display='none'">` : `<div class="crow-thumb-empty">?</div>`;
    const pBadgeHtml2 = printBadge(c) ? `<span class="crow-print-badge">${printBadge(c)}</span>` : '';
    html += `<div class="card-row${owned ? ' owned' : ''}" id="row-${key}" onclick='openModal(${cdata})'>
      <span class="trend-rank">${i + 1}</span>
      <div class="crow-check${owned ? ' owned' : ''}" onclick='event.stopPropagation();handleToggle(${cdata})'>${owned ? '✓' : ''}</div>
      ${thumbHtml}
      <div style="flex:1;min-width:0;">
        <div class="crow-name">${c.name || '—'}${pBadgeHtml2}</div>
        <div class="crow-set">${c.set}</div>
      </div>
      <div class="crow-price-wrap">
        <span class="crow-price">${c.price !== 'N/A' ? c.price : '—'}</span>${staleWarningIcon(c)}
        ${seventyPercentBadgeHtml(c)}
      </div>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
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
  updateResetBtn();
  const cards = getFiltered();
  const el = document.getElementById('cardView');
  if (cards.length === 0) {
    el.innerHTML = `<div class="empty"><div class="display">No cards found</div><p>Try adjusting your search or filters.</p></div>`;
    _activeSet = null;
    _lastRenderedSet = null;
    return;
  }
  if (currentView === 'grid') {
    _setDetailOrder = null;
    if (_activeSet) {
      const gridCards = cards.filter(c => c.setId === _activeSet.setId);
      _lastRenderedSet = null;
      renderGrid(gridCards.length > 0 ? gridCards : cards, el);
    } else {
      const q = document.getElementById('search').value.trim();
      const colorSel = document.getElementById('eraFilter').value;
      const raritySel = document.getElementById('rarityFilter').value;
      const hasFilter = !!q || !!colorSel || !!raritySel || showOwnedOnly;
      if (!hasFilter) {
        el.innerHTML = `<div class="empty"><div class="display">Search to explore</div><p>Type a card name, set, or color — or apply a filter — to see results in grid view.</p></div>`;
      } else {
        _lastRenderedSet = null;
        const sortValueGrid = document.getElementById('sortBy').value;
        if (FLAT_SORTS.has(sortValueGrid)) {
          renderGridFlat(cards, el, FLAT_SORT_TITLES[sortValueGrid]);
        } else {
          renderGrid(cards, el);
        }
      }
    }
    return;
  }
  if (_trendMode) { _setDetailOrder = null; _lastRenderedSet = null; renderTrend(el); return; }
  const sortValue = document.getElementById('sortBy').value;
  if (FLAT_SORTS.has(sortValue) && !_activeSet) {
    _setDetailOrder = null;
    _lastRenderedSet = null;
    renderFlatList(cards, el, FLAT_SORT_TITLES[sortValue]);
    return;
  }
  if (_activeSet) {
    const setCards = cards.filter(c => c.setId === _activeSet.setId);
    if (setCards.length > 0) {
      const setKey = _activeSet.setId;
      if (_lastRenderedSet === setKey) {
        filterSetDetailInPlace(setCards);
      } else {
        _lastRenderedSet = setKey;
        renderSetDetail(setCards, el);
      }
      return;
    } else {
      _activeSet = null;
      _lastRenderedSet = null;
      _setDetailOrder = null;
    }
  }
  _lastRenderedSet = null;
  _setDetailOrder = null;
  renderSetOverview(cards, el);
}

function filterSetDetailInPlace(visibleCards) {
  const visibleKeys = new Set(visibleCards.map(c => cardKey(c).replace(/[^a-z0-9]/gi, '_')));
  const el = document.getElementById('cardView');
  el.querySelectorAll('.card-row[id^="row-"]').forEach(row => {
    const key = row.id.slice(4);
    row.style.display = visibleKeys.has(key) ? '' : 'none';
  });
  el.querySelectorAll('.rarity-group').forEach(group => {
    const hasVisible = [...group.querySelectorAll('.card-row')].some(r => r.style.display !== 'none');
    group.style.display = hasVisible ? '' : 'none';
  });
}

// ─── SET GROUPING ────────────────────────────────────────────────────────────
// bySet[setId] = { setName, cards: [] }
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
  const rarities = Object.keys(counts).sort((a, b) => rarityRank(a) - rarityRank(b));
  return rarities.map(r => {
    const color = rarityColor(r);
    return `<span class="set-ov-pill" style="background:${color}22;color:${color};">${counts[r]} ${r}</span>`;
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
      const pillsHtml = rarityPillsForCards(data.cards);
      const sidEnc = encodeURIComponent(sid).replace(/'/g, '%27');
      html += `<div class="set-ov-card" onclick="openSetDetail('${sidEnc}')">
        <div class="set-ov-top">
          <span class="set-ov-code">${sid}</span>
          <span class="set-ov-year"></span>
        </div>
        <div class="set-ov-name-row">
          <div class="set-ov-name">${data.setName}</div>
        </div>
        <div class="set-ov-total">${setTotal} card${setTotal !== 1 ? 's' : ''}</div>
        <div class="set-ov-pills">${pillsHtml}</div>
      </div>`;
    }
    html += `</div></div>`;
    return html;
  }

  let html = renderSection('Main Sets', mainSets);
  html += renderSection('Starter Decks', starterSets);
  el.innerHTML = html;
}

function openSetDetail(sidEnc) {
  sessionStorage.setItem('overviewScroll', window.scrollY);
  history.pushState({ setDetail: true }, '');
  _lastRenderedSet = null;
  _activeSet = { setId: decodeURIComponent(sidEnc) };
  render();
  window.scrollTo(0, 0);
}

function renderSetDetail(cards, el) {
  const setId = _activeSet.setId;
  const setName = cards[0]?.set || setId;
  const total = cards.length;

  const byRarity = {};
  for (const c of cards) {
    const r = c.rarity || 'Unknown';
    if (!byRarity[r]) byRarity[r] = [];
    byRarity[r].push(c);
  }
  const rarityOrder = Object.keys(byRarity).sort((a, b) => rarityRank(a) - rarityRank(b));

  let html = `<div class="set-detail-header">
    <button class="set-detail-back" onclick="history.back()">← All Sets</button>
    <div class="set-detail-info">
      <div class="set-detail-era">${setId} · ${total} cards</div>
      <div class="set-detail-name-row">
        <div class="set-detail-name">${setName}</div>
      </div>
    </div>
  </div>`;

  const onScreenOrder = [];
  for (const r of rarityOrder) {
    const rarCards = [...byRarity[r]].sort(cardNumSort);
    const label = RARITY_DISPLAY[r] || r;
    const color = rarityColor(r);
    html += `<div class="rarity-group">
      <div class="rarity-group-header">
        <span class="rarity-group-label" style="color:${color};">${label} (${r})</span>
        <span class="rarity-group-count">(${rarCards.length})</span>
      </div>
      <div class="detail-card-grid">`;
    for (const c of rarCards) {
      onScreenOrder.push(c);
      const owned = isOwned(c);
      const cdata = JSON.stringify(c).replace(/'/g, '&#39;');
      const key = cardKey(c).replace(/[^a-z0-9]/gi, '_');
      const changeBadge = priceChangeBadge(c.price, c.cardId);
      const thumbHtml = c.pic ? `<img class="crow-thumb" src="${c.pic}" alt="${c.name || ''}" loading="lazy" referrerpolicy="origin" onerror="this.style.display='none'">` : `<div class="crow-thumb-empty">?</div>`;
      const pBadge = printBadge(c);
      const pBadgeHtml = pBadge ? `<span class="crow-print-badge">${pBadge}</span>` : '';
      html += `<div class="card-row${owned ? ' owned' : ''}" id="row-${key}" onclick='openModal(${cdata})'>
        <div class="crow-check${owned ? ' owned' : ''}" onclick='event.stopPropagation();handleToggle(${cdata})'>${owned ? '✓' : ''}</div>
        ${thumbHtml}
        <span class="crow-num">${(c.cardId || '').replace(/^[A-Z0-9]+-/, '#').replace(/_(p|r)\d+$/i, '')}</span>
        <span class="crow-name">${c.name || '—'}${pBadgeHtml}</span>
        <div class="crow-price-wrap">
          <span class="crow-price">${c.price !== 'N/A' ? c.price : '—'}</span>${staleWarningIcon(c)}${changeBadge}
          ${seventyPercentBadgeHtml(c)}
        </div>
      </div>`;
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
  for (const c of cards) {
    html += renderTileHtml(c);
  }
  html += `</div></div>`;
  el.innerHTML = html;
}

function renderTileHtml(c) {
  const owned = isOwned(c);
  const cdata = JSON.stringify(c).replace(/'/g, '&#39;');
  const key = cardKey(c).replace(/[^a-z0-9]/gi, '_');
  const changeBadge = priceChangeBadge(c.price, c.cardId);
  const imgSrc = c.pic || '';
  const imgTag = imgSrc
    ? `<img src="${imgSrc}" alt="${c.name || ''}" loading="lazy" referrerpolicy="origin" onerror="this.style.background='var(--panel2)';this.removeAttribute('src')">`
    : `<div style="aspect-ratio:2.5/3.5;background:var(--panel2);display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:12px;">No Image</div>`;
  return `<div class="card-tile${owned ? ' owned' : ''}" id="tile-${key}" onclick='openModal(${cdata})'>
      ${imgTag}
      <div class="tile-check" onclick='event.stopPropagation();handleToggle(${cdata})'>${owned ? '✓' : ''}</div>
      <div class="tile-info">
        <div class="tile-name" title="${c.name || ''}">${c.name || '—'}${printBadge(c) ? `<span class="crow-print-badge">${printBadge(c)}</span>` : ''}</div>
        <div class="tile-set" title="${c.set}">${c.set}</div>
        <div class="tile-footer">
          <div class="tile-price-row"><span class="tile-price">${c.price !== 'N/A' ? c.price : '—'}</span>${staleWarningIcon(c)}${seventyPercentBadgeHtml(c)}${changeBadge}</div>
        </div>
      </div>
    </div>`;
}

function renderGrid(cards, el) {
  const { bySet, setOrder } = buildSetGroups(cards);
  let html = '';
  for (const sid of setOrder) {
    const data = bySet[sid];
    html += `<div class="era-section">
      <div class="era-header">
        <div class="era-title">${data.setName}</div>
        <div class="era-count">${data.cards.length} card${data.cards.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="card-grid">`;
    for (const c of data.cards) {
      html += renderTileHtml(c);
    }
    html += `</div></div>`;
  }
  el.innerHTML = html;
}

function handleToggle(c) {
  const justAdded = toggleOwned(c);
  const key = cardKey(c).replace(/[^a-z0-9]/gi, '_');
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
