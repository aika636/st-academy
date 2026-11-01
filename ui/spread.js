import { el } from './common.js';

export function isPages(out) {
  return Boolean(out) && typeof out === 'object' && !out.tagName && ('l' in out || 'r' in out);
}

function page(side, label, content, { cls = '', marginDate = '', ribbon = false, blank = false } = {}) {
  return el('section', {
    class: `dia-page dia-page-${side} dia-surface${cls ? ` ${cls}` : ''}${blank ? ' dia-blank' : ''}`,
    dataset: { side },
    'aria-label': side === 'left' ? label : null,
  }, [
    ribbon ? el('i', { class: 'dia-ribbon' }) : null,
    marginDate ? el('i', { class: 'dia-margin-date', text: marginDate }) : null,
    ...[content || []].flat(Infinity).filter(Boolean),
  ]);
}

export function buildSpread(tab, label, out) {
  if (!isPages(out)) {
    const body = el('section', {
      class: 'dia-page dia-surface dia-plain dia-full dia-page-left',
      dataset: { side: 'left' },
      'aria-label': label,
    }, out ? [out] : []);
    return el('div', { class: 'dia-spread', dataset: { tab, single: '1' } }, [body, el('i', { class: 'dia-gutter' })]);
  }
  const cls = out.cls || '';
  const people = out.people === true;
  const left = page('left', label, out.l, {
    cls: people ? `${cls} dia-people-left`.trim() : cls, marginDate: out.marginDate, ribbon: true,
  });
  if (out.single === true) return el('div', { class: 'dia-spread', dataset: { tab } }, [left, el('i', { class: 'dia-gutter' })]);
  const right = page('right', label, out.r, {
    cls: people ? `${cls} dia-people-right dia-card`.trim() : cls, marginDate: out.marginDateR, blank: out.blankRight === true,
  });
  const dataset = people && out.view ? { tab, view: out.view } : { tab };
  return el('div', { class: 'dia-spread', dataset }, [left, right, el('i', { class: 'dia-gutter' })]);
}
