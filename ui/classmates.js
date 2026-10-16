import { CLASSMATE_TEXT_MAX, HEROINE, tieTarget } from '../core/classmates.mjs';
import { clipWords } from '../core/feed.mjs';
import { MEMORY_SIZE, relationLabel, relationMemory, relationOf } from '../core/relations.mjs';
import { personAvatar } from '../core/masks.mjs';
import { isPortrait } from '../core/portraits.mjs';
import {
  uiLabels, extraLabels, fill, formatDate, str, el, runAction, setStatus, call, renderPanel, safe, loreLinkText, mounted,
} from './common.js';
import { photoEditor, keptOpen } from './photo.js';
import { plural } from '../core/plural.mjs';
import { canTeach } from '../core/lore-people.mjs';
import { bullyRole } from '../core/bullying.mjs';

export function scoreText(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
}

export const FEED_LINE_MAX = 80;

export const SAID_SHOWN = 2;

export function lastShift(raw) {
  const m = raw && raw[0];
  if (!m) return { was: '', why: '' };
  return {
    was: m.crossed ? m.crossed.from : '',
    why: [m.reason, formatDate(m.day)].filter(Boolean).join(' · '),
  };
}

export function mentionFields(list) {
  const items = Array.isArray(list) ? list : [];
  return {
    buzz: items.length > 0,
    feedLine: items.length ? clipWords(items[0].text, FEED_LINE_MAX) : '',
    said: items.slice(0, SAID_SHOWN).map((x) => ({
      id: x.id, text: x.text, who: x.who, nick: x.nick === true, when: x.dayLine, chan: x.chan, chanLabel: x.chanLabel,
    })),
  };
}

export function classmatesView(state, preset, opts = {}) {
  const mentions = (opts && opts.mentions) || {};
  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const list = (state && Array.isArray(state.classmates)) ? state.classmates : [];

  const people = list.map((c) => {
    let tieText = '';
    let tieWho = '';
    if (c.tie) {
      const target = tieTarget(state, c.tie.to);
      tieWho = target.kind === 'heroine' ? X.cmHeroine
        : target.kind === 'unknown' ? X.cmTieUnknown
          : target.name;
      const shown = target.kind === 'heroine' ? X.cmTieHeroine : tieWho;
      const what = str(c.tie.what);
      tieText = shown && what ? fill(X.cmTieLine, { who: shown, what }) : (shown || what);
    }
    const rawMemory = relationMemory(state, c.id, preset, MEMORY_SIZE);
    const memory = rawMemory.map((m) => {
      const sign = scoreText(m.delta);
      return {
        day: m.day,
        dateLine: formatDate(m.day),
        delta: m.delta,
        sign,
        reason: m.reason,
        text: m.reason ? fill(X.memoryLine, { sign, reason: m.reason }) : sign,
        shift: m.crossed ? fill(U.relationShift, m.crossed) : '',
      };
    });
    const quiet = !memory.length && !relationOf(state, c.id);
    const relation = quiet ? '' : relationLabel(state, c.id, preset);
    const score = quiet ? '' : scoreText(relationOf(state, c.id));
    const shift = lastShift(rawMemory);
    const tieKind = c.tie ? tieTarget(state, c.tie.to).kind : 'none';
    const tieLink = c.tie && tieKind !== 'none' && (tieWho || tieText)
      ? {
        id: tieKind === 'classmate' || tieKind === 'teacher' ? c.tie.to : '',
        name: tieKind === 'heroine' ? X.cmTieHeroine : tieWho,
        what: str(c.tie.what),
      }
      : null;
    return {
      kind: 'classmate',
      id: c.id,
      name: c.name,
      role: c.club || '',
      links: tieLink ? [tieLink] : [],
      was: shift.was,
      why: shift.why,
      ...mentionFields(mentions[c.id]),
      club: c.club || '',
      desire: c.desire || '',
      problem: c.problem || '',
      manner: c.manner || '',
      tieTo: c.tie ? (c.tie.to || '') : '',
      tieWhat: c.tie ? (c.tie.what || '') : '',
      tieWho,
      tieText,
      relation,
      score,
      relationText: score ? `${relation} · ${score}` : relation,
      memory,
      memoryText: memory.length ? '' : U.relationNoHistory,
      source: c.source || 'manual',
      bully: bullyRole(state, c.id),
      bullyText: { lead: X.bullyLead, crew: X.bullyCrew }[bullyRole(state, c.id)] || '',
      linkText: loreLinkText(X, c.loreLink),
      canon: c.canon === true,
      aliasesText: Array.isArray(c.aliases) && c.aliases.length ? fill(X.aliasesLine, { aliases: c.aliases.join(', ') }) : '',
      portrait: isPortrait(c.portrait) ? c.portrait : '',
      looks: typeof c.looks === 'string' ? c.looks : '',
      note: typeof c.note === 'string' ? c.note : '',
      avatar: personAvatar(c),
    };
  });

  const tieOptions = [
    { value: '', label: X.cmTieNone },
    { value: HEROINE, label: X.cmHeroine },
    ...list.map((c) => ({ value: c.id, label: c.name })),
    ...((state && state.teachers) || []).map((t) => ({ value: t.id, label: t.name || t.id })),
  ];

  return {
    title: U.classmatesTitle,
    none: U.classmatesNone,
    historyTitle: U.relationHistoryTitle,
    people,
    tieOptions,
    loreFound: Array.isArray(state && state.loreFound) ? state.loreFound : [],
    canon: str(state && state.survey && state.survey.canon),
    count: people.length,
  };
}

