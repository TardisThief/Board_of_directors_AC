import { useState, useEffect } from 'react';
import { getBrief, saveBrief } from '../../api/client.js';
import styles from './CEOBrief.module.css';

const PLACEHOLDER = `Current priorities:
-

Key numbers:
-

Active clients:
-

Bottlenecks:
-

Goals this month:
- `;

export default function CEOBrief({ onClose }) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => {
    getBrief().then(data => {
      const text = data.content || '';
      setContent(text);
      setSavedContent(text);
      if (data.updated_at) setLastSaved(new Date(data.updated_at));
    }).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const data = await saveBrief(content);
      setSavedContent(content);
      setLastSaved(new Date(data.updated_at));
      // Persist to localStorage as backup
      localStorage.setItem('ceo_brief', content);
    } finally {
      setSaving(false);
    }
  }

  const isDirty = content !== savedContent;

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <div>
            <div className={styles.title}>CEO Brief</div>
            <div className={styles.subtitle}>
              Shared context injected into every agent session
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </header>

        <div className={styles.body}>
          {loading ? (
            <div className={styles.loadingText}>Loading brief…</div>
          ) : (
            <textarea
              className={styles.editor}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
            />
          )}
        </div>

        <footer className={styles.footer}>
          {lastSaved && (
            <span className={styles.lastSaved}>
              Last saved {lastSaved.toLocaleDateString()} {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!isDirty || saving || loading}
          >
            {saving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
          </button>
        </footer>
      </div>
    </div>
  );
}
