import { useState, useEffect } from 'react';
import { getLabMetrics } from '../../../api/client.js';
import { ModuleHeader, KPICard, Button, Badge, EmptyState } from '../../shared/ModuleLayout.jsx';
import styles from './Operations.module.css';

export default function Operations() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getLabMetrics();
      setMetrics(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <ModuleHeader
        icon="◫"
        title="Operations"
        subtitle="AC Styling Lab — members, services, activity"
        actions={<Button variant="default" size="sm" onClick={load} disabled={loading}>↺ Refresh</Button>}
      />

      {loading && <div className={styles.loading}>Loading…</div>}

      {error && (
        <div className={styles.errorBanner}>
          <span>Could not load Lab data: {error}</span>
          <Button variant="default" size="sm" onClick={load}>Retry</Button>
        </div>
      )}

      {!loading && !error && metrics && (
        <>
          {/* KPI row */}
          <div className={styles.kpiRow}>
            <KPICard
              label="Total Members"
              value={metrics.total_members ?? '—'}
              accent="var(--color-coo)"
            />
            <KPICard
              label="Active Services"
              value={metrics.active_services ?? '—'}
              accent="var(--color-coo)"
            />
            <KPICard
              label="Purchases (30d)"
              value={metrics.purchases_30d ?? '—'}
              accent="var(--color-coo)"
            />
            <KPICard
              label="Revenue (30d)"
              value={metrics.revenue_30d != null ? `$${Number(metrics.revenue_30d).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
              accent="var(--color-coo)"
            />
          </div>

          <div className={styles.body}>
            <div className={styles.columns}>
              {/* Recent purchases */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Recent Purchases</h2>
                {metrics.recent_purchases?.length > 0 ? (
                  <div className={styles.purchaseList}>
                    {metrics.recent_purchases.map((p, i) => (
                      <div key={i} className={styles.purchaseRow}>
                        <div className={styles.purchaseLeft}>
                          <span className={styles.purchaseName}>{p.customer_name || 'Member'}</span>
                          <span className={styles.purchaseService}>{p.service_name || p.product_name || '—'}</span>
                        </div>
                        <div className={styles.purchaseRight}>
                          {p.amount != null && (
                            <span className={styles.purchaseAmt}>
                              ${Number(p.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          )}
                          <span className={styles.purchaseDate}>
                            {p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon="◫" title="No recent purchases" body="No purchases found in the last 30 days." />
                )}
              </section>

              {/* Services breakdown */}
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Services Offered</h2>
                {metrics.services?.length > 0 ? (
                  <div className={styles.serviceList}>
                    {metrics.services.map((s, i) => (
                      <div key={i} className={styles.serviceRow}>
                        <span className={styles.serviceName}>{s.name}</span>
                        <div className={styles.serviceRight}>
                          {s.price != null && (
                            <span className={styles.servicePrice}>
                              ${Number(s.price).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                            </span>
                          )}
                          <Badge color={s.active ? 'var(--color-coo)' : 'var(--color-text-muted)'}>
                            {s.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon="◫" title="No services" body="No services found in the AC Lab database." />
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {!loading && !error && !metrics && (
        <EmptyState icon="◫" title="No data" body="Could not retrieve Lab metrics." action={<Button variant="primary" size="md" onClick={load}>Load Data</Button>} />
      )}
    </div>
  );
}
