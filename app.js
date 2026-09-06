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
['eraFilter', 'rarityFilter'].forEach(id =>
  document.getElementById(id).addEventListener('change', render)
);
document.getElementById('sortBy').addEventListener('change', handleSortChange);

[['eraFilter', 'eraFilterM'], ['rarityFilter', 'rarityFilterM'], ['sortBy', 'sortByM']].forEach(([desk, mob]) => {
  document.getElementById(mob).addEventListener('change', function() {
    document.getElementById(desk).value = this.value;
    if (desk === 'sortBy') handleSortChange();
    else render();
  });
  document.getElementById(desk).addEventListener('change', function() {
    document.getElementById(mob).value = this.value;
  });
});

// ─── CSV UPLOAD ──────────────────────────────────────────────────────────────
document.getElementById('csvFile').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const cards = parseCSV(ev.target.result);
    if (cards.length > 0) loadCards(cards);
    else alert('Could not parse CSV — make sure it has a header row and card data.');
  };
  reader.readAsText(file, 'utf-8');
});

const dz = document.getElementById('dropZone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.borderColor = 'var(--gold)'; });
dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const cards = parseCSV(ev.target.result);
    if (cards.length > 0) loadCards(cards);
  };
  reader.readAsText(file, 'utf-8');
});

// ─── AUTO-LOAD ────────────────────────────────────────────────────────────────
async function tryAutoLoad() {
  const bust = `?v=${Date.now()}`;

  try {
    const histResp = await fetch('one-piece-price-history.json' + bust);
    if (histResp.ok) {
      PRICE_HISTORY = await histResp.json();
    }
  } catch (e) {}

  const candidates = [
    'ONE_PIECE_COLLECTION.csv',
    'one_piece_collection.csv',
    'cards.csv',
  ];
  for (const name of candidates) {
    try {
      const resp = await fetch(name + bust);
      const ct = resp.headers.get('content-type') || '';
      if (resp.ok && !ct.includes('text/html')) {
        const text = await resp.text();
        const cards = parseCSV(text);
        if (cards.length > 0) {
          loadCards(cards);
          return;
        }
      }
    } catch (e) {}
  }
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('noDataState').style.display = 'block';
}

tryAutoLoad();

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