export function castHitsOf(host) {
  return new Set(safe(() => (host.getCardCastHits ? host.getCardCastHits() : []), []) || []);
}

export function classmateExtras(host, p, view, preset, hits) {
  const X = extraLabels(preset);
  const course = uiLabels(preset).classmatesTitle;
  return [
    hits && hits.has(p.id) ? castWarning(host, p, X, course) : null,
    bullyPicker(host, p, X),
    classmateForm(host, p, view, X),
  ];
}

function bullyPicker(host, p, X) {
  const status = el('div', { class: 'academy-status' });
  const pick = el('select', { class: 'text_pole academy-input' }, [
    el('option', { value: '', text: X.bullyRoleNone }),
    el('option', { value: 'lead', text: X.bullyRoleLead }),
    el('option', { value: 'crew', text: X.bullyRoleCrew }),
  ]);
  pick.value = p.bully || '';
  pick.addEventListener('change', async () => {
    const res = await call(host, 'setBullyRole', p.id, pick.value);
    if (res && res.ok === false) setStatus(status, 'error', res.error || 'Не вышло.');
    else renderPanel(host);
  });
  return el('label', { class: 'academy-field academy-bully-role' }, [el('span', { text: X.bullyRoleField }), pick, status]);
}

export function classmateAddForm(host, view, preset) {
  return classmateForm(host, null, view, extraLabels(preset));
}

const loreChoice = new Map();
const loreWhy = new Map();

