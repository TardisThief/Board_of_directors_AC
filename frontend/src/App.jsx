import { useState } from 'react';
import Sidebar from './components/Sidebar/Sidebar.jsx';
import Chat from './components/Chat/Chat.jsx';
import Boardroom from './components/Boardroom/Boardroom.jsx';
import CEOBrief from './components/CEOBrief/CEOBrief.jsx';
import styles from './App.module.css';

export default function App() {
  const [activeAgent, setActiveAgent] = useState('coo');
  const [briefOpen, setBriefOpen] = useState(false);
  // conversationId per agent/boardroom, persisted in state
  const [conversations, setConversations] = useState({});

  function setConversationId(agentId, id) {
    setConversations(prev => ({ ...prev, [agentId]: id }));
  }

  return (
    <div className={styles.layout}>
      <Sidebar
        activeAgent={activeAgent}
        onSelectAgent={setActiveAgent}
        onOpenBrief={() => setBriefOpen(true)}
      />

      <main className={styles.main}>
        {activeAgent === 'boardroom' ? (
          <Boardroom
            conversationId={conversations['boardroom']}
            onConversationId={id => setConversationId('boardroom', id)}
          />
        ) : (
          <Chat
            agentId={activeAgent}
            conversationId={conversations[activeAgent]}
            onConversationId={id => setConversationId(activeAgent, id)}
          />
        )}
      </main>

      {briefOpen && <CEOBrief onClose={() => setBriefOpen(false)} />}
    </div>
  );
}
