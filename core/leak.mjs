export const END_WORD = 'КОНЕЦ';

const aside = /^[\s*_#>`-]*(?:нрав|роль)(?:\s*\([^)]*\))?\s*[:—–]/iu;

const kindOf = (line, mark) => {
  const t = line.trim();
  if (!t) return 'blank';
  if (new RegExp(String.raw`^[\s#*=>_${'`'}[(-]*${mark}(?![\p{L}])`, 'iu').test(t)) return 'mark';
  if (t.includes('|')) return 'row';
  if (aside.test(t)) return 'aside';
  return 'text';
};

export function lastBlock(text, { mark = END_WORD, max = 0, restart = null } = {}) {
  const raw = String(text == null ? '' : text).replace(/\r/g, '');
  const lines = raw.split('\n');
  const kinds = lines.map((l) => kindOf(l, mark));
  if (!kinds.includes('row')) return raw;
  const lastMark = kinds.lastIndexOf('mark');
  const end = lastMark >= 0 && kinds.slice(0, lastMark).includes('row') && !kinds.slice(lastMark).includes('row') ? lastMark : lines.length - 1;
  let at = end;
  while (at >= 0 && kinds[at] !== 'row') at -= 1;
  let start = at;
  while (start >= 0 && kinds[start] !== 'text') start -= 1;
  let lead = start + 1;
  let block = lines.slice(lead, end + 1);
  let bk = kinds.slice(lead, end + 1);
  const rowsAt = () => bk.map((k, i) => (k === 'row' ? i : -1)).filter((i) => i >= 0);
  if (restart) {
    const idx = rowsAt();
    let cut = 0;
    for (let k = 1; k < idx.length; k += 1) if (restart(block[idx[k]], block[idx[k - 1]])) cut = idx[k];
    block = block.slice(cut);
    bk = bk.slice(cut);
    lead += cut;
  }
  if (max > 0) {
    const idx = rowsAt();
    if (idx.length > max * 1.5) {
      const cut = idx[idx.length - max];
      block = block.slice(cut);
      bk = bk.slice(cut);
      lead += cut;
    }
  }
  return [...Array(lead).fill(''), ...block].join('\n');
}

const LABELS = ['ник', 'имя', 'кто', 'типаж', 'интерес', 'цель', 'как пишет', 'приметы письма', 'ревность', 'союзник', 'соперник', 'фанат', 'к главным'];
const LABEL_RE = new RegExp(String.raw`^\s*(?:${LABELS.join('|')})\s*[:—–]\s*`, 'iu');

export const unlabel = (field) => String(field == null ? '' : field).replace(LABEL_RE, '').replace(/^вид\s*:\s*(?=\S)/iu, '').trim();
