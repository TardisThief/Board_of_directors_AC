import styles from './ModuleLayout.module.css';

export function ModuleHeader({ icon, title, subtitle, actions }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        {icon && <span className={styles.headerIcon}>{icon}</span>}
        <div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export function ModuleBody({ children, pad = true }) {
  return <div className={`${styles.body} ${pad ? styles.padded : ''}`}>{children}</div>;
}

export function Card({ children, className = '' }) {
  return <div className={`${styles.card} ${className}`}>{children}</div>;
}

export function KPICard({ label, value, sub, accent }) {
  return (
    <div className={styles.kpiCard} style={accent ? { borderTopColor: accent } : {}}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {sub && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

export function Button({ children, onClick, variant = 'default', size = 'md', disabled, className = '' }) {
  return (
    <button
      className={`${styles.btn} ${styles[`btn_${variant}`]} ${styles[`btn_${size}`]} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Badge({ children, color }) {
  return (
    <span className={styles.badge} style={color ? { color, borderColor: color, background: `${color}18` } : {}}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, body, action }) {
  return (
    <div className={styles.emptyState}>
      {icon && <span className={styles.emptyIcon}>{icon}</span>}
      <p className={styles.emptyTitle}>{title}</p>
      {body && <p className={styles.emptyBody}>{body}</p>}
      {action}
    </div>
  );
}
