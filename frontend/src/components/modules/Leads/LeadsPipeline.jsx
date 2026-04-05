import { useState, useEffect } from 'react';
import { getLeads, approveLead, rejectLead, runLeadScout, runLeadPipeline } from '../../../api/client.js';
import { ModuleHeader, Badge, Button, EmptyState } from '../../shared/ModuleLayout.jsx';
import styles from './LeadsPipeline.module.css';

const STAGES = [
  { status: 'DISCOVERED', label: 'Discovered', color: 'var(--color-text-muted)' },
  { status: 'PROFILED',   label: 'Profiled',   color: 'var(--color-cto)' },
  { status: 'DRAFT',      label: 'Draft',      color: 'var(--color-cmo)' },
  { status: 'REVIEW',     label: 'Review',     color: 'var(--color-gold)' },
  { status: 'SENT',       label: 'Sent',       color: 'var(--color-cso)' },
  { status: 'REJECTED',   label: 'Rejected',   color: 'var(--color-error)' },
];

export default function LeadsPipeline() {
  const [leads, setLeads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [scouting, setScouting] = useState(false);
  const [processing, setProcessing] = useState({});
  const [filterStatus, setFilterStatus] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const data = await getLeads();
    setLeads(data);
  }

  async function scout() {
    setScouting(true);
    try { await runLeadScout(); await load(); }
    finally { setScouting(false); }
  }

  async function runPipeline(id) {
    setProcessing(p => ({ ...p, [id]: true }));
    try { await runLeadPipeline(id); await load(); }
    finally { setProcessing(p => ({ ...p, [id]: false })); }
  }

  async function approve(id) {
    await approveLead(id);
    await load();
    if (selected?.id === id) setSelected(null);
  }

  async function reject(id) {
    await rejectLead(id);
    await load();
    if (selected?.id === id) setSelected(null);
  }

  const filtered = filterStatus ? leads.filter(l => l.status === filterStatus) : leads;

  return (
    <div className={styles.container}>
      <ModuleHeader
        icon="⟢"
        title="Sales & Leads"
        subtitle={`${leads.length} total leads`}
        actions={
          <Button variant="primary" size="sm" onClick={scout} disabled={scouting}>
            {scouting ? '⟳ Scouting…' : '⟢ Run Scout'}
          </Button>
        }
      />

      {/* Stage filter bar */}
      <div className={styles.stageBar}>
        <button className={`${styles.stageBtn} ${!filterStatus ? styles.activeStage : ''}`} onClick={() => setFilterStatus(null)}>
          All <span className={styles.stageCt}>{leads.length}</span>
        </button>
        {STAGES.map(s => {
          const ct = leads.filter(l => l.status === s.status).length;
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
            <EmptyState icon="⟢" title="No leads" body="Run the Scout to discover potential clients automatically." action={<Button variant="primary" size="md" onClick={scout} disabled={scouting}>{scouting ? 'Scouting…' : 'Run Scout'}</Button>} />
          ) : filtered.map(lead => (
            <div key={lead.id} className={`${styles.leadCard} ${selected?.id === lead.id ? styles.selectedCard : ''}`} onClick={() => setSelected(lead)}>
              <div className={styles.leadTop}>
                <span className={styles.leadName}>{lead.full_name || 'Unknown'}</span>
                <Badge color={STAGES.find(s => s.status === lead.status)?.color}>{lead.status}</Badge>
              </div>
              <p className={styles.leadTrigger}>{lead.trigger_summary || lead.location || '—'}</p>
              {(lead.status === 'DISCOVERED' || lead.status === 'PROFILED') && (
                <Button variant="default" size="sm" onClick={e => { e.stopPropagation(); runPipeline(lead.id); }} disabled={processing[lead.id]}>
                  {processing[lead.id] ? '⟳ Processing…' : '▶ Run Pipeline'}
                </Button>
              )}
            </div>
          ))}
        </div>

        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <div>
                <h2 className={styles.detailName}>{selected.full_name || 'Unknown'}</h2>
                <span className={styles.detailLocation}>{selected.location || '—'}</span>
              </div>
              <button className={styles.closeDetail} onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className={styles.detailBody}>
              {selected.trigger_summary && <Field label="Trigger" value={selected.trigger_summary} />}
              {selected.digital_footprint_summary && <Field label="Profile" value={selected.digital_footprint_summary} />}
              {selected.styling_gap && <Field label="Styling Gap" value={`${selected.styling_gap} (${selected.styling_gap_confidence || 'unknown'} confidence)`} />}
              {selected.email_subject && (
                <div className={styles.emailPreview}>
                  <span className={styles.emailSubject}>Subject: {selected.email_subject}</span>
                  <div className={styles.emailBody}>{selected.email_body_text}</div>
                </div>
              )}
              {selected.human_notes && <Field label="Notes" value={selected.human_notes} />}
            </div>

            {selected.status === 'REVIEW' && (
              <div className={styles.detailActions}>
                <Button variant="primary" size="md" onClick={() => approve(selected.id)}>✓ Approve & Send</Button>
                <Button variant="danger" size="md" onClick={() => reject(selected.id)}>✕ Reject</Button>
              </div>
            )}
          </div>
        )}
      </div>
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
