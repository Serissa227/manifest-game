// 远洋剧情的沿途补给（V01，copy-needed-v01.json 的 supply_stopovers）：寰宇的两条自定义开局主线要跨洋送货，
// 一口气开过去粮水撑不到（实航审计见 docs/BALANCE.md 与 DECISIONS.md“V01 实航复核后的局部数值”），任务日志在这一章下面写一行沿途在哪些港口补给。
// 港名从地点数据里按 key 取（数据改了名字这里跟着变）；找不到起点、终点或一个中途港都找不到时不写这一行，找不到的中途港跳过。
import { listJoin } from "../../i18n";
import { tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import type { StaticView, TrackView } from "../../ipc/types";

interface Stopover {
  /** 哪几章（门槛见闻与要跨洋的那一章）时写 */
  chapters: readonly string[];
  text: ZhOnlyKey;
  from: string;
  via: readonly string[];
  to: string;
}

const STOPOVERS: Readonly<Record<string, Stopover>> = {
  // 冰封以前：正月从毕尔巴鄂出发，北大西洋直航顶风逆流；经佛得角的南线逐港补给，十一月十日前到红湾
  free_basque_whaling: {
    chapters: ["a00_gate", "a01_redbay"],
    text: "sup.stopBasque",
    from: "bilbao",
    via: ["funchal", "ribeira_grande", "san_juan", "st_johns"],
    to: "red_bay",
  },
  // 周五的灯：父亲托运的药草从里斯本绕过非洲送到果阿
  free_lisbon_medicine: {
    chapters: ["a00_gate", "a01_orta"],
    text: "sup.stopLisbon",
    from: "lisbon",
    via: ["sao_tome", "sofala"],
    to: "goa",
  },
};

/** 这条任务此刻要不要写沿途补给；要写时返回那一句，否则 null。 */
export function stopoverText(statics: Pick<StaticView, "locations"> | null, track: TrackView): string | null {
  const s = STOPOVERS[track.key];
  if (!s || !statics || (track.status !== "active" && track.status !== "waiting") || !s.chapters.includes(track.chapter)) return null;
  const name = (key: string) => statics.locations.find((l) => l.key === key)?.name;
  const from = name(s.from);
  const to = name(s.to);
  if (!from || !to) return null;
  const via = s.via.map(name).filter((n): n is string => !!n);
  if (via.length === 0) return null;
  return tz(s.text, { from, to, via: listJoin(via) });
}