export function loreFoundBlock(host, view, preset) {
  const X = extraLabels(preset), U = uiLabels(preset);
  const status = el('div', { class: 'academy-status' });
  const found = (view && view.loreFound) || [];
  const find = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.loreFind,
    onclick: async (e) => {
      const res = await runAction(e.currentTarget, status, () => call(host, 'findLorePeople'), (r) => (r && r.count === 0 ? (r.linked ? fill(X.loreLinkedDone, { n: r.linked }) : X.loreNone) : X.loreFindOk));
      if (res && res.ok !== false) renderPanel(host);
    },
  });
  const findCanon = view && view.canon ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.canonFind,
    onclick: async (e) => {
      const res = await runAction(e.currentTarget, status, () => call(host, 'findCanonCourse'), (r) => (r && r.count === 0 ? X.canonNone : X.canonFindOk));
      if (res && res.ok !== false) renderPanel(host);
    },
  }) : null;
  const AS = [['later', X.loreLater], ['teacher', fill(X.loreInto, { part: U.teachersTitle })], ['classmate', fill(X.loreInto, { part: U.classmatesTitle })], ['skip', X.loreSkip]];
  const DEFAULT_AS = { teacher: 'teacher', peer: 'classmate', other: 'skip' };
  const oneBook = new Set(found.filter((p) => p.lorebook).map((p) => p.lorebook.book)).size <= 1;
  const rows = found.map((p, index) => {
    const key = `${(p.lorebook && p.lorebook.book) || p.source || ''}:${p.name}`;
    const pick = el('select', { class: 'text_pole academy-input', onchange: () => loreChoice.set(key, pick.value) }, AS.map(([value, text]) => el('option', { value, text })));
    pick.value = loreChoice.get(key) || 'later';
    const brief = (p.role === 'teacher' ? [p.subject, p.post] : p.role === 'other' ? [X.loreOther] : [p.desire || p.problem]).filter(Boolean).join(' — ');
    const meta = [...(p.aliases || []).slice(0, 3), oneBook ? '' : p.lorebook && p.lorebook.book].filter(Boolean).join(' · ');
    const row = el('div', { class: 'ad-lore-row', dataset: { index: String(index) } }, [
      el('div', {}, [
        el('b', { text: p.name }),
        p.source === 'canon' ? el('span', { class: 'ad-canon ad-stamp-canon', text: X.canonBadge }) : null,
        meta ? el('div', { class: 'ad-small ad-soft', text: meta }) : null,
        brief ? el('div', { class: 'ad-small', text: brief }) : null,
        loreWhy.has(key) ? el('div', { class: 'ad-small academy-note-warn', text: fill(X.loreNotApplied, { reason: loreWhy.get(key) }) }) : null,
      ]),
      pick,
    ]);
    row.read = () => ({ index, as: pick.value });
    row.key = key;
    row.suggest = () => { pick.value = p.role === 'teacher' && !canTeach(p) ? 'later' : DEFAULT_AS[p.role] || 'skip'; loreChoice.set(key, pick.value); };
    return row;
  });
  const list = el('div', { class: 'ad-lore-list' }, rows);
  const apply = el('div', {
    class: 'menu_button academy-btn academy-btn-main',
    text: X.loreApply,
    onclick: async (e) => {
      const choices = rows.map((r) => r.read()).filter((c) => c.as !== 'later');
      const res = await runAction(e.currentTarget, status, () => call(host, 'applyLorePeople', choices), X.loreApplied);
      if (res && res.ok !== false) {
        const bad = Array.isArray(res.rejected) ? res.rejected : [];
        const badKeys = new Set(bad.map((b) => rows[b.index] && rows[b.index].key).filter(Boolean));
        for (const k of [...loreChoice.keys()]) if (!badKeys.has(k)) loreChoice.delete(k);
        loreWhy.clear();
        for (const b of bad) if (rows[b.index]) loreWhy.set(rows[b.index].key, b.reason);
        mounted.loreApplyNote = bad.length ? fill(X.loreApplyPartly, { done: choices.length - bad.length, n: bad.length }) : '';
        renderPanel(host);
      }
    },
  });
  const markAll = rows.length ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.loreMarkAll,
    onclick: () => rows.forEach((r) => r.suggest()),
  }) : null;
  const clearFound = rows.length ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.loreClear,
    onclick: async (e) => {
      const res = await runAction(e.currentTarget, status, () => call(host, 'clearLoreFound'), X.loreApplied);
      if (res && res.ok !== false) { loreChoice.clear(); loreWhy.clear(); mounted.loreApplyNote = ''; renderPanel(host); }
    },
  }) : null;
  let sure = false;
  const clearAll = view && view.count ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.cmClearAll,
    onclick: async (e) => {
      const btn = e.currentTarget;
      if (!sure) { sure = true; btn.textContent = X.cmClearSure; return; }
      const res = await runAction(btn, status, () => call(host, 'clearClassmates'), X.cmCleared);
      if (res && res.ok !== false) renderPanel(host);
    },
  }) : null;
  return el('div', { class: 'ad-lore' }, [
    mounted.loreApplyNote ? el('div', { class: 'ad-small academy-note-warn', text: mounted.loreApplyNote }) : null,
    rows.length ? el('div', { class: 'ad-small', text: fill(X.loreFound, { n: rows.length, word: plural(rows.length, ...X.loreWords) }) }) : null,
    list,
    el('div', { class: 'academy-row academy-row-buttons' }, [find, findCanon, rows.length ? markAll : null, rows.length ? apply : null, clearFound]),
    clearAll ? el('div', { class: 'academy-row academy-row-buttons' }, [clearAll]) : null,
    status,
  ]);
}

function castWarning(host, p, X, course) {
  const status = el('div', { class: 'academy-status' });
  return el('div', { class: 'academy-cast-hit' }, [
    el('span', { class: 'academy-note academy-note-warn', text: fill(X.castHit, { course }) }),
    el('div', {
      class: 'menu_button academy-btn academy-btn-small',
      text: X.castHitRemove,
      onclick: async (e) => {
        const res = await runAction(e.currentTarget, status, () => call(host, 'removeClassmate', p.id), X.cmRemoved);
        if (res && res.ok !== false) renderPanel(host);
      },
    }),
    status,
  ]);
}

