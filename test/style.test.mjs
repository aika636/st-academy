// test/style — два правила таблицы стилей, которые держат чужая вёрстка.
//
// Зачем файл существует. Оба дефекта, ради которых он написан, не видел ни один
// из 668 тестов, и увидеть не мог: дерево строится верно, действия доходят до
// хоста, вью отдаёт правильные слова — а на экране пустая красная рамка и
// кнопка, разорванная на две строки. Класс дефекта один: **правило таверны
// перебивает наше молчаливое допущение**, и ловится он только чтением CSS.
//
// Это не проверка вёрстки — ширину в пикселях и попадание пальцем так не
// измерить, для этого есть стенд `tools/preview` и настоящий браузер. Это
// проверка того, что оба противоядия из style.css на месте и не выпали при
// следующей правке.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../style.css', import.meta.url)), 'utf8');
const ui = readFileSync(fileURLToPath(new URL('../ui.js', import.meta.url)), 'utf8');

// Комментарии сняты заранее: внутри них живут фигурные скобки — цитаты чужих
// правил, — и наивный поиск конца блока обрывается на них.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Тело правила по селектору: первый блок `{...}` после него. */
function ruleBody(selector) {
  const at = bare.indexOf(selector);
  if (at < 0) return null;
  const open = bare.indexOf('{', at);
  const close = bare.indexOf('}', open);
  return open < 0 || close < 0 ? null : bare.slice(open + 1, close);
}

test('спрятанное атрибутом hidden не показывается вопреки классу', () => {
  // `[hidden] { display: none }` живёт в таблице БРАУЗЕРА и проигрывает любому
  // нашему `display`. Пока этого правила не было, `.academy-confirm` с его
  // `display: flex` висел на вкладке настроек пустой красной рамкой.
  const body = ruleBody('.academy-panel [hidden]');
  assert.ok(body, 'нет правила, гасящего [hidden] внутри панели');
  assert.match(body, /display:\s*none/);
  assert.ok(
    css.includes('.academy-ext-block [hidden]'),
    'блок в меню расширений — вторая оболочка панели, и он должен гаситься тем же правилом',
  );

  // Правило общее, а не поимённое, — но толк от него есть только пока классы,
  // которые панель прячет атрибутом, действительно им накрыты. Если ui.js
  // начнёт прятать что-то за пределами двух оболочек, тест об этом промолчит,
  // а вот про сам приём напомнит: hidden в панели используется, значит правило
  // нужно.
  assert.match(ui, /hidden:\s*true/, 'панель больше не прячет ничего атрибутом — правило можно пересмотреть');
});

test('кнопка не ломается на две строки от ширины таверны', () => {
  // Таверна: `.menu_button { width: min-content }` (её style.css:3825) —
  // ширина по самому длинному слову, и «Сменить пресет» встаёт в две строки.
  const body = ruleBody('.academy-panel .academy-btn');
  assert.ok(body, 'нет правила, задающего ширину кнопки');
  assert.match(body, /width:\s*auto/, 'ширину кнопки задаёт таверна, а не мы');
  assert.match(body, /max-width:\s*100%/, 'длинная подпись вылезет за край панели');
  assert.ok(
    bare.includes('.academy-ext-block .academy-btn'),
    'блок в меню расширений — вторая оболочка панели, кнопки там те же',
  );
  // Селектор обязан быть тяжелее `.menu_button`: при равном весе исход решает
  // порядок подключения таблиц, а его назначает таверна, не мы.
  assert.ok(
    !/^\.academy-btn\s*\{[^}]*width:/m.test(bare),
    'ширина вернулась в голый .academy-btn — таверна снова может перебить её порядком',
  );
});

test('стенд повторяет ту самую ширину, на которой поймали дефект', () => {
  // Стенд пропустил дефект не потому, что он мелкий, а потому что подделка
  // таверны была добрее оригинала. Правило вернули — пусть остаётся.
  const stand = readFileSync(
    fileURLToPath(new URL('../tools/preview/index.html', import.meta.url)), 'utf8',
  );
  const bareStand = stand.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bareStand.indexOf('.menu_button {');
  assert.ok(at > 0, 'в стенде нет приближения .menu_button');
  const block = bareStand.slice(at, bareStand.indexOf('}', at));
  assert.match(block, /width:\s*min-content/, 'стенд снова добрее таверны — дефект ширины он пропустит');
});
