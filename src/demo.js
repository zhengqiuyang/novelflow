// 章节流水线演示：三章连载跑通 术语抽取→锁定→翻译→漂移重试→状态卡（含死人复活拦截）。
import { createNovelPipeline, heuristicTranslation } from './pipeline.js';
import { createCharacter } from './statecard.js';

const CHAPTERS = [
  {
    num: 1,
    text: `林凡拜入青云派，得授《太玄真经》残卷。
同年，他突破至筑基境初期。`,
    expectNote: '首章：术语全登记锁定',
  },
  {
    num: 2,
    text: `三年后，林凡重回青云派，再修太玄真经，已是金丹境。
玄天道人亲自考校，勉励他戒骄戒躁。`,
    expectNote: '第二章：译名必须与首章一致（锁定校验）',
  },
  {
    num: 3,
    text: `大劫将至，林凡的师兄赵无极陨落。
林凡悲愤之下突破至元婴境。`,
    expectNote: '第三章：状态卡记录死亡与突破',
  },
];

const pipeline = createNovelPipeline({
  characters: [createCharacter('林凡', { realm: '筑基境' })],
  proposeTranslationFn: async (entry) => heuristicTranslation(entry.term),
  // 启发式"翻译"：把锁定术语替换为译名，其余原文保留——演示一致性机制足够
  translateFn: async (text, context, driftHints = []) => {
    let out = text;
    for (const t of context.terms) {
      if (t.locked && t.translation) out = out.split(t.term).join(t.translation);
    }
    if (driftHints.length) out += '\n[retry-applied]'; // 重试路径标记
    return out;
  },
});

console.log('═══ novelflow 连载流水线演示 ═══\n');
for (const ch of CHAPTERS) {
  const result = await pipeline.processChapter(ch.text, ch.num);
  console.log(`── 第 ${ch.num} 章（${ch.expectNote}）──`);
  console.log('新术语:', result.newTerms.join('、') || '无');
  console.log('翻译节选:', result.translation.split('\n')[0].slice(0, 60));
  console.log('术语命中率:', (result.validation.hitRate * 100).toFixed(0) + '%',
    result.needsHuman ? '⚠️ 需人工' : '✓');
  if (result.stateEvents.length) console.log('状态变更:', result.stateEvents.map((e) => `${e.character}:${e.field}→${e.value}`).join('；'));
  if (result.uncertainEvents.length) console.log('挂起待人工（陌生名字）:', result.uncertainEvents.map((e) => e.character).join('、'));
  console.log();
}

console.log('═══ 汇总 ═══');
console.log('术语表:', [...pipeline.glossary.entries.values()].map((e) => `${e.term}=${e.translation}${e.locked ? '🔒' : ''}`).join('，'));
console.log('林凡状态卡: 存活=' + pipeline.characters[0].alive + ', 修为=' + pipeline.characters[0].realm);
console.log('统计:', JSON.stringify({ ...pipeline.stats, conflicts: pipeline.stats.conflicts.length }));
