import { useState, useRef, useEffect } from 'react';
import { streamChat } from '../../api/client.js';
import styles from './Chat.module.css';

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
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const agent = AGENT_META[agentId];

  // Reset messages when switching agents
  useEffect(() => {
    setMessages([]);
  }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);

    const userMsg = { role: 'user', content: text };
    const assistantMsg = { role: 'assistant', content: '', agentId };

    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      await streamChat({
        agentId,
        message: text,
        conversationId,
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
      <header className={styles.header} data-agent={agentId}>
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
            <p className={styles.emptyPrompt}>How can I help you today?</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} agentInitials={agent.initials} agentId={agentId} />
        ))}
        <div ref={bottomRef} />
      </div>

      <footer className={styles.footer}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${agent.name}...`}
          rows={1}
          disabled={streaming}
        />
        <button
          className={styles.sendBtn}
          onClick={send}
          disabled={!input.trim() || streaming}
          data-agent={agentId}
        >
          {streaming ? '...' : '↑'}
        </button>
      </footer>
    </div>
  );
}

function Message({ msg, agentInitials, agentId }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`${styles.message} ${isUser ? styles.userMessage : styles.assistantMessage}`}>
      {!isUser && (
        <span className={styles.msgAvatar} data-agent={agentId}>
          {agentInitials}
        </span>
      )}
      <div className={styles.bubble}>
        <pre className={styles.content}>{msg.content}</pre>
      </div>
    </div>
  );
}
