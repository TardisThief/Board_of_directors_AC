import { useState, useRef, useEffect } from 'react';
import { callBoardroom } from '../../api/client.js';
import styles from './Boardroom.module.css';

const AGENT_META = {
  coo: { name: 'Morgan', initials: 'MO' },
  cmo: { name: 'Isabelle', initials: 'IS' },
  cso: { name: 'Dominique', initials: 'DO' },
  cfo: { name: 'Rémy', initials: 'RF' },
  cto: { name: 'Soren', initials: 'SO' },
};

export default function Boardroom({ conversationId, onConversationId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);

    setMessages(prev => [
      ...prev,
      { type: 'user', content: text },
      { type: 'loading' },
    ]);

    try {
      const result = await callBoardroom({ message: text, conversationId });
      if (result.conversationId) onConversationId(result.conversationId);

      setMessages(prev => [
        ...prev.filter(m => m.type !== 'loading'),
        {
          type: 'boardroom',
          routing: result.routing,
          agentResponses: result.agentResponses,
          synthesis: result.synthesis,
        },
      ]);
    } catch (err) {
      setMessages(prev => [
        ...prev.filter(m => m.type !== 'loading'),
        { type: 'error', content: err.message },
      ]);
    } finally {
      setLoading(false);
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
        <span className={styles.icon}>◈</span>
        <div>
          <div className={styles.title}>Boardroom</div>
          <div className={styles.subtitle}>Full board session — Morgan facilitates</div>
        </div>
      </header>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>◈</span>
            <p className={styles.emptyTitle}>Boardroom</p>
            <p className={styles.emptyDesc}>
              Bring a question to the full board. Morgan will route it to the right advisors and synthesize a unified response.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.type === 'user') {
            return (
              <div key={i} className={styles.userMessage}>
                <div className={styles.bubble}>{msg.content}</div>
              </div>
            );
          }
          if (msg.type === 'loading') {
            return (
              <div key={i} className={styles.loadingMsg}>
                <span className={styles.loadingDot} />
                <span className={styles.loadingDot} />
                <span className={styles.loadingDot} />
                <span className={styles.loadingLabel}>Board convening…</span>
              </div>
            );
          }
          if (msg.type === 'boardroom') {
            return <BoardroomMessage key={i} msg={msg} />;
          }
          if (msg.type === 'error') {
            return (
              <div key={i} className={styles.errorMsg}>
                Error: {msg.content}
              </div>
            );
          }
          return null;
        })}
        <div ref={bottomRef} />
      </div>

      <footer className={styles.footer}>
        <textarea
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Bring a question to the board..."
          rows={1}
          disabled={loading}
        />
        <button
          className={styles.sendBtn}
          onClick={send}
          disabled={!input.trim() || loading}
        >
          {loading ? '...' : '↑'}
        </button>
      </footer>
    </div>
  );
}

function BoardroomMessage({ msg }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.boardroomMessage}>
      {msg.routing && (
        <div className={styles.routing}>
          <span className={styles.routingLabel}>Consulted</span>
          <div className={styles.routingAgents}>
            {msg.routing.agents.map(id => {
              const a = AGENT_META[id];
              return a ? (
                <span key={id} className={styles.routingAgent} data-agent={id}>
                  <span className={styles.routingAvatar} data-agent={id}>{a.initials}</span>
                  {a.name}
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}

      <div className={styles.synthesis}>
        <pre className={styles.content}>{msg.synthesis}</pre>
      </div>

      {msg.agentResponses?.length > 0 && (
        <button
          className={styles.toggleResponses}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide' : 'Show'} individual responses
        </button>
      )}

      {expanded && (
        <div className={styles.agentResponses}>
          {msg.agentResponses.map((r, i) => (
            <div key={i} className={styles.agentResponse}>
              <div className={styles.agentResponseHeader}>
                <span className={styles.responseAvatar} data-agent={r.agentId}>
                  {AGENT_META[r.agentId]?.initials}
                </span>
                <span className={styles.responseName}>{r.name}</span>
              </div>
              <pre className={styles.responseContent}>{r.content}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
