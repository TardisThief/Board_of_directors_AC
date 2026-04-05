import { useState, useEffect, useRef } from 'react';
import { getFinanceSummary, getFinanceEntries, createFinanceEntry, deleteFinanceEntry, scanReceipt, uploadReceipt } from '../../../api/client.js';
import { ModuleHeader, ModuleBody, Card, KPICard, Button, Badge, EmptyState } from '../../shared/ModuleLayout.jsx';
import styles from './Finance.module.css';

const CATEGORIES = {
  income: ['Services', 'Products', 'Referral', 'Other Income'],
  expense: ['Marketing', 'Meals', 'Clothes', 'Equipment', 'Software', 'Travel', 'Samples', 'Tax', 'Other'],
};

const fmt = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Finance() {
  const [summary, setSummary] = useState(null);
  const [entries, setEntries] = useState([]);
  const [tab, setTab] = useState('ledger');
  const [formOpen, setFormOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [s, e] = await Promise.all([getFinanceSummary(), getFinanceEntries()]);
    setSummary(s);
    setEntries(e);
    setLoading(false);
  }

  async function handleDelete(id) {
    await deleteFinanceEntry(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  return (
    <div className={styles.container}>
      <ModuleHeader
        icon="₊"
        title="Financial Management"
        subtitle="Ledger, expenses, income, receipts"
        actions={
          <>
            <Button variant="default" size="sm" onClick={() => setScanOpen(true)}>📷 Scan Receipt</Button>
            <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>+ Entry</Button>
          </>
        }
      />

      {/* Summary KPIs */}
      {summary && (
        <div className={styles.kpiRow}>
          <KPICard label="Revenue MTD" value={fmt(summary.mtd.income)} accent="var(--color-cso)" />
          <KPICard label="Expenses MTD" value={fmt(summary.mtd.expenses)} accent="var(--color-error)" />
          <KPICard label="Net MTD" value={fmt(summary.mtd.net)} accent={summary.mtd.net >= 0 ? 'var(--color-cso)' : 'var(--color-error)'} />
          <KPICard label="Revenue YTD" value={fmt(summary.ytd.income)} sub="year to date" />
          <KPICard label="Net YTD" value={fmt(summary.ytd.net)} sub="year to date" />
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabs}>
        {['ledger', 'income', 'expenses'].map(t => (
          <button key={t} className={`${styles.tab} ${tab === t ? styles.activeTab : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <ModuleBody pad={false}>
        <div className={styles.tableWrap}>
          {loading ? (
            <div className={styles.loading}>Loading…</div>
          ) : entries.length === 0 ? (
            <EmptyState icon="₊" title="No entries yet" body="Add your first income or expense entry." action={<Button variant="primary" size="md" onClick={() => setFormOpen(true)}>Add Entry</Button>} />
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Vendor / Client</th>
                  <th className={styles.right}>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries
                  .filter(e => tab === 'ledger' || e.type === (tab === 'income' ? 'income' : 'expense'))
                  .map(entry => (
                    <tr key={entry.id}>
                      <td className={styles.mono}>{entry.date}</td>
                      <td>
                        <Badge color={entry.type === 'income' ? 'var(--color-cso)' : 'var(--color-error)'}>
                          {entry.type}
                        </Badge>
                      </td>
                      <td>{entry.category}</td>
                      <td className={styles.desc}>{entry.description || '—'}</td>
                      <td className={styles.muted}>{entry.vendor || entry.client || '—'}</td>
                      <td className={`${styles.right} ${styles.mono} ${entry.type === 'income' ? styles.positive : styles.negative}`}>
                        {entry.type === 'expense' ? '−' : '+'}{fmt(entry.amount)}
                      </td>
                      <td>
                        <button className={styles.deleteBtn} onClick={() => handleDelete(entry.id)} title="Delete">✕</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </ModuleBody>

      {formOpen && <EntryForm onClose={() => setFormOpen(false)} onSaved={load} />}
      {scanOpen && <ReceiptScanner onClose={() => setScanOpen(false)} onSaved={load} />}
    </div>
  );
}

function EntryForm({ onClose, onSaved, prefill = {} }) {
  const [form, setForm] = useState({ type: 'expense', amount: '', currency: 'USD', category: '', description: '', date: new Date().toISOString().split('T')[0], vendor: '', client: '', notes: '', ...prefill });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!form.amount || !form.category) return;
    setSaving(true);
    await createFinanceEntry(form);
    onSaved();
    onClose();
  }

  return (
    <div className={styles.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <form className={styles.form} onSubmit={save}>
        <div className={styles.formHeader}>
          <span>{prefill.amount ? 'Confirm Entry' : 'New Entry'}</span>
          <button type="button" onClick={onClose}>✕</button>
        </div>
        <div className={styles.formGrid}>
          <label>Type
            <select value={form.type} onChange={e => { set('type', e.target.value); set('category', ''); }}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label>Amount
            <input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" required />
          </label>
          <label>Category
            <select value={form.category} onChange={e => set('category', e.target.value)} required>
              <option value="">Select…</option>
              {CATEGORIES[form.type].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Date
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
          </label>
          <label className={styles.full}>Description
            <input type="text" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What was this for?" />
          </label>
          <label>{form.type === 'income' ? 'Client' : 'Vendor'}
            <input type="text" value={form.type === 'income' ? form.client : form.vendor}
              onChange={e => set(form.type === 'income' ? 'client' : 'vendor', e.target.value)}
              placeholder={form.type === 'income' ? 'Client name' : 'Vendor / merchant'} />
          </label>
          <label>Notes
            <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
          </label>
        </div>
        <div className={styles.formFooter}>
          <Button variant="default" size="md" onClick={onClose} type="button">Cancel</Button>
          <Button variant="primary" size="md" disabled={saving}>{saving ? 'Saving…' : 'Save Entry'}</Button>
        </div>
      </form>
    </div>
  );
}

function ReceiptScanner({ onClose, onSaved }) {
  const [scanning, setScanning] = useState(false);
  const [extracted, setExtracted] = useState(null);
  const [filename, setFilename] = useState('');
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setFilename(file.name);
    setScanning(true);
    try {
      const result = await scanReceipt(file);
      setExtracted(result.extracted);
    } finally { setScanning(false); }
  }

  return (
    <div className={styles.modal} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.form}>
        <div className={styles.formHeader}><span>Scan Receipt</span><button onClick={onClose}>✕</button></div>
        {!extracted ? (
          <div className={styles.scanArea}>
            <button className={styles.scanBtn} onClick={() => fileRef.current?.click()} disabled={scanning}>
              {scanning ? '⟳ Scanning…' : '📷 Upload Receipt Photo'}
            </button>
            <p className={styles.scanHint}>Claude will extract the amount, vendor, and category automatically</p>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </div>
        ) : (
          <EntryForm prefill={extracted} onClose={onClose} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}
