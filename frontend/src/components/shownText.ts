// 显示前的一道挡（FIX4F，1113b 只点界面的实测）：后端偶尔把数据里的键、仓库文档的路径原样带到玩家看得见的字里
// （人物所在地“下田（土佐） · trading_house”、历史的“ming_court”“lectures_held”、秘术流派下的“docs/TERRA16.md §9.3”）。
// 后端在改成显示名；前端先挡住：形如全小写加下划线的英文键不直接显示——有对应的显示名就换成显示名，没有就去掉这一段；
// 以 docs/ 开头的出处不显示。只认得出“像键”的样子，正常的中英文句子不动。
import { ZH_ONLY, tz, type ZhOnlyKey } from "../i18n/zhOnly";

/** 一个键的显示名；不认得时为 undefined。 */
export type KeyNames = (key: string) => string | undefined;

/** 全小写、带下划线的英文键（ming_court、trading_house）。 */
const KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
/** 句子里夹着的键（前后不挨着别的英文字母、数字或下划线）。 */
const KEY_IN = /(?<![A-Za-z0-9_])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![A-Za-z0-9_])/g;
/** 只有小写字母的一个词（势力、朝廷的键，如 ming）：只在 loose 时当键。 */
const WORD = /^[a-z][a-z0-9_]*$/;

/** 这串字是不是一个数据键（loose：只有小写字母的一个词也算）。 */
export function isRawKey(s: string, loose = false): boolean {
  const x = s.trim();
  return KEY.test(x) || (loose && WORD.test(x));
}

/** 场所的键（人物所在地后面那一段）→ 显示名。 */
export const venueName: KeyNames = (key) => {
  const k = `venue.${key}`;
  return k in ZH_ONLY ? tz(k as ZhOnlyKey) : undefined;
};

/**
 * 一个名字：是键时换成显示名，换不了为 null（调用方就不画这一段）；不是键时原样。
 * loose：只有小写字母的一个词也当键（朝廷、势力这类字段）。
 */
export function shownName(s: string | null | undefined, names?: KeyNames, loose = false): string | null {
  if (!s) return null;
  if (!isRawKey(s, loose)) return s;
  return names?.(s.trim()) ?? null;
}

/** 收拾去掉键以后留下的空括号、连在一起或挂在两头的分隔符与空格。 */
function tidy(s: string): string {
  return s
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\s*([·、，,；;])\s*(?:[·、，,；;]\s*)+/g, "$1")
    .replace(/^\s*[·、，,；;：:]\s*/, "")
    .replace(/\s*[·、，,；;]\s*$/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 一句话里夹着的键：换成显示名，换不了就去掉（连同多出来的分隔符）。整句就是一个键又换不了时为空串。 */
export function scrubKeys(s: string | null | undefined, names?: KeyNames): string {
  if (!s) return "";
  if (s.search(KEY_IN) < 0) return s;
  return tidy(s.replace(KEY_IN, (k) => names?.(k) ?? ""));
}

/** 人物的所在地（“下田（土佐） · trading_house”）：场所的键换成场所名，认不得的那一段不显示。 */
export function shownWhere(s: string | null | undefined): string | null {
  if (!s) return null;
  const out = scrubKeys(s, venueName);
  return out === "" ? null : out;
}

/** 出处是不是仓库里的文档路径（docs/TERRA16.md §9.3）。 */
export function isRepoPath(s: string): boolean {
  return /^docs[\\/]/i.test(s.trim());
}

/**
 * FE3：出处里给写内容的人追溯用的内部编号（项目设计文档的章节、研究笔记的代号、编目号、验收记号）显示时滤掉，数据不动。
 * 按分号（；或 ;）切段，只看**段首**：
 * - `TERRA16` / `Manifest TERRA16` 开头：`TERRA16：<话>` 留冒号后面的话，别的整段去掉；
 * - `研究笔记` 开头、`研究` + 大写字母开头 → 去掉；
 * - 大写字母 + 可有空格 + `§` 开头、整段只有一个大写字母、“大写字母 + 空格 + 大写字母加数字”的代号、含“验收”→ 去掉；
 * - 段首的编目号（大写字母 + 两位数字 + 空格）去掉、留后面的；`【待核】` 去掉、留后面的。
 * 剩下的段用 `；` 接回去；原文以 `。` 结尾而结果没有时补一个。整条去光 → null。
 */
export function cleanSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const src = raw.trim();
  if (src === "" || isRepoPath(src)) return null;
  const out: string[] = [];
  for (const part of src.split(/[；;]/)) {
    // 【待核】在哪儿都去掉（全量核对时见到段中、段尾也有）；“（研究笔记转引 / 线索）”这类括注与段尾的“，见研究笔记R”也去掉
    let seg = part
      .trim()
      .replace(/【待核】\s*/g, "")
      .replace(/（[^（）]*研究笔记[^（）]*）/g, "")
      .replace(/[，,]?\s*见研究笔记\s*[A-Z]?(?:\s*§[\d.]+)?\s*([。.]?)$/, "$1")
      .trim();
    // 段尾的句号先拿掉，判断完再按原文补
    const bare = seg.replace(/[。.]$/, "").trim();
    const terra = /^(?:Manifest\s+)?TERRA16/.exec(bare);
    if (terra) {
      // “TERRA16：话”与“TERRA16 §5.2.1、§8.6：话”都留冒号后面的话
      const said = /^(?:Manifest\s+)?TERRA16[^：:]*[：:]\s*(.+)$/.exec(seg);
      if (said && said[1].trim()) out.push(said[1].trim());
      continue;
    }
    if (/^研究笔记/.test(bare) || /^研究[A-Z]/.test(bare)) continue;
    if (/^[A-Z]\s*§/.test(bare) || /^[A-Z]$/.test(bare) || /^[A-Z]\s+[A-Z]\d+$/.test(bare) || bare.includes("验收")) continue;
    seg = seg.replace(/^[A-Z]\d{2}\s+/, "").trim();
    if (seg !== "") out.push(seg);
  }
  if (out.length === 0) return null;
  let res = out.join("；").trim();
  if (src.endsWith("。") && !res.endsWith("。")) res = `${res.replace(/[；;，,]$/, "")}。`;
  return res === "" || res === "。" ? null : res;
}

/** 显示给玩家的出处：去掉仓库文档的路径与内部编号（cleanSource），去光了的那条不显示。 */
export function shownSources(list: readonly string[] | null | undefined): string[] {
  return (list ?? []).map((s) => cleanSource(s)).filter((s): s is string => s !== null);
}

/** 一条出处：是仓库文档的路径或去光了内部编号时为 null。 */
export function shownSource(s: string | null | undefined): string | null {
  return cleanSource(s);
}
