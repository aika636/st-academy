import { parseMarker, keepMarkerKinds, markerKeys, partyOf, salvageMarker, cardDisplayName, splitNewRole, MARKER_RE, HEROINE, SOCIAL_TEXT_MAX } from './parse-marker.mjs';
import { normName } from './stop-names.mjs';
import { isPerson } from './classmates.mjs';
import { sittableExams, kindOf } from './exams.mjs';
import { teacherOfSubject } from './state.mjs';
import { holidaysAhead, holidaysOn } from './holidays.mjs';
import { addDays } from './time.mjs';
import { EVENT_HORIZON } from './parse-marker.mjs';
import { SCENE_KINDS, sceneText, sceneAbout, personWord } from './scene.mjs';
import { heroGender, heroWords } from './gender.mjs';
import { subjectWord, upFirst } from './words.mjs';
import { reactionCap, loudCap, LOUDNESS, hash, cleanNick, cleanType, nickWord, postRef } from './feed.mjs';
import { isPrepToken, prepTokenOf, prepTokenText, prepTokens } from './prep.mjs';
import { featText, featById, featsPromptLines } from './feats.mjs';
import { isBullyToken, parseBullyToken, bullyTokenOf, bullyAnalysisActive, bullyTabooLine, bullyingOf, resolveBully, bullyTokenText, BULLY_LEVEL_HINTS, BULLY_MOVE_ALIASES } from './bullying.mjs';

export const ANALYSIS_KINDS = ['grade', 'completion', 'rel', 'attendance', 'event', 'pause', 'fame', ...SCENE_KINDS];

export const ANALYSIS_LIMITS = { reply: 6000, user: 5000, reason: 60 };

