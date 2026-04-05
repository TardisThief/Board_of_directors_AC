import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// AC Lab Supabase client (read-only, service role for internal use)
const labClient = process.env.AC_LAB_SUPABASE_URL && process.env.AC_LAB_SUPABASE_SERVICE_KEY
  ? createClient(process.env.AC_LAB_SUPABASE_URL, process.env.AC_LAB_SUPABASE_SERVICE_KEY)
  : null;

// GET /api/operations/lab-metrics
router.get('/lab-metrics', async (_req, res) => {
  if (!labClient) {
    return res.status(503).json({ error: 'AC Lab Supabase not configured' });
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Run queries in parallel — adapt table names to AC Lab schema as needed
    const [membersRes, purchasesRes, servicesRes] = await Promise.allSettled([
      labClient.from('profiles').select('id', { count: 'exact', head: true }),
      labClient
        .from('orders')
        .select('id, amount, created_at, user_id, service_id')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(20),
      labClient.from('services').select('id, name, price, active').order('name'),
    ]);

    // Members count
    const total_members = membersRes.status === 'fulfilled' ? (membersRes.value.count ?? 0) : null;

    // Recent purchases + 30d revenue
    let recent_purchases = [];
    let purchases_30d = 0;
    let revenue_30d = 0;
    let active_services = null;

    if (purchasesRes.status === 'fulfilled' && purchasesRes.value.data) {
      recent_purchases = purchasesRes.value.data;
      purchases_30d = recent_purchases.length;
      revenue_30d = recent_purchases.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    }

    // Services
    let services = [];
    if (servicesRes.status === 'fulfilled' && servicesRes.value.data) {
      services = servicesRes.value.data;
      active_services = services.filter(s => s.active).length;
    }

    res.json({
      total_members,
      active_services,
      purchases_30d,
      revenue_30d,
      recent_purchases,
      services,
    });
  } catch (err) {
    console.error('[Operations] lab-metrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
