import { useState, useEffect } from 'react';
import { getToolStatuses } from '../../api/client.js';
import styles from './Sidebar.module.css';

const AGENTS = [
  { id: 'coo', name: 'Morgan', title: 'Chief Operating Officer', initials: 'MO' },
  { id: 'cmo', name: 'Isabelle', title: 'Chief Marketing Officer', initials: 'IS' },
  { id: 'cso', name: 'Dominique', title: 'Chief Sales Officer', initials: 'DO' },
  { id: 'cfo', name: 'Rémy', title: 'Chief Financial Officer', initials: 'RF' },
  { id: 'cto', name: 'Soren', title: 'Chief Technology Officer', initials: 'SO' },
];

const TOOL_CONFIG = {
  contentEngine: {
    label: 'Content Engine',
    url: 'http://localhost:3002',
    metric: s => s.online ? `${s.trends} trends · ${s.pendingProposals} pending` : null,
  },
  leadGen: {
    label: 'Lead Generator',
    url: 'http://localhost:8000',
    metric: s => s.online ? `${s.inReview} in review` : null,
  },
  acLab: {
    label: 'AC Styling Lab',
    url: 'https://www.theacstyle.com',
    metric: s => s.online ? `${s.recentPurchases} purchases (7d)` : null,
    external: true,
  },
};

export default function Sidebar({ activeAgent, onSelectAgent, onOpenBrief, theme, onToggleTheme }) {
  const [toolStatuses, setToolStatuses] = useState(null);
  const [commandOpen, setCommandOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadStatuses() {
    try {
      const data = await getToolStatuses();
      setToolStatuses(data);
    } catch {
      // tools offline — ignore
    }
  }

  if (collapsed) {
    return (
      <aside className={`${styles.sidebar} ${styles.collapsed}`}>
        <button className={styles.collapseBtn} onClick={() => setCollapsed(false)} title="Expand">
          ›
        </button>
        {AGENTS.map(agent => (
          <button
            key={agent.id}
            className={`${styles.iconBtn} ${activeAgent === agent.id ? styles.active : ''}`}
            data-agent={agent.id}
            onClick={() => onSelectAgent(agent.id)}
            title={agent.name}
          >
            <span className={styles.avatar} data-agent={agent.id}>{agent.initials}</span>
          </button>
        ))}
        <button
          className={`${styles.iconBtn} ${activeAgent === 'boardroom' ? styles.active : ''}`}
          onClick={() => onSelectAgent('boardroom')}
          title="Boardroom"
        >
          <span className={styles.boardroomIconSm}>◈</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <div>
          <span className={styles.logo}>AC Styling</span>
          <span className={styles.tagline}>Command Center</span>
        </div>
        <button className={styles.collapseBtn} onClick={() => setCollapsed(true)} title="Collapse">
          ‹
        </button>
      </div>

      <nav className={styles.nav}>
        <span className={styles.navLabel}>Board</span>
        {AGENTS.map(agent => (
          <button
            key={agent.id}
            className={`${styles.agentBtn} ${activeAgent === agent.id ? styles.active : ''}`}
            data-agent={agent.id}
            onClick={() => onSelectAgent(agent.id)}
          >
            <span className={styles.avatar} data-agent={agent.id}>{agent.initials}</span>
            <span className={styles.agentInfo}>
              <span className={styles.agentName}>{agent.name}</span>
              <span className={styles.agentTitle}>{agent.title}</span>
            </span>
          </button>
        ))}

        <div className={styles.divider} />

        <button
          className={`${styles.boardroomBtn} ${activeAgent === 'boardroom' ? styles.active : ''}`}
          onClick={() => onSelectAgent('boardroom')}
        >
          <span className={styles.boardroomIcon}>◈</span>
          <span className={styles.agentInfo}>
            <span className={styles.agentName}>Boardroom</span>
            <span className={styles.agentTitle}>Full board session</span>
          </span>
        </button>

        <div className={styles.divider} />

        {/* Command Center */}
        <button
          className={styles.sectionHeader}
          onClick={() => setCommandOpen(o => !o)}
        >
          <span className={styles.navLabel} style={{ marginBottom: 0 }}>Command Center</span>
          <span className={styles.chevron}>{commandOpen ? '▾' : '▸'}</span>
        </button>

        {commandOpen && (
          <div className={styles.commandCenter}>
            {Object.entries(TOOL_CONFIG).map(([key, cfg]) => {
              const status = toolStatuses?.[key];
              const online = status?.online ?? false;
              const metric = status ? cfg.metric(status) : null;
              return (
                <a
                  key={key}
                  href={cfg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.toolCard}
                >
                  <span className={`${styles.statusDot} ${online ? styles.online : styles.offline}`} />
                  <span className={styles.toolInfo}>
                    <span className={styles.toolName}>{cfg.label}</span>
                    {metric && <span className={styles.toolMetric}>{metric}</span>}
                    {!online && <span className={styles.toolMetric}>offline</span>}
                  </span>
                  <span className={styles.toolArrow}>↗</span>
                </a>
              );
            })}
            <button className={styles.refreshBtn} onClick={loadStatuses}>
              ↺ refresh
            </button>
          </div>
        )}
      </nav>

      <div className={styles.footer}>
        <button className={styles.briefBtn} onClick={onOpenBrief}>
          CEO Brief
        </button>
        <button
          className={styles.themeBtn}
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </aside>
  );
}
