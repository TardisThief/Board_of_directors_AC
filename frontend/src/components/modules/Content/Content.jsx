import { useState, useEffect, useRef } from 'react';
import { getAssets, getTrends, getProposals, getSchedule, refreshTrends, generateProposals, createScheduleEntry, updateScheduleEntry, deleteScheduleEntry } from '../../../api/client.js';
import { ModuleHeader, Button, Badge, EmptyState } from '../../shared/ModuleLayout.jsx';
import styles from './Content.module.css';

const TABS = ['vault', 'trends', 'proposals', 'calendar'];

export default function Content() {
  const [tab, setTab] = useState('vault');
  const [assets, setAssets] = useState([]);
  const [trends, setTrends] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestProgress, setIngestProgress] = useState(null);

  useEffect(() => { loadTab(tab); }, [tab]);

  async function loadTab(t) {
    setLoading(true);
    try {
      if (t === 'vault') setAssets(await getAssets({ limit: 60 }));
      if (t === 'trends') setTrends(await getTrends());
      if (t === 'proposals') setProposals(await getProposals());
      if (t === 'calendar') setSchedule(await getSchedule());
    } finally { setLoading(false); }
  }

  async function handleIngest(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = '';
    setIngesting(true);
    setIngestProgress({ step: 'Uploading…' });

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    try {
      const res = await fetch('/api/content/assets/ingest', { method: 'POST', body: formData });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.done) { await loadTab('vault'); }
            else { setIngestProgress(d); }
          } catch { /* */ }
        }
      }
    } finally { setIngesting(false); setIngestProgress(null); }
  }

  async function handleRefreshTrends() {
    setLoading(true);
    try { await refreshTrends(); setTrends(await getTrends()); }
    finally { setLoading(false); }
  }

  async function handleGenerateProposals(trendId) {
    setLoading(true);
    try { await generateProposals([trendId], 'b-roll'); setProposals(await getProposals()); setTab('proposals'); }
    finally { setLoading(false); }
  }

  return (
    <div className={styles.container}>
      <ModuleHeader
        icon="◐"
        title="Marketing & Content"
        subtitle="Asset vault, trends, proposals, content calendar"
        actions={
          tab === 'vault' ? (
            <Button variant="primary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={ingesting}>
              {ingesting ? `⟳ ${ingestProgress?.current || 'Ingesting…'}` : '+ Add Assets'}
            </Button>
          ) : tab === 'trends' ? (
            <Button variant="default" size="sm" onClick={handleRefreshTrends} disabled={loading}>↺ Refresh Trends</Button>
          ) : null
        }
      />

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.active : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {loading && <div className={styles.loading}>Loading…</div>}

        {!loading && tab === 'vault' && (
          assets.length === 0
            ? <EmptyState icon="◐" title="Empty vault" body="Add images and videos to start building your content library." action={<Button variant="primary" size="md" onClick={() => fileInputRef.current?.click()}>Add Assets</Button>} />
            : (
              <div className={styles.grid}>
                {assets.map(a => (
                  <div key={a.id} className={styles.assetCard}>
                    {a.type === 'image'
                      ? <img src={a.public_url} alt={a.filename} className={styles.assetImg} />
                      : <div className={styles.videoThumb}>▶</div>
                    }
                    <div className={styles.assetMeta}>
                      <span className={styles.assetName}>{a.filename}</span>
                      {a.vibes?.slice(0, 2).map(v => <Badge key={v}>{v}</Badge>)}
                    </div>
                  </div>
                ))}
              </div>
            )
        )}

        {!loading && tab === 'trends' && (
          trends.length === 0
            ? <EmptyState icon="◐" title="No active trends" body="Refresh to scrape the latest TikTok and Instagram trends." action={<Button variant="primary" size="md" onClick={handleRefreshTrends}>Refresh Trends</Button>} />
            : (
              <div className={styles.list}>
                {trends.map(t => (
                  <div key={t.id} className={styles.trendCard}>
                    <div className={styles.trendTop}>
                      <span className={styles.trendName}>{t.name}</span>
                      <div className={styles.trendMeta}>
                        <Badge color="var(--color-cmo)">{t.platform}</Badge>
                        <span className={styles.heat}>🔥 {t.heat_score}</span>
                      </div>
                    </div>
                    {t.trending_hashtags?.length > 0 && (
                      <p className={styles.hashtags}>{t.trending_hashtags.slice(0, 5).join(' ')}</p>
                    )}
                    <Button variant="default" size="sm" onClick={() => handleGenerateProposals(t.id)}>Generate Proposal</Button>
                  </div>
                ))}
              </div>
            )
        )}

        {!loading && tab === 'proposals' && (
          proposals.length === 0
            ? <EmptyState icon="◐" title="No proposals" body="Go to Trends and generate a proposal from an active trend." />
            : (
              <div className={styles.list}>
                {proposals.map(p => (
                  <div key={p.id} className={styles.proposalCard}>
                    <div className={styles.proposalTop}>
                      <span className={styles.proposalTrend}>{p.trends?.name || 'Proposal'}</span>
                      <Badge color={p.status === 'pending' ? 'var(--color-gold)' : 'var(--color-cso)'}>{p.status}</Badge>
                    </div>
                    {p.caption && <p className={styles.caption}>{p.caption}</p>}
                    <div className={styles.proposalActions}>
                      <Button variant="primary" size="sm" onClick={async () => {
                        const title = p.trends?.name || 'Post';
                        await createScheduleEntry({ title, caption: p.caption, proposal_id: p.id, status: 'draft', platforms: ['instagram', 'tiktok'] });
                        setTab('calendar');
                      }}>→ Schedule</Button>
                    </div>
                  </div>
                ))}
              </div>
            )
        )}

        {!loading && tab === 'calendar' && (
          <CalendarView schedule={schedule} onRefresh={() => loadTab('calendar')} />
        )}
      </div>

      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleIngest}
        accept="image/*,video/*" />
    </div>
  );
}

function CalendarView({ schedule, onRefresh }) {
  const [newPost, setNewPost] = useState(null);

  async function handleDelete(id) {
    await deleteScheduleEntry(id);
    onRefresh();
  }

  const byStatus = (s) => schedule.filter(p => p.status === s);

  return (
    <div className={styles.calendarLayout}>
      <div className={styles.calColumns}>
        {['draft', 'scheduled', 'published'].map(s => (
          <div key={s} className={styles.calColumn}>
            <div className={styles.colHeader}>
              <Badge color={s === 'draft' ? 'var(--color-gold)' : s === 'scheduled' ? 'var(--color-cto)' : 'var(--color-cso)'}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Badge>
              <span className={styles.colCount}>{byStatus(s).length}</span>
            </div>
            {byStatus(s).map(post => (
              <div key={post.id} className={styles.calCard}>
                <p className={styles.calTitle}>{post.title}</p>
                {post.scheduled_at && <span className={styles.calDate}>{new Date(post.scheduled_at).toLocaleDateString()}</span>}
                {post.platforms?.length > 0 && (
                  <div className={styles.platforms}>
                    {post.platforms.map(p => <Badge key={p}>{p}</Badge>)}
                  </div>
                )}
                <button className={styles.deleteBtn} onClick={() => handleDelete(post.id)}>✕</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
