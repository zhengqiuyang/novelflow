// 术语引擎：中文网文专名抽取 + 锁定表。
// 中文无空格分词，纯正则贪婪匹配会把"拜入青云派"整段当术语——
// 这里的策略：后缀锚定（派/宗/诀/境…）+ 向上回溯找最短边界候选
// （候选前一个字符是动词/标点/引号/行首，才算术语真正的左边界）。
// 核心信任机制：译名首现确认后"锁定"，输出侧校验命中率——代码校验，不是 prompt 恳求。

// 术语后缀族：[后缀正则, 类别]
const SUFFIX_FAMILIES = [
  [/派|门|宗|教|阁|殿|楼|盟|会|山庄|谷|岛/, 'sect'],
  [/功法|心法|诀|剑法|拳法|神功|真经|大法/, 'technique'],
  [/真人|道人|大师|上人|老祖|圣主|尊老/, 'title'],
  [/境(?:初期|中期|后期|巅峰)?/, 'realm'],
];

// 左边界字符：候选术语**前面**若是这些动词尾字/虚词，视为句法边界
const BOUNDARY_CHARS = new Set('入到去在往的了的和与至拜加回进闯赶传授予自向从对使被把跟比说叫为是已将让修炼读习悟'.split(''));
const MIN_LEN = 2;
const MAX_LEN = 8;

// 常用词白名单：避免"咱们派""没有门"这类误报
const STOPWORDS = new Set([
  '他们派', '我们派', '你们派', '对方派', '自己门', '没有门', '打开门', '关上门',
  '心里门', '一种功法', '这套功法', '那门功法', '门外汉',
]);

export function createGlossary() {
  return { entries: new Map() }; // Map<term, {term, translation, category, firstChapter, locked}>
}

export function extractTerms(chapterText, chapterNum) {
  const text = String(chapterText);
  const found = new Map();

  for (const [suffixRe, category] of SUFFIX_FAMILIES) {
    for (const suffix of matchAllSuffixes(text, suffixRe)) {
      const term = shortestBoundaryCandidate(text, suffix.start, suffix.end);
      if (!term || STOPWORDS.has(term) || term.length < MIN_LEN) continue;
      if (!found.has(term)) {
        found.set(term, { term, category, firstChapter: chapterNum, count: 1 });
      } else {
        found.get(term).count += 1;
      }
    }
  }
  return [...found.values()];
}

function* matchAllSuffixes(text, suffixRe) {
  const g = new RegExp(suffixRe.source, 'g');
  let m;
  while ((m = g.exec(text)) !== null) {
    yield { start: m.index, end: m.index + m[0].length };
  }
}

// 从后缀位置向上回溯：取"候选前一个字符是边界"的最短候选（j 是候选起点，
// 边界看 text[j-1]）；到顶也无边界则放弃（宁缺勿错）
function shortestBoundaryCandidate(text, suffixStart, suffixEnd) {
  for (let j = suffixStart - 1; suffixEnd - j <= MAX_LEN && j >= 0; j--) {
    if (suffixEnd - j < MIN_LEN) continue; // 前缀至少 1 字
    const prev = text[j - 1];
    const atBoundary = j === 0 || !/[\u4e00-\u9fa5]/.test(prev) || BOUNDARY_CHARS.has(prev);
    if (atBoundary) return text.slice(j, suffixEnd);
  }
  return null;
}

// 首现登记（未锁定状态，等人工/LLM 提名译名）
export function registerTerms(glossary, terms) {
  const added = [];
  for (const t of terms) {
    if (!glossary.entries.has(t.term)) {
      glossary.entries.set(t.term, { ...t, translation: null, locked: false });
      added.push(t.term);
    }
  }
  return added;
}

// 锁定译名——锁了就不许漂移
export function lockTerm(glossary, term, translation) {
  const e = glossary.entries.get(term);
  if (!e) throw new Error(`术语未登记: ${term}`);
  e.translation = translation;
  e.locked = true;
  return e;
}

// 本章出场术语（用于上下文注入：只注入本章会遇到的）
export function termsInText(glossary, text) {
  return [...glossary.entries.values()].filter((e) => text.includes(e.term));
}

// 输出侧校验：译文里锁定术语的译名必须出现。返回违规明细。
export function validateTranslation(glossary, sourceText, translation) {
  const violations = [];
  const applicable = termsInText(glossary, sourceText).filter((e) => e.locked);
  for (const e of applicable) {
    if (!translation.includes(e.translation)) {
      violations.push({ term: e.term, expected: e.translation });
    }
  }
  return {
    violations,
    hitRate: applicable.length === 0 ? 1 : (applicable.length - violations.length) / applicable.length,
  };
}

// 漂移检测：原文含锁定术语，译文却用了别的译名 → 标记重译
export function detectDrift(glossary, sourceText, translation) {
  const { violations } = validateTranslation(glossary, sourceText, translation);
  return violations.map((v) => ({ ...v, kind: 'drift-or-missing', action: 'retry-line' }));
}
