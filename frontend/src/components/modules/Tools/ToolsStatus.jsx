import { useState, useEffect } from 'react';
import { getHealthStatus } from '../../../api/client.js';
import { ModuleHeader, Button, Badge } from '../../shared/ModuleLayout.jsx';
import styles from './ToolsStatus.module.css';

export default function ToolsStatus() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await getHealthStatus();
      setHealth(data);
      setLastChecked(new Date());
    } catch (e) {
      setHealth({ status: 'error', error: e.message, services: [] });
    } finally {
      setLoading(false);
    }
  }

  const overall = health?.status === 'ok' ? 'Operational' : health?.status === 'degraded' ? 'Degraded' : health?.status === 'error' ? 'Error' : '—';
  const overallColor = health?.status === 'ok' ? 'var(--color-cso)' : health?.status === 'degraded' ? 'var(--color-gold)' : 'var(--color-error)';

  return (
    <div className={styles.container}>
      <ModuleHeader
        icon="⚙"
        title="Tools & Tech"
        subtitle="System health, API connections, service status"
        actions={
          <div className={styles.headerRight}>
            {lastChecked && (
              <span className={styles.lastChecked}>
                Last checked {lastChecked.toLocaleTimeString()}
              </span>
            )}
            <Button variant="default" size="sm" onClick={load} disabled={loading}>
              {loading ? '⟳ Checking…' : '↺ Refresh'}
            </Button>
          </div>
        }
      />

      <div className={styles.body}>
        {/* Overall status banner */}
        {health && (
          <div className={styles.overallBanner} style={{ borderColor: overallColor }}>
            <div className={styles.overallLeft}>
              <span className={styles.overallDot} style={{ background: overallColor }} />
              <span className={styles.overallLabel}>System Status</span>
            </div>
            <Badge color={overallColor}>{overall}</Badge>
          </div>
        )}

        {loading && !health && <div className={styles.loading}>Checking services…</div>}

        {health?.services?.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Services</h2>
            <div className={styles.serviceGrid}>
              {health.services.map((svc, i) => (
                <ServiceCard key={i} svc={svc} />
              ))}
            </div>
          </section>
        )}

        {health?.apis?.length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>API Connections</h2>
            <div className={styles.apiList}>
              {health.apis.map((api, i) => (
                <ApiRow key={i} api={api} />
              ))}
            </div>
          </section>
        )}

        {health?.env_vars && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Environment</h2>
            <div className={styles.envGrid}>
              {Object.entries(health.env_vars).map(([key, present]) => (
                <div key={key} className={styles.envRow}>
                  <span className={styles.envKey}>{key}</span>
                  <span className={styles.envDot} style={{ color: present ? 'var(--color-cso)' : 'var(--color-error)' }}>
                    {present ? '✓ Set' : '✗ Missing'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {health?.error && (
          <div className={styles.errorBlock}>
            <span className={styles.errorLabel}>Error</span>
            <p className={styles.errorMsg}>{health.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceCard({ svc }) {
  const color = svc.status === 'ok' ? 'var(--color-cso)' : svc.status === 'degraded' ? 'var(--color-gold)' : 'var(--color-error)';
  return (
    <div className={styles.serviceCard}>
      <div className={styles.serviceTop}>
        <span className={styles.serviceName}>{svc.name}</span>
        <Badge color={color}>{svc.status}</Badge>
      </div>
      {svc.latency_ms != null && (
        <span className={styles.serviceMeta}>{svc.latency_ms}ms</span>
      )}
      {svc.note && <p className={styles.serviceNote}>{svc.note}</p>}
    </div>
  );
}

function ApiRow({ api }) {
  const color = api.configured ? 'var(--color-cso)' : 'var(--color-error)';
  return (
    <div className={styles.apiRow}>
      <div className={styles.apiLeft}>
        <span className={styles.apiName}>{api.name}</span>
        {api.model && <span className={styles.apiMeta}>{api.model}</span>}
      </div>
      <Badge color={color}>{api.configured ? 'Configured' : 'Missing'}</Badge>
    </div>
  );
}
