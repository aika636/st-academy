import { parseMarker, keepMarkerKinds, markerKeys, partyOf, salvageMarker, cardDisplayName, splitNewRole, MARKER_RE, HEROINE, SOCIAL_TEXT_MAX } from './parse-marker.mjs';
import { normName } from './stop-names.mjs';
import { isPerson } from './classmates.mjs';
import { sittableExams, kindOf } from './exams.mjs';
import { teacherOfSubject } from './state.mjs';
import { holidaysAhead, holidaysOn } from './holidays.mjs';
import { addDays } from './time.mjs';
import { EVENT_HORIZON } from './parse-marker.mjs';
import { SCENE_KINDS, sceneText, sceneAbout, personWord, GONE_PERSON, relPhrase } from './scene.mjs';
import { heroGender } from './gender.mjs';
import { subjectWord, upFirst, periodWord } from './words.mjs';
import { reactionCap, loudCap, LOUDNESS, hash, cleanNick, cleanType, nickWord, postRef } from './feed.mjs';
import { isPrepToken, prepTokenOf, prepTokenText, prepTokens } from './prep.mjs';
import { featText, featById, featsPromptLines } from './feats.mjs';
import { isBullyToken, parseBullyToken, bullyTokenOf, bullyAnalysisActive, bullyTabooLine, bullyingOf, resolveBully, bullyTokenText, BULLY_LEVEL_HINTS, BULLY_MOVE_ALIASES } from './bullying.mjs';

export const ANALYSIS_KINDS = ['grade', 'completion', 'rel', 'attendance', 'event', 'pause', 'fame', ...SCENE_KINDS];

export const ANALYSIS_LIMITS = { reply: 6000, user: 5000, reason: 60 };

const systemOf = (gender) => [
  `You are the registrar of an academic office. You get a fragment of a role-play about a ${gender === 'm' ? 'male' : 'female'} student, plus lists of subjects, teachers and fellow students.`,
  `Record only what actually happened in the fragment to ${gender === 'm' ? 'him' : 'her'} and the people around; never invent.`,
  'Answer in two blocks: block 1 is one service-marker line, block 2 is «Слышно:» (how loud it was and who saw); then a «Кратко:» line.',
  'Write all free-text values (reasons, descriptions, event names, the summary) in Russian.',
  'Do not write posts, replies or nicknames: a separate call composes gossip.',
].join(' ');

export const SOCIAL_LIMITS = { met: 8, clash: 4, act: 4, rumor: 3, new: 3, looks: 6, deal: 4, bully: 4, prep: 3, feat: 1, moment: 1, fame: 1 };

export const REACTION_LIMITS = { text: 200, minLetters: 3 };

export const SOMEONE = 'someone';

export const REPLY_LIMITS = { perPost: 2, total: 4 };

export function replyCap(loud) {
  return loudCap(Number.isInteger(loud) ? loud : 1, REPLY_LIMITS.total);
}

export const NICK_MARK = '~';

export function someoneWord(preset) {
  const own = preset && preset.vocab && preset.vocab.someone;
  return typeof own === 'string' && own.trim() ? own.trim() : 'кто-то с курса';
}

