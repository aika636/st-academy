import { milestones, milestoneDetail } from './milestones.mjs';
import { normalizeFeats } from './state.mjs';
import { hash } from './feed.mjs';
import { DIE } from './exams.mjs';
import { heroWords } from './gender.mjs';

export const RARITIES = ['common', 'rare', 'epic', 'legendary'];

export const FEAT_FAMILIES = [
  { id: 'love', labelKey: 'achFamLove' },
  { id: 'teach', labelKey: 'achFamTeach' },
  { id: 'chaos', labelKey: 'achFamChaos' },
  { id: 'fame', labelKey: 'achFamFame' },
  { id: 'people', labelKey: 'achFamPeople' },
  { id: 'study', labelKey: 'achFamStudy' },
  { id: 'events', labelKey: 'achFamEvents' },
  { id: 'shame', labelKey: 'achFamShame' },
];

export const MOMENTS_FAMILY = { id: 'moments', labelKey: 'achFamMoments' };

export const FREE_EVERY = 8;

const ROWS = [
  ['kiss', 'love', '💋', 'common', 0, 'ach', 'Сорвать поцелуй', 'Поцелуйте персонажа карточки — по-настоящему, а не в мечтах.', 'Дипломатия? Не, не слышали.'],
  ['date', 'love', '🌹', 'rare', 0, 'ach', 'Вытащить на свидание', 'Сходите с персонажем карточки на настоящее свидание — и пусть оба это признают.', 'Это больше не «случайно встретились».'],
  ['outed', 'love', '📢', 'rare', 0, 'ach', 'Спалить ваши отношения', 'Признайтесь в отношениях при всех — или попадитесь так, что отпираться поздно.', 'Секретность покинула чат.'],
  ['makeup', 'love', '🕊️', 'rare', 1, 'ach', 'Помириться при свидетелях', 'Поссорьтесь с персонажем карточки на людях — и помиритесь, пока все смотрят.', 'Зрители требуют вторую серию.'],
  ['loveSpite', 'love', '💔', 'epic', 1, 'ach', 'Выбрать любовь назло', 'Выберите персонажа карточки, хотя это стоит вам чего-то важного.', 'Здравый смысл подал заявление об уходе.'],
  ['jealous', 'love', '💚', 'rare', 0, 'ach', 'Довести до ревности', 'Заставьте персонажа карточки ревновать — громко и при всех.', 'Третий лишний уже бежит.'],
  ['kissTeacher', 'teach', '🍎', 'rare', 0, 'ach', 'Поцеловать препода', 'Поцелуйте преподавателя. Да, того самого.', 'Консультация затянулась.'],
  ['correctTeacher', 'teach', '✏️', 'rare', 0, 'ach', 'Поправить препода', 'Поймайте преподавателя на ошибке — и пусть он признает, что вы правы.', 'Сегодня экзаменовали по обе стороны стола.'],
  ['board', 'teach', '📝', 'common', 0, 'ach', 'Захватить доску', 'Объясните тему всей группе вместо преподавателя.', 'Препод взял выходной прямо на занятии.'],
  ['helpTeacher', 'teach', '🩹', 'rare', 1, 'ach', 'Выручить препода', 'Помогите преподавателю с бедой, которая не про учёбу.', 'Оценку за это не ставят. А жаль.'],
  ['favorite', 'teach', '⭐', 'rare', 0, 'state', 'Стать любимчиком', 'Добейтесь самого тёплого отношения преподавателя.', 'Вам теперь прощают опоздания. Наверное.'],
  ['nemesis', 'teach', '😤', 'rare', 1, 'state', 'Довести препода', 'Доведите преподавателя до того, что он вас не выносит.', 'У него дёргается глаз при вашем имени.'],
  ['disrupt', 'chaos', '💥', 'rare', 0, 'ach', 'Сорвать урок', 'Сделайте так, чтобы урок продолжить было невозможно.', 'Препод ушёл пить валерьянку.'],
  ['firstSkip', 'chaos', '🏃', 'common', 1, 'state', 'Сбежать с урока', 'Прогуляйте занятие без уважительной причины.', 'Присутствовали исключительно духовно.'],
  ['ghost', 'chaos', '👻', 'rare', 1, 'state', 'Стать призраком', 'Прогуляйте десять занятий.', 'Вас уже вычеркнули из списка живых.'],
  ['trespass', 'chaos', '🚪', 'rare', 1, 'ach', 'Пролезть куда нельзя', 'Проникните туда, куда вход запрещён.', 'Табличка «Посторонним вход воспрещён» плачет.'],
  ['breakForFriend', 'chaos', '🔓', 'rare', 0, 'ach', 'Нарушить ради своих', 'Нарушьте правило, чтобы помочь другому, — и помогите.', 'Устав пострадал, друг — нет.'],
  ['rewriteRules', 'chaos', '📜', 'legendary', 1, 'ach', 'Переписать правила', 'Натворите такого, что из-за вас поменяют правила.', 'В уставе теперь есть пункт имени вас.'],
  ['onTheEdge', 'chaos', '⚠️', 'rare', 1, 'state', 'Поиграть с отчислением', 'Получите последнее предупреждение.', 'Вас знают в лицо там, куда лучше не попадать.'],
  ['gossip', 'fame', '🗣️', 'common', 0, 'code', 'Попасть в сплетни', 'Станьте темой разговоров в общем чате.', 'Теперь обсуждают не только меню.'],
  ['wrongRumor', 'fame', '🌀', 'rare', 0, 'ach', 'Узнать о себе новое', 'Услышьте о себе слух, который переврал всё.', 'Версия для публики, с бонусными сценами.'],
  ['killRumor', 'fame', '🤐', 'rare', 0, 'ach', 'Заткнуть сплетников', 'Публично опровергните ложный слух о себе.', 'Поправка догнала сплетню.'],
  ['famous', 'fame', '🌟', 'rare', 1, 'ach', 'Прославиться заочно', 'Встретьте человека, который уже наслышан о ваших подвигах.', 'Автографы — после занятий.'],
  ['chatQueen', 'fame', '👑', 'epic', 0, 'code', 'Захватить общий чат', 'Будьте главной темой общего чата весь день.', 'Чат переименовали бы в вашу честь, если бы могли.'],
  ['seatOutcast', 'people', '🪑', 'common', 0, 'ach', 'Подсесть к изгою', 'Примите в компанию того, кого все сторонятся.', 'В компании плюс один, у изгоев минус один.'],
  ['fightBack', 'people', '🥊', 'rare', 0, 'code', 'Дать задире отпор', 'Дайте отпор тому, кто вас травит.', 'Удобная мишень закончилась.'],
  ['shield', 'people', '🛡️', 'rare', 0, 'ach', 'Прикрыть не себя', 'Заступитесь за того, кого травят, — и примите удар на себя.', 'Неприятности теперь на двоих.'],
  ['buryHatchet', 'people', '🪓', 'rare', 0, 'ach', 'Закопать топор войны', 'Помиритесь с давним врагом.', 'Просьба не выкапывать до завтра.'],
  ['keepPromise', 'people', '🤞', 'rare', 1, 'ach', 'Сдержать неудобное обещание', 'Выполните обещание, когда выполнить его стало очень трудно.', 'Слово оказалось крепче обстоятельств.'],
  ['bullyApology', 'people', '🙇', 'rare', 0, 'ach', 'Выбить извинения', 'Добейтесь, чтобы задира искренне извинился.', 'Задира теперь заикается при встрече.'],
  ['firstTop', 'study', '💯', 'common', 0, 'state', 'Выжать высшую оценку', 'Получите высшую оценку.', 'Журналу нечего добавить.'],
  ['debtCleared', 'study', '✂️', 'common', 0, 'state', 'Отрубить хвост', 'Пересдайте то, что было завалено.', 'Одной причиной для кошмаров меньше.'],
  ['retakeWin', 'study', '🔁', 'common', 0, 'state', 'Взять со второй', 'Завалите экзамен, а потом всё-таки сдайте.', 'Первая попытка была разминкой.'],
  ['cleanWeek', 'study', '📅', 'common', 0, 'state', 'Не пропустить ни дня', 'Проучитесь неделю без единого прогула.', 'Будильник гордится вами.'],
  ['cleanSession', 'study', '🏅', 'rare', 0, 'state', 'Сдать всё с первого раза', 'Сдайте всю сессию без пересдач.', 'Пересдачи скучают без вас.'],
  ['autoPass', 'study', '🎟️', 'rare', 0, 'state', 'Проскочить автоматом', 'Получите оценку без экзамена.', 'Экзамен даже не узнал о вашем существовании.'],
  ['brilliant', 'study', '🏆', 'epic', 0, 'state', 'Сдать на ура', 'Сдайте экзамен с огромным запасом.', 'Комиссия аплодирует стоя.'],
  ['hackMethod', 'study', '🔧', 'rare', 0, 'ach', 'Сломать методичку', 'Решите задачу способом, которого нет в учебнике, — и пусть его признают.', 'Методичка нервно перелистывается.'],
  ['carryTeam', 'study', '🏋️', 'rare', 0, 'ach', 'Утащить всех на себе', 'Спасите общий проект, когда остальные уже сдались.', 'Соавторы делают вид, что так и было задумано.'],
  ['luckyRoll', 'study', '🎲', 'epic', 0, 'code', 'Выбросить невозможное', 'Пройдите испытание кубиком, у которого почти не было шансов.', 'Кубик выбрал самый наглый исход.'],
  ['invited', 'events', '💌', 'common', 0, 'code', 'Урвать приглашение', 'Получите личное приглашение на праздник.', 'В списке гостей знакомое имя.'],
  ['madeIt', 'events', '🚀', 'rare', 0, 'ach', 'Добраться назло всему', 'Придите на праздник, несмотря на все препятствия.', 'Обстоятельства проиграли всухую.'],
  ['dance', 'events', '💃', 'common', 0, 'ach', 'Выйти на танец', 'Станцуйте с кем-нибудь на празднике.', 'Танцпол получил нового бойца.'],
  ['savedParty', 'events', '🎉', 'epic', 0, 'ach', 'Спасти праздник', 'Спасите праздник, который вот-вот сорвётся.', 'Шоу продолжается — благодаря вам.'],
  ['spillSecret', 'shame', '🤭', 'rare', 1, 'ach', 'Выболтать свой секрет', 'Случайно раскройте свой секрет при всех.', 'Секрет вышел без разрешения владельца.'],
  ['wrongAddressee', 'shame', '📨', 'common', 1, 'ach', 'Перепутать адресата', 'Отправьте личное сообщение не тому человеку.', 'Дошло. Вопрос только — до кого.'],
  ['critFail', 'shame', '💀', 'rare', 1, 'state', 'Провалиться с размахом', 'Провалите испытание так, что это войдёт в легенды.', 'Даже провал выступил на максимум.'],
  ['caughtSneaking', 'shame', '🕵️', 'common', 1, 'ach', 'Спалиться на выходе', 'Попробуйте незаметно уйти — и попадитесь.', 'Тихий уход получил свидетеля.'],
];

