import { milestones, milestoneDetail } from '../core/milestones.mjs';
import {
  FEATS, FEAT_FAMILIES, MOMENTS_FAMILY, earnedFeats, featText, featLine, withChar, tallyCount,
} from '../core/feats.mjs';
import { fill, stateHealth, formatDate, extraLabels, uiLabels, plural, el, memoDetails } from './common.js';

export function milestonesView(state, preset) {
  const X = extraLabels(preset);
  let list = [];
  try {
    list = milestones(state, preset);
  } catch {
    list = [];
  }
  return list.map((m) => ({
    id: m.id,
    kind: m.kind,
    name: featLine({ name: featText(m.kind, preset).name, detail: milestoneDetail(m, state, preset) }),
    when: m.when || null,
    whenLine: m.when ? formatDate(m.when) : X.milestoneNoDate,
  }));
}

const shortDay = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');

const rarityLabel = (X, r) => X[`achRarity${r[0].toUpperCase()}${r.slice(1)}`] || r;

export function achievementsView(state, preset, tally = {}, opts = {}) {
  const X = extraLabels(preset);
  const char = opts.char || '';
  const off = opts.enabled === false;
  const health = stateHealth(state, preset);
  let list = [];
  if (health.kind === 'ok') {
    try { list = earnedFeats(state, preset, { char }); } catch { list = []; }
  }
  const dateOf = (e) => (e.when ? formatDate(e.when) : X.milestoneNoDate);
  const awardOf = (e, famTitle) => ({
    id: e.id,
    kind: e.feat || 'moment',
    secret: e.secret,
    emoji: e.emoji,
    title: e.name,
    desc: e.desc,
    quip: e.quip,
    whenLine: dateOf(e),
    whenShort: shortDay(e.when),
    detail: e.detail,
    rarity: e.rarity,
    rarityLabel: rarityLabel(X, e.rarity),
    mark: e.secret ? X.achSecretMark : '',
    family: famTitle,
  });

  const catalog = FEATS.map((f) => {
    const got = list.filter((e) => e.feat === f.id);
    const t = featText(f.id, preset);
    return {
      kind: f.id, secret: f.secret, got: got.length > 0, count: got.length,
      title: f.secret && !got.length ? X.achSecretName : t.name,
      hint: f.secret && !got.length ? X.achSecretHint : withChar(t.desc, char),
    };
  });
  const byKind = new Map(catalog.map((c) => [c.kind, c]));

  const families = FEAT_FAMILIES.map((fam) => {
    const feats = FEATS.filter((f) => f.fam === fam.id);
    const cats = feats.map((f) => byKind.get(f.id));
    const got = cats.filter((c) => c.got);
    const title = fam.id === 'teach' ? ((preset && preset.ui && preset.ui.achFamTeach) || uiLabels(preset).teachersTitle) : X[fam.labelKey];
    const secretLeft = cats.filter((c) => !c.got && c.secret).length;
    return {
      id: fam.id,
      title,
      got: got.length,
      total: cats.length,
      countLine: fill(X.achShelfCount, { got: got.length, total: cats.length }),
      share: cats.length ? got.length / cats.length : 0,
      awards: list.filter((e) => e.fam === fam.id).map((e) => awardOf(e, title)),
      todo: cats.filter((c) => !c.got && !c.secret).map((c) => ({ kind: c.kind, title: c.title, hint: c.hint })),
      secretMore: secretLeft
        ? fill(X.achSecretMore, { n: secretLeft, word: plural(secretLeft, X.achSecretWordOne, X.achSecretWordMany, X.achSecretWordMany) })
        : '',
    };
  });
  const moments = list.filter((e) => e.kind === 'moment');
  if (moments.length) {
    const title = X[MOMENTS_FAMILY.labelKey];
    families.push({
      id: MOMENTS_FAMILY.id, title, got: moments.length, total: moments.length,
      countLine: String(moments.length), share: 1, awards: moments.map((e) => awardOf(e, title)), todo: [], secretMore: '',
    });
  }

  const t = tally && typeof tally === 'object' ? tally : {};
  const global = FEATS
    .map((f, i) => ({ kind: f.id, i, n: tallyCount(t[f.id]) }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((g) => ({ kind: g.kind, n: g.n, title: featText(g.kind, preset).name, line: fill(X.achGlobalLine, { n: g.n }) }));

  const gotKinds = catalog.filter((c) => c.got).length;
  return {
    kind: 'ok',
    started: health.kind === 'ok',
    off,
    families,
    earnedTotal: list.length,
    earned: list,
    countLine: fill(X.achEarnedCount, { got: gotKinds, total: catalog.length }),
    catalog,
    global,
  };
}

function pageTitle(preset) {
  return (preset && preset.ui && preset.ui.milestonesTitle) || uiLabels(preset).tabAchievements;
}

export function renderAchievements(host, view, preset) {
  const X = extraLabels(preset);

  if (view.off) {
    return {
      l: [
        el('div', { class: 'ad-p-title' }, [el('h2', { text: pageTitle(preset) })]),
        el('div', { class: 'ad-silent', text: X.achOff }),
      ],
      single: true,
      cls: 'ad-inner ad-full',
    };
  }

  const sign = () => el('span', { class: 'ad-sign', 'aria-hidden': 'true' }, [el('i')]);
  const row = (id, main, state, more) => memoDetails(`ach:${id}`, {
    cls: 'ad-row', summary: [sign(), el('span', { class: 'ad-row-main' }, main), state], body: more,
  });
  const award = (f, a) => el('li', { class: `ad-award ad-fam-${f.id}`, dataset: { kind: a.kind, milestone: a.id, rarity: a.rarity } }, [
    row(`${a.kind}:${a.id}`, [
      el('span', { class: 'ad-award-title', text: a.title }),
      a.quip || a.desc ? el('span', { class: a.quip ? 'ad-row-sub ad-award-quip' : 'ad-row-sub ad-award-desc', text: a.quip || a.desc }) : null,
    ], el('span', { class: 'ad-row-state' }, [
      el('span', { class: 'ad-got', text: X.achGot }),
      a.whenShort ? el('span', { class: 'ad-award-when', text: a.whenShort }) : null,
    ]), el('div', { class: 'ad-row-more' }, [
      a.quip && a.desc ? el('span', { class: 'ad-award-desc', text: a.desc }) : null,
      a.emoji ? el('span', { class: 'ad-emoji', 'aria-hidden': 'true', text: a.emoji }) : null,
      a.whenLine || a.detail ? el('span', { class: 'ad-award-when' }, [
        a.whenLine ? el('span', { text: a.whenLine }) : null,
        a.whenLine && a.detail ? ' · ' : null,
        a.detail ? el('span', { text: a.detail }) : null,
      ]) : null,
      el('span', { class: 'ad-award-fam', text: a.family }),
      el('span', { class: 'ad-award-rar', text: a.rarityLabel }),
      a.mark ? el('span', { class: 'ad-award-mark', text: a.mark }) : null,
    ])),
  ]);
  const todo = (t) => el('li', { class: 'ad-todo-row', dataset: { kind: t.kind } }, [
    row(`todo:${t.kind}`, [
      el('span', { class: 'ad-award-title ad-tr-t', text: t.title }),
      el('span', { class: 'ad-row-sub ad-tr-h', text: t.hint }),
    ], null, []),
  ]);
  const shelf = (f) => el('section', { class: `ad-shelf ad-fam-${f.id}`, dataset: { family: f.id } }, [
    el('div', { class: 'ad-shelf-h' }, [
      el('h3', { text: f.title }),
      el('span', { class: 'ad-n', text: f.countLine }),
    ]),
    el('div', { class: 'ad-shelf-bar', 'aria-hidden': 'true' }, [el('i', { style: `--p:${f.share.toFixed(3)}` })]),
    f.awards.length ? el('ul', { class: 'ad-awards' }, f.awards.map((a) => award(f, a))) : null,
    f.todo.length ? el('ul', { class: 'ad-todo-rows' }, f.todo.map(todo)) : null,
    f.secretMore ? el('div', { class: 'ad-secret-row' }, [el('span', { class: 'ad-sign', 'aria-hidden': 'true' }), el('span', { text: f.secretMore })]) : null,
  ]);

  const global = el('section', { class: 'ad-alltime' }, [
    el('h3', { class: 'ad-sec-h', text: X.achGlobalTitle }),
    view.global.length
      ? el('ul', {}, view.global.map((g) => el('li', { dataset: { kind: g.kind } }, [
        el('span', { text: g.title }),
        el('span', { text: g.line }),
      ])))
      : el('div', { class: 'ad-silent', text: X.achGlobalNone }),
    el('p', { class: 'ad-hint-note', text: X.achGlobalNote }),
  ]);

  const weight = (f) => 2 + f.awards.length * 1.2 + f.todo.length + (f.secretMore ? 0.7 : 0);
  const total = view.families.reduce((n, f) => n + weight(f), 0) + 3;
  let acc = 0;
  let cut = view.families.length;
  for (let i = 0; i < view.families.length; i++) {
    if (acc + weight(view.families[i]) / 2 >= total / 2) { cut = i; break; }
    acc += weight(view.families[i]);
  }
  cut = Math.max(1, Math.min(cut, view.families.length));
  const col = (list) => (list.length ? el('div', { class: 'ad-shelves' }, list.map(shelf)) : null);

  const l = [
    el('div', { class: 'ad-p-title' }, [
      el('h2', { text: pageTitle(preset) }),
      el('span', { class: 'ad-p-count' }, [el('span', { text: X.achEarnedTitle }), ' · ', el('span', { text: view.countLine })]),
    ]),
    view.earnedTotal ? null : el('div', { class: 'ad-silent', text: X.achEarnedNone }),
    el('h3', { class: 'ad-sec-h', text: X.achCatalogTitle }),
    col(view.families.slice(0, cut)),
  ];
  const r = [col(view.families.slice(cut)), global];
  return { l, r, cls: 'ad-inner' };
}
