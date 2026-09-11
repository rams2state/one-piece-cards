// rarity.js — One Piece rarity classification, colors, price-change badges,
// stale-price logic. Mirrors Pokémon's rarity.js structure; the rarity space
// is much simpler (L/C/UC/R/SR/SEC/TR/P/PR, no era-based ultra-rare bucketing).

// Rarest-first order — drives set-detail rarity-group ordering and the
// rarity dropdown's sort.
// ADDED 2026-09-10: 'DON!!' placed near the top — the only DON!! rows
// that make it into the CSV at all are chase-tier Gold/Silver/Special/
// Alternate Art prints (see is_chase.py), which run as high as the
// hundreds of dollars (a "(Gold)" print was confirmed at $722.82) — well
// above typical SR/L pricing, so it's ranked alongside SEC/SR rather than
// down with the plain rarities.
const RARITY_ORDER = ['SEC', 'DON!!', 'SR', 'L', 'TR', 'R', 'UC', 'C', 'P', 'PR'];
function rarityRank(r) {
  const idx = RARITY_ORDER.indexOf(r);
  return idx === -1 ? 99 : idx;
}

const RARITY_DISPLAY = {
  'SEC': 'Secret Rare',
  'SR':  'Super Rare',
  'L':   'Leader',
  'TR':  'Treasure Rare',
  'R':   'Rare',
  'UC':  'Uncommon',
  'C':   'Common',
  'P':   'Promo',
  'PR':  'Promo',
  'DON!!': 'DON!! Card',
};

const RARITY_COLOR = {
  'SEC': '#ff4d4d', // secret rare — brightest red, top chase tier
  'SR':  '#ffd700', // super rare — gold
  'L':   '#ff8c42', // leader — orange
  'TR':  '#a78bfa', // treasure rare — purple
  'R':   '#60a5fa', // rare — blue
  'UC':  '#4ade80', // uncommon — green
  'C':   '#8b8fa3', // common — dim gray
  'P':   '#f97d9c', // promo — pink
  'PR':  '#f97d9c',
  'DON!!': '#e8c34a', // gold DON!! cards — distinct warm gold, separate from SR's brighter gold
};

function rarityColor(r) { return RARITY_COLOR[r] || '#8b8fa3'; }
function shortRarity(r) { return r || '?'; }
function rarityClass(r) {
  const map = {
    'SEC': 'pill-sec', 'SR': 'pill-sr', 'L': 'pill-l', 'TR': 'pill-tr',
    'R': 'pill-r', 'UC': 'pill-uc', 'C': 'pill-c', 'P': 'pill-p', 'PR': 'pill-p',
    'DON!!': 'pill-don',
  };
  return map[r] || 'pill-default';
}

// ─── STALE PRICE ─────────────────────────────────────────────────────────────
const STALE_PRICE_DAYS = 7;
const STALE_PRICE_DAYS_SEVERE = 30;

function stalePriceBadge(c) {
  const noPrice = !c.price || c.price === 'N/A';
  const days = daysSince(c.lastPriced);
  if (noPrice) {
    if (days === null) {
      return `<span class="price-stale" title="No price has ever been fetched for this card">Never priced</span>`;
    }
    return `<span class="price-stale" title="Last real price was ${days} day(s) ago">Stale ${days}d</span>`;
  }
  if (days !== null && days >= STALE_PRICE_DAYS) {
    return `<span class="price-stale" title="Price last confirmed ${days} days ago">Stale ${days}d</span>`;
  }
  return '';
}
function staleWarningIcon(c) {
  if (READ_ONLY_SHARE) return '';
  const noPrice = !c.price || c.price === 'N/A';
  const days = daysSince(c.lastPriced);
  if (days === null || noPrice) return '';
  if (days >= STALE_PRICE_DAYS_SEVERE) {
    return `<span class="price-stale-icon severe" title="Price last confirmed ${days} days ago — likely a permanent data gap">⚠</span>`;
  }
  if (days >= STALE_PRICE_DAYS) {
    return `<span class="price-stale-icon" title="Price last confirmed ${days} days ago">⚠</span>`;
  }
  return '';
}
// No TCGplayer-vs-eBay price-gap signal exists in the One Piece data
// (no separate cheapest-listing feed), so priceVolatileIcon is a no-op —
// kept as a function so render.js's call sites don't need special-casing.
function priceVolatileIcon(c) { return ''; }
function priceVolatileBadge(c) { return ''; }

function priceVal(p) {
  if (!p || p === 'N/A') return -1;
  return parseFloat(String(p).replace(/[^0-9.]/g, '')) || 0;
}

// ─── 70% GUIDANCE PRICE ──────────────────────────────────────────────────────
function seventyPercentVal(c) {
  const v = priceVal(c.price);
  return v > 0 ? v * 0.7 : null;
}
function seventyPercentLabel(c) {
  const v = seventyPercentVal(c);
  return v !== null ? `$${v.toFixed(2)}` : null;
}
function seventyPercentBadgeHtml(c) {
  if (READ_ONLY_SHARE) return '';
  const label = seventyPercentLabel(c);
  return label ? `<span class="price-70pct" title="70% of market price">70%: ${label}</span>` : '';
}

// No PSA-10 price field exists in the One Piece CSV (unlike Pokémon's eBay-
// derived psa10Price) — the grid tile badge is a no-op; the modal always
// shows a clickable "Check PSA 10 price" box regardless (see modal.js).
function tilePsa10Html(c) { return ''; }

// ─── 7-DAY PRICE HISTORY LOOKUP ──────────────────────────────────────────────
// Finds the history entry closest to (today - days) without going OVER that
// many days back. Returns null if no entry is old enough yet — with this
// dataset's single-day-per-card history, that's every card until the daily
// collector has run for a week.
function getPriceNDaysAgo(cardId, days) {
  const history = (typeof PRICE_HISTORY !== 'undefined' && PRICE_HISTORY[cardId]) || [];
  if (history.length === 0) return null;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  for (let i = history.length - 1; i >= 0; i--) {
    const entryDate = new Date(history[i].d + 'T00:00:00');
    if (entryDate <= cutoff) return history[i].p;
  }
  return null;
}

function priceChangeBadge(current, cardId) {
  if (READ_ONLY_SHARE) return '';
  const cv = priceVal(current);
  const pv7 = getPriceNDaysAgo(cardId, 7);
  if (cv < 0 || pv7 === null || pv7 <= 0) return '';
  const delta = cv - pv7;
  const pct = (delta / pv7) * 100;
  if (Math.abs(delta) < 0.01) return '<span class="price-change price-flat"><span class="price-change-period">7D</span> —</span>';
  const arrow = delta > 0 ? '↑' : '↓';
  const cls = delta > 0 ? 'price-up' : 'price-down';
  const sign = delta > 0 ? '+' : '';
  return `<span class="price-change ${cls}"><span class="price-change-period">7D</span> ${arrow} ${sign}${pct.toFixed(1)}%</span>`;
}
