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
    const { data, error } = await withFriendlyError(
      supabase.from('product_overrides').select('*').eq('active', true)
    );

    if (error) {
      return res.status(500).json({ error: error.message });
    }
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

    const { id, name, price, compareAtPrice, image, outOfStock, active } = body || {};
    if (!id) {
      return res.status(400).json({ error: 'Product id is required.' });
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
    await logAdminAction(supabase, session.user, 'product_upsert', id, { name, price, compareAtPrice, image, outOfStock, active }, getClientIp(req));
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
