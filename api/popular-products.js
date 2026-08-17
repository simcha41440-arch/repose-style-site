const { getSupabase, withFriendlyError } = require('./_lib/supabase');

// Public, read-only endpoint: returns which products actually sell the
// most, aggregated from real orders. Used by the storefront (see
// loadPopularProducts() in index.html) to render a "מוצרים פופולריים" row
// in place of the old per-visitor "נצפה לאחרונה" row, which only ever
// reflected one person's own browsing (stored in their own browser) rather
// than what people across the whole site actually buy.
//
// The `orders` table itself has no public RLS policy (see schema.sql) -
// intentionally, since order rows hold customer names/phones/addresses.
// This route runs server-side with the service-role key and only ever
// sends back anonymous { id, qty } totals, never anything from `customer`
// or any other order field.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Only the fields needed to tally quantities - never customer/notes/etc.
  // Capped at the most recent 1000 non-cancelled orders so this stays fast
  // and "popular" tracks recent taste rather than being dominated by a
  // single old promo/bulk order from years ago.
  const { data, error } = await withFriendlyError(
    supabase
      .from('orders')
      .select('items, status, created_at')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1000)
  );

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const totals = {};
  (data || []).forEach(function (order) {
    let items;
    try {
      items = Array.isArray(order.items) ? order.items : JSON.parse(order.items);
    } catch (e) {
      items = [];
    }
    (items || []).forEach(function (it) {
      const id = it && it.id;
      if (!id) return;
      const qty = Number(it.qty) || 1;
      totals[id] = (totals[id] || 0) + qty;
    });
  });

  const popular = Object.keys(totals)
    .map(function (id) { return { id: id, qty: totals[id] }; })
    .sort(function (a, b) { return b.qty - a.qty; })
    .slice(0, 12);

  // Cheap CDN/browser caching - this never needs to be second-by-second
  // fresh, and it saves recomputing the same aggregation on every visitor.
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  return res.status(200).json({ popular: popular });
};
