import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const VAULT_PATH = process.env.VAULT_PATH;

function readVaultFile(relativePath) {
  try {
    return readFileSync(path.join(VAULT_PATH, relativePath), 'utf-8');
  } catch {
    return '';
  }
}

function getVaultPulse() {
  try {
    return execSync('git log --oneline -10', { cwd: VAULT_PATH }).toString().trim();
  } catch {
    return 'No git history available.';
  }
}

function checkStaleness(relativePath) {
  try {
    const result = execSync(
      `git log -1 --format="%ci" -- "${relativePath}"`,
      { cwd: VAULT_PATH }
    ).toString().trim();
    if (!result) return null;
    const lastUpdated = new Date(result);
    const daysSince = Math.floor((Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
    return { lastUpdated: result, daysSince, stale: daysSince > 30 };
  } catch {
    return null;
  }
}

export function assembleAgentContext() {
  const identity = readVaultFile('_system/identity.md');
  const preferences = readVaultFile('_system/preferences.md');
  const domainState = readVaultFile('ac-styling/_state.md');
  const boardSpec = readVaultFile('ac-styling/board-of-directors.md');
  const pulse = getVaultPulse();
  const staleness = checkStaleness('ac-styling/_state.md');

  return { identity, preferences, domainState, boardSpec, pulse, staleness };
}
