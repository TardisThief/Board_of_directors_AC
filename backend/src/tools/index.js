import * as contentEngine from './contentEngine.js';
import * as leadGen from './leadGen.js';
import * as acLab from './acLab.js';

export async function getAllToolStatuses() {
  const [ce, lg, lab] = await Promise.all([
    contentEngine.getStatus(),
    leadGen.getStatus(),
    acLab.getStatus(),
  ]);
  return {
    contentEngine: { ...ce, name: 'Content Engine', url: process.env.CONTENT_ENGINE_URL },
    leadGen: { ...lg, name: 'Lead Generator', url: process.env.LEAD_GEN_URL },
    acLab: { ...lab, name: 'AC Styling Lab', url: process.env.AC_LAB_URL },
  };
}

// Per-agent tool context enrichment
export async function getToolContextForAgent(agentId) {
  switch (agentId) {
    case 'cmo':
      return contentEngine.getCMOContext();
    case 'cso':
      return leadGen.getCSOContext();
    case 'cfo':
      return acLab.getCFOContext();
    case 'coo': {
      const [coo, cfo, cso] = await Promise.all([
        acLab.getCOOContext(),
        acLab.getCFOContext(),
        leadGen.getCSOContext(),
      ]);
      const parts = [coo, cfo, cso].filter(Boolean);
      return parts.length ? parts.join('\n\n---\n\n') : null;
    }
    case 'cto': {
      const statuses = await getAllToolStatuses();
      const lines = ['## Tool Stack — Live Status'];
      for (const [key, s] of Object.entries(statuses)) {
        const dot = s.online ? '● online' : '○ offline';
        let detail = '';
        if (key === 'contentEngine' && s.online)
          detail = ` — ${s.trends} trends, ${s.pendingProposals} proposals`;
        if (key === 'leadGen' && s.online)
          detail = ` — ${s.inReview} leads in review`;
        if (key === 'acLab' && s.online)
          detail = ` — ${s.recentPurchases} purchases (7d)`;
        lines.push(`- **${s.name}:** ${dot}${detail}`);
      }
      return lines.join('\n');
    }
    default:
      return null;
  }
}
