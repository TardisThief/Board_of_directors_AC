import { useState, useEffect } from 'react';
import {
  getLeads, approveLead, rejectLead, runLeadScout, runLeadPipeline,
  pauseLead, resumeLead, editLeadDraft,
  getLeadEvents, getLeadRuns,
  getDiscoverySources, createDiscoverySource, updateDiscoverySource, deleteDiscoverySource,
  runSource, previewSourceQuery, updateLead,
} from '../../../api/client.js';
import { ModuleHeader, Badge, Button, EmptyState } from '../../shared/ModuleLayout.jsx';
import styles from './LeadsPipeline.module.css';

const STAGES = [
  { status: 'DISCOVERED', label: 'Discovered', color: 'var(--color-text-muted)' },
  { status: 'PROFILING',  label: 'Profiling',  color: 'var(--color-cto)' },
  { status: 'CURATED',    label: 'Curated',    color: 'var(--color-cto)' },
  { status: 'DRAFTED',    label: 'Drafted',    color: 'var(--color-cmo)' },
  { status: 'REVIEW',     label: 'Review',     color: 'var(--color-gold)' },
  { status: 'SENT',       label: 'Sent',       color: 'var(--color-cso)' },
  { status: 'REJECTED',   label: 'Rejected',   color: 'var(--color-error)' },
  { status: 'PAUSED',     label: 'Paused',     color: 'var(--color-text-muted)' },
];

const TABS = ['pipeline', 'sources'];

