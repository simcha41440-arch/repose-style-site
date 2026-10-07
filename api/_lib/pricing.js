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

// Every towel design is sold in three sizes with their own prices (the
// size id is sent as item.size). Keep in sync with TOWEL_SIZES in index.html.
const TOWEL_SIZES = { hand: 25, face: 42, body: 85 };
const TOWEL_SIZE_ORDER = ['hand', 'face', 'body'];

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
  'towel-bath-classic': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-hand-premium': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-body-boutique': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-natali': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-avishag': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-venezia': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-oriya': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-liya': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-iziva': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-tenerife': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'towel-liam': { price: 25, category: 'towel', sizes: TOWEL_SIZES },
  'perfume-gold': { price: 459, category: 'perfume' },
  'perfume-white': { price: 359, category: 'perfume' },
  'perfume-graphite': { price: 569, category: 'perfume' },
  'scent-holyland': { price: 189, category: 'perfume' },
  'scent-miami': { price: 189, category: 'perfume' },
  'scent-spring': { price: 189, category: 'perfume' },
  'scent-newyork': { price: 189, category: 'perfume' },
  'scent-paris': { price: 189, category: 'perfume' },
  'scent-lacoste': { price: 189, category: 'perfume' },
  'scent-tea-time': { price: 189, category: 'perfume' },
  'scent-royal-beach': { price: 189, category: 'perfume' },
  'scent-olympia': { price: 189, category: 'perfume' },
  'scent-delta': { price: 189, category: 'perfume' },
  'scent-boutique-hotel': { price: 189, category: 'perfume' },
  'scent-nautica-home': { price: 189, category: 'perfume' },
  'scent-jasmine': { price: 189, category: 'perfume' },
  'scent-black-jasmine': { price: 189, category: 'perfume' },
  'scent-luxury-spa': { price: 189, category: 'perfume' },
  'scent-karamim': { price: 189, category: 'perfume' },
  'scent-bereshit': { price: 189, category: 'perfume' },
  'scent-patal': { price: 189, category: 'perfume' },
  'scent-blue-chanel': { price: 189, category: 'perfume' },
  'scent-london': { price: 189, category: 'perfume' },
  'scent-pink-lotus': { price: 189, category: 'perfume' },
  'scent-abercrombie': { price: 189, category: 'perfume' },
  'scent-my-secret': { price: 189, category: 'perfume' },
  'scent-testers-6': { price: 39, category: 'perfume' },
};

// Merges live product_overrides rows (as returned by a
// `.from('product_overrides').select('*').eq('active', true)` query) on
// top of BASE_CATALOG, the same way applyAdminOverrides() does client-side
// in index.html. Pass the Supabase rows in - this module has no DB client
// of its own, to keep it a small dependency-free unit callers can test in
// isolation.
// Products removed from the catalog - an old override row for one of
// these must never make it orderable again (see REMOVED_PRODUCT_IDS in index.html).
const REMOVED_IDS = new Set(['towel-spa-set', 'towel-folded-set', 'towel-full-set']);

function buildPriceMap(overrideRows) {
  const map = {};
  for (const id of Object.keys(BASE_CATALOG)) {
    map[id] = { ...BASE_CATALOG[id] };
  }
  for (const row of overrideRows || []) {
    if (!row || !row.id) continue;
    if (REMOVED_IDS.has(row.id)) continue;
    // Products added from the admin panel's "הוספת מוצר חדש" form (towels,
    // bedding, perfume devices, scent bottles) have no entry in BASE_CATALOG -
    // without this they would be rejected at checkout as "unknown product".
    // Their price/category come from the saved override row itself.
    if (!map[row.id]) {
      if (row.active === false) continue;
      if (row.price === undefined || row.price === null || row.price === '') continue;
      const customPrice = Number(row.price);
      if (!Number.isFinite(customPrice) || customPrice < 0) continue;
      const cat = row.category === 'towel'
        ? 'towel'
        : (row.category === 'scent' || row.category === 'perfume' ? 'perfume' : undefined);
      map[row.id] = { price: customPrice, ...(cat ? { category: cat } : {}) };
      if (row.out_of_stock) map[row.id].outOfStock = true;
      continue;
    }
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
  if (catalogEntry.sizes) {
    // Unknown/missing size falls back to the first (smallest) size - same as the client.
    const sizeId = Object.prototype.hasOwnProperty.call(catalogEntry.sizes, item.size) ? item.size : TOWEL_SIZE_ORDER[0];
    price = catalogEntry.sizes[sizeId];
  } else if (item.size === 'single' && catalogEntry.category !== 'towel' && catalogEntry.category !== 'perfume') {
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
// Also carries through the structured `size` and `embroidery` fields
// as-is (not just baked into `name`) so admin can show them as their own
// clearly-labelled fields instead of having to parse them back out of a
// sentence - see renderOrderDetail() in admin.html. These two fields are
// also what unitPrice() above needs to compute the right price (half-price
// for size:"single", +EMBROIDERY_SURCHARGE for a non-free embroidered
// product) - if the caller's `items` don't carry them, the order is
// priced as a plain full-price item, so keep this in sync with whatever
// the client actually submits.
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
      size: item.size || null,
      embroidery: item.embroidery || null,
      // Display-only (e.g. device color "שחור"/"לבן") - never affects price.
      color: typeof item.color === 'string' && item.color ? item.color.slice(0, 40) : null,
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