export const FEATS = ROWS.map(([id, fam, emoji, rarity, secret, src, name, desc, quip]) => ({
  id, fam, emoji, rarity, secret: secret === 1, src, name, desc, quip,
}));

const BY_ID = new Map(FEATS.map((f) => [f.id, f]));
export const featById = (id) => BY_ID.get(id) || null;
export const isSecretFeat = (id) => Boolean(BY_ID.get(id) && BY_ID.get(id).secret);

const lower = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

export function achIdOf(word) {
  const w = lower(word);
  const hit = FEATS.find((f) => f.src === 'ach' && lower(f.id) === w);
  return hit ? hit.id : '';
}

const RARITY_WORDS = {
  common: ['common', 'обычная', 'обычный', 'обычное'],
  rare: ['rare', 'редкая', 'редкий', 'редкое'],
  epic: ['epic', 'эпическая', 'эпический', 'эпическое', 'эпик'],
  legendary: ['legendary', 'легендарная', 'легендарный', 'легендарное'],
};

export function rarityOf(word) {
  const w = lower(word).replace(/[.!]+$/, '');
  return Object.keys(RARITY_WORDS).find((k) => RARITY_WORDS[k].includes(w)) || '';
}

export const MOMENT_WORDS = ['момент', 'moment'];

export const momentId = (name) => `moment:${hash(lower(name))}`;

