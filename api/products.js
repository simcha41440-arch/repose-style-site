const { getSupabase, withFriendlyError } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/session');
const { parseJsonBody } = require('./_lib/parseJson');
const { getClientIp, logAdminAction } = require('./_lib/security');

// This endpoint stores "overrides" on top of the product catalog that
// is baked into index.html (id, name, price, active). The storefront
// fetches GET /api/products on load and merges any active overrides
// over the static catalog, so changing a price or deactivating a
// product here is reflected for every visitor - not just the browser
// that made the change.
module.exports = async (req, res) => {
  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (req.method === 'GET') {
    // ?popular=1 - a completely separate, public, read-only query: the
    // top-selling product ids/quantities, aggregated from real orders.
    // Used by the storefront to render a "מוצרים פופולריים" row instead of
    // the old per-visitor "recently viewed" one. Handled here (instead of
    // its own /api/popular-products.js file) to avoid adding another
    // serverless function to the project - Vercel's plan caps how many a
    // single project can have, and this project is already at that cap.
    if (req.query && req.query.popular) {
      const { data: orderRows, error: ordersErr } = await withFriendlyError(
        supabase
          .from('orders')
          .select('items, status, created_at')
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(1000)
      );
      if (ordersErr) {
        return res.status(500).json({ error: ordersErr.message });
      }
      const totals = {};
      (orderRows || []).forEach(function (order) {
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
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      return res.status(200).json({ popular: popular });
    }

    // Returns EVERY override row, active and inactive alike - not just
    // active=true ones. The storefront (applyAdminOverrides in index.html)
    // needs to see active:false rows too, since that's how it knows to hide
    // a built-in catalog product that an admin deleted; if this only
    // returned active rows, a deleted product would just vanish from the
    // response and silently fall back to being shown again.
    const { data, error } = await withFriendlyError(
      supabase.from('product_overrides').select('*')
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    // Same reasoning as /api/content: cache at the edge so every visitor
    // doesn't wait on a fresh Supabase round-trip. Price/availability
    // changes still show up within ~60s.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=3600');
    return res.status(200).json({ products: data });
  }

  // Every other method (create/update/delete) is admin-only.
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method === 'POST' || req.method === 'PUT') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { id, name, price, compareAtPrice, image, outOfStock, active, category, details } = body || {};
    if (!id) {
      return res.status(400).json({ error: 'Product id is required.' });
    }
    // Keeps ids URL/DOM-safe (used as a query param in product links, and
    // as a DOM id/data attribute all over index.html) - applies to both
    // overrides of existing catalog ids (which already match this) and
    // brand-new ids typed in the admin panel's "הוספת מוצר חדש" form.
    if (!/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'מזהה מוצר יכול להכיל רק אותיות אנגליות קטנות, מספרים ומקף (-).' });
    }
    let compareAtPriceNum;
    if (compareAtPrice === undefined) {
      compareAtPriceNum = undefined; // not provided at all - leave whatever is already saved untouched
    } else if (compareAtPrice === null || compareAtPrice === '') {
      compareAtPriceNum = null; // explicitly clearing the sale price
    } else {
      compareAtPriceNum = Number(compareAtPrice);
      if (!Number.isFinite(compareAtPriceNum) || compareAtPriceNum <= 0) {
        return res.status(400).json({ error: 'Compare-at price must be a positive number.' });
      }
    }

    // Merge onto whatever is already saved for this id, instead of blindly
    // upserting - the admin form only sends the fields it actually wants to
    // change (e.g. just the name, or just a sale price), and a plain upsert
    // would silently wipe every field it didn't send back to null. This
    // was a real bug: editing just the name on a product that already had
    // a custom price used to reset that price back to the site default.
    const { data: existingRows } = await withFriendlyError(
      supabase.from('product_overrides').select('*').eq('id', id).limit(1)
    );
    const existing = existingRows && existingRows[0];

    const upsertRow = {
      id,
      name: name !== undefined ? (name || null) : (existing ? existing.name : null),
      price: price !== undefined ? (price === '' ? null : price) : (existing ? existing.price : null),
      compare_at_price: compareAtPriceNum !== undefined ? compareAtPriceNum : (existing ? existing.compare_at_price : null),
      image: image !== undefined ? (image || null) : (existing ? existing.image : null),
      out_of_stock: outOfStock !== undefined ? !!outOfStock : (existing ? !!existing.out_of_stock : false),
      active: active !== undefined ? !!active : (existing ? existing.active : true),
      // category/details only apply to brand-new products added from the
      // admin panel's "הוספת מוצר חדש" form (see index.html's
      // applyAdminOverrides, which pushes a full new product into
      // PRODUCTS for any override row whose id isn't already in the
      // built-in catalog). Left untouched on plain price/name overrides
      // of existing catalog products, same merge-onto-existing pattern as
      // every other field here.
      category: category !== undefined ? (category || null) : (existing ? existing.category : null),
      details: details !== undefined ? (details || null) : (existing ? existing.details : null),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await withFriendlyError(
      supabase
        .from('product_overrides')
        .upsert(upsertRow, { onConflict: 'id' })
        .select()
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'product_upsert', id, { name, price, compareAtPrice, image, outOfStock, active, category }, getClientIp(req));
    return res.status(200).json({ product: data && data[0] });
  }

  if (req.method === 'DELETE') {
    const id = req.query && req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'Product id is required.' });
    }

    const { error } = await withFriendlyError(
      supabase.from('product_overrides').delete().eq('id', id)
    );
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    await logAdminAction(supabase, session.user, 'product_delete', id, null, getClientIp(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method not allowed.' });
};
