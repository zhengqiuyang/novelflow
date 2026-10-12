import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGlossary, extractTerms, registerTerms, lockTerm,
  termsInText, validateTranslation, detectDrift,
} from '../src/glossary.js';
import {
  createCharacter, extractStateEvents, applyEvents, contextForChapter,
} from '../src/statecard.js';

// ---- 术语引擎 ----
const CH1 = `林凡拜入青云派后，日夜苦修《太玄真经》。
玄天道人见他资质极佳，亲自传授御剑诀。
三年后，林凡终于突破至金丹境初期，成为青云派最年轻的金丹修士。`;

test('抽取：门派/功法/称谓/境界按规律识别', () => {
  const terms = extractTerms(CH1, 1);
  const names = terms.map((t) => t.term);
  assert.ok(names.includes('青云派'));
  assert.ok(names.includes('太玄真经'));
  assert.ok(names.includes('御剑诀'));
  assert.ok(names.includes('玄天道人'));
  assert.ok(names.some((n) => n.startsWith('金丹境'))); // "金丹境(初期)"
  assert.ok(!names.some((n) => n.includes('拜入')));    // 动词不混入
  assert.ok(!names.some((n) => n.includes('林凡')));    // 人名不混入门派
});

test('抽取：停用词不误报', () => {
  const terms = extractTerms('他们派了三个人出去，打开门一看，外面站着门外汉。', 1);
  const names = terms.map((t) => t.term);
  assert.ok(!names.includes('他们派'));
  assert.ok(!names.includes('打开门'));
});

test('锁定与校验：译名命中/漂移检测', () => {
  const g = createGlossary();
  registerTerms(g, extractTerms(CH1, 1));
  lockTerm(g, '青云派', 'Azure Cloud Sect');
  lockTerm(g, '太玄真经', 'Taixuan Scripture');
  lockTerm(g, '玄天道人', 'Daoist Xuantian');

  const inText = termsInText(g, '林凡重回青云派，翻阅太玄真经。');
  assert.equal(inText.length, 2);

  const good = validateTranslation(g, '林凡重回青云派，翻阅太玄真经。', 'Lin Fan returned to Azure Cloud Sect and read the Taixuan Scripture.');
  assert.equal(good.hitRate, 1);
  assert.equal(good.violations.length, 0);

  const bad = validateTranslation(g, '林凡重回青云派。', 'Lin Fan returned to the sect he once knew.');
  assert.equal(bad.hitRate, 0);
  assert.deepEqual(bad.violations, [{ term: '青云派', expected: 'Azure Cloud Sect' }]);

  const drift = detectDrift(g, '林凡重回青云派。', 'Lin Fan returned to the Blue Cloud School.');
  assert.equal(drift.length, 1);
  assert.equal(drift[0].action, 'retry-line');
});

test('未登记术语锁定报错', () => {
  const g = createGlossary();
  assert.throws(() => lockTerm(g, '不存在的门', 'X'));
});

// ---- 状态卡 ----
test('状态事件：死亡/突破抽取，陌生名字挂起', () => {
  const lin = createCharacter('林凡', { realm: '筑基期' });
  const { events, uncertain } = extractStateEvents(
    '林凡突破至元婴境。远处，赵日天陨落。', 200, [lin],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].character, '林凡');
  assert.equal(events[0].field, 'realm');
  assert.equal(uncertain.length, 1); // 赵日天不在角色表 → 挂起
  assert.equal(uncertain[0].field, 'alive');
});

test('状态应用：留痕 + 死人再死报冲突', () => {
  const lin = createCharacter('林凡', { realm: '筑基期' });
  const e1 = extractStateEvents('林凡突破至金丹境。', 10, [lin]).events;
  applyEvents(lin, e1);
  assert.equal(lin.realm, '金丹境');

  const death = extractStateEvents('林凡陨落。', 150, [lin]).events;
  applyEvents(lin, death);
  assert.equal(lin.alive, false);

  const deathAgain = extractStateEvents('林凡身死。', 200, [lin]).events;
  const conflicts = applyEvents(lin, deathAgain);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'already-dead'); // 死人复活类矛盾被拦下
  assert.equal(lin.history.length, 2);
});

test('章节上下文注入：只给出场角色', () => {
  const lin = createCharacter('林凡', { realm: '金丹境' });
  const other = createCharacter('王二狗');
  const ctx = contextForChapter([lin, other], '这一章林凡闭关。', null);
  assert.equal(ctx.length, 1);
  assert.equal(ctx[0].name, '林凡');
  assert.equal(ctx[0].realm, '金丹境');
  assert.equal(ctx[0].alive, true);
});