export function buildAnalysisPrompt(state, preset, input = {}) {
  const gender = heroGender(state, input.heroine);
  const g = (f, m) => (gender === 'm' ? m : f);
  const heroine = str(input.heroine) || g('the heroine', 'the hero');
  const period = periodWord(preset);
  const subjects = (state.subjects || []).map((s) => {
    const t = teacherOfSubject(state, s.id);
    return `- ${s.id} — ${s.name || s.id}${t ? ` — ${t.name || t.id} (${t.id})` : ''}`;
  });
  const alsoLine = (p) => {
    const list = Array.isArray(p.aliases) ? p.aliases.filter((a) => typeof a === 'string' && a.trim()) : [];
    return list.length ? ` (aka: ${list.join(', ')})` : '';
  };
  const teachers = (state.teachers || []).map((t) => `- ${t.id} — ${t.name || t.id}${alsoLine(t)}`);
  const course = (Array.isArray(state.classmates) ? state.classmates : []).filter((c) => c && c.id).map((c) => {
    const about = classmateLine(c);
    return `- ${c.id} — ${c.name || c.id}${alsoLine(c)}${about ? ` — ${about}` : ''}`;
  });
  const values = ((preset.grades && preset.grades.values) || []).map((g) => g.value);

  const lines = [];
  if (input.statusLine) lines.push(`Calendar: ${input.statusLine}`);
  const canon = state.survey && typeof state.survey.canon === 'string' ? state.survey.canon.trim() : '';
  if (canon) {
    lines.push(`World canon: ${canon}. A person already listed under another spelling or translation (Снейп and Снегг) is that person: write the id, not new. Write new canonical people by full canonical name («Поппи Помфри», not «мадам Помфри») and mark them canon in the role: new=Поппи Помфри:teacher,canon; new=Луна Лавгуд:canon.`);
  }
  const latinCards = (Array.isArray(input.cardNames) ? input.cardNames : []).filter((n) => typeof n === 'string' && /[a-z]/i.test(n) && !/[а-яё]/i.test(n));
  if (latinCards.length && /[а-яё]/i.test(str(input.reply))) {
    lines.push(`Name the card character (${latinCards.join(', ')}) in Russian as in the reply, not in Latin: in keys (@card/name) and in «Кратко».`);
  }
  lines.push(`${upFirst(subjectWord(preset, 'many'))} (id — name — teacher):`, ...subjects);
  lines.push('Teachers (id — name):', ...teachers);
  lines.push('Students (id — name — about):', ...(course.length ? course : ['- none yet']));
  const seen = (Array.isArray(state.classmateCandidates) ? state.classmateCandidates : []).map((c) => c && str(c.name)).filter(Boolean).slice(-15);
  const bare = [...(state.teachers || []), ...(Array.isArray(state.classmates) ? state.classmates : [])].filter((p) => p && p.id && !str(p.looks));
  if (bare.length) lines.push(`No recorded appearance: ${bare.slice(0, 40).map((p) => p.id).join(', ')}.`);
  if (seen.length) lines.push(`Already noticed, awaiting the player's decision (under any spelling these are not new faces — do not write new= for them): ${seen.join(', ')}.`);
  if (values.length) lines.push(`Grade values: ${values.join(', ')}.`);
  const debts = (state.subjects || []).filter((subject) => subject.debt);
  lines.push(`Current debts: ${debts.length ? debts.map((subject) => subject.id).join(', ') : 'none'}.`);
  const exams = input.exams === false ? [] : todaysExamLines(state, preset);
  if (exams.length) {
    lines.push(`Scheduled today: ${exams.join('; ')}. If it was passed or failed in the fragment, record the outcome as grade for that subject.`);
  }
  const hooks = (Array.isArray(input.hooks) ? input.hooks : []).filter((h) => h && h.id && h.text).slice(0, 3);
  if (hooks.length) lines.push('Hooks the player gave the narrator (id — what):', ...hooks.map((h) => `- ${h.id} — ${clip(h.text, 200)}`));
  const preps = (Array.isArray(input.preps) ? input.preps : []).filter((n) => n && n.id && n.text).slice(0, 3);
  if (preps.length) lines.push('NPC intentions (id — who — what):', ...preps.map((n) => `- ${n.id} — ${clip(n.text, 200)}`));
  const known = knownEventLines(state, preset);
  lines.push(`Already planned (do not repeat): ${known.length ? known.join('; ') : 'nothing'}.`);
  const taboo = bullyTabooLine(state);
  if (taboo) lines.push(taboo);
  const feats = input.feats === false ? { context: [], rules: [] } : featsPromptLines(state, preset, { char: [].concat(input.cardNames || [])[0] || '', heroine, gender, ahead: input.feats && input.feats.ahead ? 1 : 0 });
  lines.push(...feats.context);
  lines.push('');
  const said = clipAnalysisReply(stripForeignMarkup(str(input.userText)), ANALYSIS_LIMITS.user);
  if (said) {
    lines.push(`The player's line before the reply is also part of the fragment: it says what ${heroine} does.`, '"""', said, '"""', '');
  }
  lines.push('Narrator reply:', '"""', clipAnalysisReply(stripForeignMarkup(input.reply)), '"""', '');
  lines.push(
    'Block 1. What happened, as one service-marker line:',
    `<!-- [ACADEMY grade=subject:grade rel=person:minor+:reason skip=subject late=subject event=+3:name met=student clash=who:with:reason act=who:what:with:kind:access:reach rumor=about:claim new=Name looks=who:description deal=who:to:what fame=+:reason${feats.rules.length ? ' ach=id:reason' : ''}] -->`,
    'Block 1 rules. Everywhere: write only what the text states, not its likely consequences (an apology is not a reconciliation, a frown is not a quarrel; no words of reconciliation, quarrel or promise — no fact); read the whole fragment — a result can sit in the background, a memory or someone\'s line, even in a domestic or romantic scene; ids come from the lists above; each key separately, keys may repeat; no time or date except days in event.',
    `- grade: only if ${heroine} received a grade, passed or failed a test or exam. Never grades for other people.`,
    ...(said ? [`- The player's line counts: what ${heroine} did there (an action, words said aloud, a visible result) happened unless the reply contradicts it — a brilliant answer in class, an exploded cauldron, a kiss, a dance, a fight: write act, fame, grade and the rest from it too. Intention, thought, dream, question and an unfinished attempt (${g('попыталась', 'попытался')}) did not happen. Witnesses named in the player's line are witnesses: judge access from both texts. One event shown in both texts is one key.`] : []),
    `- completion=all:grade (all of ${heroine}'s exams/tests passed), completion=debts:grade (all debts closed), completion=id:grade (a named listed subject passed): only on an explicit statement. "All" must be said outright: a wish, plan, negation («ещё не ${g('сдала', 'сдал')} все») or another character's achievements do not count. «Все зачёты на отлично ${g('сдала', 'сдал')}», "all debts closed with top marks" is a real academic result, not "nothing happened": take the highest grade on the scale; with no exact grade use the passing «зачёт» if it is on the scale; never invent a number. An ordinary grade for an answer at the board stays grade; do not duplicate completion with grade for the same items; do not guess the subject from an unnamed teacher; one good answer gives no grades for other subjects.`,
    `- rel=person:minor+|minor-|major+|major-:reason: a teacher's or student's attitude to ${heroine} noticeably changed: minor (slightly), major (strongly); reason in 2–3 words.`,
    `- skip=subject: ${heroine} skipped a class («${period}»); late=subject: was late to it. Only on a direct statement: a date jump, "four days passed", a day off, the end of exam week, no classes shown or a home scene prove nothing; never infer from the calendar.`,
    `- event=+days:name: a holiday, party, ball, concert, trip, date or other event the fragment says is coming; days from the scene (0 today, 1 tomorrow; a run +5..+6; several events — several keys). Detention, punishment or an assignment to specific people is deal, not event. Skip it if beyond ${EVENT_HORIZON} days, undated, past or already planned.`,
    ...pauseRules(state),
    '- met=id[,id]: students from the list who were in the scene.',
    `- clash=who:with:reason (2–3 words): a plain spat between two; ${heroine} is @heroine. A real quarrel is better written as act with kind «конфликт».`,
    `- act=who:what:with:kind:access:reach, optionally say="detail": one per noticeable, outwardly observable action (no thoughts, feelings or motives) of the main pair (${heroine} and the card character), together or apart, or of other students: hug, kiss, held hands, quarrel, someone protected, refused, won, failed, left, appeared.`,
    `  who/with: id, @heroine or @card/name; with is empty for a solo action. A person outside the lists: write the name as is (capitalized) if next to ${heroine} or the card character, or acting alone; never anonymous («кто-то», a crowd).`,
    '  what: short, in Russian, what was done, as in the text: no continuation of the gesture, no things or details that are not there (knelt down — not «встал на колени и умолял»).',
    '  kind, one Russian word: близость, конфликт, помощь, отказ, достижение, провал, уход, появление. конфликт is only quarrel, abuse, threat, insult, fight, attack; holding, pulling close or to a wall, catching up, taking by the hand, dragging along, anxious questioning, covering, scolding out of fear for the person in a romantic or caring scene is близость or помощь; in doubt, not конфликт. отказ is an actual refusal of a request or offer; flustered or teasing snapping in a warm scene is not отказ.',
    `  access, one Russian word, judged per action: на людях — any witness in the room or near (even two or three); наедине — nobody near; подслушали — the two think they are alone but the text has someone behind a corner or door, peeping or hiding, seeing or hearing in secret (then not наедине, and no private for it). What happened in public stays на людях even if the pair was alone afterwards (a dance at a party, a kiss in the hall); наедине only what happened without witnesses; one reply may hold several acts with different access. Secret acts (planted note, stolen or swapped item, blackmail) that only ${heroine} saw, not witnesses, are наедине even in a crowd.`,
    '  reach, one Russian word: многие — a crowd, a hall, a full corridor; несколько — a couple of witnesses; неизвестно.',
    '  with: the second participant, whoever they are (partner, duel rival, the one refused); for помощь — the one helped (healed a beast — help to the beast, not the bystander).',
    '  One act per event: a same-kind reply by the same pair ("hugged back") is not separate; a reply of another kind is (insulted — slapped; attacked — defended). A loud public mishap of a main character without a second participant (fell off a broom, wounded, punished, lost points) is an act too (провал, уход or появление). Petty bodily mishaps (tripped, dropped a pen, sneezed, spilled tea) with no witnesses or consequences are not провал.',
    '  say: a short verbatim quote or visible detail from the text; none — omit, never invent.',
    `  Example: act=@heroine:${g('обняла', 'обнял')} при всех:@card/Имя:близость:на людях:многие:"Только не отпускай"; act=@heroine:${g('сдала', 'сдал')} зачёт с первого раза::достижение:на людях:несколько.`,
    '  Which acts: read the player\'s line and the reply from first line to last; take acts from both. New first — what happened for the first time in this fragment; a gesture continued from the previous turn (still holding hands, walking together) is not new, write it only if nothing new happened. Do not lose public deeds even when unrelated to the pair: reading out a letter, note or news, open defiance, a challenge, mockery, refusing to obey, a teacher\'s intervention or punishment (stopped, scolded, took points, summoned, chose not to intervene), a teacher appearing mid-scene — each its own act with its own who (a teacher id fits) and its own access. Private stays наедине and public stays на людях: a pair left alone later does not make the earlier public part secret, and vice versa. Usually 1–3 acts, at most four; if short on room: deeds before witnesses first, then the pair\'s, then the rest; merge small gestures of one scene (poured, put, handed) into one act.',
    '- rumor=about:claim: someone in the scene started or retold a rumor, and only if it was voiced in the fragment; about = id or @heroine; claim continues «говорят, что <он/она> …»: rumor=sokolova:списала контрольную.',
    `- new=name: a person with a name appears in the scene who is neither among the teachers nor the students; the name as in the text. Only someone who is in the scene; one mentioned in conversation or memory («брат рассказывал, как его наказали в прошлом году») is not a new face. A teacher or other adult staff — new=name:teacher. Never ${heroine}, the narrator or those already listed.`,
    `- looks=id:description${bare.length ? ' (only for people in "No recorded appearance")' : ''} or looks=Name:description for a new face from new= in the same reply: appearance described in the reply. Start with who it is and apparent age, then hair, eyes, face, height, clothes, marks — briefly, up to 160 characters, only what is written, invent nothing. Only lasting traits: height, build, hair, eyes, face, habitual clothes, marks; not the momentary — traces, dirt, blood, bruises, lipstick, pose, rumpled clothes, expression. Not described — no key. Never for ${heroine} or the card character.`,
    `- deal=who:to:what: a commitment opened between people: promise (a small explicit one counts: «зайду вечером», «верну завтра»), debt, joint project, an item to return. who = the one who owes or is assigned detention, punishment or a fine; to = whom they owe. Detention given to ${heroine}: who=@heroine, to=the one who assigned it. Closed: deal-=who:to:what — write it in the reply where the one who owes actually did it (brought the promised thing, returned the book, served the detention), with the same who, to and wording as the open one.`,
    `- fame: only if ${heroine} personally did something in public that made witnesses treat ${g('her', 'him')} better (fame=+:reason) or worse (fame=-:reason): ${g('защитила, победила, блеснула', 'защитил, победил, блеснул')} in class / ${g('сорвалась, опозорилась, нарушила', 'сорвался, опозорился, нарушил')} a known rule. A quarrel or closeness alone, anything in private, a retelling or memory of the past is not fame. At most one fame per reply. In doubt, omit.`,
    ...(hooks.length ? [`- played=id: a hook from "Hooks" actually came up in the fragment; otherwise omit. An invitation hook came up only if the inviter himself invites ${heroine}; if someone else is invited, or he says he himself was invited — omit.`] : []),
    ...(preps.length ? ['- prep=id:done or prep=id:failed: an intention from "NPC intentions" was explicitly fulfilled (done) or fell through (failed) in this fragment. Not directly visible — omit; expectations and plans do not count.'] : []),
    ...feats.rules,
    ...(bullyAnalysisActive(state) ? bullyRules(heroine, g, state) : []),
    '- Nothing happened — the empty marker <!-- [ACADEMY] -->.',
    '',
    'Block 2. Слышно: how loud this will be among the students and whether it was public. It changes nothing in the ledger; no posts, replies, nicknames or react=/reply= lines (a separate call writes gossip). Lines:',
    'Слышно:',
    'loud=0..3',
    'private=marker key numbers',
    'Block 2 rules. loud: 0 quiet (ordinary grade, chat), almost unnoticed; 1 noticeable; 2 loud (public skipping, quarrel); 3 the whole school (scandal, confession from the stage). private: only what happened without witnesses (closed-door talk, whisper, secret meeting): 1-based ordinal numbers of block 1 keys, comma-separated, e.g. private=2,3; leave out what was public; none — no line. «Наедине» does not mean secret forever: it can be overheard, but the registrar does not decide that.',
    '',
    `Last line: «Кратко:» and one Russian sentence on what happened in the fragment with ${heroine}'s studies and the people around (classes, grades, teachers, skips, classmates) — or «к учёбе не относится».`,
  );
  return { system: systemOf(gender), user: lines.join('\n') };
}

