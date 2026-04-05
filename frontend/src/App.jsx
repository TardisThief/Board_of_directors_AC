import { useState, useEffect } from 'react';
import Nav from './components/Nav/Nav.jsx';
import Command from './components/modules/Command/Command.jsx';
import Finance from './components/modules/Finance/Finance.jsx';
import Content from './components/modules/Content/Content.jsx';
import LeadsPipeline from './components/modules/Leads/LeadsPipeline.jsx';
import Operations from './components/modules/Operations/Operations.jsx';
import ToolsStatus from './components/modules/Tools/ToolsStatus.jsx';
import styles from './App.module.css';

export const MODULES = [
  { id: 'command',    label: 'Command',             icon: '◈', shortcut: '1' },
  { id: 'finance',    label: 'Financial Management', icon: '₊', shortcut: '2' },
  { id: 'content',    label: 'Marketing & Content',  icon: '◐', shortcut: '3' },
  { id: 'leads',      label: 'Sales & Leads',        icon: '⟢', shortcut: '4' },
  { id: 'operations', label: 'Operations',           icon: '◫', shortcut: '5' },
  { id: 'tools',      label: 'Tools & Tech',         icon: '⚙', shortcut: '6' },
];

export default function App() {
  const [activeModule, setActiveModule] = useState('command');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Keyboard shortcuts 1-6
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      const mod = MODULES.find(m => m.shortcut === e.key);
      if (mod) setActiveModule(mod.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={styles.layout}>
      <Nav
        activeModule={activeModule}
        onSelect={setActiveModule}
        theme={theme}
        onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />
      <main className={styles.main}>
        {activeModule === 'command'    && <Command />}
        {activeModule === 'finance'    && <Finance />}
        {activeModule === 'content'    && <Content />}
        {activeModule === 'leads'      && <LeadsPipeline />}
        {activeModule === 'operations' && <Operations />}
        {activeModule === 'tools'      && <ToolsStatus />}
      </main>
    </div>
  );
}