function classmateForm(host, p, view, X) {
  const status = el('div', { class: 'academy-status' });
  const input = (label, value, hint, max) => {
    const node = el('input', {
      type: 'text', class: 'text_pole academy-input', value: value || '', placeholder: hint || '',
      ...(max ? { maxlength: String(max) } : {}),
    });
    node.value = value || '';
    return { node, wrap: el('label', { class: 'academy-field' }, [el('span', { text: label }), node]) };
  };
  const name = input(X.cmName, p && p.name, X.cmNameHint, CLASSMATE_TEXT_MAX.name);
  const club = input(X.cmClub, p && p.club, X.cmClubHint, CLASSMATE_TEXT_MAX.club);
  const desire = input(X.cmDesire, p && p.desire, X.cmDesireHint, CLASSMATE_TEXT_MAX.desire);
  const problem = input(X.cmProblem, p && p.problem, X.cmProblemHint, CLASSMATE_TEXT_MAX.problem);
  const manner = input(X.cmManner, p && p.manner, X.cmMannerHint, CLASSMATE_TEXT_MAX.manner);
  const tieWhat = input(X.cmTieWhat, p && p.tieWhat, X.cmTieWhatHint, CLASSMATE_TEXT_MAX.tie);
  const tieTo = el('select', { class: 'text_pole academy-input' },
    view.tieOptions
      .filter((o) => !p || o.value !== p.id)
      .map((o) => el('option', { value: o.value, text: o.label })));
  tieTo.value = (p && p.tieTo) || '';
  const tieWrap = el('label', { class: 'academy-field' }, [el('span', { text: X.cmTie }), tieTo]);
  const portrait = p ? input(X.portraitField, p.portrait, X.portraitHint, 0) : null;

  const fields = () => ({
    name: String(name.node.value || ''),
    club: String(club.node.value || ''),
    desire: String(desire.node.value || ''),
    problem: String(problem.node.value || ''),
    manner: String(manner.node.value || ''),
    tie: { to: String(tieTo.value || ''), what: String(tieWhat.node.value || '') },
    ...(portrait ? { portrait: String(portrait.node.value || '').trim() } : {}),
  });

  const save = el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-btn-main',
    text: p ? X.cmSave : X.cmAdd,
    onclick: async (e) => {
      const f = fields();
      if (!f.name.trim()) { setStatus(status, 'error', X.cmNameMissing); return; }
      if (f.portrait && !isPortrait(f.portrait)) { setStatus(status, 'error', X.portraitBad); return; }
      const res = await runAction(e.currentTarget, status,
        () => (p ? call(host, 'updateClassmate', p.id, f) : call(host, 'addClassmate', f)),
        p ? X.cmSaved : X.cmAdded);
      if (res && res.ok !== false) renderPanel(host);
    },
  });

  const ask = el('div', { class: 'academy-confirm', hidden: true });
  ask.hidden = true;
  const remove = p ? el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-btn-danger',
    text: X.cmRemove,
    onclick: () => {
      ask.hidden = false;
      if (typeof ask.scrollIntoView === 'function') ask.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  }) : null;
  if (p) {
    ask.append(
      el('div', { class: 'academy-confirm-title', text: fill(X.cmRemoveAsk, { name: p.name }) }),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-main',
          text: X.cmRemoveYes,
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => call(host, 'removeClassmate', p.id), X.cmRemoved);
            ask.hidden = true;
            if (res && res.ok !== false) renderPanel(host);
          },
        }),
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: X.cmRemoveNo,
          onclick: () => { ask.hidden = true; },
        }),
      ]),
    );
  }

  return el('details', { class: 'academy-repair academy-cm-form', ...(p ? keptOpen(`edit::${p.id}`, p.id) : {}) }, [
    el('summary', { text: p ? X.cmEdit : X.cmAddTitle }),
    el('div', { class: 'academy-repair-body' }, [
      name.wrap, club.wrap, desire.wrap, tieWrap, tieWhat.wrap, problem.wrap, manner.wrap,
      p ? photoEditor(host, p, X, portrait.wrap) : null,
      el('div', { class: 'academy-row academy-row-buttons' }, [save, remove]),
      p ? ask : null,
      status,
    ]),
  ]);
}
