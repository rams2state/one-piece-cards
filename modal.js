// modal.js — card detail modal, including the Chart.js price history graph.
// Mirrors Pokémon's modal.js closely: prev/next navigation via _modalList/
// _modalIdx (respecting set-detail on-screen order via _setDetailOrder when
// opened from there), owned toggle, purchase-price prompt, and the explicit
// Y-axis min/max price chart. Adapted stat block (Color/Type/Cost/Power/
// Life/Counter/Attribute) replaces Pokémon's HP/type/weakness fields, and
// 1st-Edition detection is dropped entirely (Pokémon-only concept).

let _modalCard = null;
let _modalList = [];
let _modalIdx = -1;
let _setDetailOrder = null;
let _priceChart = null;

function modalNav(dir) {
  const next = _modalIdx + dir;
  if (next < 0 || next >= _modalList.length) return;
  _modalIdx = next;
  openModal(_modalList[_modalIdx], false);
}

function updateNavState() {
  const prev = document.getElementById('mNavPrev');
  const next = document.getElementById('mNavNext');
  const counter = document.getElementById('mNavCounter');
  if (prev) prev.classList.toggle('disabled', _modalIdx <= 0);
  if (next) next.classList.toggle('disabled', _modalIdx >= _modalList.length - 1);
  if (counter && _modalList.length > 1) {
    counter.textContent = `${_modalIdx + 1} / ${_modalList.length}`;
  } else if (counter) {
    counter.textContent = '';
  }
}

function openModal(c, updateList = true) {
  _modalCard = c;
  const promptEl = document.getElementById('mPurchasePrompt');
  if (promptEl) promptEl.style.display = 'none';
  if (updateList) {
    _modalList = _setDetailOrder || getFiltered();
    _modalIdx = _modalList.findIndex(x => x.cardId === c.cardId);
    if (_modalIdx === -1) _modalIdx = 0;
    sessionStorage.setItem('binderScroll', window.scrollY);
    history.pushState({ modal: true }, '');
  }
  updateNavState();
  const nameStr = c.name || '(Unknown)';
  document.getElementById('mName').textContent = nameStr;

  const rarityPill = document.getElementById('mRarityPill');
  if (rarityPill) {
    rarityPill.className = `pill ${rarityClass(c.rarity)}`;
    rarityPill.textContent = `${RARITY_DISPLAY[c.rarity] || c.rarity || '?'}${c.isSpecial ? ' (SP)' : ''}`;
  }

  const cardNumEl = document.getElementById('mCardNum');
  if (cardNumEl) cardNumEl.textContent = c.cardId || '';

  document.getElementById('mMeta').innerHTML =
    [c.set, c.setId].filter(Boolean).join(' <span class="meta-dot">·</span> ');

  // REMOVED 2026-09-06 per Jordan: "dont really care for this block" (the
  // Color/Type/Cost/Power/Life/Counter/Attribute stat-box grid). The
  // #mStats container itself was also removed from the HTML/CSS.
  const textEl = document.getElementById('mCardText');
  if (textEl) textEl.textContent = c.text || '';

  // Price with 7-day change
  const cv = priceVal(c.price);
  let priceHtml = c.price && c.price !== 'N/A' ? c.price : 'Price N/A';
  const pv7 = getPriceNDaysAgo(c.cardId, 7);
  if (!READ_ONLY_SHARE && cv >= 0 && pv7 !== null && pv7 > 0) {
    const delta = cv - pv7;
    const pct = (delta / pv7 * 100).toFixed(1);
    const sign = delta >= 0 ? '+' : '';
    const cls = delta >= 0 ? 'price-up' : 'price-down';
    const arrow = delta >= 0 ? '↑' : '↓';
    priceHtml += ` <span class="price-change ${cls}" style="font-size:13px;"><span class="price-change-period">7D</span> ${arrow} ${sign}${pct}%</span>`;
  }
  const staleBadge = stalePriceBadge(c);
  if (staleBadge) priceHtml += ' ' + staleBadge;

  if (!READ_ONLY_SHARE) {
    const seventyLabel = seventyPercentLabel(c);
    const psa10Url = buildEbayPsa10Url(c);
    const psa10Box = `<a class="modal-70pct-psa10" href="${psa10Url}" target="_blank" rel="noopener" title="No PSA 10 price data yet — click to search eBay for PSA 10 listings of this card.">Check PSA 10 price →</a>`;
    if (seventyLabel) {
      priceHtml += `<div class="modal-70pct">70%: ${seventyLabel}${psa10Box}</div>`;
    } else {
      priceHtml += `<div class="modal-70pct">${psa10Box}</div>`;
    }
    const purchasePrice = ownedPurchasePrice(c);
    if (purchasePrice !== null && purchasePrice > 0) {
      priceHtml += `<div class="modal-purchase-price">Paid: $${purchasePrice.toFixed(2)}</div>`;
    }
  }
  document.getElementById('mPrice').innerHTML = priceHtml;

  const img = document.getElementById('mImg');
  const fallback = document.getElementById('mFallback');
  if (c.pic) {
    img.src = c.pic;
    img.style.display = '';
    fallback.style.display = 'none';
  } else {
    img.src = '';
    img.style.display = 'none';
    fallback.style.display = 'block';
  }

  document.getElementById('mBuy').href = buildTcgplayerUrl(c);
  const mBuyEbay = document.getElementById('mBuyEbay');
  if (mBuyEbay) mBuyEbay.href = buildPriceChartingUrl(c);

  const ownBtn = document.getElementById('mOwn');
  const owned = isOwned(c);
  ownBtn.textContent = owned ? 'Owned' : '＋ Mark as Owned';
  ownBtn.classList.toggle('owned', owned);

  if (!READ_ONLY_SHARE) {
    renderPriceChart(c.cardId || '');
  }

  document.getElementById('modalBackdrop').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function toggleFromModal() {
  if (!_modalCard) return;
  const c = _modalCard;
  const justAdded = toggleOwned(c);
  const owned = isOwned(c);
  const ownBtn = document.getElementById('mOwn');
  ownBtn.textContent = owned ? 'Owned' : '＋ Mark as Owned';
  ownBtn.classList.toggle('owned', owned);
  const key = cardKey(c).replace(/[^a-z0-9]/gi, '_');
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
  if (justAdded) showPurchasePrompt();
}

// ─── PURCHASE PRICE PROMPT ──────────────────────────────────────────────────
function showPurchasePrompt() {
  const promptEl = document.getElementById('mPurchasePrompt');
  const input = document.getElementById('mPurchaseInput');
  if (!promptEl || !input) return;
  input.value = '';
  promptEl.style.display = '';
  setTimeout(() => input.focus(), 0);
}
function hidePurchasePrompt() {
  const promptEl = document.getElementById('mPurchasePrompt');
  if (promptEl) promptEl.style.display = 'none';
}
function savePurchasePrice() {
  if (!_modalCard) { hidePurchasePrompt(); return; }
  const input = document.getElementById('mPurchaseInput');
  const raw = input ? input.value.trim() : '';
  const val = parseFloat(raw);
  if (raw && !isNaN(val) && val >= 0) {
    setPurchasePrice(_modalCard, val);
  }
  hidePurchasePrompt();
}
function skipPurchasePrice() {
  hidePurchasePrompt();
}

function closeModal(restoreScroll = true) {
  document.getElementById('modalBackdrop').classList.remove('active');
  document.body.style.overflow = '';
  if (_priceChart) { _priceChart.destroy(); _priceChart = null; }
  if (restoreScroll) {
    const y = parseInt(sessionStorage.getItem('binderScroll') || '0', 10);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'instant' });
    }));
  }
}