export function featText(id, preset) {
  const f = featById(id);
  const own = preset && preset.phrases && preset.phrases.feats && preset.phrases.feats[id];
  const pick = (key) => (own && typeof own[key] === 'string' && own[key].trim() ? own[key].trim() : (f ? f[key] : ''));
  return { name: pick('name'), desc: pick('desc'), quip: pick('quip') };
}

export function withChar(desc, char) {
  const name = String(char || '').trim();
  return name ? String(desc).replace('персонажа карточки', `персонажа карточки (${name})`) : String(desc);
}

export function earnedFeats(state, preset, { char = '' } = {}) {
  if (!state || typeof state !== 'object') return [];
  const out = [];
  for (const m of milestones(state, preset)) {
    const f = featById(m.kind);
    if (!f) continue;
    const t = featText(f.id, preset);
    out.push({
      id: m.id, feat: f.id, kind: 'state', fam: f.fam, emoji: f.emoji, rarity: f.rarity, secret: f.secret,
      name: t.name, desc: withChar(t.desc, char), quip: t.quip, detail: milestoneDetail(m, state, preset),
      when: m.when || null, why: '',
      ...(m.subjectId ? { subjectId: m.subjectId } : {}), ...(m.teacherId ? { teacherId: m.teacherId } : {}),
    });
  }
  for (const it of normalizeFeats(state.feats).items) {
    if (it.moment) {
      out.push({
        id: it.id, kind: 'moment', fam: MOMENTS_FAMILY.id, emoji: it.moment.emoji, rarity: it.moment.rarity, secret: false,
        name: it.moment.name, desc: it.moment.desc, quip: '', detail: '', when: it.when || null, why: it.why, src: it.src || '',
      });
      continue;
    }
    const f = featById(it.id);
    if (!f) continue;
    const t = featText(f.id, preset);
    out.push({
      id: f.id, feat: f.id, kind: f.src, fam: f.fam, emoji: f.emoji, rarity: f.rarity, secret: f.secret,
      name: t.name, desc: withChar(t.desc, char), quip: t.quip, detail: '', when: it.when || null, why: it.why, src: it.src || '',
    });
  }
  const order = (e) => (e.feat ? FEATS.findIndex((f) => f.id === e.feat) : FEATS.length);
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.when && b.e.when && a.e.when !== b.e.when) return a.e.when < b.e.when ? -1 : 1;
      if (Boolean(a.e.when) !== Boolean(b.e.when)) return a.e.when ? -1 : 1;
      return (order(a.e) - order(b.e)) || (a.i - b.i);
    })
    .map((x) => x.e);
}

