// test/hint-icon — значок ⓘ (`ui/common.hintIcon`) на заглушке документа: нет слова —
// нет значка; нажатие и клавиши открывают пояснение, повторное закрывает.

import test from 'node:test';
import assert from 'node:assert/strict';

function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attrs: {},
    listeners: {},
    hidden: false,
    textContent: '',
    className: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); },
    append(...cs) { for (const c of cs) this.children.push(c); },
    get firstChild() { return this.children[0] || null; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    contains: () => false,
    getBoundingClientRect: () => ({ left: 100, right: 118, bottom: 40, width: 18 }),
  };
}
const body = makeNode('body');
globalThis.document = { createElement: makeNode, addEventListener: () => {}, body };
globalThis.window = { addEventListener: () => {}, innerWidth: 360, innerHeight: 780 };

const { hintIcon } = await import('../ui/common.js');
const preset = { glossary: { седмица: 'Неделя из семи дней.' } };
const fire = (node, type, ev = {}) => (node.listeners[type] || []).forEach((fn) => fn({
  preventDefault() {}, stopPropagation() {}, ...ev,
}));

test('hintIcon: слова нет в словаре — значка нет', () => {
  assert.equal(hintIcon(preset, '5-я неделя'), null);
  assert.equal(hintIcon({}, 'седмица'), null);
});

test('hintIcon: нажатие открывает пояснение у значка, Enter закрывает, Esc тоже', () => {
  const icon = hintIcon(preset, '5-я седмица');
  assert.equal(icon.attrs.role, 'button');
  assert.equal(icon.attrs.tabindex, '0');
  assert.match(icon.attrs['aria-label'], /седмица: Неделя из семи дней\./);
  assert.equal(icon.children[0].className, 'fa-solid fa-circle-info');

  fire(icon, 'click');
  const pop = body.children.find((c) => c.className === 'academy-hint-pop');
  assert.ok(pop);
  assert.equal(pop.hidden, false);
  assert.equal(icon.attrs['aria-expanded'], 'true');
  assert.ok(Number.parseFloat(pop.style.left) >= 8 && Number.parseFloat(pop.style.left) + 280 <= 360);

  fire(icon, 'keydown', { key: 'Enter' });
  assert.equal(pop.hidden, true);
  assert.equal(icon.attrs['aria-expanded'], 'false');

  fire(icon, 'keydown', { key: ' ' });
  assert.equal(pop.hidden, false);
});
