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
const RARITY_ORDER = ['SEC', 'DON!!', 'SR', 'SP', 'L', 'TR', 'R', 'UC', 'C', 'P', 'PR'];
function rarityRank(r) {
  const idx = RARITY_ORDER.indexOf(r);
  return idx === -1 ? 99 : idx;
}

const RARITY_DISPLAY = {
  'SEC': 'Secret Rare',
  'SR':  'Super Rare',
  'SP':  'Special Card',
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
  'SP':  '#f0abfc', // special card (JP data) — orchid
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
    'SEC': 'pill-sec', 'SR': 'pill-sr', 'SP': 'pill-sr', 'L': 'pill-l', 'TR': 'pill-tr',
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

// ─── 7-DAY PRICE CHANGE ──────────────────────────────────────────────────────
// CHANGED 2026-10-13: the collector now precomputes each card's price from
// ~7 days ago (c.p7), so badges and Gainers/Losers no longer need the full
// price-history file -- that file is only downloaded when a card is opened.
function getPriceNDaysAgo(c) {
  return c && c.p7 != null && c.p7 > 0 ? c.p7 : null;
}

function priceChangeBadge(c) {
  if (READ_ONLY_SHARE) return '';
  const cv = priceVal(c.price);
  const pv7 = getPriceNDaysAgo(c);
  if (cv < 0 || pv7 === null) return '';
  const delta = cv - pv7;
  const pct = (delta / pv7) * 100;
  if (Math.abs(delta) < 0.01) return '<span class="price-change price-flat"><span class="price-change-period">7D</span> —</span>';
  const arrow = delta > 0 ? '↑' : '↓';
  const cls = delta > 0 ? 'price-up' : 'price-down';
  const sign = delta > 0 ? '+' : '';
  return `<span class="price-change ${cls}"><span class="price-change-period">7D</span> ${arrow} ${sign}${pct.toFixed(1)}%</span>`;
}

// JP cards: Japan-market price (Yuyu-tei, yen converted to USD), shown under
// the US price so the buy-in-Japan / sell-in-US gap is visible.
function jpMarketLine(c, cls = 'jp-market') {
  if (!c || c.lang !== 'jp' || !c.jpyUsd) return '';
  return `<span class="${cls}" title="Japan market (Yuyu-tei): ¥${c.jpy.toLocaleString()}">JP ${fmtUsd(c.jpyUsd)}</span>`;
}

function fmtUsd(v) {
  return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
