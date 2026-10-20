// app.js — bootstrapping, popstate/back-button handling, keyboard/swipe
// gestures, CSV auto-load. Mirrors Pokémon's app.js closely.

document.getElementById('modalBackdrop').addEventListener('click', function(e) {
  if (e.target === this) {
    history.back();
  }
});

window.addEventListener('popstate', function(e) {
  const isModalOpen = document.getElementById('modalBackdrop').classList.contains('active');
  if (isModalOpen) {
    closeModal(true);
    return;
  }
  if (_activeSet) {
    _activeSet = null;
    _lastRenderedSet = null;
    _trendMode = null;
    if (currentView === 'grid') applyViewState('list');
    const y = parseInt(sessionStorage.getItem('overviewScroll') || '0', 10);
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' });
    }));
    return;
  }
  if (_trendMode) {
    _trendMode = null;
    ['btnGainers', 'btnGainersM', 'btnDrops', 'btnDropsM'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active-gainers', 'active-drops');
    });
    render();
  }
});

window.addEventListener('pageshow', function() {
  const y = parseInt(sessionStorage.getItem('binderScroll') || '0', 10);
  if (y > 0) window.scrollTo({ top: y, behavior: 'instant' });
});

document.addEventListener('keydown', e => {
  const open = document.getElementById('modalBackdrop').classList.contains('active');
  if (e.key === 'Escape') { history.back(); return; }
  if (open && e.key === 'ArrowRight') { e.preventDefault(); modalNav(1); }
  if (open && e.key === 'ArrowLeft') { e.preventDefault(); modalNav(-1); }
});

(function() {
  const backdrop = document.getElementById('modalBackdrop');
  let _mx = null, _my = null;
  const SWIPE_MIN = 50, SWIPE_RATIO = 1.5;
  const SWIPE_DOWN_MIN = 80;
  backdrop.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { _mx = null; return; }
    _mx = e.touches[0].clientX;
    _my = e.touches[0].clientY;
  }, { passive: true });
  backdrop.addEventListener('touchend', e => {
    if (_mx === null) return;
    const dx = e.changedTouches[0].clientX - _mx;
    const dy = e.changedTouches[0].clientY - _my;
    _mx = null;
    if (dy > SWIPE_DOWN_MIN && Math.abs(dy) > Math.abs(dx)) {
      history.back();
      return;
    }
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) / (Math.abs(dy) || 1) < SWIPE_RATIO) return;
    if (dx < 0) modalNav(1);
    else modalNav(-1);
  }, { passive: true });
})();

// ─── SEARCH / FILTER EVENTS ──────────────────────────────────────────────────
let _searchDebounce = null;
document.getElementById('search').addEventListener('input', function() {
  document.getElementById('searchWrap').classList.toggle('has-text', !!this.value);
  clearTimeout(_searchDebounce);
  const val = this.value;
  setTimeout(() => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(render, 300);
  }, 0);
});
document.getElementById('clearSearch').addEventListener('click', function() {
  document.getElementById('search').value = '';
  document.getElementById('searchWrap').classList.remove('has-text');
  render();
});
['eraFilter', 'printFilter', 'rarityFilter'].forEach(id =>
  document.getElementById(id).addEventListener('change', render)
);
document.getElementById('sortBy').addEventListener('change', handleSortChange);

[['eraFilter', 'eraFilterM'], ['printFilter', 'printFilterM'], ['rarityFilter', 'rarityFilterM'], ['sortBy', 'sortByM']].forEach(([desk, mob]) => {
  document.getElementById(mob).addEventListener('change', function() {
    document.getElementById(desk).value = this.value;
    if (desk === 'sortBy') handleSortChange();
    else render();
  });
  document.getElementById(desk).addEventListener('change', function() {
    document.getElementById(mob).value = this.value;
  });
});

// ─── DATA LOADING ─────────────────────────────────────────────────────────────
// REBUILT 2026-10-13. data/version.json is tiny and always fetched fresh;
// the card files are then requested with ?v=<that version>, so the browser
// reuses its cached copy until the collector publishes new data (the old
// ?v=Date.now() forced a full ~1 MB re-download on every visit).
window.DATA_VERSION = null;
const _cardCache = {};

