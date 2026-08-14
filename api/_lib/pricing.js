// Server-side source of truth for prices. Mirrors the static PRODUCTS /
// TOWELS_DATA catalog baked into index.html (id -> base price/category/
// customizable), plus the exact same pricing rules used client-side in
// cartItemUnitPrice() / checkoutShippingPrice() / couponDiscountAmount().
//
// WHY THIS EXISTS: the storefront computes the cart subtotal, shipping
// and coupon discount entirely in the browser, then sends the resulting
// numbers to /api/orders (and, before that, to the Tranzila iframe as the
// amount to charge). A number computed in the browser is just a number
// the visitor's own JS produced - nothing stops someone from opening dev
// tools and sending a different one. This module recomputes the "real"
// price for a submitted cart server-side, so /api/orders can reject an
// order whose numbers don't match instead of trusting the client blindly.
//
// IMPORTANT: keep BASE_CATALOG in sync with the PRODUCTS/TOWELS_DATA
// arrays in index.html whenever a product is added, removed, or its base
// price changes there. This intentionally does NOT read admin-panel price
// overrides from Supabase's product_overrides table via a live query here
// - callers that need the current (possibly overridden) price should pass
// overrides in explicitly (see buildPriceMap below).

const EMBROIDERY_SURCHARGE = 200;
const FREE_SHIPPING_THRESHOLD = 299;
const STANDARD_SHIPPING = 29;

// id -> { price, category, customizable }
const BASE_CATALOG = {
  prachim: { price: 1080 },
  simfonia: { price: 700 },
  rakefet: { price: 890 },
  yahalom: { price: 1490, customizable: true, embroideryFree: true },
  london: { price: 690, customizable: true },
  royal: { price: 1190 },
  star: { price: 680 },
  okeanos: { price: 590 },
  classic: { price: 665 },
  aviv: { price: 1080 },
  'simfonia-premium': { price: 1000 },
  elegantia: { price: 700 },
  'towel-bath-classic': { price: 79, category: 'towel' },
  'towel-spa-set': { price: 99, category: 'towel' },
  'towel-hand-premium': { price: 65, category: 'towel' },
  'towel-body-boutique': { price: 85, category: 'towel' },
  'towel-folded-set': { price: 95, category: 'towel' },
  'towel-full-set': { price: 100, category: 'towel' },
};

// Merges live product_overrides rows (as returned by a
// `.from('product_overrides').select('*').eq('active', true)` query) on
// top of BASE_CATALOG, the same way applyAdminOverrides() does client-side
// in index.html. Pass the Supabase rows in - this module has no DB client
// of its own, to keep it a small dependency-free unit callers can test in
// isolation.
function buildPriceMap(overrideRows) {
  const map = {};
  for (const id of Object.keys(BASE_CATALOG)) {
    map[id] = { ...BASE_CATALOG[id] };
  }
  for (const row of overrideRows || []) {
    if (!row || !row.id || !map[row.id]) continue;
    if (row.price !== undefined && row.price !== null && row.price !== '') {
      map[row.id].price = Number(row.price);
    }
    if (row.out_of_stock) {
      map[row.id].outOfStock = true;
    }
  }
  return map;
}

// Same rule as productForSize() in index.html: a "single" (חצי סט) is half
// the price, rounded, and only applies to non-towel bedding.
function unitPrice(priceMap, item) {
  const catalogEntry = priceMap[item.id];
  if (!catalogEntry) return null; // unknown id - caller should reject the order
  let price = catalogEntry.price;
  if (item.size === 'single' && catalogEntry.category !== 'towel') {
    price = Math.round(price / 2);
  }
  if (catalogEntry.customizable && item.embroidery && !catalogEntry.embroideryFree) {
    price += EMBROIDERY_SURCHARGE;
  }
  return { price, outOfStock: !!catalogEntry.outOfStock };
}

// Recomputes subtotal from submitted cart items { id, qty, size?, embroidery? }.
// Returns { subtotal, unknownIds, outOfStockIds } - callers decide how to
// treat unknown/out-of-stock ids (currently: reject the order).
function computeSubtotal(priceMap, items) {
  let subtotal = 0;
  const unknownIds = [];
  const outOfStockIds = [];
  for (const item of items || []) {
    const qty = Number(item && item.qty);
    if (!item || !item.id || !Number.isFinite(qty) || qty <= 0) {
      unknownIds.push(item && item.id);
      continue;
    }
    const result = unitPrice(priceMap, item);
    if (!result) {
      unknownIds.push(item.id);
      continue;
    }
    if (result.outOfStock) outOfStockIds.push(item.id);
    subtotal += result.price * qty;
  }
  return { subtotal, unknownIds, outOfStockIds };
}

function shippingPrice(subtotal, shippingMethod) {
  if (shippingMethod === 'pickup') return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING;
}

// Mirrors couponDiscountAmount() in index.html. `coupon` is the row from
// the `coupons` table (must already be verified active + unused by the
// caller - this function only applies the percent/min_subtotal math).
function couponDiscount(subtotal, coupon) {
  if (!coupon) return 0;
  const minSubtotal = coupon.min_subtotal;
  if (minSubtotal && subtotal < Number(minSubtotal)) return 0;
  const pct = Math.min(100, Math.max(0, Number(coupon.percent) || 0));
  return Math.round(subtotal * (pct / 100));
}

// Rebuilds the items array for storage using server-verified unit prices,
// keeping whatever display `name` the client sent (purely cosmetic - size/
// embroidery labels baked into the string) but never trusting its `price`.
// Assumes every id in `items` already passed computeSubtotal() with no
// unknownIds - callers should validate that first.
function verifyItems(priceMap, items) {
  return (items || []).map((item) => {
    const result = unitPrice(priceMap, item);
    return {
      id: item.id,
      name: item.name || item.id,
      qty: Number(item.qty),
      price: result ? result.price : null,
    };
  });
}

module.exports = {
  EMBROIDERY_SURCHARGE,
  FREE_SHIPPING_THRESHOLD,
  STANDARD_SHIPPING,
  BASE_CATALOG,
  buildPriceMap,
  unitPrice,
  computeSubtotal,
  verifyItems,
  shippingPrice,
  couponDiscount,
};