const systemOf = (gender, preset) => {
  const sbj = subjectWord(preset, 'genMany');
  const w = heroWords(gender);
  return [
  `Ты — секретарь учебной части. Тебе дают фрагмент ролевой истории про ${gender === 'm' ? 'студента' : 'студентку'}, списки ${sbj}, преподавателей и ${w.her} курса.`,
  `Ты записываешь в ведомость только то, что в этом фрагменте действительно случилось — с ${w.heroIns} и людьми вокруг ${gender === 'm' ? 'него' : 'неё'}. Ничего не додумываешь.`,
  'Отвечаешь двумя блоками: «Что было» — строка служебной метки, «Слышно» — насколько громко это и было ли это при людях; затем строка «Кратко:».',
  'Постов, реплик и ников курса ты не пишешь: сплетни сочиняет отдельный вызов.',
  ].join(' ');
};

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
  const w = heroWords(gender);
  const g = (f, m) => (gender === 'm' ? m : f);
  const heroine = str(input.heroine) || w.hero;
  const subjects = (state.subjects || []).map((s) => {
    const t = teacherOfSubject(state, s.id);
    return `- ${s.id} — ${s.name || s.id}${t ? ` — ${t.name || t.id} (${t.id})` : ''}`;
  });
  const alsoLine = (p) => {
    const list = Array.isArray(p.aliases) ? p.aliases.filter((a) => typeof a === 'string' && a.trim()) : [];
    return list.length ? ` (ещё пишут: ${list.join(', ')})` : '';
  };
  const teachers = (state.teachers || []).map((t) => `- ${t.id} — ${t.name || t.id}${alsoLine(t)}`);
  const course = (Array.isArray(state.classmates) ? state.classmates : []).filter((c) => c && c.id).map((c) => {
    const about = classmateLine(c);
    return `- ${c.id} — ${c.name || c.id}${alsoLine(c)}${about ? ` — ${about}` : ''}`;
  });
  const values = ((preset.grades && preset.grades.values) || []).map((g) => g.value);

  const lines = [];
  if (input.statusLine) lines.push(`Где мы в календаре: ${input.statusLine}`);
  const canon = state.survey && typeof state.survey.canon === 'string' ? state.survey.canon.trim() : '';
  if (canon) {
    lines.push(`Мир — канон: ${canon}. Если человек уже есть в списках под другим написанием или переводом (Снейп и Снегг) — это он: пиши его id, а не new. Новых канонических людей пиши полным каноническим именем («Поппи Помфри», не «мадам Помфри») и помечай словом canon в роли: new=Поппи Помфри:teacher,canon; new=Луна Лавгуд:canon.`);
  }
  const latinCards = (Array.isArray(input.cardNames) ? input.cardNames : []).filter((n) => typeof n === 'string' && /[a-z]/i.test(n) && !/[а-яё]/i.test(n));
  if (latinCards.length && /[а-яё]/i.test(str(input.reply))) {
    lines.push(`Персонаж карточки (${latinCards.join(', ')}) называй по-русски, как в тексте ответа, а не латиницей: в ключах (@card/имя) и в «Кратко».`);
  }
  lines.push(`${upFirst(subjectWord(preset, 'many'))} (id — название — преподаватель):`, ...subjects);
  lines.push('Преподаватели (id — имя):', ...teachers);
  lines.push(`Курс ${w.heroGen} (id — имя — о человеке):`, ...(course.length ? course : ['- пока никого']));
  const seen = (Array.isArray(state.classmateCandidates) ? state.classmateCandidates : []).map((c) => c && str(c.name)).filter(Boolean).slice(-15);
  const bare = [...(state.teachers || []), ...(Array.isArray(state.classmates) ? state.classmates : [])].filter((p) => p && p.id && !str(p.looks));
  if (bare.length) lines.push(`Без записанной внешности: ${bare.slice(0, 40).map((p) => p.id).join(', ')}.`);
  if (seen.length) lines.push(`Уже замечены, ждут решения игрока (под любым написанием это не новые лица — new= для них не пиши): ${seen.join(', ')}.`);
  if (values.length) lines.push(`Оценки пишутся одним из значений: ${values.join(', ')}.`);
  const debts = (state.subjects || []).filter((subject) => subject.debt);
  lines.push(`Текущие хвосты: ${debts.length ? debts.map((subject) => subject.id).join(', ') : 'нет'}.`);
  const exams = input.exams === false ? [] : todaysExamLines(state, preset);
  if (exams.length) {
    lines.push(`Сегодня по расписанию: ${exams.join('; ')}. Если во фрагменте его сдали или провалили — запиши исход как grade по ${subjectWord(preset, 'dat')}.`);
  }
  const hooks = (Array.isArray(input.hooks) ? input.hooks : []).filter((h) => h && h.id && h.text).slice(0, 3);
  if (hooks.length) lines.push('Поводы, которые игрок отдал рассказчику (id — что):', ...hooks.map((h) => `- ${h.id} — ${clip(h.text, 200)}`));
  const preps = (Array.isArray(input.preps) ? input.preps : []).filter((n) => n && n.id && n.text).slice(0, 3);
  if (preps.length) lines.push('Намерения неписей (id — кто — что):', ...preps.map((n) => `- ${n.id} — ${clip(n.text, 200)}`));
  const known = knownEventLines(state, preset);
  lines.push(`Уже в планах (не повторяй): ${known.length ? known.join('; ') : 'ничего'}.`);
  const taboo = bullyTabooLine(state);
  if (taboo) lines.push(taboo);
  const feats = input.feats === false ? { context: [], rules: [] } : featsPromptLines(state, preset, { char: [].concat(input.cardNames || [])[0] || '', heroine, gender, ahead: input.feats && input.feats.ahead ? 1 : 0 });
  lines.push(...feats.context);
  lines.push('');
  const said = clipAnalysisReply(stripForeignMarkup(str(input.userText)), ANALYSIS_LIMITS.user);
  if (said) {
    lines.push(`Реплика игрока перед ответом — это тоже фрагмент: здесь игрок пишет, что делает ${heroine}.`, '"""', said, '"""', '');
  }
  lines.push('Ответ рассказчика:', '"""', clipAnalysisReply(stripForeignMarkup(input.reply)), '"""', '');
  lines.push(
    'Блок 1. Что было — одной строкой служебной метки:',
    `<!-- [ACADEMY grade=${subjectWord(preset)}:оценка rel=человек:minor+:повод skip=${subjectWord(preset)} late=${subjectWord(preset)} event=+3:название met=однокурсник clash=кто:с кем:повод act=кто:что:с кем:вид:доступность:охват rumor=о ком:что говорят new=Имя Фамилия looks=кто:внешность deal=кто:кому:что fame=+:основание${feats.rules.length ? ' ach=id:основание' : ''}] -->`,
    'Правила блока 1:',
    `- grade — только если ${heroine} ${g('получила оценку, сдала или не сдала', 'получил оценку, сдал или не сдал')} зачёт или экзамен. Оценки другим людям не пишутся.`,
    '- Прочитай весь фрагмент: учебный итог может быть фоном, воспоминанием о прошедших днях или репликой собеседника, даже если главная сцена бытовая или романтическая.',
    ...(said ? [`- Фрагмент — реплика игрока и ответ рассказчика вместе. Что ${heroine} в реплике игрока сделала (действие, сказанное вслух, результат на глазах у других), случилось, если ответ рассказчика этому не противоречит: блестящий ответ на занятии, взорванный котёл, поцелуй, танец, драка — пиши act, fame, grade и остальное и по реплике игрока. Намерение, мысль, мечта, вопрос и «попыталась» без результата — не случилось. Свидетели, названные в реплике игрока, — тоже свидетели: доступность считай по обоим текстам. Одно событие, показанное и в реплике, и в ответе, — один ключ.`] : []),
    `- Явный итог «все экзамены/зачёты сданы» записывай completion=all:оценка; «все хвосты закрыты» — completion=debts:оценка; сдача названной позиции из списка ${subjectWord(preset, 'genMany')} — completion=id:оценка. Обычная оценка за ответ у доски остаётся grade. Не дублируй completion обычными grade по тем же позициям списка.`,
    `- «Ты все зачёты на отлично ${g('сдала', 'сдал')}», «все хвосты были сданы на высший балл», «${g('сдала', 'сдал')} все хвосты до единого; в зачётке отметки отлично» — состоявшийся учебный итог, а не отсутствие событий. Для «отлично»/«высший балл» возьми высшую оценку из шкалы. Без точной оценки используй проходное «зачёт», если оно есть в шкале; не выдумывай числовой балл.`,
    `- completion=all допустим только при явно сказанном «все» об экзаменах/зачётах ${w.heroGen}. Желание, будущий план, отрицание («ещё не ${g('сдала', 'сдал')} все») или достижения другого персонажа не означают завершение. Не угадывай ${subjectWord(preset, 'acc')} по неназванному преподавателю; не добавляй оценки остальным из списка за один удачный ответ.`,
    `- rel — если отношение преподавателя или однокурсника к ${heroine} заметно изменилось: minor+ или minor- (немного), major+ или major- (сильно); после второго двоеточия — повод в двух-трёх словах.`,
    `- skip — ${heroine} ${g('прогуляла', 'прогулял')} пару; late — ${g('опоздала', 'опоздал')} на пару.`,
    `- Не усиливай сказанное: пиши то, что произошло в тексте, а не его возможные последствия. ${w.hero[0].toUpperCase()}${w.hero.slice(1)} ${g('извинилась', 'извинился')} — это не «помирились», кто-то нахмурился — не «поссорились». Нет слов о примирении, ссоре, обещании — нет и факта.`,
    `- skip/late только при прямом факте пропуска/опоздания ${w.heroGen}. Переход даты, «прошло четыре дня», выходной, конец зачётной недели, отсутствие описания занятий или домашняя сцена не доказывают прогул. Не выводи прогулы из календаря.`,
    `- event — праздник, вечеринка, бал, концерт, поход, свидание или другое событие, о котором во фрагменте сказано, что оно будет: event=+дни:название, где дни — через сколько дней от момента сцены (0 — сегодня, 1 — завтра). Несколько дней подряд — event=+5..+6:название. Событий несколько — несколько ключей event. Наказание, отработка или поручение конкретным людям — не event, а deal. Дальше ${EVENT_HORIZON} дней, без понятного срока, прошедшее и уже записанное в планах — не пиши.`,
    ...pauseRules(state),
    '- met — кто из курса был в сцене: id из списка курса, несколько — через запятую.',
    `- clash — стычка, ссора или перепалка двоих: clash=кто:с кем:повод в двух-трёх словах. ${heroine} пишется @heroine. Ссору лучше писать как act с видом «конфликт», clash — если это просто стычка курса.`,
    `- act — заметное действие главных (${heroine} и персонажа карточки) — вместе или по отдельности — или людей курса, которое со стороны можно увидеть: объятие, поцелуй, держались за руки, ссора, кто-то кого-то защитил, отказал, победил, провалился, ушёл, появился. Только внешне наблюдаемое — без мыслей, чувств и мотивов. act=кто:что:с кем:вид:доступность:охват и, если есть, say="деталь". кто и с кем — id, @heroine или @card/имя персонажа карточки; с кем пусто, если действие одного. Человека, которого нет в списках, пиши по имени как есть (с заглавной), если рядом ${heroine} или персонаж карточки либо он действует один; безымянных («кто-то», «толпа») не пиши. что — коротко, что сделал(а), видимое со стороны, ровно как в тексте: не дописывай продолжение жеста, вещи и подробности, которых там нет (опустился на колени — не «встал на колени и умолял»). вид — одно слово: близость, конфликт, помощь, отказ, достижение, провал, уход, появление. Конфликт — только ссора, ругань, угроза, оскорбление, драка, нападение: тот, кто с кем, — противник. Удержал, прижал к себе или к стене, догнал, взял за руку, утащил за собой, допытывался с тревогой, укрыл, отчитал из страха за человека — в романтической или заботливой сцене это близость или помощь, а не конфликт; сомневаешься — не конфликт. доступность: на людях — были свидетели (кто-то из людей был в той же комнате или рядом, даже двое-трое); наедине — никого рядом; подслушали — двое думают, что одни, а в тексте кто-то стоит за углом, за дверью, подглядывает или прячется и видит или слышит тайком (тогда не наедине и private для этого не пиши). Доступность определяй для каждого действия отдельно: что было при людях (танец на празднике, поцелуй в зале) — «на людях», даже если потом пара осталась наедине; наедине — только то, что случилось без свидетелей; в одном ответе может быть несколько act с разной доступностью. Тайное — подбросили записку, украли или подменили вещь, шантаж — то, что ${g('увидела и узнала', 'увидел и узнал')} только ${heroine}, а не свидетели, — «наедине», даже если вокруг толпа. с кем — второй участник, кем бы он ни был: партнёр, соперник на поединке, тот, кому отказали; при помощи — тот, кому помогли (вылечила зверя — помощь зверю, а не тому, кто стоял рядом). На одно событие — один act: ответное действие той же пары того же рода («обнял в ответ») отдельно не пиши; ответ другого рода — свой act (оскорбил — в ответ пощёчина или заклятие; напала — защитил). Громкое при людях с одним из главных без второго участника — упал с метлы, ранен, наказан, лишился баллов — тоже act (провал, уход или появление). охват: многие — толпа, зал, коридор полный; несколько — пара свидетелей; неизвестно. say — короткая дословная реплика или видимая деталь из текста; нет — не пиши, не сочиняй.`,
    '- Примеры act: act=@heroine:обняла при всех:@card/Имя:близость:на людях:многие:"Только не отпускай"; act=@heroine:сдала зачёт с первого раза::достижение:на людях:несколько.',
    `- Какие act брать: читай реплику игрока и ответ рассказчика целиком, от первой строки до последней, — act берётся из обоих текстов, а не только из конца ответа. Сначала новое — то, что в этом фрагменте случилось впервые. Жест, который тянется с прошлого хода (всё ещё держатся за руки, идут вместе, стоят рядом), — продолжение, а не новое событие: пиши его, только если нового нет. Не теряй заметные поступки при свидетелях, даже когда они не про близость пары: публичное оглашение письма, записки или новости, демонстративное неповиновение, вызов, насмешка, отказ подчиниться, вмешательство или наказание преподавателя (остановил, отчитал, снял баллы, вызвал к себе, не стал вмешиваться), появление преподавателя в разгар сцены — каждое отдельным act со своим «кто» (id преподавателя из списка тоже подходит) и своей доступностью. Приватное остаётся наедине, а людное — на людях: сцена, в которой потом пара осталась вдвоём, не делает прошлое при людях тайным, и наоборот. Объём: обычно 1–3 act на фрагмент, не больше четырёх; при нехватке места — сначала поступки при свидетелях, затем поступки пары, затем остальное; мелкие жесты одной сцены (налил, положил, подал) склей в один act.`,
    '- rumor — кто-то в сцене пустил или пересказал слух: rumor=о ком:что говорят. Только если слух прозвучал во фрагменте; о ком — id или @heroine. «Что» продолжает фразу «говорят, что <он/она> …»: rumor=sokolova:списала контрольную.',
    `- new — в сцене появился человек по имени, которого нет ни среди преподавателей, ни в курсе: new=имя, как в тексте. Только тот, кто сам есть в сцене; упомянутый в разговоре или воспоминании («брат рассказывал, как его наказали в прошлом году») — не новое лицо. Если это преподаватель или другой взрослый из персонала — new=имя:teacher. ${heroine}, рассказчика и тех, кто уже в списках, не пиши.`,
    `- looks — внешность человека, если в ответе она описана: looks=id:описание${bare.length ? ' — только для людей из списка «Без записанной внешности»' : ''} или looks=Имя:описание для нового лица из new= этого же ответа. Начни с того, кто это и сколько лет на вид, дальше волосы, глаза, лицо, рост, одежда, приметы — коротко, до 160 символов, только то, что прямо написано, без выдумки. Только устойчивое: рост, сложение, волосы, глаза, лицо, привычная одежда, приметы; не пиши сиюминутное — следы, грязь, кровь, синяки, помаду, позу, мятую одежду, выражение лица. Нет описания в тексте — ключ не пиши. ${heroine} и персонажу карточки внешность не пишется.`,
    `- deal — между людьми открылось дело: обещание, долг, общий проект, вещь, которую надо вернуть: deal=кто:кому:что. «Кто» — тот, кто должен или кому назначены отработка, наказание, штраф; «кому» — перед кем он должен. Отработку назначили ${w.heroDat} — кто=@heroine, кому=тот, кто назначил. Дело закрыли (вернули, выполнили) — deal-=кто:кому:что.`,
    `- fame — только если ${heroine} сама на людях сделала что-то, за что свидетели стали относиться к ${g('ней', 'нему')} лучше (fame=+:основание) или хуже (fame=-:основание): ${g('защитила, победила, блеснула', 'защитил, победил, блеснул')} на занятии / ${g('сорвалась, опозорилась, нарушила', 'сорвался, опозорился, нарушил')} известное правило. Ссора и близость сами по себе — не fame. Наедине — не fame. Пересказ и воспоминание уже бывшего — не fame. Не больше одного fame на ответ. Не уверен — не пиши.`,
    ...(hooks.length ? [`- played — повод из списка «Поводы» во фрагменте действительно прозвучал: played=id. Не прозвучал — не пиши. Повод-приглашение прозвучал, только если сам позвавший зовёт ${heroine}; если зовут кого-то другого или он рассказывает, что позвали его самого, — не пиши.`] : []),
    ...(preps.length ? ['- prep — намерение из списка «Намерения неписей» явно исполнилось или сорвалось в этом фрагменте: prep=id:done (сбылось) или prep=id:failed (сорвалось). Не видно прямо — не пиши; ожидание и планы не считаются.'] : []),
    ...feats.rules,
    ...(bullyAnalysisActive(state) ? bullyRules(heroine, g, state) : []),
    '- Время и дату не пиши (кроме дней до события в event).',
    '- Пиши id из списков выше. Каждый ключ — отдельно, ключи можно повторять.',
    '- Если ничего из этого не случилось — пустая метка <!-- [ACADEMY] -->.',
    '',
    'Блок 2. Слышно — насколько громко это дойдёт до курса и было ли при людях. Этот блок ничего в ведомости не меняет. Постов, реплик и ников курса здесь нет: сплетни пишет отдельный вызов. Строками:',
    'Слышно:',
    'loud=0..3',
    'private=номера ключей блока 1',
    'Правила блока 2:',
    '- loud — насколько громко то, что было: 0 — тихо (обычная оценка, разговор), курс почти не замечает; 1 — заметно; 2 — громко (прогул при всех, ссора); 3 — на всю школу (скандал, признание со сцены).',
    '- private — только если было наедине, без свидетелей: разговор вдвоём за закрытой дверью, шёпот, тайная встреча. Номера — порядковые номера ключей метки блока 1, считая с 1, через запятую: private=2,3. Что случилось при людях, не отмечай; нет таких — строку не пиши. «Наедине» не значит «навсегда в тайне»: подслушать могут, но это решит не секретарь.',
    '- Реплик курса, ников, строк react= и reply= в ответе не нужно.',
    '',
    `Последней строкой напиши «Кратко:» и одно предложение: что в этом фрагменте было с учёбой ${w.heroGen} и людьми вокруг (пары, оценки, преподаватели, прогулы, курс) — или «к учёбе не относится».`,
  );
  return { system: systemOf(gender, preset), user: lines.join('\n') };
}

