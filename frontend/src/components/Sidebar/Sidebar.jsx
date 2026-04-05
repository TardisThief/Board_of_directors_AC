import styles from './Sidebar.module.css';

const AGENTS = [
  { id: 'coo', name: 'Morgan', title: 'Chief Operating Officer', initials: 'MO' },
  { id: 'cmo', name: 'Isabelle', title: 'Chief Marketing Officer', initials: 'IS' },
  { id: 'cso', name: 'Dominique', title: 'Chief Sales Officer', initials: 'DO' },
  { id: 'cfo', name: 'Rémy', title: 'Chief Financial Officer', initials: 'RF' },
  { id: 'cto', name: 'Soren', title: 'Chief Technology Officer', initials: 'SO' },
];

export default function Sidebar({ activeAgent, onSelectAgent, onOpenBrief }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.logo}>AC Styling</span>
        <span className={styles.tagline}>Board of Directors</span>
      </div>

      <nav className={styles.nav}>
        <span className={styles.navLabel}>Advisors</span>
        {AGENTS.map(agent => (
          <button
            key={agent.id}
            className={`${styles.agentBtn} ${activeAgent === agent.id ? styles.active : ''}`}
            data-agent={agent.id}
            onClick={() => onSelectAgent(agent.id)}
          >
            <span className={styles.avatar} data-agent={agent.id}>
              {agent.initials}
            </span>
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
      </nav>

      <div className={styles.footer}>
        <button className={styles.briefBtn} onClick={onOpenBrief}>
          CEO Brief
        </button>
      </div>
    </aside>
  );
}
