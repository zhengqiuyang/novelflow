import test from 'node:test';
import assert from 'node:assert/strict';
import { createNovelPipeline, heuristicTranslation } from '../src/pipeline.js';
import { createCharacter } from '../src/statecard.js';

function makePipeline(translateFn) {
  return createNovelPipeline({
    characters: [createCharacter('林凡', { realm: '筑基境' })],
    proposeTranslationFn: async (entry) => heuristicTranslation(entry.term),
    translateFn: translateFn ?? (async (text, ctx) => {
      let out = text;
      for (const t of ctx.terms) if (t.locked && t.translation) out = out.split(t.term).join(t.translation);
      return out;
    }),
  });
}

const CH1 = '林凡拜入青云派，得授《太玄真经》残卷。林凡日夜苦修，突破至筑基境初期。';
const CH2 = '三年后，林凡重回青云派，再修太玄真经，已是金丹境。';
const CH3 = '大劫将至，林凡的师兄赵无极陨落。林凡悲愤之下突破至元婴境。';

test('流水线：首章登记锁定，次章命中率达 100%', async () => {
  const p = makePipeline();
  const r1 = await p.processChapter(CH1, 1);
  assert.ok(r1.newTerms.length >= 3);
  assert.equal(p.stats.termsLocked, r1.newTerms.length);
  assert.equal(r1.validation.hitRate, 1); // 译文用译名替换，全命中

  const r2 = await p.processChapter(CH2, 2);
  assert.deepEqual(r2.newTerms, ['金丹境']); // 只有境界词是新术语
  assert.equal(r2.validation.hitRate, 1);
  assert.equal(p.characters[0].realm, '筑基境初期');
});

test('流水线：漂移触发重试，修复后不再需人工', async () => {
  let call = 0;
  const p = makePipeline(async (text, ctx, hints) => {
    call += 1;
    if (call === 1) return text; // 第一次"翻译"原样返回（术语未替换 = 漂移）
    let out = text;
    for (const t of ctx.terms) if (t.locked && t.translation) out = out.split(t.term).join(t.translation);
    return out + (hints.length ? '(fixed)' : '');
  });
  const r = await p.processChapter(CH1, 1);
  assert.equal(call, 2);           // 重试了一次
  assert.equal(p.stats.retries, 1);
  assert.equal(r.needsHuman, false);
  assert.equal(r.validation.hitRate, 1);
});

test('流水线：重试仍漂移 → 标记人工', async () => {
  const p = makePipeline(async (text) => text); // 永不替换术语
  const r = await p.processChapter(CH1, 1);
  assert.equal(r.needsHuman, true);
  assert.ok(r.validation.hitRate < 1);
});

test('流水线：死亡事件入卡，陌生名字挂起', async () => {
  const p = makePipeline();
  await p.processChapter(CH1, 1);
  const r3 = await p.processChapter(CH3, 3);
  assert.equal(p.characters[0].alive, true);         // 死的是赵无极，林凡活着
  assert.ok(r3.uncertainEvents.some((e) => e.character.includes('赵无极'))); // 陌生人挂起
  assert.equal(p.characters[0].realm, '元婴境');
});

test('必须注入两个函数', () => {
  assert.throws(() => createNovelPipeline({}), /translateFn/);
});
