// verify_links.js — builds TCGplayer / PriceCharting / eBay PSA-10 search
// links for a card. Mirrors Pokémon's verify_links.js query-shape approach,
// adapted for One Piece's simpler data (no condition tiers, no 1st-edition
// concept — dropped entirely per Jordan's explicit decision).

// TCGplayer: One Piece TCG has its own category on TCGplayer.
function buildTcgplayerUrl(c) {
  const q = encodeURIComponent(c.name || '');
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${q}&view=grid`;
}

// PriceCharting: name + set name, with "Parallel"/"Special" appended as a
// separate descriptive token (rather than the parenthetical the raw Card
// Name sometimes carries) when applicable — PriceCharting's own listings
// tend to use these as standalone words.
function buildPriceChartingUrl(c) {
  const parts = [c.name || '', c.set || ''];
  if (c.isParallel) parts.push('Parallel');
  if (c.isSpecial) parts.push('Special');
  const q = parts.filter(Boolean).join(' ');
  const params = new URLSearchParams({ q, type: 'prices' });
  return `https://www.pricecharting.com/search-products?${params.toString()}`;
}

// eBay PSA-10: always available regardless of whether we have a PSA10 price
// on file (we don't, for this dataset) — clicking opens a live eBay search
// for graded PSA 10 copies of this exact card.
function buildEbayPsa10Url(c) {
  const parts = [c.name || '', c.set || ''];
  if (c.isParallel) parts.push('Parallel');
  if (c.isSpecial) parts.push('Special');
  parts.push('PSA 10');
  const q = parts.filter(Boolean).join(' ');
  const params = new URLSearchParams({
    _nkw: q,
    LH_BIN: '1',
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}
