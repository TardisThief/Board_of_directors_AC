import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import { getKPIs, streamCommandChat, getBrief, saveBrief, uploadFiles } from '../../../api/client.js';
import { KPICard, Button } from '../../shared/ModuleLayout.jsx';
import styles from './Command.module.css';

marked.setOptions({ breaks: true, gfm: true });

const fmt = n => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Command() {
  const [kpis, setKpis] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [convId, setConvId] = useState(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => { loadKPIs(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  async function loadKPIs() {
    try { setKpis(await getKPIs()); } catch { /* offline */ }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = '';
    setUploading(true);
    try {
      const result = await uploadFiles(files, false);
      setPendingFiles(prev => [...prev, ...result.files.filter(f => !f.error)]);
    } finally { setUploading(false); }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pendingFiles.length) || streaming) return;
    const fileContext = pendingFiles.length ? pendingFiles.map(f => `### ${f.name}\n${f.text}`).join('\n\n') : null;
    setInput(''); setPendingFiles([]); setStreaming(true);
    const ts = Date.now();
    setMessages(prev => [...prev,
      { role: 'user', content: text + (pendingFiles.length ? `\n\n📎 ${pendingFiles.map(f => f.name).join(', ')}` : ''), ts },
      { role: 'assistant', content: '', ts: ts + 1 },
    ]);
    try {
      await streamCommandChat({
        message: text || '(see attached files)',
        conversationId: convId,
        fileContext,
        onConversationId: id => setConvId(id),
        onToken: token => setMessages(prev => {
          const u = [...prev];
          u[u.length - 1] = { ...u[u.length - 1], content: u[u.length - 1].content + token };
          return u;
        }),
      });
    } finally { setStreaming(false); }
  }

  return (
    <div className={styles.container}>
      {/* KPI bar */}
      <div className={styles.kpiBar}>
        <KPICard label="Revenue MTD" value={fmt(kpis?.finance?.income_mtd)} accent="var(--color-cso)" />
        <KPICard label="Expenses MTD" value={fmt(kpis?.finance?.expenses_mtd)} accent="var(--color-error)" />
        <KPICard label="Net MTD" value={fmt(kpis?.finance?.net_mtd)} accent="var(--color-gold)" />
        <KPICard label="Leads to Review" value={kpis?.leads?.in_review ?? '—'} accent="var(--color-coo)" />
        <KPICard label="Scheduled Posts" value={kpis?.content?.scheduled_posts ?? '—'} accent="var(--color-cmo)" />
        {kpis?.lab?.recentPurchases != null && (
          <KPICard label="Lab Purchases (7d)" value={kpis.lab.recentPurchases} accent="var(--color-cto)" />
        )}
        <button className={styles.refreshKpi} onClick={loadKPIs} title="Refresh KPIs">↺</button>
      </div>

      {/* Chat */}
      <div className={styles.chatArea}>
        <div className={styles.chatHeader}>
          <span className={styles.chatIcon}>◈</span>
          <div>
            <span className={styles.chatTitle}>Command</span>
            <span className={styles.chatSub}>Ask anything about your business</span>
          </div>
          <Button variant="default" size="sm" onClick={() => setBriefOpen(true)}>
            CEO Brief
          </Button>
        </div>

        <div className={styles.messages}>
          {messages.length === 0 && (
            <div className={styles.empty}>
              <span className={styles.emptyIcon}>◈</span>
              <p className={styles.emptyTitle}>AC Styling Command</p>
              <p className={styles.emptyHint}>Your dashboard is live. Ask about revenue, leads, content, or anything about the business.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`${styles.msg} ${m.role === 'user' ? styles.userMsg : styles.assistantMsg}`}>
              {m.role === 'assistant' && <span className={styles.msgIcon}>◈</span>}
              <div className={styles.msgBody}>
                {m.role === 'assistant'
                  ? <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(m.content || '') }} />
                  : <p className={styles.userText}>{m.content}</p>
                }
                <span className={styles.msgTime}>{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}
          {streaming && messages[messages.length - 1]?.content === '' && (
            <div className={styles.typing}><span /><span /><span /></div>
          )}
          <div ref={bottomRef} />
        </div>

        {pendingFiles.length > 0 && (
          <div className={styles.chips}>
            {pendingFiles.map((f, i) => (
              <span key={i} className={styles.chip}>
                📎 {f.name}
                <button onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div className={styles.inputArea}>
          <button className={styles.attachBtn} onClick={() => fileInputRef.current?.click()} disabled={streaming || uploading}>
            {uploading ? '⟳' : '📎'}
          </button>
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask about revenue, leads, content schedule…"
            rows={1}
            disabled={streaming}
          />
          <button className={styles.sendBtn} onClick={send} disabled={(!input.trim() && !pendingFiles.length) || streaming}>↑</button>
        </div>
      </div>

      {briefOpen && <BriefPanel onClose={() => setBriefOpen(false)} />}

      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFiles}
        accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.json,.png,.jpg,.jpeg" />
    </div>
  );
}

function BriefPanel({ onClose }) {
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBrief().then(d => { setContent(d.content || ''); setSaved(d.content || ''); });
  }, []);

  async function save() {
    setSaving(true);
    await saveBrief(content);
    setSaved(content);
    setSaving(false);
  }

  return (
    <div className={styles.briefBackdrop} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.briefModal}>
        <div className={styles.briefHeader}>
          <span className={styles.briefTitle}>CEO Brief</span>
          <button onClick={onClose}>✕</button>
        </div>
        <textarea
          className={styles.briefEditor}
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Current priorities, key numbers, bottlenecks, goals this month…"
        />
        <div className={styles.briefFooter}>
          <Button variant="primary" size="md" onClick={save} disabled={content === saved || saving}>
            {saving ? 'Saving…' : content === saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