export function featLine(e) {
  return e ? [e.name, e.detail].filter(Boolean).join(': ') : '';
}

export const TALLY_CHATS_MAX = 200;

export function recordTally(tally, chatKey, list, today) {
  const base = tally && typeof tally === 'object' && !Array.isArray(tally) ? tally : {};
  if (!chatKey || !Array.isArray(list) || !list.length) return base;
  let out = base;
  for (const id of new Set(list.map((m) => m && (m.feat || m.kind)).filter((k) => BY_ID.has(k)))) {
    const cur = base[id] && Array.isArray(base[id].chats) ? base[id] : { chats: [], first: null };
    if (cur.chats.includes(chatKey)) continue;
    if (out === base) out = { ...base };
    out[id] = { chats: [...cur.chats, chatKey].slice(-TALLY_CHATS_MAX), first: cur.first || today || null };
  }
  return out;
}

export function tickFeats(state) {
  const f = normalizeFeats(state && state.feats);
  return { ...state, feats: { ...f, n: f.n + 1 } };
}

export function momentDue(state, ahead = 0) {
  const f = normalizeFeats(state && state.feats);
  const last = Math.max(0, ...f.items.filter((i) => i.moment).map((i) => i.n));
  return f.n + ahead - last >= FREE_EVERY;
}