export default function LeadsPipeline() {
  const [tab, setTab] = useState('pipeline');
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [scouting, setScouting] = useState(false);
  const [processing, setProcessing] = useState({});
  const [filterStatus, setFilterStatus] = useState(null);

  useEffect(() => { if (tab === 'pipeline') loadLeads(); }, [tab]);

  async function loadLeads() {
    const data = await getLeads();
    setLeads(data);
  }

  async function scout() {
    setScouting(true);
    try { await runLeadScout(); await loadLeads(); }
    finally { setScouting(false); }
  }

  async function runPipeline(id) {
    setProcessing(p => ({ ...p, [id]: true }));
    try { await runLeadPipeline(id); await loadLeads(); }
    finally { setProcessing(p => ({ ...p, [id]: false })); }
  }

  async function approve(id) {
    await approveLead(id);
    await loadLeads();
    if (selected?.id === id) setSelected(null);
  }

  async function reject(id) {
    await rejectLead(id);
    await loadLeads();
    if (selected?.id === id) setSelected(null);
  }

  async function handlePause(id) {
    await pauseLead(id);
    await loadLeads();
    if (selected?.id === id) setSelected(prev => ({ ...prev, status: 'PAUSED' }));
  }

  async function handleResume(id) {
    await resumeLead(id);
    await loadLeads();
    if (selected?.id === id) setSelected(prev => ({ ...prev, status: prev.paused_from_status || 'DISCOVERED' }));
  }

  const filtered = filterStatus ? leads.filter(l => l.status === filterStatus) : leads;

  return (
    <div className={styles.container}>
      <ModuleHeader
        icon="⟢"
        title="Sales & Leads"
        subtitle={`${leads.length} total leads`}
        actions={
          tab === 'pipeline' ? (
            <Button variant="primary" size="sm" onClick={scout} disabled={scouting}>
              {scouting ? '⟳ Scouting…' : '⟢ Run Scout'}
            </Button>
          ) : null
        }
      />

      {/* Top-level tabs */}
      <div className={styles.topTabs}>
        {TABS.map(t => (
          <button key={t} className={`${styles.topTab} ${tab === t ? styles.topTabActive : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && (
        <>
          {/* Stage filter bar */}
          <div className={styles.stageBar}>
            <button className={`${styles.stageBtn} ${!filterStatus ? styles.activeStage : ''}`} onClick={() => setFilterStatus(null)}>
              All <span className={styles.stageCt}>{leads.length}</span>
            </button>
            {STAGES.map(s => {
              const ct = leads.filter(l => l.status === s.status).length;
              if (ct === 0) return null;
              return (
                <button
                  key={s.status}
                  className={`${styles.stageBtn} ${filterStatus === s.status ? styles.activeStage : ''}`}
                  style={filterStatus === s.status ? { borderBottomColor: s.color, color: s.color } : {}}
                  onClick={() => setFilterStatus(filterStatus === s.status ? null : s.status)}
                >
                  {s.label} <span className={styles.stageCt}>{ct}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.body}>
            <div className={`${styles.list} ${selected ? styles.split : ''}`}>
              {filtered.length === 0 ? (
                <EmptyState icon="⟢" title="No leads" body="Run the Scout to discover potential clients automatically."
                  action={<Button variant="primary" size="md" onClick={scout} disabled={scouting}>{scouting ? 'Scouting…' : 'Run Scout'}</Button>} />
              ) : filtered.map(lead => (
                <div key={lead.id} className={`${styles.leadCard} ${selected?.id === lead.id ? styles.selectedCard : ''}`} onClick={() => setSelected(lead)}>
                  <div className={styles.leadTop}>
                    <span className={styles.leadName}>{lead.full_name || 'Unknown'}</span>
                    <Badge color={STAGES.find(s => s.status === lead.status)?.color}>{lead.status}</Badge>
                  </div>
                  <p className={styles.leadTrigger}>{lead.trigger_summary || lead.location || '—'}</p>
                  {(lead.status === 'DISCOVERED' || lead.status === 'CURATED' || lead.status === 'DRAFTED') && (
                    <Button variant="default" size="sm" onClick={e => { e.stopPropagation(); runPipeline(lead.id); }} disabled={processing[lead.id]}>
                      {processing[lead.id] ? '⟳ Processing…' : '▶ Run Pipeline'}
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {selected && (
              <LeadDetail
                lead={selected}
                onApprove={approve}
                onReject={reject}
                onPause={handlePause}
                onResume={handleResume}
                onClose={() => setSelected(null)}
                onRefresh={loadLeads}
              />
            )}
          </div>
        </>
      )}

      {tab === 'sources' && <SourcesPanel />}
    </div>
  );
}

// ── Lead Detail Panel ─────────────────────────────────────────────────────────

function LeadDetail({ lead, onApprove, onReject, onPause, onResume, onClose, onRefresh }) {
  const [detailTab, setDetailTab] = useState('overview');
  const [events, setEvents] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(lead.email_subject || '');
  const [body, setBody] = useState(lead.email_body_text || '');
  const [notes, setNotes] = useState(lead.human_notes || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSubject(lead.email_subject || '');
    setBody(lead.email_body_text || '');
    setNotes(lead.human_notes || '');
    setEditing(false);
    setDetailTab('overview');
  }, [lead.id]);

  async function loadEvents() {
    setLoadingEvents(true);
    try {
      const [ev, ru] = await Promise.all([getLeadEvents(lead.id), getLeadRuns(lead.id)]);
      setEvents(ev || []);
      setRuns(ru || []);
    } finally { setLoadingEvents(false); }
  }

  useEffect(() => {
    if (detailTab === 'audit') loadEvents();
  }, [detailTab, lead.id]);

  async function saveDraft() {
    setSaving(true);
    try {
      await editLeadDraft(lead.id, { email_subject: subject, email_body_text: body, human_notes: notes });
      onRefresh();
      setEditing(false);
    } finally { setSaving(false); }
  }

  const DETAIL_TABS = ['overview', 'email', 'audit'];

  return (
    <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div>
          <h2 className={styles.detailName}>{lead.full_name || 'Unknown'}</h2>
          <span className={styles.detailLocation}>{lead.title ? `${lead.title} · ` : ''}{lead.location || '—'}</span>
        </div>
        <div className={styles.detailHeaderActions}>
          {lead.status === 'PAUSED'
            ? <Button variant="default" size="sm" onClick={() => onResume(lead.id)}>▶ Resume</Button>
            : !['SENT', 'REJECTED'].includes(lead.status) && (
                <Button variant="default" size="sm" onClick={() => onPause(lead.id)}>⏸ Pause</Button>
              )
          }
          <button className={styles.closeDetail} onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Detail tabs */}
      <div className={styles.detailTabs}>
        {DETAIL_TABS.map(t => (
          <button key={t} className={`${styles.detailTab} ${detailTab === t ? styles.detailTabActive : ''}`} onClick={() => setDetailTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.detailBody}>
        {detailTab === 'overview' && (
          <>
            {lead.trigger_summary && <Field label="Trigger" value={lead.trigger_summary} />}
            {lead.digital_footprint_summary && <Field label="Profile" value={lead.digital_footprint_summary} />}
            {lead.styling_gap && <Field label="Styling Gap" value={`${lead.styling_gap}${lead.styling_gap_confidence ? ` (${lead.styling_gap_confidence} confidence)` : ''}`} />}
            {lead.tone_notes && <Field label="Tone Notes" value={lead.tone_notes} />}
            {lead.human_notes && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Notes</span>
                {editing
                  ? <textarea className={styles.editTextarea} value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
                  : <p className={styles.fieldValue}>{lead.human_notes}</p>
                }
              </div>
            )}
            {!lead.human_notes && editing && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Notes</span>
                <textarea className={styles.editTextarea} value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes…" />
              </div>
            )}
            {lead.status === 'REVIEW' && !editing && (
              <Button variant="default" size="sm" onClick={() => setEditing(true)}>✎ Edit Draft</Button>
            )}
            {editing && (
              <div className={styles.editActions}>
                <Button variant="primary" size="sm" onClick={saveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button variant="default" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            )}
          </>
        )}

        {detailTab === 'email' && (
          <>
            {editing ? (
              <>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Subject</span>
                  <input className={styles.editInput} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject…" />
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Body</span>
                  <textarea className={styles.editTextarea} value={body} onChange={e => setBody(e.target.value)} rows={14} />
                </div>
                <div className={styles.editActions}>
                  <Button variant="primary" size="sm" onClick={saveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                  <Button variant="default" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </>
            ) : lead.email_subject ? (
              <>
                <div className={styles.emailPreview}>
                  <span className={styles.emailSubject}>Subject: {lead.email_subject}</span>
                  <div className={styles.emailBody}>{lead.email_body_text}</div>
                </div>
                <Button variant="default" size="sm" onClick={() => setEditing(true)}>✎ Edit Email</Button>
              </>
            ) : (
              <EmptyState icon="✉" title="No email draft yet" body="The copywriter will generate a draft once the lead is curated." />
            )}
          </>
        )}

        {detailTab === 'audit' && (
          loadingEvents ? <div className={styles.loadingAudit}>Loading…</div> : (
            <>
              {runs.length > 0 && (
                <div className={styles.auditSection}>
                  <span className={styles.auditSectionLabel}>Agent Runs</span>
                  {runs.map(r => (
                    <div key={r.id} className={styles.auditRun}>
                      <span className={styles.auditRunAgent}>{r.agent_name}</span>
                      <Badge color={r.status === 'completed' ? 'var(--color-cso)' : r.status === 'failed' ? 'var(--color-error)' : 'var(--color-gold)'}>{r.status}</Badge>
                      {r.tokens_used && <span className={styles.auditRunMeta}>{r.tokens_used} tokens</span>}
                      {r.duration_ms && <span className={styles.auditRunMeta}>{(r.duration_ms / 1000).toFixed(1)}s</span>}
                      {r.error_message && <p className={styles.auditRunError}>{r.error_message}</p>}
                    </div>
                  ))}
                </div>
              )}
              {events.length > 0 && (
                <div className={styles.auditSection}>
                  <span className={styles.auditSectionLabel}>Event Log</span>
                  <div className={styles.timeline}>
                    {events.map(e => (
                      <div key={e.id} className={styles.timelineItem}>
                        <div className={styles.timelineDot} />
                        <div className={styles.timelineContent}>
                          <div className={styles.timelineTop}>
                            <span className={styles.timelineEvent}>{e.from_status} → {e.to_status}</span>
                            <span className={styles.timelineActor}>{e.actor}</span>
                          </div>
                          {e.reason && <p className={styles.timelineReason}>{e.reason}</p>}
                          <span className={styles.timelineTime}>{new Date(e.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {events.length === 0 && runs.length === 0 && (
                <EmptyState icon="◎" title="No audit history" body="Events will appear as the lead moves through the pipeline." />
              )}
            </>
          )
        )}
      </div>

      {lead.status === 'REVIEW' && (
        <div className={styles.detailActions}>
          <Button variant="primary" size="md" onClick={() => onApprove(lead.id)}>✓ Approve & Send</Button>
          <Button variant="danger" size="md" onClick={() => onReject(lead.id)}>✕ Reject</Button>
        </div>
      )}
    </div>
  );
}

// ── Discovery Sources Panel ───────────────────────────────────────────────────

function SourcesPanel() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState({});
  const [editing, setEditing] = useState(null); // source id being edited
  const [form, setForm] = useState({ name: '', source_type: 'linkedin_google', category: 'General', query: '', trigger_type: 'promotion' });
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setSources(await getDiscoverySources()); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!form.name || !form.source_type) return;
    await createDiscoverySource({ name: form.name, source_type: form.source_type, category: form.category, config: { query: form.query, trigger_type: form.trigger_type } });
    setAdding(false);
    setForm({ name: '', source_type: 'linkedin_google', category: 'General', query: '', trigger_type: 'promotion' });
    await load();
  }

  async function handleToggle(source) {
    await updateDiscoverySource(source.id, { is_active: !source.is_active });
    await load();
  }

  async function handleDelete(id) {
    await deleteDiscoverySource(id);
    await load();
  }

  async function handleRun(id) {
    setRunning(r => ({ ...r, [id]: true }));
    try { await runSource(id); }
    finally { setRunning(r => ({ ...r, [id]: false })); }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await previewSourceQuery(form.source_type, form.query, form.trigger_type);
      setPreview(result);
    } finally { setPreviewing(false); }
  }

  const SOURCE_TYPES = ['linkedin_google', 'google_news', 'zillow'];

  return (
    <div className={styles.sourcesPanel}>
      <div className={styles.sourcesPanelHeader}>
        <span className={styles.sourcesPanelTitle}>Discovery Sources</span>
        <Button variant="primary" size="sm" onClick={() => setAdding(a => !a)}>{adding ? '✕ Cancel' : '+ Add Source'}</Button>
      </div>

      {adding && (
        <div className={styles.addSourceForm}>
          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Name</label>
              <input className={styles.formInput} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Miami New Homeowners…" />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Type</label>
              <select className={styles.formInput} value={form.source_type} onChange={e => setForm(f => ({ ...f, source_type: e.target.value }))}>
                {SOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Category</label>
              <input className={styles.formInput} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="Real Estate" />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.formField} style={{ flex: 2 }}>
              <label className={styles.formLabel}>Query</label>
              <input className={styles.formInput} value={form.query} onChange={e => setForm(f => ({ ...f, query: e.target.value }))} placeholder="miami realtor promotion OR new job site:linkedin.com" />
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Trigger Type</label>
              <select className={styles.formInput} value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}>
                {['promotion', 'new_home', 'new_job', 'event', 'news'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.formActions}>
            <Button variant="primary" size="sm" onClick={handleAdd}>Add Source</Button>
            <Button variant="default" size="sm" onClick={handlePreview} disabled={previewing || !form.query}>{previewing ? '⟳ Previewing…' : '⤵ Preview Query'}</Button>
          </div>
          {preview && (
            <div className={styles.previewBox}>
              <span className={styles.previewLabel}>Preview — {preview.results?.length || 0} results</span>
              {preview.results?.slice(0, 5).map((r, i) => (
                <div key={i} className={styles.previewResult}>
                  <span className={styles.previewResultTitle}>{r.title}</span>
                  <span className={styles.previewResultSnippet}>{r.snippet}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.loadingAudit}>Loading…</div>
      ) : sources.length === 0 ? (
        <EmptyState icon="⟢" title="No sources" body="Add discovery sources to automate lead scouting." />
      ) : (
        <div className={styles.sourcesList}>
          {sources.map(source => (
            <div key={source.id} className={`${styles.sourceCard} ${!source.is_active ? styles.sourceInactive : ''}`}>
              <div className={styles.sourceTop}>
                <div className={styles.sourceInfo}>
                  <span className={styles.sourceName}>{source.name}</span>
                  <div className={styles.sourceMeta}>
                    <Badge>{source.source_type}</Badge>
                    <Badge color="var(--color-text-muted)">{source.category}</Badge>
                    {!source.is_active && <Badge color="var(--color-error)">inactive</Badge>}
                  </div>
                </div>
                <div className={styles.sourceActions}>
                  <Button variant="default" size="sm" onClick={() => handleRun(source.id)} disabled={running[source.id] || !source.is_active}>
                    {running[source.id] ? '⟳' : '▶ Run'}
                  </Button>
                  <button className={styles.toggleBtn} onClick={() => handleToggle(source)} title={source.is_active ? 'Deactivate' : 'Activate'}>
                    {source.is_active ? '⊙' : '○'}
                  </button>
                  <button className={styles.deleteSourceBtn} onClick={() => handleDelete(source.id)}>✕</button>
                </div>
              </div>
              {source.config?.query && <p className={styles.sourceQuery}>{source.config.query}</p>}
              {source.last_run_at && (
                <span className={styles.sourceLastRun}>Last run: {new Date(source.last_run_at).toLocaleDateString()}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <p className={styles.fieldValue}>{value}</p>
    </div>
  );
}
