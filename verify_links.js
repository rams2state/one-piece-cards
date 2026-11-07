// verify_links.js — builds TCGplayer / PriceCharting / eBay PSA-10 search
// links for a card. Mirrors Pokémon's verify_links.js query-shape approach,
// adapted for One Piece's simpler data (no condition tiers, no 1st-edition
// concept — dropped entirely per Jordan's explicit decision).

// TCGplayer: One Piece TCG has its own category on TCGplayer.
function buildTcgplayerUrl(c) {
  // ADDED 2026-10-19: direct product page when we know TCGplayer's id.
  if (c.tcgId) return `https://www.tcgplayer.com/product/${encodeURIComponent(c.tcgId)}`;
  const q = encodeURIComponent(c.name || '');
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${q}&view=grid`;
}

// eBay: general search for this card (raw and graded listings both show
// up) — replaces the old PriceCharting button. ADDED 2026-09-16 per
// Jordan, mirroring the same button swap already made in the Pokémon
// app. Query shape reused from the old PSA-10-specific builder (name +
// set + Parallel/Special tokens) minus the "PSA 10" keyword, since this
// is a general search now, not graded-only.
// CHANGED 2026-11-06 (Jordan): PSA 10 search -- name + card number +
// the version (alt art / manga / SP / TR...) + "PSA 10".
function buildEbayUrl(c) {
  const num = (c.cardId || '').match(/((?:OP|EB|ST|PRB|P)\d{0,2}-\d{3})/i);
  const parts = [c.name || '', num ? num[1].toUpperCase() : ''];
  const ver = { alt: 'Alt Art', manga: 'Manga', sp: 'SP', tr: 'Treasure Rare', superalt: 'Alt Art', wanted: 'Wanted Poster', gold: 'Gold' }[c.print];
  if (ver) parts.push(ver);
  parts.push('PSA 10');
  const q = parts.filter(Boolean).join(' ');
  const params = new URLSearchParams({
    _nkw: q,
    LH_BIN: '1',
  });
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

// ADDED 2026-10-13: Japanese cards link to their PriceCharting page (where
// the US price comes from) and their Yuyu-tei page (JP-market price).
function buildPriceChartingUrl(c) {
  if (c.pcPath) {
    const [consoleUri, productUri] = c.pcPath.split('/');
    return `https://www.pricecharting.com/game/${encodeURIComponent(consoleUri)}/${encodeURIComponent(productUri)}`;
  }
  return `https://www.pricecharting.com/search-products?q=${encodeURIComponent((c.rawName || c.name) + ' ' + (c.cardId || '').replace(/_p\d+$/, '') + ' japanese')}&type=prices`;
}
function buildYuyuteiUrl(c) {
  return c.yyPath ? `https://yuyu-tei.jp/${c.yyPath}` : '';
}
