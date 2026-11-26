// FE3：出处行里的内部编号（TERRA16 章节、研究笔记代号、编目号、验收记号）显示时滤掉，正常出处不动（对照表逐条）。
import { describe, expect, it } from "vitest";
import { cleanSource, shownSource, shownSources } from "../components/shownText";

const CASES: [string, string | null][] = [
  ["TERRA16 §5.2.1及研究K；费用、图纸和特性强度为游戏设计。", "费用、图纸和特性强度为游戏设计。"],
  ["英格兰1514年巨舰，1553年8月在伍利奇焚毁；研究K。", "英格兰1514年巨舰，1553年8月在伍利奇焚毁。"],
  ["Q §1.2；T §6.2", null],
  ["Manifest TERRA16 §15.2；帕拉塞尔苏斯三原质与天降石背景；人物为本作设定", "帕拉塞尔苏斯三原质与天降石背景；人物为本作设定"],
  ["《布兰航海记》开篇银枝女子；Manifest TERRA16 §8.6 与 §15.1", "《布兰航海记》开篇银枝女子"],
  ["T §7.1、§7.4；北非编年史", "北非编年史"],
  ["T §1；P §6B；土佐地方史", "土佐地方史"],
  ["TERRA16第8、12、15节原创人物与故事约定；物件的具体传承为游戏补全", "物件的具体传承为游戏补全"],
  ["TERRA16：具体图纸和通行物为游戏补全。", "具体图纸和通行物为游戏补全。"],
  ["TERRA16 §16 古典；Athenaeus, Deipnosophistae, Aldus, Venice 1514", "Athenaeus, Deipnosophistae, Aldus, Venice 1514"],
  ["研究笔记 T §2.2；Lazarillo, Martin Nucio, Antwerp 1554", "Lazarillo, Martin Nucio, Antwerp 1554"],
  ["A01 荷马《伊利亚特》《奥德赛》；阿尔丁八开本 1504；研究笔记 N §1，A01", "荷马《伊利亚特》《奥德赛》；阿尔丁八开本 1504"],
  ["《清太宗实录》天聪九年；研究D", "《清太宗实录》天聪九年"],
  ["太田牛一《信长公记》相关年条；研究P §1", "太田牛一《信长公记》相关年条"],
  ["docs/TERRA16.md", null],
  ["Matei Cazacu, Dracula（2004）", "Matei Cazacu, Dracula（2004）"],
  ["瓦拉几亚编年史研究", "瓦拉几亚编年史研究"],
  ["【待核】某部航海志", "某部航海志"],
  // 全量核对时补的形式
  ["TERRA16 §5.2.1、§8.6：精灵线条为游戏补全，性能受十九世纪飞剪上限约束。", "精灵线条为游戏补全，性能受十九世纪飞剪上限约束。"],
  ["Q §6.1；威尼斯使节报告（经研究笔记转引）", "威尼斯使节报告"],
  ["明末耶稣会书信（研究笔记转引）", "明末耶稣会书信"],
  ["Florio《A Worlde of Wordes》（1598）伞词条；林斯霍滕《旅行记》（1596）及《大明会典》的伞制，见研究笔记R", "Florio《A Worlde of Wordes》（1598）伞词条；林斯霍滕《旅行记》（1596）及《大明会典》的伞制"],
  ["1503 阿尔丁；拉丁译本的印行年代【待核】", "1503 阿尔丁；拉丁译本的印行年代"],
];

describe("FE3 出处的内部编号显示时滤掉", () => {
  it.each(CASES)("%s → %s", (raw, want) => {
    expect(cleanSource(raw)).toBe(want);
    expect(shownSource(raw)).toBe(want);
  });
  it("一组出处：去光的不显示；全空时是空数组（各处“没有就不画”照旧成立）", () => {
    expect(shownSources(["Q §1.2；T §6.2", "docs/x.md", "瓦拉几亚编年史研究"])).toEqual(["瓦拉几亚编年史研究"]);
    expect(shownSources(["Q §1.2", "研究K"])).toEqual([]);
    expect(shownSources(null)).toEqual([]);
  });
});