async function fetchVersion() {
  if (window.DATA_VERSION) return window.DATA_VERSION;
  try {
    const r = await fetch('data/version.json', { cache: 'no-store' });
    window.DATA_VERSION = r.ok ? await r.json() : {};
  } catch (e) { window.DATA_VERSION = {}; }
  return window.DATA_VERSION;
}

async function fetchCards(lang) {
  if (_cardCache[lang]) return _cardCache[lang];
  const ver = await fetchVersion();
  const r = await fetch(`data/cards-${lang}.json?v=${encodeURIComponent(ver[lang] || '0')}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const cards = normalizeDataFile(await r.json());
  _cardCache[lang] = { cards, setOrder: SET_ORDER, meta: DATA_META };
  return _cardCache[lang];
}

function updateLangToggle() {
  document.querySelectorAll('[data-lang-btn]').forEach(b => {
    const on = b.dataset.langBtn === LANG;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.body.classList.toggle('lang-jp', isJP());
  const search = document.getElementById('search');
  if (search) search.placeholder = isJP() ? 'Search Japanese cards, numbers, or sets…' : 'Search cards, sets, or colors…';
  const footer = document.getElementById('footerSrc');
  if (footer) footer.innerHTML = isJP()
    ? 'Japanese cards · US prices from PriceCharting (eBay sales) · JP-market prices from Yuyu-tei'
    : 'Data from optcgapi.com &amp; TCGplayer';
}

async function showLang(lang) {
  LANG = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
  updateLangToggle();
  document.getElementById('loadingState').style.display = '';
  document.getElementById('noDataState').style.display = 'none';
  document.getElementById('cardView').style.display = 'none';
  try {
    const d = await fetchCards(lang);
    if (LANG !== lang) return; // user switched again while loading
    SET_ORDER = d.setOrder;
    DATA_META = d.meta;
    _activeSet = null;
    _lastRenderedSet = null;
    _trendMode = null;
    loadCards(d.cards);
  } catch (e) {
    console.warn('[data] could not load', lang, e);
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('noDataState').style.display = 'block';
    document.getElementById('noDataMsg').textContent = lang === 'jp'
      ? 'Japanese card data isn\'t available yet — it appears after the next daily collector run.'
      : 'Card data couldn\'t be loaded. Check your connection and refresh.';
  }
}

function setLang(lang) {
  if (lang === LANG && ALL_CARDS.length) return;
  if (document.getElementById('modalBackdrop').classList.contains('active')) closeModal(false);
  if (_activeSet) { _activeSet = null; history.replaceState(null, ''); }
  showLang(lang);
}

document.querySelectorAll('[data-lang-btn]').forEach(b =>
  b.addEventListener('click', () => setLang(b.dataset.langBtn)));

showLang(LANG);

// ─── NAVIGATION: mouse button 4 (desktop back button) ────────────────────────
document.addEventListener('mouseup', e => {
  if (e.button === 3) { e.preventDefault(); history.back(); }
});
document.addEventListener('mousedown', e => {
  if (e.button === 3) e.preventDefault();
});

// Swipe right (mobile)
(function() {
  let _tx = null, _ty = null;
  let _lastModalClose = 0;
  const SWIPE_MIN = 60;
  const SWIPE_RATIO = 1.5;
  const EDGE_MAX = 40;
  const MODAL_COOLDOWN = 400;

  document.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { _tx = null; return; }
    if (e.touches[0].clientX > EDGE_MAX) { _tx = null; return; }
    _tx = e.touches[0].clientX;
    _ty = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (_tx === null) return;
    const dx = e.changedTouches[0].clientX - _tx;
    const dy = Math.abs(e.changedTouches[0].clientY - _ty);
    _tx = null;
    if (document.getElementById('modalBackdrop').classList.contains('active')) return;
    if (Date.now() - _lastModalClose < MODAL_COOLDOWN) return;
    if (dx > SWIPE_MIN && Math.abs(dx) / (dy || 1) > SWIPE_RATIO) {
      history.back();
    }
  }, { passive: true });

  window.addEventListener('popstate', () => {
    const wasModalOpen = document.getElementById('modalBackdrop').classList.contains('active');
    if (wasModalOpen) _lastModalClose = Date.now();
    else setTimeout(() => {
      if (!document.getElementById('modalBackdrop').classList.contains('active')) {
        _lastModalClose = Date.now();
      }
    }, 0);
  }, { capture: true });
})();