function bullyRules(heroine, g, state) {
  const b = bullyingOf(state);
  const person = (id) => { const p = (state.classmates || []).find((c) => c && c.id === id); return p ? `${p.id} (${p.name})` : ''; };
  const lead = b.lead ? person(b.lead) : '';
  const crew = b.crew.map(person).filter(Boolean).join(', ');
  return [
    `- bully — травля ${heroine}: если во фрагменте кто-то из курса унижает, изводит или бьёт ${g('её', 'его')} (в том числе пытается — удачно или нет), пиши bully=id:уровень:что именно. «Что именно» — короткий оборот в прошедшем времени без имени, продолжающий фразу «<имя> …»: поджидал её у раздевалки и угрожал. id — из списка курса, того, кто сделал это на деле. Уровни: ${BULLY_LEVEL_HINTS.join('; ')}. Пиши по высшему уровню, до которого дошло, и только то, что произошло во фрагменте. Если выпад совершили подручные зачинщика или его безымянные друзья по его наводке — пиши bully= от имени зачинщика${lead ? `: ${lead}${crew ? `; подпевалы: ${crew}` : ''}` : ''}. Если это акт из списка «Поводы» (травля: …) — пиши для него played=id и bully= с тем, что произошло на деле; если ничего такого во фрагменте не было — не пиши ни того, ни другого. Повод засчитывай, только если выпад совершил тот, кто в нём назван, или его подпевалы; похожее сделал кто-то другой — пиши bully= с его id, а played= для повода не пиши. Зачинщика нет во фрагменте — от его имени ничего не пиши.`,
    `- bully=@heroine:ход — ход самой ${heroine}; пиши его каждый раз, когда он показан в реплике игрока или в ответе (не только когда травля идёт в этом же фрагменте): fightback (${g('дала', 'дал')} отпор: ответила обидчику словом, делом, шуткой, магией, защитилась — даже если вмешался кто-то третий), complain (${g('пожаловалась', 'пожаловался')} наставнику; третьим полем id наставника), ally (${g('нашла', 'нашёл')} союзника; третьим полем id), ignore (${g('сделала', 'сделал')} вид, что не замечает выпадов, нарочно не реагирует), revenge (${g('отомстила', 'отомстил')}), peace (${g('заключила', 'заключил')} перемирие с обидчиком: договорились не трогать друг друга; обычное «извини» или одна мирная фраза — не перемирие).`,
    `- bully=@bully:backoff — вынужденное отступление зачинщика: пиши ТОЛЬКО когда в этом фрагменте он отступил из-за конкретного препятствия — проиграл стычку, испугался последствий (взрослых, огласки, расправы), или вмешались другие и остановили его. НЕ считается отступлением: фыркнул и ушёл, сменил место или способ, «решил продолжить позже», отвлёкся, замолчал на время, ушёл сам по своим делам, отступил на словах, но продолжил иначе; отпор героини сам по себе — тоже не отступление, пока зачинщик не остановлен. Сомневаешься — не пиши.`,
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
  if (str(c.desire)) parts.push(`хочет ${str(c.desire)}`);
  if (str(c.problem)) parts.push(str(c.problem));
  return parts.join('; ').slice(0, 140);
}

function pauseRules(state) {
  const day = state && state.calendar && state.calendar.day;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? ` День сцены: ${day} (ГГГГ-ММ-ДД).` : '';
  return [
    `- pause — занятия ПРЕКРАТИЛИСЬ: во фрагменте прямо сказано, что каникулы уже начались, заведение закрыли или занятий больше нет (карантин, закрытие, отмена всех пар). pause=дни:название, где дни — сколько дней занятий не будет, считая день сцены (на неделю — 7; до 20-го — число дней от дня сцены до 20-го включительно; до конца месяца — так же). Срок не назван — pause=open:название («до отмены»). Занятия возобновились, каникулы кончились — pause=end.${today}`,
    '- pause: только прямой состоявшийся факт. Желание («хорошо бы каникулы»), предположение («наверное, закроют»), слух, воспоминание о прошлых каникулах и план без решения («обсуждают, не закрыть ли») — не пиши. Отменили одну пару или один день — это не pause. Пример да: «С сегодняшнего дня занятий нет до весны» — pause=open:каникулы до весны, а «Академию закрыли на неделю из-за потопа» — pause=7:закрытие из-за потопа. Пример нет: «Скорее бы каникулы», «Прошлой зимой каникулы были долгими», «Говорят, на карантин закроют».',
    '- pause: пиши в тот ответ, где это объявили, а не при каждом упоминании. Идущий период из «Уже в планах» не повторяй; только если срок изменили или продлили — пиши новый.',
  ];
}

function knownEventLines(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  try {
    const now = holidaysOn(preset, day, state).map((h) => `${h.name} (идёт сейчас${h.open ? ', до отмены' : h.pause ? `, до ${dayWord(h.to)}` : ''})`);
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

export const ANON_WHO = 'без подписи';

export function tokenText(token, lexicon, { known = false, brief = false, day = '', today = '' } = {}) {
  const people = [...arr(lexicon.teachers).map((t) => ({ ...t, teacher: true })), ...arr(lexicon.classmates)];
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
    const who = (t && t.name) || ev.teacherId;
    const dir = ev.delta > 0 ? 'теплее' : 'холоднее';
    const how = ev.impact === 'major' ? 'заметно' : ev.impact === 'minor' ? 'немного' : '';
    return `${who}: ${dir}${how ? ` (${how})` : ''}${ev.reason ? ` — ${ev.reason}` : ''}`;
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
  const people = [...arr(lexicon.teachers).map((t) => ({ ...t, teacher: true })), ...arr(lexicon.classmates)];
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
    const people = [...arr(lexicon.teachers).map((t) => ({ ...t, teacher: true })), ...arr(lexicon.classmates)];
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
