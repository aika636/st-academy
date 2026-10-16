import { fill } from './lorebook.mjs';

export const PHASE_OK = 'ok';
export const PHASE_WAIT = 'wait';
export const PHASE_ERROR = 'error';

export const NAMES_SHOWN = 3;

const KINDS = ['added', 'updated', 'removed'];

export function cleanTitle(raw) {
  return String(raw || '').replace(/^\s*\[academy\]\s*/i, '').replace(/^academy:/, '').trim();
}

export function normalizeChanges(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && KINDS.includes(c.kind))
    .map((c) => ({ kind: c.kind, title: cleanTitle(c.title) }))
    .filter((c) => c.title);
}

export function namesLine(titles, U) {
  const shown = titles.slice(0, NAMES_SHOWN).join(', ');
  const rest = titles.length - NAMES_SHOWN;
  return rest > 0 ? `${shown} ${fill(U.lorebookMore, { n: rest })}` : shown;
}

export function changesLine(changes, U) {
  const word = { added: U.lorebookWasAdded, updated: U.lorebookWasUpdated, removed: U.lorebookWasRemoved };
  return KINDS
    .map((k) => ({ k, titles: changes.filter((c) => c.kind === k).map((c) => c.title) }))
    .filter((g) => g.titles.length)
    .map((g) => `${word[g.k]}: ${namesLine(g.titles, U)}`)
    .join('; ');
}

export function statusView(status, U, time = () => '', orphans = []) {
  if (!status || ![PHASE_OK, PHASE_WAIT, PHASE_ERROR].includes(status.phase)) return null;
  const changes = normalizeChanges(status.changes);
  let line;
  if (status.phase === PHASE_WAIT) line = U.lorebookStateWait;
  else if (status.phase === PHASE_ERROR) line = fill(U.lorebookStateError, { error: String(status.error || '').slice(0, 160) });
  else {
    const what = changesLine(changes, U);
    const at = status.at ? time(status.at) : '';
    line = [U.lorebookStateOk, [what, at].filter(Boolean).join(' · ')].filter(Boolean).join(': ');
  }
  const label = { added: U.lorebookRowAdded, updated: U.lorebookRowUpdated, removed: U.lorebookRowRemoved };
  const rows = [
    ...changes.map((c) => ({ label: label[c.kind], title: c.title })),
    ...orphans.map((o) => ({ label: U.lorebookRowOrphan, title: cleanTitle(o.uid) })),
  ];
  return { phase: status.phase, line, rows };
}
