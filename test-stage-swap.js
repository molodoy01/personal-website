// Смоук-тест контроллера createStageSwap: извлекаем код прямо из index.html
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length < 2) { console.error('FAIL: не нашёл второй <script>'); process.exit(1); }
const script = scripts[1][1];
const start = script.indexOf('const createStageSwap');
const end = script.indexOf('const btn = document.querySelector');
if (start < 0 || end < 0 || end <= start) { console.error('FAIL: не извлёк контроллер'); process.exit(1); }
const code = script.slice(start, end);

// ——— стабы окна/документа ———
let hoverListeners = [];
let motionListeners = [];
const hoverQ = { matches: true, addEventListener: (t, fn) => { if (t === 'change') hoverListeners.push(fn); } };
const motionQ = { matches: false, addEventListener: (t, fn) => { if (t === 'change') motionListeners.push(fn); } };
const window = {
  PointerEvent: function () {},
  matchMedia: q => (q.includes('reduce') ? motionQ : hoverQ),
  __focusHandlers: [],
  addEventListener: (t, fn) => { if (t === 'focus') window.__focusHandlers.push(fn); },
};
const makeStage = () => {
  const listeners = {};
  const classes = new Set();
  const stage = {
    hovered: false,
    attrs: {},
    classList: {
      contains: c => classes.has(c),
      add: c => classes.add(c),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
    },
    setAttribute: (k, v) => { stage.attrs[k] = v; },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    matches: sel => (sel === ':hover' ? stage.hovered : false),
    fire: (t, ev) => { (listeners[t] || []).slice().forEach(fn => fn(ev || {})); },
    count: t => (listeners[t] || []).length,
    on: () => classes.has('is-swapped'),
  };
  return stage;
};
const stage = makeStage();
const document = { querySelector: sel => (sel === '.studio-visual' ? stage : null) };

// ——— выполняем контроллер ———
new Function('window', 'document', code)(window, document);

// ——— утилиты проверок ———
let failed = 0;
const check = (name, cond) => {
  if (cond) console.log('  ok  ' + name);
  else { failed++; console.log('  FAIL ' + name); }
};

console.log('1. старт в autoMode (hover+fine, нет reduce):');
check('aria-pressed=false', stage.attrs['aria-pressed'] === 'false');
check('нет is-swapped', !stage.on());
check('pointerenter подключён', stage.count('pointerenter') === 1);

console.log('2. hover управляет, touch игнорируется:');
stage.fire('pointerenter', { pointerType: 'mouse' });
check('enter(mouse) -> включено', stage.on() && stage.attrs['aria-pressed'] === 'true');
stage.fire('pointerleave', { pointerType: 'mouse' });
check('leave(mouse) -> выключено', !stage.on());
stage.fire('pointerenter', { pointerType: 'touch' });
check('enter(touch) -> без изменений', !stage.on());
stage.fire('pointerleave', { pointerType: 'touch' });
check('leave(touch) -> без изменений', !stage.on());

console.log('3. гибрид: мышиный клик игнорируется, тап переключает:');
stage.fire('pointerdown', { pointerType: 'mouse' });
stage.fire('click');
check('клик мыши в autoMode игнорируется', !stage.on());
stage.fire('pointerdown', { pointerType: 'touch' });
stage.fire('click');
check('тап в autoMode переключает', stage.on());
stage.fire('click'); // второй клик после того же pointerdown(touch) — usedKeyboard сбросился, тип тот же
check('повторный тап переключает обратно', !stage.on());

console.log('4. клавиатура: Enter/Space переключают, двойного клика нет:');
stage.fire('keydown', { key: 'Enter', preventDefault: () => {} });
check('Enter -> включено', stage.on());
stage.fire('click');
check('click после клавиатуры не дублирует', stage.on());
stage.fire('keydown', { key: ' ', preventDefault: () => {} });
check('Space -> выключено', !stage.on());
stage.fire('keydown', { key: 'a', preventDefault: () => { throw new Error('preventDefault не нужен'); } });
check('другие клавиши не трогаются', !stage.on());

console.log('5. потеря hover (alt+tab) и возврат фокуса:');
stage.hovered = true;
stage.fire('pointerenter', { pointerType: 'mouse' });
check('наведение включило', stage.on());
stage.fire('pointerleave', { pointerType: 'mouse' }); // браузер «потерял» указатель
check('leave выключил', !stage.on());
stage.hovered = true; // вернулись в окно, курсор над сценой
window.__focusHandlers.forEach(fn => fn());
check('после focus состояние == :hover', stage.on() === stage.hovered);
stage.hovered = false;
window.__focusHandlers.forEach(fn => fn());
check('курсор ушёл пока были не в окне -> focus гасит', !stage.on());

console.log('6. смена режима на лету: reduce включили -> autoMode выключился');
motionQ.matches = true;
motionListeners.forEach(fn => fn());
check('pointerenter отключён', stage.count('pointerenter') === 0);
stage.fire('pointerdown', { pointerType: 'mouse' });
stage.fire('click');
check('в ручном режиме мышиный клик переключает', stage.on());

console.log('7. обратная смена: reduce выключили -> hover снова работает, состояние = :hover');
motionQ.matches = false;
motionListeners.forEach(fn => fn());
check('pointerenter снова подключён', stage.count('pointerenter') === 1);
check('состояние синхронизировано с :hover', stage.on() === stage.hovered);

console.log('8. старый браузер без matchMedia.addEventListener — не падает:');
const before = stage.count('pointerenter');
const noListenerQ = { matches: true, addEventListener: undefined };
const window2 = { PointerEvent: function () {}, matchMedia: () => noListenerQ, addEventListener: () => {} };
try {
  new Function('window', 'document', code)(window2, { querySelector: () => makeStage() });
  check('контроллер создался без исключения', true);
} catch (e) {
  check('контроллер создался без исключения (' + e.message + ')', false);
}

process.exit(failed ? 1 : 0);
