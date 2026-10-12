// 人物状态卡：修为/关系/生死/持有物的跨章追踪。
// 防的经典事故：第 200 章死人复活、师兄变师弟。
// 更新器是确定性规则 + LLM 抽取的混合：低置信变更挂起待人工，不静默写入。
export function createCharacter(name, init = {}) {
  return {
    name,
    alive: true,
    realm: init.realm ?? null,        // 修为境界
    relations: init.relations ?? {},  // {人物名: 关系}
    items: init.items ?? [],          // 持有物
    history: [],                      // 变更留痕：{chapter, field, from, to, quote, confidence}
  };
}

// 从一章文本抽取状态变更事件（确定性信号先行）。
// 修仙文的现实：人名和触发词之间常隔状语（"林凡悲愤之下突破至元婴境"），
// 紧邻正则会把"悲愤之下"当人名——所以用已知角色名在触发词前窗口内回溯锚定。
// 找不到已知角色 → 原始相邻名进 uncertain（挂起待人工，不静默写入）。
const REALM_TRIGGER = /(突破|晋升|跨入)了?(?:至)?(?<realm>[\u4e00-\u9fa5]{1,6}(?:境|期))/g;
const DEATH_TRIGGER = /(陨落|身死|气绝|被杀|战死|身亡|咽了气)/g;
const RAW_NAME = /([\u4e00-\u9fa5]{2,4})$/;
const LOOKBACK = 10;

export function extractStateEvents(chapterText, chapterNum, knownCharacters = []) {
  const events = [];
  const uncertain = [];

  for (const [trigger, field] of [[REALM_TRIGGER, 'realm'], [DEATH_TRIGGER, 'alive']]) {
    trigger.lastIndex = 0;
    let m;
    while ((m = trigger.exec(chapterText)) !== null) {
      const window = chapterText.slice(Math.max(0, m.index - LOOKBACK), m.index);
      const { anchor, uncertainName } = resolveSubject(window, knownCharacters);
      const evt = {
        chapter: chapterNum,
        quote: m[0],
        field,
        value: field === 'alive' ? false : m.groups?.realm,
      };
      if (anchor) {
        events.push({ character: anchor.name, ...evt });
      } else if (uncertainName) {
        uncertain.push({ character: uncertainName, ...evt });
      }
    }
  }
  return { events, uncertain };
}

// 窗口内找"离触发词最近"的已知角色（多个角色同窗取更近者）
function anchorKnownCharacter(window, knownCharacters) {
  let best = null;
  let bestIdx = -1;
  for (const c of knownCharacters) {
    const idx = window.lastIndexOf(c.name);
    if (idx >= 0 && idx > bestIdx) {
      best = c;
      bestIdx = idx;
    }
  }
  return best;
}

// 事件归属仲裁：紧邻名字优先于窗口回溯。
// - 紧邻名与已知角色重叠（含/被含）→ 锚定该角色
// - 紧邻名是状语尾巴（"悲愤之下""大喜"）→ 视为无主语，回退窗口锚定
// - 紧邻名是陌生名字（如"赵无极"）→ 不锚定已知角色，挂起待人工
//   （"林凡的师兄赵无极陨落"死的是赵无极，不是窗口里的林凡）
const ADVERBIAL_TAILS = new Set([
  '之下', '之后', '之际', '之时', '大喜', '大怒', '悲愤', '顿时', '随即',
  '当即', '终于', '突然', '忽然', '直接', '一声', '惨叫',
]);

function resolveSubject(window, knownCharacters) {
  const rawName = window.match(RAW_NAME)?.[1];
  if (rawName) {
    const isAdverbial = [...ADVERBIAL_TAILS].some((t) => rawName.includes(t));
    if (isAdverbial) {
      // 状语尾巴不是主语（贪婪匹配可能抓到"悲愤之下"整串）→ 回退窗口锚定
      return { anchor: anchorKnownCharacter(window, knownCharacters), uncertainName: null };
    }
    const overlapped = knownCharacters.find(
      (c) => rawName.includes(c.name) || c.name.includes(rawName)
    );
    if (overlapped) return { anchor: overlapped, uncertainName: null };
    return { anchor: null, uncertainName: rawName }; // 陌生主语，不猜
  }
  return { anchor: anchorKnownCharacter(window, knownCharacters), uncertainName: null };
}

// 应用变更（带留痕与冲突检测）：死人复活类的矛盾直接报冲突，不覆盖。
export function applyEvents(character, events) {
  const conflicts = [];
  for (const e of events.filter((x) => matchChar(character, x.character))) {
    if (e.field === 'alive') {
      if (character.alive === false) {
        conflicts.push({ ...e, kind: 'already-dead', msg: `${character.name} 已死亡，再次死亡事件需人工核实` });
        continue;
      }
      character.history.push({ chapter: e.chapter, field: 'alive', from: true, to: false, quote: e.quote });
      character.alive = false;
    }
    if (e.field === 'realm' && e.value) {
      character.history.push({ chapter: e.chapter, field: 'realm', from: character.realm, to: e.value, quote: e.quote });
      character.realm = e.value;
    }
  }
  return conflicts;
}

// 翻译第 N 章前的上下文注入：只给出场角色的卡片摘要（上下文经济学）
export function contextForChapter(characters, chapterText, glossary) {
  const mentioned = characters.filter((c) => chapterText.includes(c.name));
  return mentioned.map((c) => ({
    name: c.name,
    translation: glossary?.entries.get(c.name)?.translation ?? null,
    alive: c.alive,
    realm: c.realm,
    relations: c.relations,
  }));
}

function matchChar(character, eventCharName) {
  return character.name === eventCharName
    || character.name.includes(eventCharName)
    || eventCharName.includes(character.name);
}