function bullyRules(heroine, g, state) {
  const b = bullyingOf(state);
  const person = (id) => { const p = (state.classmates || []).find((c) => c && c.id === id); return p ? `${p.id} (${p.name})` : ''; };
  const lead = b.lead ? person(b.lead) : '';
  const crew = b.crew.map(person).filter(Boolean).join(', ');
  return [
    `- bully=id:level:what: bullying of ${heroine} — if in the fragment a student humiliates, torments or hits ${g('her', 'him')} (an attempt too, successful or not). what = a short Russian past-tense phrase without a name, continuing «<имя> …»: поджидал её у раздевалки и угрожал. id = from the student list, the one who actually did it. Levels: ${BULLY_LEVEL_HINTS.join('; ')}. Write the highest level reached, and only what happened in the fragment. If the initiator's henchmen or nameless friends acted on the initiator's orders, write bully= under the initiator${lead ? `: ${lead}${crew ? `; henchmen: ${crew}` : ''}` : ''}; the initiator absent from the fragment — write nothing under their name. If it is an act from "Hooks" (травля: …), write played=id for it and bully= with what actually happened; if nothing of the kind happened, neither. Count the hook only if the act was done by the one named in it or by their henchmen; if someone else did something similar, write bully= with that person's id and no played= for the hook.`,
    `- bully=@heroine:move — ${heroine}'s own move; write it every time it is shown in the player's line or the reply (not only when bullying goes on in the same fragment): fightback (${g('she', 'he')} hit back: answered the offender with a word, deed, joke or magic, defended ${g('herself', 'himself')} — even if a third party stepped in), complain (complained to a teacher; the third field is the teacher's id), ally (found an ally; the third field is the id), ignore (pretended not to notice the attacks, deliberately did not react), revenge (took revenge), peace (made a truce with the offender: agreed not to touch each other; an ordinary "sorry" or one peaceful phrase is not a truce).`,
    `- bully=@bully:backoff — the initiator's forced retreat: write ONLY when in this fragment they backed off because of a concrete obstacle — lost a clash, feared consequences (adults, publicity, reprisal), or others intervened and stopped them. NOT a retreat: snorted and left, changed place or method, "decided to continue later", got distracted, fell silent for a while, left on their own business, backed off in words but continued another way; ${heroine}'s fightback alone is not a retreat either while the initiator is not stopped. In doubt, omit.`,
  ];
}

const TEXT_TAGS = 'b|i|u|s|em|strong|del|ins|sub|sup|small|big|mark|span|p|br|hr|div|font|center|blockquote|q|code|pre|a|ul|ol|li|details|summary|h[1-6]';