export function featsKnow(state, ahead = 0) {
  const f = normalizeFeats(state && state.feats);
  return {
    owned: f.items.filter((i) => !i.moment).map((i) => i.id),
    moments: f.items.filter((i) => i.moment).map((i) => lower(i.moment.name)),
    momentOk: momentDue(state, ahead),
  };
}

export function placeFeat(next, ev, { src = '', day = '' } = {}) {
  const f = normalizeFeats(next.feats);
  let item;
  if (ev.moment) {
    const name = lower(ev.moment.name);
    if (f.items.some((i) => i.moment && lower(i.moment.name) === name)) return null;
    if (!momentDue(next)) return null;
    item = { id: ev.id || momentId(ev.moment.name), moment: ev.moment, why: '' };
  } else {
    if (!achIdOf(ev.id) || f.items.some((i) => i.id === ev.id)) return null;
    item = { id: ev.id, why: ev.why || '' };
  }
  f.items.push({ ...item, src, when: day, n: f.n });
  next.feats = normalizeFeats(f);
  return next.feats.items.some((i) => i.id === item.id) ? { kind: 'feat', id: item.id } : null;
}

export function revertFeat(state, receipt) {
  if (!receipt || !state.feats) return state;
  const f = normalizeFeats(state.feats);
  return { ...state, feats: { ...f, items: f.items.filter((i) => i.id !== receipt.id) } };
}

export function revertFeatSource(state, src) {
  if (!src || !state.feats) return state;
  const f = normalizeFeats(state.feats);
  const items = f.items.filter((i) => i.src !== src);
  return items.length === f.items.length ? state : { ...state, feats: { ...f, items } };
}

const aboutHeroine = (state) => ((state.feed && state.feed.items) || []).filter((x) => x && x.kind === 'reaction' && x.heroine === true);

export const QUEEN_POSTS = 8;
export const QUEEN_VOICES = 3;

const chanceOf = (dc) => Math.max(0, Math.min(DIE, DIE - dc + 1)) / DIE;

export const LUCKY_CHANCE = 0.1;

function luckyRoll(state) {
  let day = null;
  for (const item of (state.exams && state.exams.items) || []) {
    const rolls = Array.isArray(item.rolls) ? item.rolls : [];
    rolls.forEach((r, idx) => {
      if (!r || !['success', 'critSuccess'].includes(r.tier) || r.saved || !Number.isFinite(r.roll) || !Number.isFinite(r.dc)) return;
      if (r.roll < r.dc || chanceOf(r.dc) > LUCKY_CHANCE) return;
      if (idx === rolls.length - 1 && item.modelOverride && String(item.outcome) !== String(r.value)) return;
      if (day === null || (r.day && (!day || r.day < day))) day = r.day || '';
    });
  }
  return day;
}

function chatQueen(state) {
  const days = new Map();
  for (const x of aboutHeroine(state)) {
    const d = x.at && x.at.day;
    if (!d) continue;
    const row = days.get(d) || { n: 0, who: new Set() };
    row.n += 1;
    const voice = x.who || x.nick;
    if (voice) row.who.add(voice);
    days.set(d, row);
  }
  const hit = [...days.entries()].filter(([, r]) => r.n >= QUEEN_POSTS && r.who.size >= QUEEN_VOICES).map(([d]) => d).sort();
  return hit.length ? hit[0] : null;
}

function codeFeats(state) {
  const out = {};
  const today = (state.calendar && state.calendar.day) || '';
  const mine = aboutHeroine(state);
  if (mine.length) out.gossip = (mine[0].at && mine[0].at.day) || today;
  const queen = chatQueen(state);
  if (queen) out.chatQueen = queen;
  const inv = state.invites;
  if (inv && (inv.pending || (Number.isInteger(inv.last) && inv.last >= 0))) out.invited = today;
  if (state.bullying && state.bullying.fought) out.fightBack = state.bullying.fought;
  const lucky = luckyRoll(state);
  if (lucky !== null) out.luckyRoll = lucky || today;
  return out;
}

