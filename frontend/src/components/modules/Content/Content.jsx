import { useState, useEffect, useRef } from 'react';
import { getAssets, getTrends, getProposals, getSchedule, refreshTrends, createScheduleEntry,
  deleteScheduleEntry, updateScheduleEntry, swapProposalAsset, generateProposalCaptions,
  updateProposalStatus, getBrandVoice, updateBrandVoice, learnBrandVoice } from '../../../api/client.js';
import { ModuleHeader, Button, Badge, EmptyState } from '../../shared/ModuleLayout.jsx';
import styles from './Content.module.css';

const TABS = ['vault', 'trends', 'proposals', 'calendar', 'brand voice'];

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
    try {
      const result = await refreshTrends();
      setTrends(await getTrends());
      console.log('[Trends] Refresh result:', result);
    } finally { setLoading(false); }
  }

  async function handleGenerateProposals() {
    setLoading(true);
    try {
      await fetch('/api/content/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'b-roll', max: 5 }) });
      setProposals(await getProposals());
      setTab('proposals');
    } finally { setLoading(false); }
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
          ) : tab === 'proposals' ? (
            <Button variant="default" size="sm" onClick={handleGenerateProposals} disabled={loading}>⟳ Generate</Button>
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
            ? <EmptyState icon="◐" title="No active trends" body="Refresh to scrape the latest TikTok trends." action={<Button variant="primary" size="md" onClick={handleRefreshTrends}>Refresh Trends</Button>} />
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
                    <Button variant="default" size="sm" onClick={handleGenerateProposals} disabled={loading}>Generate Proposals</Button>
                  </div>
                ))}
              </div>
            )
        )}

        {!loading && tab === 'proposals' && (
          proposals.length === 0
            ? <EmptyState icon="◐" title="No proposals" body="Go to Trends and generate proposals from active trends." action={<Button variant="primary" size="md" onClick={handleGenerateProposals}>Generate Proposals</Button>} />
            : (
              <div className={styles.list}>
                {proposals.map(p => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    onRefresh={() => loadTab('proposals')}
                    onSchedule={async () => {
                      const title = p.trend?.name || 'Post';
                      await createScheduleEntry({ title, caption: p.caption, proposal_id: p.id, status: 'draft', platforms: ['instagram', 'tiktok'] });
                      setTab('calendar');
                    }}
                  />
                ))}
              </div>
            )
        )}

        {!loading && tab === 'calendar' && (
          <CalendarView schedule={schedule} onRefresh={() => loadTab('calendar')} />
        )}

        {tab === 'brand voice' && (
          <BrandVoicePanel />
        )}
      </div>

      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleIngest}
        accept="image/*,video/*" />
    </div>
  );
}

// ── Proposal Card ─────────────────────────────────────────────────────────────

