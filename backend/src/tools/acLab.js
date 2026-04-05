import { createClient } from '@supabase/supabase-js';

function getLabClient() {
  const url = process.env.AC_LAB_SUPABASE_URL;
  const key = process.env.AC_LAB_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getStatus() {
  const db = getLabClient();
  if (!db) return { online: false, recentPurchases: 0, activeProfiles: 0 };

  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: purchases } = await db
      .from('purchases')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);
    const { count: profiles } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    return {
      online: true,
      recentPurchases: purchases ?? 0,
      activeProfiles: profiles ?? 0,
    };
  } catch {
    return { online: false, recentPurchases: 0, activeProfiles: 0 };
  }
}

export async function getCFOContext() {
  const db = getLabClient();
  if (!db) return null;

  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: purchases }, { data: offers }] = await Promise.all([
      db.from('purchases')
        .select('amount, created_at, offer_id')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('offers')
        .select('id, title, price')
        .limit(20),
    ]);

    if (!purchases?.length) return null;

    const offerMap = Object.fromEntries((offers || []).map(o => [o.id, o]));
    const total = purchases.reduce((s, p) => s + (p.amount || 0), 0);

    const lines = ['## AC Styling Lab — Revenue Data (Last 30 Days)'];
    lines.push(`\n- **Total revenue:** $${(total / 100).toFixed(2)}`);
    lines.push(`- **Purchases:** ${purchases.length}`);

    const byOffer = {};
    purchases.forEach(p => {
      if (p.offer_id) {
        byOffer[p.offer_id] = (byOffer[p.offer_id] || 0) + 1;
      }
    });
    const topOffers = Object.entries(byOffer).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topOffers.length) {
      lines.push('\n### Top Selling Offers');
      topOffers.forEach(([id, count]) => {
        const offer = offerMap[id];
        const name = offer?.title || id;
        lines.push(`- ${name}: ${count} sale${count !== 1 ? 's' : ''}`);
      });
    }

    return lines.join('\n');
  } catch {
    return null;
  }
}

export async function getCOOContext() {
  const db = getLabClient();
  if (!db) return null;

  try {
    const { data: recentServices } = await db
      .from('services')
      .select('title, status')
      .limit(10);

    const { count: totalProfiles } = await db
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    if (!recentServices?.length) return null;

    const lines = ['## AC Styling Lab — Operations Overview'];
    lines.push(`\n- **Total members:** ${totalProfiles ?? 0}`);
    if (recentServices?.length) {
      lines.push('\n### Active Services');
      recentServices.forEach(s => {
        lines.push(`- ${s.title}${s.status ? ` [${s.status}]` : ''}`);
      });
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}
