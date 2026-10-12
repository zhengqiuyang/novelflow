// 章节流水线：把术语引擎 + 状态卡 + 翻译执行 + 质量闸门串成一章的处理流程。
// translateFn / proposeTranslationFn 可注入——CLI 用启发式，接 LLM 时替换。
import {
  createGlossary, extractTerms, registerTerms, lockTerm,
  termsInText, validateTranslation, detectDrift,
} from './glossary.js';
import { extractStateEvents, applyEvents, contextForChapter } from './statecard.js';

export function createNovelPipeline({ glossary = createGlossary(), characters = [], translateFn, proposeTranslationFn } = {}) {
  if (!translateFn || !proposeTranslationFn) throw new Error('必须注入 translateFn 与 proposeTranslationFn');
  return {
    glossary,
    characters,
    stats: { chapters: 0, termsRegistered: 0, termsLocked: 0, retries: 0, conflicts: [] },

    async processChapter(chapterText, chapterNum) {
      this.stats.chapters += 1;

      // ① 术语：抽取 → 新词登记 → 译名提案 → 锁定
      const newTerms = registerTerms(this.glossary, extractTerms(chapterText, chapterNum));
      this.stats.termsRegistered += newTerms.length;
      for (const term of newTerms) {
        const proposal = await proposeTranslationFn(this.glossary.entries.get(term), chapterText);
        if (proposal) {
          lockTerm(this.glossary, term, proposal);
          this.stats.termsLocked += 1;
        }
      }

      // ② 翻译（上下文 = 出场术语 + 出场角色状态卡）
      const context = {
        terms: termsInText(this.glossary, chapterText).map((e) => ({ term: e.term, translation: e.translation, locked: e.locked })),
        characters: contextForChapter(this.characters, chapterText, this.glossary),
      };
      let translation = await translateFn(chapterText, context);
      let drift = detectDrift(this.glossary, chapterText, translation);

      // ③ 质量闸门：漂移 → 重译一次（带违规明细），仍漂移则保留并标记人工
      let needsHuman = false;
      if (drift.length > 0) {
        this.stats.retries += 1;
        translation = await translateFn(chapterText, context, drift);
        drift = detectDrift(this.glossary, chapterText, translation);
        if (drift.length > 0) needsHuman = true;
      }

      // ④ 状态卡：抽取变更 → 应用（冲突收集，陌生人挂起）
      const { events, uncertain } = extractStateEvents(chapterText, chapterNum, this.characters);
      for (const ch of this.characters) {
        this.stats.conflicts.push(...applyEvents(ch, events));
      }

      return {
        chapterNum,
        newTerms,
        translation,
        validation: validateTranslation(this.glossary, chapterText, translation),
        needsHuman,
        stateEvents: events,
        uncertainEvents: uncertain,
      };
    },
  };
}

// 启发式译名提案（CLI/演示用）：音译风格确定性映射，LLM 版替换此函数
export function heuristicTranslation(term) {
  const map = {
    派: 'Sect', 门: 'Gate', 宗: 'Sect', 阁: 'Pavilion', 殿: 'Hall', 谷: 'Valley', 岛: 'Isle',
    功法: 'Art', 心法: 'Method', 诀: 'Mantra', 真经: 'Scripture', 大法: 'Grand Art',
    真人: 'the True One', 道人: 'Daoist', 境: ' Realm', 期: ' Stage',
  };
  const suffix = Object.keys(map).find((s) => term.endsWith(s));
  return suffix ? `Xuan-${map[suffix]}#${term.length}` : null; // 演示用占位译名（保证唯一稳定）
}
