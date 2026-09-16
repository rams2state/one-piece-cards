// verify_links.js — builds TCGplayer / PriceCharting / eBay PSA-10 search
// links for a card. Mirrors Pokémon's verify_links.js query-shape approach,
// adapted for One Piece's simpler data (no condition tiers, no 1st-edition
// concept — dropped entirely per Jordan's explicit decision).

// TCGplayer: One Piece TCG has its own category on TCGplayer.
function buildTcgplayerUrl(c) {
  const q = encodeURIComponent(c.name || '');
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${q}&view=grid`;
}

// eBay: general search for this card (raw and graded listings both show
// up) — replaces the old PriceCharting button. ADDED 2026-09-16 per
// Jordan, mirroring the same button swap already made in the Pokémon
// app. Query shape reused from the old PSA-10-specific builder (name +
// set + Parallel/Special tokens) minus the "PSA 10" keyword, since this
// is a general search now, not graded-only.
function buildEbayUrl(c) {
  const parts = [c.name || '', c.set || ''];
  if (c.isParallel) parts.push('Parallel');
  if (c.isSpecial) parts.push('Special');
  const q = parts.filter(Boolean).join(' ');
  const params = new URLSearchParams({
    _nkw: q,
    LH_BIN: '1',
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}
