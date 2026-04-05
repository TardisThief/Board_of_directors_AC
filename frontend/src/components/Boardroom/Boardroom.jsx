import { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import { callBoardroom } from '../../api/client.js';
import styles from './Boardroom.module.css';

marked.setOptions({ breaks: true, gfm: true });

const AGENT_META = {
  coo: { name: 'Morgan', initials: 'MO' },
  cmo: { name: 'Isabelle', initials: 'IS' },
  cso: { name: 'Dominique', initials: 'DO' },
  cfo: { name: 'Rémy', initials: 'RF' },
  cto: { name: 'Soren', initials: 'SO' },
};

const CONVENING_STEPS = [
  { label: 'Routing to the board…', duration: 800 },
  { label: 'Advisors convening…', duration: 1200 },
  { label: 'Synthesizing response…', duration: 600 },
];

export default function Boardroom({ conversationId, onConversationId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conveneStep, setConveneStep] = useState(0);
  const [consultedAgents, setConsultedAgents] = useState([]);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [input]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setLoading(true);
    setConveneStep(0);
    setConsultedAgents([]);

    setMessages(prev => [
      ...prev,
      { type: 'user', content: text, ts: Date.now() },
    ]);

    // Animate convening steps
    let stepIndex = 0;
    const stepInterval = setInterval(() => {
      stepIndex++;
      if (stepIndex < CONVENING_STEPS.length) {
        setConveneStep(stepIndex);
      } else {
        clearInterval(stepInterval);
      }
    }, CONVENING_STEPS[stepIndex].duration);

    try {
      const result = await callBoardroom({ message: text, conversationId });
      clearInterval(stepInterval);

      if (result.conversationId) onConversationId(result.conversationId);
      setConsultedAgents(result.routing?.agents || []);

      setMessages(prev => [
        ...prev,
        {
          type: 'boardroom',
          routing: result.routing,
          agentResponses: result.agentResponses,
          synthesis: result.synthesis,
          ts: Date.now(),
        },
      ]);
    } catch (err) {
      clearInterval(stepInterval);
      setMessages(prev => [
        ...prev,
        { type: 'error', content: err.message, ts: Date.now() },
      ]);
    } finally {
      setLoading(false);
      setConveneStep(0);
      setConsultedAgents([]);
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
              Bring a question to the full board. Morgan routes it to the right advisors and synthesizes a unified response.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.type === 'user') return <UserMessage key={i} msg={msg} />;
          if (msg.type === 'boardroom') return <BoardroomMessage key={i} msg={msg} />;
          if (msg.type === 'error') return <ErrorMessage key={i} msg={msg} />;
          return null;
        })}

        {loading && (
          <div className={styles.convening}>
            <div className={styles.conveningAgents}>
              {Object.entries(AGENT_META).map(([id, a]) => (
                <span
                  key={id}
                  className={`${styles.conveningAvatar} ${consultedAgents.includes(id) ? styles.active : ''}`}
                  data-agent={id}
                >
                  {a.initials}
                </span>
              ))}
            </div>
            <div className={styles.conveningLabel}>
              <span className={styles.conveningDots}>
                <span /><span /><span />
              </span>
              {CONVENING_STEPS[conveneStep]?.label}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <footer className={styles.footer}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Bring a question to the board…"
          rows={1}
          disabled={loading}
        />
        <button
          className={styles.sendBtn}
          onClick={send}
          disabled={!input.trim() || loading}
        >
          {loading ? '…' : '↑'}
        </button>
      </footer>
    </div>
  );
}

function UserMessage({ msg }) {
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={styles.userMessage}>
      <div className={styles.userBubble}>{msg.content}</div>
      <span className={styles.msgTime}>{time}</span>
    </div>
  );
}

function BoardroomMessage({ msg }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const html = marked.parse(msg.synthesis || '');

  return (
    <div className={styles.boardroomMessage}>
      {msg.routing?.agents?.length > 0 && (
        <div className={styles.routing}>
          <span className={styles.routingLabel}>Consulted</span>
          <div className={styles.routingAgents}>
            {msg.routing.agents.map(id => {
              const a = AGENT_META[id];
              return a ? (
                <span key={id} className={styles.routingAgent}>
                  <span className={styles.routingAvatar} data-agent={id}>{a.initials}</span>
                  <span>{a.name}</span>
                </span>
              ) : null;
            })}
          </div>
        </div>
      )}

      <div className={styles.synthesis}>
        <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
      </div>

      <div className={styles.messageFooter}>
        <span className={styles.msgTime}>{time}</span>
        {msg.agentResponses?.length > 0 && (
          <button className={styles.toggleBtn} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide' : 'Show'} individual responses
          </button>
        )}
      </div>

      {expanded && (
        <div className={styles.agentResponses}>
          {msg.agentResponses.map((r, i) => (
            <div key={i} className={styles.agentResponse}>
              <div className={styles.responseHeader}>
                <span className={styles.responseAvatar} data-agent={r.agentId}>
                  {AGENT_META[r.agentId]?.initials}
                </span>
                <span className={styles.responseName}>{r.name}</span>
              </div>
              <div
                className={`md ${styles.responseContent}`}
                dangerouslySetInnerHTML={{ __html: marked.parse(r.content || '') }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorMessage({ msg }) {
  return <div className={styles.error}>Error: {msg.content}</div>;
}
