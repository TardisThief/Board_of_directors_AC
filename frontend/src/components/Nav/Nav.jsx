import { MODULES } from '../../App.jsx';
import styles from './Nav.module.css';

export default function Nav({ activeModule, onSelect, theme, onToggleTheme }) {
  return (
    <aside className={styles.nav}>
      <div className={styles.brand}>
        <span className={styles.brandName}>AC Styling</span>
        <span className={styles.brandSub}>Command Center</span>
      </div>

      <nav className={styles.modules}>
        {MODULES.map(mod => (
          <button
            key={mod.id}
            className={`${styles.moduleBtn} ${activeModule === mod.id ? styles.active : ''}`}
            data-module={mod.id}
            onClick={() => onSelect(mod.id)}
            title={`${mod.label} (${mod.shortcut})`}
          >
            <span className={styles.moduleIcon}>{mod.icon}</span>
            <span className={styles.moduleLabel}>{mod.label}</span>
            <span className={styles.shortcut}>{mod.shortcut}</span>
          </button>
        ))}
      </nav>

      <div className={styles.footer}>
        <button
          className={styles.themeBtn}
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? '☀' : '☾'}
          <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  );
}