// ─── PRICE HISTORY CHART ─────────────────────────────────────────────────────
function renderPriceChart(cardId) {
  const canvas = document.getElementById('priceChart');
  const emptyMsg = document.getElementById('mChartEmpty');

  if (_priceChart) { _priceChart.destroy(); _priceChart = null; }

  const history = PRICE_HISTORY[cardId] || [];

  if (history.length < 2) {
    canvas.style.display = 'none';
    emptyMsg.style.display = '';
    return;
  }

  canvas.style.display = '';
  emptyMsg.style.display = 'none';

  const labels = history.map(e => e.d);
  const prices = history.map(e => e.p);

  const first = prices[0], last = prices[prices.length - 1];
  const trending = last >= first ? '#4ade80' : '#f87171';

  const dataMin = Math.min(...prices);
  const dataMax = Math.max(...prices);
  const dataRange = dataMax - dataMin;
  const pad = Math.max(dataRange * 0.1, 0.5);
  let yMin = dataMin - pad;
  let yMax = dataMax + pad;
  if (yMax - yMin < 1) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - 0.5;
    yMax = mid + 0.5;
  }
  yMin = Math.max(yMin, 0);

  _priceChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: prices,
        borderColor: trending,
        backgroundColor: trending + '18',
        borderWidth: 2,
        pointRadius: history.length <= 30 ? 3 : 0,
        pointBackgroundColor: trending,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => formatDateDisplay(ctx[0]?.label || ''),
            label: ctx => `$${ctx.parsed.y.toFixed(2)}`,
          },
          backgroundColor: '#1f2330',
          borderColor: '#2b2f3d',
          borderWidth: 1,
          titleColor: '#8b8fa3',
          bodyColor: '#eae7dd',
          padding: 8,
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#8b8fa3', font: { size: 9 }, maxTicksLimit: 6,
            callback: function(value) {
              const label = this.getLabelForValue(value);
              return formatDateDisplay(label);
            },
          },
          grid: { color: '#2b2f3d' },
        },
        y: {
          min: yMin,
          max: yMax,
          ticks: {
            color: '#8b8fa3',
            font: { size: 9 },
            maxTicksLimit: 6,
            callback: v => (yMax - yMin) < 10 ? '$' + v.toFixed(2) : '$' + v.toFixed(0),
          },
          grid: { color: '#2b2f3d' },
        }
      }
    }
  });
}
