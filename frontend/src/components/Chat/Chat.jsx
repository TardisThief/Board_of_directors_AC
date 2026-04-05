import { useState, useRef, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import { streamChat, uploadFiles } from '../../api/client.js';
import styles from './Chat.module.css';

marked.setOptions({ breaks: true, gfm: true });

const AGENT_META = {
  coo: { name: 'Morgan', title: 'Chief Operating Officer', initials: 'MO' },
  cmo: { name: 'Isabelle', title: 'Chief Marketing Officer', initials: 'IS' },
  cso: { name: 'Dominique', title: 'Chief Sales Officer', initials: 'DO' },
  cfo: { name: 'Rémy', title: 'Chief Financial Officer', initials: 'RF' },
  cto: { name: 'Soren', title: 'Chief Technology Officer', initials: 'SO' },
};

export default function Chat({ agentId, conversationId, onConversationId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [addToVault, setAddToVault] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const agent = AGENT_META[agentId];

  useEffect(() => { setMessages([]); setPendingFiles([]); }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [input]);

  const handleFileChange = useCallback(async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    e.target.value = '';

    setUploading(true);
    try {
      const result = await uploadFiles(files, addToVault);
      setPendingFiles(prev => [...prev, ...result.files.filter(f => !f.error)]);
    } finally {
      setUploading(false);
    }
  }, [addToVault]);

  function removeFile(index) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pendingFiles.length) || streaming) return;

    const fileContext = pendingFiles.length
      ? pendingFiles.map(f => `### ${f.name}\n${f.text}`).join('\n\n')
      : null;

    setInput('');
    setPendingFiles([]);
    setStreaming(true);

    const displayContent = text + (pendingFiles.length
      ? `\n\n📎 ${pendingFiles.map(f => f.name).join(', ')}`
      : '');

    setMessages(prev => [
      ...prev,
      { role: 'user', content: displayContent, ts: Date.now() },
      { role: 'assistant', content: '', agentId, ts: Date.now() + 1 },
    ]);

    try {
      await streamChat({
        agentId,
        message: text || '(see attached files)',
        conversationId,
        fileContext,
        onConversationId,
        onToken: token => {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + token,
            };
            return updated;
          });
        },
      });
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <span className={styles.avatar} data-agent={agentId}>{agent.initials}</span>
        <div>
          <div className={styles.agentName}>{agent.name}</div>
          <div className={styles.agentTitle}>{agent.title}</div>
        </div>
      </header>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyAvatar} data-agent={agentId}>{agent.initials}</span>
            <p className={styles.emptyName}>{agent.name}</p>
            <p className={styles.emptyHint}>How can I help you today?</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} agent={agent} agentId={agentId} />
        ))}
        {streaming && messages[messages.length - 1]?.content === '' && (
          <div className={styles.typing}>
            <span /><span /><span />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pending files */}
      {pendingFiles.length > 0 && (
        <div className={styles.fileChips}>
          {pendingFiles.map((f, i) => (
            <span key={i} className={styles.chip}>
              📎 {f.name}
              <button className={styles.chipRemove} onClick={() => removeFile(i)}>✕</button>
            </span>
          ))}
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.inputRow}>
          <button
            className={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploading}
            title="Attach files"
          >
            {uploading ? '⟳' : '📎'}
          </button>
          <textarea
            ref={textareaRef}
            className={styles.input}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agent.name}…`}
            rows={1}
            disabled={streaming}
          />
          <button
            className={styles.sendBtn}
            data-agent={agentId}
            onClick={send}
            disabled={(!input.trim() && !pendingFiles.length) || streaming}
          >
            ↑
          </button>
        </div>
        <div className={styles.footerMeta}>
          <label className={styles.vaultToggle}>
            <input
              type="checkbox"
              checked={addToVault}
              onChange={e => setAddToVault(e.target.checked)}
            />
            Add files to Content Vault
          </label>
        </div>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.json,.png,.jpg,.jpeg,.gif,.webp"
      />
    </div>
  );
}

function Message({ msg, agent, agentId }) {
  const isUser = msg.role === 'user';
  const html = isUser ? null : marked.parse(msg.content || '');
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`${styles.message} ${isUser ? styles.userMsg : styles.assistantMsg}`}>
      {!isUser && (
        <span className={styles.msgAvatar} data-agent={agentId}>{agent.initials}</span>
      )}
      <div className={styles.msgBody}>
        {!isUser && <span className={styles.msgSender}>{agent.name}</span>}
        <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}>
          {isUser ? (
            <p className={styles.userText}>{msg.content}</p>
          ) : (
            <div
              className="md"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
        <span className={styles.msgTime}>{time}</span>
      </div>
    </div>
  );
}