const IMG_RE = /<img(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/gi;

const FOREIGN_BLOCK_RE = new RegExp(`<(?!(?:${TEXT_TAGS})[\\s>/])([a-z][\\w-]*)(?:\\s[^>]*)?>[\\s\\S]*?</\\1\\s*>`, 'gi');

export function stripForeignMarkup(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(IMG_RE, '')
    .replace(FOREIGN_BLOCK_RE, '')
    .replace(/<(div|p|span|center)\b[^>]*>\s*<\/\1>/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function classmateLine(c) {
  const parts = [];
  if (str(c.desire)) parts.push(`wants ${str(c.desire)}`);
  if (str(c.problem)) parts.push(str(c.problem));
  return parts.join('; ').slice(0, 140);
}

function pauseRules(state) {
  const day = state && state.calendar && state.calendar.day;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? ` Scene day: ${day} (YYYY-MM-DD).` : '';
  return [
    `- pause=days:name: classes HAVE STOPPED: the text says outright that holidays have begun, the institution closed or there are no classes any more (quarantine, closure, all lessons cancelled). days = days without classes counting the scene day (a week — 7; until the 20th — through the 20th inclusive; until the end of the month — likewise). No end named — pause=open:name. Classes resumed, holidays over — pause=end.${today}`,
    '  Only a direct, completed fact; a wish («хорошо бы каникулы»), guess («наверное, закроют»), rumor, memory of past holidays and an undecided plan («обсуждают, не закрыть ли») are not pause. One cancelled lesson or day is not pause. Yes: «С сегодняшнего дня занятий нет до весны» — pause=open:каникулы до весны; «Академию закрыли на неделю из-за потопа» — pause=7:закрытие из-за потопа. No: «Скорее бы каникулы», «Прошлой зимой каникулы были долгими», «Говорят, на карантин закроют». Write it once, in the reply that announced it; do not repeat a running period from "Already planned" unless its term changed.',
  ];
}

function knownEventLines(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  try {
    const now = holidaysOn(preset, day, state).map((h) => `${h.name} (ongoing${h.open ? ', until cancelled' : h.pause ? `, until ${dayWord(h.to)}` : ''})`);
    const ahead = holidaysAhead(preset, day, EVENT_HORIZON + 1, state).map((a) => `${a.holiday.name} (+${a.days})`);
    return [...now, ...ahead].slice(0, 12);
  } catch {
    return [];
  }
}

function todaysExamLines(state, preset) {
  let items = [];
  try {
    items = sittableExams(state, preset);
  } catch {
    return [];
  }
  return items.map((item) => {
    const kind = kindOf(preset, item.kind);
    const subject = (state.subjects || []).find((s) => s.id === item.subjectId);
    return `${(kind && kind.name) || item.kind}: ${(subject && subject.name) || item.subjectId} (${item.subjectId})`;
  });
}

export function parseAnalysis(raw, lexicon, opts = {}) {
  const postsOn = !opts || opts.posts !== false;
  let text = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  let found = new RegExp(MARKER_RE.source, 'i').test(text);
  let partial = false;
  if (!found) {
    const saved = salvageMarker(text);
    if (saved) {
      text = text.slice(0, saved.start) + saved.marker + text.slice(saved.end);
      found = true;
      partial = saved.partial;
    }
  }
  const tokens = [];
  const rejected = [];
  const byNumber = [];
  const counts = {};
  const evOf = new Map();
  const hookIds = new Set((Array.isArray(lexicon && lexicon.hooks) ? lexicon.hooks : []).map((h) => h && h.id).filter(Boolean));
  for (const k of markerKeys(text)) {
    if (COMPOSED_KEYS.includes(k.name)) continue;
    if (BULLY_KEYS.includes(k.name)) {
      byNumber.push(null);
      const r = readBully(k.value, lexicon);
      if (r.error) rejected.push({ raw: k.raw, reason: r.error });
      else if (!tokens.includes(r.token)) {
        if ((counts.bully || 0) >= SOCIAL_LIMITS.bully) rejected.push({ raw: k.raw, reason: `больше ${SOCIAL_LIMITS.bully} ключей bully на один ответ` });
        else {
          counts.bully = (counts.bully || 0) + 1;
          tokens.push(r.token);
        }
      }
      continue;
    }
    if (PREP_KEYS.includes(k.name)) {
      byNumber.push(null);
      const r = readPrep(k.value, lexicon);
      if (r.error) rejected.push({ raw: k.raw, reason: r.error });
      else if (!tokens.includes(r.token)) {
        if ((counts.prep || 0) >= SOCIAL_LIMITS.prep) rejected.push({ raw: k.raw, reason: `больше ${SOCIAL_LIMITS.prep} ключей prep на один ответ` });
        else {
          counts.prep = (counts.prep || 0) + 1;
          tokens.push(r.token);
        }
      }
      continue;
    }
    if (PLAYED_KEYS.includes(k.name)) {
      byNumber.push(null);
      for (const id of String(k.value || '').split(/[,\s]+/).map((v) => v.replace(/[[\]()«»"]/g, '').trim().toLowerCase()).filter(Boolean)) {
        const t = `played=${id}`;
        if (!hookIds.has(id)) rejected.push({ raw: t, reason: 'такого повода секретарю не давали' });
        else if (!tokens.includes(t)) tokens.push(t);
      }
      continue;
    }
    if (!k.kind) {
      byNumber.push(null);
      continue;
    }
    if (!k.value) {
      rejected.push({ raw: k.raw, reason: 'пустое значение' });
      byNumber.push(null);
      continue;
    }
    const parsed = parseMarker(analysisMarker([k.raw]), lexicon);
    rejected.push(...parsed.rejected);
    let first = null;
    for (const ev of parsed.events) {
      const t = tokenOf(ev);
      if (!t) continue;
      evOf.set(t, ev);
      const kind = ev.kind === 'feat' && ev.moment ? 'moment' : ev.kind;
      const limit = SOCIAL_LIMITS[kind];
      if (!tokens.includes(t)) {
        if (limit !== undefined && (counts[kind] || 0) >= limit) {
          rejected.push({ raw: k.raw, reason: `больше ${limit} ключей ${kind} на один ответ` });
          continue;
        }
        counts[kind] = (counts[kind] || 0) + 1;
        tokens.push(t);
      }
      first = first || t;
    }
    byNumber.push(first);
  }

  const lookers = new Set();
  for (const t of [...tokens]) {
    const ev = evOf.get(t);
    if (!ev || ev.kind !== 'looks') continue;
    const people = [...arr(lexicon.classmates), ...arr(lexicon.teachers)];
    const named = ev.personId ? people.find((p) => p && p.id === ev.personId) : people.find((p) => p && isPerson(p, ev.name));
    const fresh = !named && [...evOf.values()].some((e) => e.kind === 'new' && isPerson({ name: e.name }, ev.name));
    const waiting = !named && !fresh && arr(lexicon.candidates).some((p) => p && isPerson(p, ev.name));
    const key = named ? named.id : normName(ev.name);
    const reason = !named && !fresh && !waiting ? `нет такого человека: «${ev.name}»`
      : named && named.looks ? `у «${named.name || named.id}» внешность уже есть`
        : lookers.has(key) ? 'внешность этого человека уже записана' : '';
    if (!reason) { lookers.add(key); continue; }
    tokens.splice(tokens.indexOf(t), 1);
    byNumber.forEach((x, i) => { if (x === t) byNumber[i] = null; });
    rejected.push({ raw: t, reason });
  }
  tokens.sort((a, b) => a.startsWith('looks=') - b.startsWith('looks='));

  const pairKey = (ev) => [ev.a, ev.b].sort().join('|');
  const conflicts = new Map();
  for (const t of tokens) {
    const ev = evOf.get(t);
    if (ev && ev.kind === 'act' && ev.type === 'конфликт' && ev.b) conflicts.set(pairKey(ev), t);
  }
  const verbStem = (what) => String(what || '').toLowerCase().replace(/ё/g, 'е').trim().split(/\s+/)[0].slice(0, 4);
  const acts = new Map();
  for (const t of [...tokens]) {
    const ev = evOf.get(t);
    if (!ev || ev.kind !== 'act' || !ev.b) continue;
    const twin = acts.get(`${ev.type}|${ev.b}|${ev.a}`);
    const counter = twin && ev.type === 'конфликт' && verbStem(ev.what) !== verbStem((evOf.get(twin) || {}).what);
    if (!twin || counter) { acts.set(`${ev.type}|${ev.a}|${ev.b}`, t); continue; }
    tokens.splice(tokens.indexOf(t), 1);
    byNumber.forEach((x, i) => { if (x === t) byNumber[i] = twin; });
    rejected.push({ raw: t, reason: 'то же действие в ответ уже записано' });
  }
  for (const t of [...tokens]) {
    const ev = evOf.get(t);
    const twin = ev && ev.kind === 'clash' ? conflicts.get(pairKey(ev)) : null;
    if (!twin) continue;
    tokens.splice(tokens.indexOf(t), 1);
    byNumber.forEach((x, i) => { if (x === t) byNumber[i] = twin; });
    rejected.push({ raw: t, reason: 'уже есть act-конфликт' });
  }

  const loudMatch = /(?<![\p{L}\d_])(?:loud|громкость)\s*[=:]\s*([0-3])/iu.exec(text);
  const loud = loudMatch ? Number(loudMatch[1]) : null;
  const cap = loudCap(loud === null ? 1 : loud, reactionCap(lexicon));
  const reactions = [];
  const seenText = new Set();
  const slots = [];
  for (const value of postsOn ? reactionValues(text) : []) {
    const r = readReaction(value, tokens, byNumber, lexicon);
    const raw = `react=${value}`;
    slots.push(null);
    if (r.error) {
      rejected.push({ raw, reason: r.error });
      continue;
    }
    const key = textKey(r.text);
    if (seenText.has(key)) {
      rejected.push({ raw, reason: 'повтор реакции' });
      continue;
    }
    if (reactions.length >= cap) {
      rejected.push({ raw, reason: `реакций больше, чем стоит событие (до ${cap})` });
      continue;
    }
    seenText.add(key);
    const t = reactionToken(r);
    reactions.push(t);
    slots[slots.length - 1] = t;
  }

  const replies = [];
  const perPost = new Map();
  const voices = new Map();
  const replyMax = replyCap(loud === null ? 1 : loud);
  for (const value of postsOn ? reactionValues(text, REPLY_WORDS) : []) {
    const raw = `reply=${value}`;
    const a = readReply(value, slots, lexicon);
    if (a.error) {
      rejected.push({ raw, reason: a.error });
      continue;
    }
    const key = textKey(a.text);
    if (seenText.has(key)) {
      rejected.push({ raw, reason: 'повтор реплики' });
      continue;
    }
    if (replies.length >= replyMax) {
      rejected.push({ raw, reason: `ответов больше, чем стоит событие (до ${replyMax})` });
      continue;
    }
    if ((perPost.get(a.parent) || 0) >= REPLY_LIMITS.perPost) {
      rejected.push({ raw, reason: `под одним постом — до ${REPLY_LIMITS.perPost} ответов` });
      continue;
    }
    const me = voiceOf(a.who, a.nick);
    const heard = voices.get(a.parent) || [];
    if (me && me === a.parentVoice && !a.answered && !heard.some((v) => v !== me)) {
      rejected.push({ raw, reason: 'автор поста отвечает сам себе' });
      continue;
    }
    seenText.add(key);
    perPost.set(a.parent, (perPost.get(a.parent) || 0) + 1);
    voices.set(a.parent, [...heard, me]);
    replies.push(replyToken(a));
  }
  const privates = [];
  for (const value of reactionValues(text, PRIVATE_WORDS)) {
    for (const ref of value.split(/[\s,;]+/).map((v) => v.replace(/[#№[\]()]/g, '').trim()).filter(Boolean)) {
      const n = /^\d{1,2}$/.test(ref) ? Number(ref) : 0;
      const fact = n >= 1 && n <= byNumber.length ? byNumber[n - 1] : null;
      const t = fact ? `private=${factRef(fact)}` : '';
      if (!t) rejected.push({ raw: `private=${ref}`, reason: `нет факта номер ${ref} — нечему быть наедине` });
      else if (!privates.includes(t)) privates.push(t);
    }
  }
  const posted = reactions.length > 0 || replies.length > 0;
  if (posted) tokens.push(...reactions, ...replies);
  tokens.push(...privates);
  if (posted || (loud !== null && (loud >= 2 || rejected.length > 0 || tokens.some(isFactToken)))) tokens.push(`loud=${loud === null ? 1 : loud}`);

  const m = /кратко\s*[:：]\s*(.+)/i.exec(text);
  const summary = m ? tidySummary(m[1].replace(/<!--[\s\S]*?-->/g, ''), lexicon) : '';
  return { found, partial, tokens, summary, rejected };
}

export function tidySummary(text, lexicon) {
  let out = String(text || '').trim();
  out = out.replace(/@(?:card|who)\//g, '');
  out = out.replace(/^(?:к\s+учёбе\s+не\s+относится[\s:.,;—–-]*)+/i, '').trim();
  const names = (lexicon && lexicon.names) || {};
  const lang = ((lexicon && lexicon.survey) || {}).lang || (lexicon && lexicon.lang);
  for (const person of Array.isArray(names.cast) ? names.cast : []) {
    const all = [person && person.name, ...((person && person.aliases) || [])].filter((n) => typeof n === 'string' && n.trim());
    const own = cardDisplayName('', all[0], [person], lang);
    if (!own) continue;
    for (const n of all) {
      if (n === own || /[а-яё]/i.test(n) === /[а-яё]/i.test(own)) continue;
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), () => own);
    }
  }
  return out.slice(0, 300);
}

const COMPOSED_KEYS = ['react', 'реакция', 'reply', 'ответ', 'loud', 'громкость', 'private', 'наедине'];

const PRIVATE_WORDS = ['private', 'наедине'];

const REACT_WORDS = ['react', 'реакция'];
const REPLY_WORDS = ['reply', 'ответ'];

function textKey(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const PLAYED_KEYS = ['played', 'сыграно', 'сыгран'];

const BULLY_KEYS = ['bully', 'травля'];

const PREP_KEYS = ['prep', 'намерение'];
const PREP_RESULTS = { done: 'done', сбылось: 'done', исполнено: 'done', failed: 'failed', сорвалось: 'failed', сорвано: 'failed' };

function readPrep(value, lexicon) {
  const [raw, word = ''] = String(value || '').split(':').map((x) => x.replace(/[[\]()«»"]/g, '').trim());
  const id = raw.toLowerCase();
  const result = PREP_RESULTS[word.toLowerCase()];
  if (!result) return { error: 'исход намерения — done или failed' };
  if (!arr(lexicon && lexicon.preps).some((n) => n && n.id === id)) return { error: 'такого намерения секретарю не давали' };
  return { token: prepTokenOf(id, result) };
}

const HEROINE_RE = /^(?:@?heroine|@?hero|@?героиня|@?герой)$/iu;
const BULLY_RE = /^(?:@?bully|@?задира|@?зачинщик|@?зачинщица)$/iu;

function readBully(value, lexicon) {
  const parts = String(value || '').split(':').map((x) => x.trim());
  const who = parts[0] || '';
  const course = { classmates: arr(lexicon && lexicon.classmates) };
  if (HEROINE_RE.test(who) || BULLY_RE.test(who)) {
    const kind = BULLY_MOVE_ALIASES[(parts[1] || '').toLowerCase()];
    if (!kind || (BULLY_RE.test(who) && kind !== 'backoff')) return { error: 'ход героини — fightback, complain, ally, ignore, revenge или peace; отступление задиры — @bully:backoff' };
    const wanted = parts[2] || '';
    let withId = '';
    if (kind === 'ally') withId = resolveBully(course, wanted);
    else if (kind === 'complain') {
      const t = arr(lexicon && lexicon.teachers).find((x) => x && wanted && (x.id === wanted || normName(x.name) === normName(wanted)));
      withId = t ? t.id : '';
    }
    if (kind === 'ally' && !withId) return { error: 'союзник — человек из курса' };
    return { token: bullyTokenOf({ type: 'move', kind, with: withId }) };
  }
  const by = resolveBully(course, who);
  if (!by) return { error: 'травит кто-то не из курса' };
  const level = Number(parts[1]);
  if (!Number.isInteger(level) || level < 0 || level > 4) return { error: 'уровень травли — от 0 до 4' };
  const text = parts.slice(2).join(' ').trim();
  if (!text) return { error: 'не сказано, что именно случилось' };
  return { token: bullyTokenOf({ type: 'act', by, level, text }) };
}

const CHANNEL_WORDS = {
  chat: ['chat', 'чат', 'чат курса', 'course', 'факт'],
  anon: ['anon', 'анон', 'анонимка', 'аноним', 'слух', 'rumor'],
};

const SOMEONE_WORDS = ['someone', 'кто-то', 'кто то', 'кто-то с потока', 'кто то с потока', 'кто-то с курса', 'anyone', 'somebody'];

function channelOf(word) {
  const w = String(word || '').toLowerCase().replace(/ё/g, 'е').replace(/[[\]()«»"]/g, '').trim();
  for (const [chan, words] of Object.entries(CHANNEL_WORDS)) if (words.includes(w)) return chan;
  return null;
}

function reactionValues(text, words = REACT_WORDS) {
  const out = [];
  const re = new RegExp(`(?<![\\p{L}\\d_])(?:${words.join('|')})\\s*=\\s*([^\\n]*)`, 'giu');
  for (const m of text.matchAll(re)) {
    let v = m[1];
    const stop = v.search(/-->|\s[\p{L}\d_-]{1,24}\s*=/u);
    if (stop >= 0) v = v.slice(0, stop);
    v = v.replace(/\]{1,2}\s*$/, '').trim();
    if (v) out.push(v);
  }
  return out;
}

function readReaction(value, tokens, byNumber, lexicon) {
  const fields = value.split(':');
  const ref = fields[0].replace(/[#№[\]()]/g, '').trim().toLowerCase();
  let fact = null;
  if (/^\d{1,2}$/.test(ref)) {
    const n = Number(ref);
    if (n < 1 || n > byNumber.length) return { error: `нет факта номер ${n}` };
    fact = byNumber[n - 1];
    if (!fact) return { error: `факт номер ${n} не записан — реакция без опоры` };
  } else if (ref) {
    fact = tokens.find((t) => t.startsWith(`${ref}=`) && isFactToken(t)) || null;
    if (!fact) return { error: `нет факта «${ref}»` };
  } else {
    return { error: 'реакция без ссылки на факт' };
  }
  let who = '';
  let chan = 'chat';
  let rest;
  if (channelOf(fields[1])) {
    chan = channelOf(fields[1]);
    rest = fields.slice(2);
  } else if (channelOf(fields[2])) {
    who = fields[1];
    chan = channelOf(fields[2]);
    rest = fields.slice(3);
  } else {
    who = fields[1];
    rest = fields.slice(2);
  }
  const author = authorOf(who, lexicon);
  if (author.error) return { error: author.error };
  const text = reactionText(rest.join(':'));
  if ((text.match(/\p{L}/gu) || []).length < REACTION_LIMITS.minLetters) return { error: 'у реакции нет текста' };
  return { fact, who: author.id, nick: author.nick, type: author.type, chan, text };
}

function readReply(value, slots, lexicon) {
  const fields = value.split(':');
  const ref = fields[0].replace(/[#№[\]()«»"]/g, '').trim().toLowerCase();
  let parent;
  let chan;
  let parentVoice;
  let answered = false;
  const own = /^(?:r|р|реакция\s*)?(\d{1,2})$/u.exec(ref);
  const old = /^(?:f|ф)\s*(\d{1,2})$/u.exec(ref);
  if (own) {
    const n = Number(own[1]);
    if (n < 1 || n > slots.length) return { error: `нет поста номер ${n} — ответ без ветки` };
    const post = slots[n - 1];
    if (!post) return { error: `пост номер ${n} не записан — ответ без ветки` };
    parent = `r.${hash(post)}`;
    const r = reactionOf(post);
    chan = r.chan;
    parentVoice = voiceOf(r.who, r.nick);
  } else if (old) {
    const post = arr(lexicon && lexicon.feedPosts).find((p) => p && p.ref === `f${Number(old[1])}`);
    if (!post) return { error: `нет поста «${ref}» в ленте — ответ без ветки` };
    parent = `f.${postRef(post.id)}`;
    chan = post.chan === 'anon' ? 'anon' : 'chat';
    parentVoice = voiceOf(post.who, post.nick);
    answered = Number(post.replies) > 0;
  } else {
    return { error: 'ответ без поста' };
  }
  let rest = fields.slice(1);
  let who = '';
  if (rest.length > 1) {
    who = rest[0];
    rest = rest.slice(1);
    if (rest.length > 1 && channelOf(rest[0])) rest = rest.slice(1);
  }
  const author = authorOf(who, lexicon);
  if (author.error) return { error: author.error };
  const text = reactionText(rest.join(':'));
  if ((text.match(/\p{L}/gu) || []).length < REACTION_LIMITS.minLetters) return { error: 'у ответа нет текста' };
  return { parent, who: author.id, nick: author.nick, type: author.type, chan, text, parentVoice, answered };
}

function voiceOf(who, nick) {
  const n = cleanNick(nick);
  if (n) return `${NICK_MARK}${n.toLowerCase().replace(/ё/g, 'е')}`;
  return who && who !== SOMEONE ? who : '';
}

function authorOf(raw, lexicon) {
  const typed = /^([^()]*)\(([^()]*)\)\s*$/.exec(String(raw || ''));
  const type = typed ? cleanType(typed[2]) : '';
  const w = String(typed ? typed[1] : raw || '').replace(/[[\]()«»"]/g, '').trim();
  const low = w.toLowerCase().replace(/ё/g, 'е');
  if (!w || SOMEONE_WORDS.includes(low) || low === someoneWord(lexicon).toLowerCase().replace(/ё/g, 'е')) return { id: SOMEONE, nick: '' };
  if (w.startsWith(NICK_MARK) || w.startsWith('～')) {
    const nick = cleanNick(w);
    if (!nick) return { id: SOMEONE, nick: '' };
    if (partyOf(nick, lexicon).id === HEROINE) return { error: 'героиня — не реакция курса' };
    return { id: '', nick, type };
  }
  const party = partyOf(w, lexicon);
  if (party.id === HEROINE) return { error: 'героиня — не реакция курса' };
  if (party.id) return { id: party.id, nick: '' };
  const masky = /^[а-яё]/.test(w) || (/\s/.test(w) && !/^[A-ZА-ЯЁ]/.test(w));
  const nick = masky ? cleanNick(w) : '';
  return nick ? { id: '', nick, type } : { id: SOMEONE, nick: '' };
}

function reactionText(raw) {
  let t = String(raw || '')
    .replace(/-->|[=[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[«"“„']+|[»"”']+$/g, '')
    .trim();
  if (t.length > REACTION_LIMITS.text) {
    const cut = t.slice(0, REACTION_LIMITS.text);
    const at = cut.lastIndexOf(' ');
    t = `${(at > REACTION_LIMITS.text / 2 ? cut.slice(0, at) : cut).trim()}…`;
  }
  return t;
}

export function unparsedNames(rejected) {
  const out = [];
  for (const r of Array.isArray(rejected) ? rejected : []) {
    const m = /неизвестный (?:человек|преподаватель):\s*«([^»]+)»/u.exec(String((r && r.reason) || ''));
    const name = m ? m[1].trim().replace(/^@(?:card|who)\//, '') : '';
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 6);
}

export function unparsedLeft(names, tokens, people = []) {
  const known = new Set();
  for (const t of Array.isArray(tokens) ? tokens : []) {
    if (typeof t === 'string' && t.startsWith('new=')) known.add(normName(splitNewRole(t.slice(4)).name));
  }
  for (const p of people) for (const n of [p && p.name, ...((p && p.aliases) || [])]) if (n) known.add(normName(n));
  return (Array.isArray(names) ? names : []).filter((n) => !known.has(normName(n)));
}

export function factRef(token) {
  return hash(String(token || ''));
}

function authorField(who, nick, type) {
  const n = cleanNick(nick);
  const t = n ? cleanType(type) : '';
  return n ? `${NICK_MARK}${n}${t ? `(${t})` : ''}` : (who || SOMEONE);
}

function authorFrom(field) {
  const f = String(field || '');
  if (f.startsWith(NICK_MARK)) {
    const typed = /^([^()]*)\(([^()]*)\)$/.exec(f);
    const nick = cleanNick(typed ? typed[1] : f);
    if (nick) return { who: '', nick, type: typed ? cleanType(typed[2]) : '' };
  }
  return { who: f || SOMEONE, nick: '', type: '' };
}

export function reactionToken({ fact, who, nick, type, chan, text }) {
  return `react=${factRef(fact)}:${authorField(who, nick, type)}:${chan === 'anon' ? 'anon' : 'chat'}:${reactionText(text)}`;
}

export function replyToken({ parent, who, nick, type, chan, text }) {
  return `reply=${parent}:${authorField(who, nick, type)}:${chan === 'anon' ? 'anon' : 'chat'}:${reactionText(text)}`;
}

export function isReactToken(token) {
  return /^react=/.test(String(token || ''));
}

export function isReplyToken(token) {
  return /^reply=/.test(String(token || ''));
}

export function replyOf(token, tokens = []) {
  const m = /^reply=([rf]\.[0-9a-z]+):([^:]*):(chat|anon):([\s\S]+)$/.exec(String(token || ''));
  if (!m) return null;
  const own = m[1].startsWith('r.');
  const post = own ? (tokens || []).find((t) => isReactToken(t) && hash(t) === m[1].slice(2)) || null : null;
  return { parent: m[1], ...authorFrom(m[2]), chan: m[3], text: m[4], post, feed: own ? '' : m[1].slice(2) };
}

export function repliesOf(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  return list.filter(isReplyToken).map((t) => replyOf(t, list)).filter((a) => a && (a.post || a.feed)).map((a) => ({
    parent: a.post ? { token: a.post } : { ref: a.feed },
    who: a.nick ? '' : a.who, nick: a.nick, type: a.type, chan: a.chan, text: a.text,
  }));
}

export function isLoudToken(token) {
  return /^loud=/.test(String(token || ''));
}

export function isPrivateToken(token) {
  return /^private=/.test(String(token || ''));
}

export function privateRefs(tokens) {
  return new Set((Array.isArray(tokens) ? tokens : []).filter(isPrivateToken).map((t) => t.slice(8)).filter(Boolean));
}

export { isBullyToken, isPrepToken, prepTokens };

export function isPlayedToken(token) {
  return /^played=/.test(String(token || ''));
}

export function playedOf(tokens) {
  return (Array.isArray(tokens) ? tokens : []).filter(isPlayedToken).map((t) => t.slice(7)).filter(Boolean);
}

export function isFactToken(token) {
  return Boolean(token) && !isReactToken(token) && !isReplyToken(token) && !isLoudToken(token) && !isPlayedToken(token) && !isPrivateToken(token) && !isBullyToken(token) && !isPrepToken(token);
}

export function reactionOf(token, tokens = []) {
  const m = /^react=([^:]+):([^:]*):(chat|anon):([\s\S]+)$/.exec(String(token || ''));
  if (!m) return null;
  const fact = (tokens || []).find((t) => isFactToken(t) && factRef(t) === m[1]) || null;
  return { ref: m[1], ...authorFrom(m[2]), chan: m[3], text: m[4], fact, token: String(token) };
}

export function reactionsOf(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  return list.filter(isReactToken).map((t) => reactionOf(t, list)).filter((r) => r && r.fact);
}

export function loudOf(tokens) {
  const t = (tokens || []).find(isLoudToken);
  const n = t ? Number(t.slice(5)) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null;
}

export function pruneReactions(tokens) {
  if (!Array.isArray(tokens)) return tokens;
  const refs = new Set(tokens.filter(isFactToken).map(factRef));
  const withReacts = tokens.filter((t) => {
    if (!isReactToken(t)) return true;
    const r = reactionOf(t);
    return Boolean(r && refs.has(r.ref));
  });
  const posts = new Set(withReacts.filter(isReactToken).map((t) => hash(t)));
  const kept = withReacts.filter((t) => {
    if (!isReplyToken(t)) return true;
    const a = replyOf(t);
    return Boolean(a && (a.feed || posts.has(a.parent.slice(2))));
  });
  const left = kept.filter((t) => !isPrivateToken(t) || refs.has(t.slice(8)));
  return left.some((t) => isReactToken(t) || isReplyToken(t) || isFactToken(t)) ? left : left.filter((t) => !isLoudToken(t));
}

export function dropTokenAt(tokens, index) {
  if (!Array.isArray(tokens)) return tokens;
  const left = tokens.filter((_, i) => i !== index);
  if (isFactToken(tokens[index]) && !left.some(isFactToken)) return pruneReactions(left.filter((t) => !isLoudToken(t)));
  return pruneReactions(left);
}

export function tokenOf(ev) {
  if (!ev || !ANALYSIS_KINDS.includes(ev.kind)) return null;
  if (ev.kind === 'grade') return `grade=${ev.subjectId}:${ev.value}`;
  if (ev.kind === 'completion') return `completion=${ev.scope}:${ev.value}`;
  if (ev.kind === 'attendance') return `${ev.status === 'late' ? 'late' : 'skip'}=${ev.subjectId}`;
  if (ev.kind === 'event') {
    const name = cleanReason(ev.name).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    return `event=+${ev.days}${ev.until > ev.days ? `..+${ev.until}` : ''}:${name}`;
  }
  if (ev.kind === 'pause') {
    if (ev.end) return 'pause=end';
    const name = cleanReason(ev.name).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    return `pause=${ev.days ? ev.days : 'open'}${name ? `:${name}` : ''}`;
  }
  if (ev.kind === 'fame') {
    const why = cleanReason(ev.why, SOCIAL_TEXT_MAX.why).replace(/:/g, ' ');
    return `fame=${ev.sign < 0 ? '-' : '+'}${why ? `:${why}` : ''}`;
  }
  if (ev.kind === 'met') return `met=${ev.personId}`;
  if (ev.kind === 'clash') {
    const reason = cleanReason(ev.reason);
    return `clash=${ev.a}:${ev.b}${reason ? `:${reason}` : ''}`;
  }
  if (ev.kind === 'act') {
    const plain = (v, max, glue) => cleanReason(v, max).replace(/\s*:\s*/g, glue).replace(/["«»“”„]/g, '').trim();
    const what = plain(ev.what, 80, ' ');
    if (!what) return null;
    const say = plain(ev.say, 100, ' — ');
    return `act=${ev.a}:${what}:${ev.b || ''}:${ev.type}:${ev.access || 'на людях'}:${ev.reach || 'неизвестно'}${say ? `:"${say}"` : ''}`;
  }
  if (ev.kind === 'rumor') {
    const what = cleanReason(ev.text, 100);
    return what ? `rumor=${ev.about}:${what}` : null;
  }
  if (ev.kind === 'new') {
    const name = cleanReason(ev.name).replace(/:/g, ' ').trim();
    const role = [ev.role === 'teacher' ? 'teacher' : '', ev.canon ? 'canon' : ''].filter(Boolean).join(',');
    return name ? `new=${name}${role ? `:${role}` : ''}` : null;
  }
  if (ev.kind === 'looks') {
    const text = cleanReason(ev.text, SOCIAL_TEXT_MAX.looks);
    const who = ev.personId || cleanReason(ev.name).replace(/:/g, ' ').trim();
    return text && who ? `looks=${who}:${text}` : null;
  }
  if (ev.kind === 'deal') {
    const what = cleanReason(ev.what);
    return what ? `deal${ev.closed ? '-' : ''}=${ev.a}:${ev.b}:${what}` : null;
  }
  if (ev.kind === 'feat') {
    const plain = (v, max) => cleanReason(v, max).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    if (ev.moment) {
      const m = ev.moment;
      const [emoji, name, desc] = [plain(m.emoji, 16), plain(m.name, 50), plain(m.desc, 160)];
      return emoji && name && desc ? `ach=момент:${emoji}:${name}:${desc}:${m.rarity}` : null;
    }
    const why = plain(ev.why, 100);
    return why && ev.id ? `ach=${ev.id}:${why}` : null;
  }
  const sign = ev.delta < 0 ? '-' : '+';
  const strength = ev.impact ? `${ev.impact}${sign}` : `${sign}${Math.abs(ev.delta)}`;
  const reason = cleanReason(ev.reason);
  return `rel=${ev.teacherId}:${strength}${reason ? `:${reason}` : ''}`;
}

function cleanReason(reason, max = ANALYSIS_LIMITS.reason) {
  return str(reason)
    .replace(/-->|[=[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

export function analysisMarker(tokens) {
  const list = (tokens || []).filter(Boolean);
  return `<!-- [ACADEMY${list.length ? ` ${list.join(' ')}` : ''}] -->`;
}

export function effectiveText(text, tokens) {
  const src = String(text || '');
  if (!Array.isArray(tokens)) return src;
  return `${keepMarkerKinds(src, ['time'])}\n${analysisMarker(tokens.filter(isFactToken))}`;
}

function displayPeople(lexicon) {
  return [...arr(lexicon.teachers).map((t) => ({ ...t, teacher: true })), ...arr(lexicon.classmates), ...arr(lexicon.candidates)];
}

export const ANON_WHO = 'без подписи';

export function tokenText(token, lexicon, { known = false, brief = false, day = '', today = '' } = {}) {
  const people = displayPeople(lexicon);
  const heroine = lexicon.names && typeof lexicon.names.user === 'string' ? lexicon.names.user.trim() : '';
  const gender = heroGender(lexicon, heroine);
  if (isReactToken(token)) {
    const r = reactionOf(token);
    if (!r) return String(token);
    if (r.chan === 'anon') return r.nick ? `${nickWord(r.nick)}: «${r.text}»` : `${ANON_WHO}: «${r.text}»`;
    return `${authorWord(r, people, heroine, lexicon, gender)}: «${r.text}»`;
  }
  if (isReplyToken(token)) {
    const a = replyOf(token);
    if (!a) return String(token);
    const who = a.chan === 'anon' && !a.nick ? ANON_WHO : authorWord(a, people, heroine, lexicon, gender);
    return `${who}: «${a.text}»`;
  }
  if (isLoudToken(token)) {
    const row = LOUDNESS.find((l) => l.level === loudOf([token]));
    return row ? row.word : String(token);
  }
  if (isPrivateToken(token)) return 'наедине, без свидетелей';
  if (isBullyToken(token)) return bullyTokenText(token, people, heroine, gender, lexicon);
  if (isPrepToken(token)) return prepTokenText(token, lexicon.preps);
  if (isPlayedToken(token)) {
    const hook = arr(lexicon.hooks).find((h) => h && h.id === token.slice(7));
    if (hook && hook.plate) return hook.plate;
    return hook ? `повод сыгран: ${hook.text}` : 'повод сыгран';
  }
  const ev = tokenEvent(token, lexicon);
  if (!ev) return String(token);
  if (ev.kind === 'feat') return featPlate(ev, lexicon);
  if (SCENE_KINDS.includes(ev.kind)) return sceneText(ev, people, heroine, gender);
  const subject = (id) => {
    const s = (lexicon.subjects || []).find((x) => x.id === id);
    return (s && s.name) || id;
  };
  if (ev.kind === 'grade') return `оценка: ${subject(ev.subjectId)} — ${ev.value}`;
  if (ev.kind === 'fame') return `Слава: ${ev.sign < 0 ? 'ниже' : 'выше'}${ev.why ? ` — ${ev.why}` : ''}`;
  if (ev.kind === 'completion') return `Сдано: ${ev.scope === 'all' ? 'все зачёты и экзамены' : ev.scope === 'debts' ? 'все текущие хвосты' : subject(ev.scope)} — ${ev.value}`;
  if (ev.kind === 'attendance') return `${ev.status === 'late' ? 'опоздание' : 'прогул'}: ${subject(ev.subjectId)}`;
  if (ev.kind === 'event') {
    const span = ev.until > ev.days ? ` (${daysWord(ev.until - ev.days + 1)})` : '';
    const head = known ? 'уже в планах: ' : brief ? 'в планы: ' : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const from = addDays(day, ev.days);
      const last = addDays(day, Math.max(ev.until, ev.days));
      const past = /^\d{4}-\d{2}-\d{2}$/.test(today) && today > last ? ' — уже прошло' : '';
      return `${head}${ev.name} — ${daysText(ev.days)}, ${dayWord(from)}${span}${past}`;
    }
    return `${head}${ev.name} — ${daysText(ev.days)}${span}`;
  }
  if (ev.kind === 'pause') {
    if (ev.end) return 'занятия возобновились';
    const name = ev.name ? `${ev.name} — ` : '';
    return `${name}занятий нет ${ev.days ? daysWord(ev.days) : 'до отмены'}`;
  }
  if (ev.kind === 'rel') {
    const t = people.find((x) => x.id === ev.teacherId);
    const who = (t && t.name) || GONE_PERSON.nom;
    const degree = ev.impact === 'major' ? 'заметно' : ev.impact === 'minor' ? 'чуть' : '';
    const head = relPhrase(who, ev.delta > 0, degree);
    return `${head}${ev.reason ? `${head.includes(': ') ? ' —' : ':'} ${ev.reason}` : ''}`;
  }
  return String(token);
}

function featPlate(ev, lexicon) {
  const own = ev.moment || featText(ev.id, lexicon);
  const emoji = ev.moment ? ev.moment.emoji : (featById(ev.id) || {}).emoji;
  const mark = emoji ? `${emoji} ` : '';
  return `ачивка: ${mark}${own.name}${ev.why ? ` — ${ev.why}` : ''}`;
}

export function talkParts(token, lexicon) {
  const people = displayPeople(lexicon);
  const heroine = lexicon.names && typeof lexicon.names.user === 'string' ? lexicon.names.user.trim() : '';
  const gender = heroGender(lexicon, heroine);
  const r = isReactToken(token) ? reactionOf(token) : isReplyToken(token) ? replyOf(token) : null;
  if (!r) return null;
  if (r.nick) return { who: nickWord(r.nick), say: r.text, style: 'mask' };
  if (r.chan === 'anon') return { who: ANON_WHO, say: r.text, style: 'anon' };
  const who = authorWord(r, people, heroine, lexicon, gender);
  return { who, say: r.text, style: r.who === SOMEONE || !r.who ? 'anon' : 'person' };
}

export function tokenAbout(token, lexicon) {
  const ev = tokenEvent(token, lexicon);
  if (ev && SCENE_KINDS.includes(ev.kind)) {
    const people = displayPeople(lexicon);
    const heroine = lexicon.names && typeof lexicon.names.user === 'string' ? lexicon.names.user.trim() : '';
  const gender = heroGender(lexicon, heroine);
    return sceneAbout(ev, people, heroine, gender);
  }
  return tokenText(token, lexicon, { brief: true });
}

function authorWord(r, people, heroine, lexicon, gender = 'f') {
  if (r.nick) return nickWord(r.nick);
  return r.who === SOMEONE || !r.who ? someoneWord(lexicon) : personWord(r.who, people, heroine, gender);
}

function daysText(n) {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === 2) return 'послезавтра';
  return `через ${daysWord(n)}`;
}

const MONTHS_GEN = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function dayWord(day) {
  const [, m, d] = String(day).split('-').map(Number);
  return `${d} ${MONTHS_GEN[m] || ''}`.trim();
}

function daysWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const word = a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b > 1 && b < 5 ? 'дня' : 'дней';
  return `${n} ${word}`;
}

export function tokenEvent(token, lexicon) {
  return parseMarker(analysisMarker([token]), lexicon).events[0] || null;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function clipAnalysisReply(text, limit = ANALYSIS_LIMITS.reply) {
  const source = str(text);
  if (source.length <= limit) return source;
  const separator = '\n[… часть текста опущена …]\n';
  const budget = Math.max(0, limit - separator.length * 3);
  const edge = Math.floor(budget / 4);
  const middle = source.slice(edge, source.length - edge);
  const relevant = middle.split(/\n\s*\n|(?<=[.!?])\s+/u)
    .filter((part) => /экзамен|зач[её]т|хвост|оценк|отметк|профессор|преподавател|прогул|опозда|сдал|сдан|сдач|праздн|(?<![а-яё])бал(?!л)|вечеринк|концерт|ярмарк|фестивал|турнир|поход|свидани|через .{0,12}(дн|недел)|завтра|послезавтра|в (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|ссор|ругал|скандал|слух|сплетн|говорят|обещал|одолжил|верн[её]т|конспект|exam|grade|passed/iu.test(part))
    .join('\n');
  return [source.slice(0, edge), relevant.slice(0, budget - edge * 2), source.slice(-edge)]
    .filter(Boolean).join(separator);
}

function clip(text, limit) {
  const s = str(text);
  return s.length > limit ? `…${s.slice(s.length - limit)}` : s;
}