function ProposalCard({ proposal: p, onRefresh, onSchedule }) {
  const [expanded, setExpanded] = useState(false);
  const [captions, setCaptions] = useState(p.caption_variants || []);
  const [selectedCaption, setSelectedCaption] = useState(p.caption || '');
  const [generating, setGenerating] = useState(false);
  const [swapping, setSwapping] = useState({});

  async function handleGenerateCaptions() {
    setGenerating(true);
    try {
      const result = await generateProposalCaptions(p.id);
      setCaptions(result.captions || []);
      if (result.captions?.[0]) setSelectedCaption(result.captions[0]);
    } finally { setGenerating(false); }
  }

  async function handleSwap(slotLabel) {
    setSwapping(s => ({ ...s, [slotLabel]: true }));
    try {
      await swapProposalAsset(p.id, slotLabel);
      onRefresh();
    } finally { setSwapping(s => ({ ...s, [slotLabel]: false })); }
  }

  async function handleDismiss() {
    await updateProposalStatus(p.id, 'dismissed');
    onRefresh();
  }

  const slots = p.matched_assets || [];

  return (
    <div className={styles.proposalCard}>
      <div className={styles.proposalTop}>
        <span className={styles.proposalTrend}>{p.trend?.name || 'Proposal'}</span>
        <Badge color={p.status === 'pending' ? 'var(--color-gold)' : 'var(--color-cso)'}>{p.status}</Badge>
      </div>

      {/* Asset slots */}
      {slots.length > 0 && (
        <div className={styles.slotRow}>
          {slots.map(slot => (
            <div key={slot.slot_label} className={styles.slot}>
              {slot.asset?.public_url
                ? <img src={slot.asset.public_url} alt={slot.slot_label} className={styles.slotImg} />
                : <div className={styles.slotEmpty}>No asset</div>
              }
              <div className={styles.slotMeta}>
                <span className={styles.slotLabel}>{slot.slot_label}</span>
                <button className={styles.swapBtn} onClick={() => handleSwap(slot.slot_label)} disabled={swapping[slot.slot_label]}>
                  {swapping[slot.slot_label] ? '…' : '⇄'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Caption */}
      {selectedCaption && <p className={styles.caption}>{selectedCaption}</p>}

      {/* Caption variants */}
      {expanded && captions.length > 1 && (
        <div className={styles.captionVariants}>
          {captions.map((c, i) => (
            <button
              key={i}
              className={`${styles.captionOption} ${c === selectedCaption ? styles.captionSelected : ''}`}
              onClick={() => setSelectedCaption(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className={styles.proposalActions}>
        <Button variant="primary" size="sm" onClick={onSchedule}>→ Schedule</Button>
        <Button variant="default" size="sm" onClick={() => { setExpanded(e => !e); if (!expanded && !captions.length) handleGenerateCaptions(); }}>
          {expanded ? '▲ Collapse' : '▼ Captions'}
        </Button>
        {expanded && <Button variant="default" size="sm" onClick={handleGenerateCaptions} disabled={generating}>{generating ? '⟳' : '↺ Regenerate'}</Button>}
        <Button variant="danger" size="sm" onClick={handleDismiss}>✕</Button>
      </div>
    </div>
  );
}

// ── Calendar View ──────────────────────────────────────────────────────────────

function CalendarView({ schedule, onRefresh }) {
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

// ── Brand Voice Panel ─────────────────────────────────────────────────────────

function BrandVoicePanel() {
  const [voice, setVoice] = useState(null);
  const [desc, setDesc] = useState('');
  const [samples, setSamples] = useState('');
  const [saving, setSaving] = useState(false);
  const [learning, setLearning] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getBrandVoice().then(v => {
      setVoice(v);
      setDesc(v?.voice_description || '');
      setSamples((v?.sample_captions || []).join('\n'));
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateBrandVoice(desc, samples.split('\n').map(s => s.trim()).filter(Boolean));
      setSaved(true);
    } finally { setSaving(false); }
  }

  async function handleLearn() {
    setLearning(true);
    try {
      const result = await learnBrandVoice();
      setVoice(v => ({ ...v, learned_style: result.learned_style }));
    } finally { setLearning(false); }
  }

  return (
    <div className={styles.brandVoice}>
      <div className={styles.brandVoiceForm}>
        <div className={styles.bvField}>
          <label className={styles.bvLabel}>Brand Voice Description</label>
          <textarea
            className={styles.bvTextarea}
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Describe AC Styling's brand voice — tone, personality, who you're speaking to…"
            rows={4}
          />
        </div>
        <div className={styles.bvField}>
          <label className={styles.bvLabel}>Sample Captions (one per line)</label>
          <textarea
            className={styles.bvTextarea}
            value={samples}
            onChange={e => setSamples(e.target.value)}
            placeholder="Paste example captions from past posts, one per line…"
            rows={5}
          />
        </div>
        <div className={styles.bvActions}>
          <Button variant="primary" size="md" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Voice'}
          </Button>
          <Button variant="default" size="md" onClick={handleLearn} disabled={learning}>
            {learning ? '⟳ Learning…' : '✦ Learn from Vault'}
          </Button>
        </div>
      </div>

      {voice?.learned_style && (
        <div className={styles.learnedStyle}>
          <p className={styles.bvLabel}>Learned Style</p>
          <div className={styles.learnedGrid}>
            {voice.learned_style.tone?.length > 0 && (
              <div><span className={styles.learnedKey}>Tone</span><span>{voice.learned_style.tone.join(', ')}</span></div>
            )}
            {voice.learned_style.emoji_usage && (
              <div><span className={styles.learnedKey}>Emoji usage</span><span>{voice.learned_style.emoji_usage}</span></div>
            )}
            {voice.learned_style.sentence_length && (
              <div><span className={styles.learnedKey}>Sentence length</span><span>{voice.learned_style.sentence_length}</span></div>
            )}
            {voice.learned_style.personality_traits?.length > 0 && (
              <div><span className={styles.learnedKey}>Personality</span><span>{voice.learned_style.personality_traits.join(', ')}</span></div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