export function syncFeats(state, { src = '' } = {}) {
  if (!state || typeof state !== 'object') return state;
  const have = new Set(normalizeFeats(state.feats).items.map((i) => i.id));
  const fresh = Object.entries(codeFeats(state)).filter(([id]) => !have.has(id));
  if (!fresh.length) return state;
  const f = normalizeFeats(state.feats);
  for (const [id, day] of fresh) f.items.push({ id, src, when: day, why: '', n: f.n });
  return { ...state, feats: normalizeFeats(f) };
}

const CHECKS = {
  jealous: (w, g) => `персонаж карточки при свидетелях явно ревнует ${w.heroAcc} — злится, ставит соперника на место, уводит ${w.herAcc}, устраивает сцену — из-за ${w.her} поступка или чужого внимания к ${w.herDat}. Ревность — его реакция, но заслуга ${w.heroGen}: это ${w.her} достижение`,
  correctTeacher: (w, g) => `${w.hero} ${g('указала', 'указал')} преподавателю на ошибку, и в ответе рассказчика преподаватель сам признал ${w.her} правоту`,
  kissTeacher: (w, g) => `${w.hero} ${g('поцеловала', 'поцеловал')} преподавателя или он — ${w.herAcc}, хоть в щёку, хоть на спор`,
};

const GOOD_MOMENTS = [
  'Обратить провал в номер — превратите собственную ошибку в шутку, над которой смеётся весь зал',
  'Перехитрить экзаменатора — найдите в правилах лазейку, которую никто не замечал',
  'Спасти чужую репутацию — возьмите на себя чужой промах при свидетелях',
  'Выйти сухой из воды — объясните невероятное так, что вам поверили',
];
const BAD_MOMENTS = [
  '«Сердцеед» за поцелуй — такое уже есть в каталоге',
  '«Гений курса» за просто хороший ответ',
  '«Мастер обмана» за одну мысль кого-то обмануть',
];

export function featsPromptLines(state, preset, { char = '', heroine = 'героиня', ahead = 0, gender = 'f' } = {}) {
  const w = heroWords(gender);
  const g = (f, m) => (gender === 'm' ? m : f);
  const have = new Set(normalizeFeats(state && state.feats).items.map((i) => i.id));
  const open = FEATS.filter((f) => f.src === 'ach' && !have.has(f.id));
  const free = momentDue(state, ahead);
  if (!open.length && !free) return { context: [], rules: [] };
  const context = [];
  const rules = [];
  if (open.length) {
    context.push('Достижения, ещё не полученные (id — условие):', ...open.map((f) => `- ${f.id} — ${withChar(CHECKS[f.id] ? CHECKS[f.id](w, g) : featText(f.id, preset).desc, char)}`));
    rules.push(
      `- ach — достижение ${heroine} из списка «Достижения»: ach=id:основание, где основание — короткая фраза из текста, что именно случилось. Только то, что случилось в ответе рассказчика: реплика игрока — это попытка, и то, что игрок написал за других («препод признал», «он позвал меня»), не считается, пока рассказчик этого не показал. Не намерение, не мечта, не слух, не поступок одного персонажа карточки, к которому ${heroine} ${g('не причастна', 'не причастен')}. Одно достижение из списка на ответ. Не уверен — не пиши.`,
    );
  }
  if (free) {
    rules.push(
      `- Свободный момент: ach=момент:эмодзи:Название:Описание:редкость — сейчас можно: если в ответе рассказчика ${heroine} ${g('сделала', 'сделал')} что-то яркое, смешное, безумное, дерзкое или героическое (пранк, шоу, выходка, неожиданный ход), предложи момент, даже если в том же ответе есть достижение из списка — момент описывает другую деталь. Не пиши только за обычный ход и за то, что уже покрыло достижение. Название — глагол-задание из 2–5 слов с хулиганским тоном; описание — одна фраза в духе Steam о том, что сделал игрок, привязанная к реальной детали сцены; редкость common или rare (epic — только при крупном последствии). Хорошие названия: ${GOOD_MOMENTS.map((m) => `«${m}»`).join('; ')}. Плохие: ${BAD_MOMENTS.join('; ')}.`,
    );
  }
  return { context, rules };
}
