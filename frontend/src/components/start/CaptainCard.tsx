// 船长卡：头像、名牌、生辰与星座、身世五问的回答、六项属性条与奇才之法。
// 开局向导的侧栏（随每一步更新）与游戏里顶栏头像的悬停卡共用。没有身世数据时只显示头像与名字。
// 第九批（UI-CONTRACT I2）：属性分组的世界按组画雷达图（组多时上面一排组名切换，一组一张；不足三项的组画横条），
// 隐藏属性不画；有评价时列出评价读数。经典世界（一组六项）照原来的属性条画。
import { useState } from "react";
import { captainAssetId, storyPortrait } from "../../art/portraitCast";
import { t, tk } from "../../i18n";
import type { CaptainDefsView } from "../../ipc/types";
import { methodName } from "../../forecast/labels";
import { PortraitArt } from "../portrait/PortraitArt";
import { captainPortrait, lookNumber } from "./captain";
import { AttrBars, AttrRadar, type RadarAxis } from "./AttrRadar";
import { attributeName } from "./captainText";
import { attrKeys, groupedAttrs, isClassicLayout, optionOf, ratingValues, signByKey, signOf } from "./wizard";

export interface CardData {
  /** 显示用的姓名（已清理；空串显示“……”） */
  name: string;
  look: number;
  /** 按主角开局时主角的头像素材（如 t16-mio-16）：有它时不按外貌编号取头像 */
  asset?: string;
  birthday?: { month: number; day: number; age: number } | null;
  /** 档案里记下的星座 key（旧存档可能是旧版星宫）；不给时按生日判定（开局向导的草稿） */
  sign?: string;
  answers?: readonly (string | null)[];
  /** 属性（按世界属性表的顺序，经典世界即 ATTRIBUTE_KEYS）；为空时不显示属性条 */
  attrs?: readonly number[] | null;
  /** 其中来自自由分配的点数（开局向导里另用颜色标出） */
  alloc?: readonly number[] | null;
  /** 评价读数 [key, 值]（档案的 profile.ratings）；不给时按属性与评价的权重算（开局向导的预览） */
  ratings?: readonly [string, number][] | null;
  methods?: readonly string[];
}

/** 一项属性的格子条：身世与星座的点、自由分配的点、上限以内的空格。 */
export function AttrPips({ value, alloc = 0, cap, max }: { value: number; alloc?: number; cap: number; max: number }) {
  const cells = Array.from({ length: Math.max(max, value) }, (_, i) => {
    if (i < value - alloc) return "is-bg";
    if (i < value) return "is-alloc";
    return i < cap ? "is-room" : "is-later";
  });
  return (
    <span className="cw-pips" aria-hidden>
      {cells.map((c, i) => (
        <i key={i} className={c} />
      ))}
    </span>
  );
}

/** 按组的属性图：组多时一排组名切换（一组一张），三项以上画雷达图，不足三项画横条。 */
function GroupedAttrs({ defs, attrs, alloc }: { defs: CaptainDefsView; attrs: readonly number[]; alloc: readonly number[] | null | undefined }) {
  const [tab, setTab] = useState(0);
  const keys = attrKeys(defs);
  const buckets = groupedAttrs(defs).filter((b) => b.items.length > 0);
  if (buckets.length === 0) return null;
  const cur = Math.min(tab, buckets.length - 1);
  const b = buckets[cur];
  const axes: RadarAxis[] = b.items.map((i) => {
    const value = attrs[i] ?? 0;
    const spent = alloc?.[i] ?? 0;
    return { key: keys[i], name: attributeName(defs, keys[i]), value, base: alloc ? value - spent : undefined };
  });
  const [lo, hi] = b.group.range;
  const multi = buckets.length > 1;
  const testId = `cw-card-group-${b.group.key}`;
  return (
    <div className="cw-card-groups">
      {multi && (
        <div className="cw-card-tabs" role="tablist" aria-label={t("cap.at.groups")}>
          {buckets.map((x, i) => (
            <button
              key={x.group.key}
              type="button"
              role="tab"
              aria-selected={i === cur}
              className={i === cur ? "cw-card-tab is-on" : "cw-card-tab"}
              onClick={() => setTab(i)}
            >
              {x.group.name}
            </button>
          ))}
        </div>
      )}
      <div className="cw-card-group" role={multi ? "tabpanel" : undefined} aria-label={multi ? b.group.name : undefined}>
        {axes.length >= 3 ? (
          <AttrRadar group={b.group.name} axes={axes} lo={lo} hi={hi} testId={testId} />
        ) : (
          <AttrBars group={b.group.name} axes={axes} lo={lo} hi={hi} testId={testId} />
        )}
      </div>
    </div>
  );
}

/** 评价读数（名字查 StaticView.captain.ratings；没有名字的评价用 key）。 */
function Ratings({ defs, ratings }: { defs: CaptainDefsView; ratings: readonly [string, number][] }) {
  if (ratings.length === 0) return null;
  return (
    <ul className="cw-card-ratings" aria-label={t("cap.card.ratings")} data-testid="cw-card-ratings">
      {ratings.map(([key, value]) => {
        const name = defs.ratings?.find((r) => r.key === key)?.name ?? key;
        return (
          <li key={key} aria-label={t("cap.card.attr", { name, value })}>
            <span className="cw-rating-name" aria-hidden>
              {name}
            </span>
            <span className="cw-rating-value ts-num" aria-hidden>
              {value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function CaptainCard({
  defs,
  data,
  size = 144,
  className,
  testId,
  foldable = false,
}: {
  defs: CaptainDefsView | null | undefined;
  data: CardData;
  /** 头像边长（CSS 像素） */
  size?: number;
  className?: string;
  testId?: string;
  /**
   * 新界面（v2）的开局向导与补建身世：手机上缺省收成一行（头像、名字、生辰与星座），生辰右边一个“详情”键展开整张卡——
   * 这一步要选的、要分点的留在第一屏。宽屏上样式把“详情”键藏起来，整张卡照常显示。旧界面不传（DOM 与原来相同）。
   */
  foldable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = data.name.trim();
  const sign = !defs
    ? undefined
    : data.sign !== undefined
      ? signByKey(defs, data.sign)
      : data.birthday
        ? signOf(defs, data.birthday.month, data.birthday.day)
        : undefined;
  // 经典的版面（一组六项）：照原来的属性条画；否则按组画雷达图
  const classic = defs && isClassicLayout(defs) ? groupedAttrs(defs)[0] : null;
  return (
    <aside
      className={["cw-card", className, foldable ? "v2-card-fold" : null, foldable && open ? "is-open" : null].filter(Boolean).join(" ")}
      aria-label={t("cap.card.title")}
      data-testid={testId}
    >
      <div className="cw-card-portrait">
        <PortraitArt
          asset={data.asset ?? captainAssetId(data.look)}
          fallback={() => captainPortrait(data.look)}
          size={size}
          label={
            data.asset || storyPortrait(data.look)
              ? t("start.heroPortraitLabel", { name: shown || "?" })
              : t("start.portraitLabel", { name: shown || "?", n: lookNumber(data.look) })
          }
          className="ts-portrait-img"
          live
        />
      </div>
      <div className="ts-nameplate cw-card-name">{shown ? t("start.captainPlate", { name: shown }) : "……"}</div>

      {defs && data.birthday && (
        <p className="cw-card-born">
          <span>{t("cap.card.born", { month: data.birthday.month, day: data.birthday.day, age: data.birthday.age })}</span>
          {sign && <span className="cw-card-sign">{sign.name}</span>}
        </p>
      )}
      {foldable && (
        <button type="button" className="v2-card-toggle" aria-expanded={open} aria-label={t("v2.start.cardDetailsLabel")} onClick={() => setOpen((o) => !o)}>
          {t("v2.start.cardDetails")}
        </button>
      )}

      {defs && data.answers && defs.questions.length > 0 && (
        <ol className="cw-card-bg">
          {defs.questions.map((q, qi) => {
            const o = optionOf(defs, qi, data.answers?.[qi]);
            const text = o?.name ?? t("cap.card.unanswered");
            return (
              <li key={q.key} className={o ? undefined : "is-empty"} title={q.title} aria-label={t("labelValue", { label: q.title, value: text })}>
                {text}
              </li>
            );
          })}
        </ol>
      )}

      {defs && data.attrs && classic && (
        <ul className="cw-card-attrs">
          {classic.items.map((i) => {
            const k = attrKeys(defs)[i];
            const v = data.attrs?.[i] ?? 0;
            const name = attributeName(defs, k);
            const g = classic.group;
            return (
              <li key={k} aria-label={t("cap.card.attr", { name, value: v })}>
                <span className="cw-attr-name" aria-hidden>
                  {name}
                </span>
                <AttrPips value={v} alloc={data.alloc?.[i] ?? 0} cap={g.creation_cap} max={g.range[1]} />
                <span className="cw-attr-value ts-num" aria-hidden>
                  {v}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {defs && data.attrs && !classic && <GroupedAttrs defs={defs} attrs={data.attrs} alloc={data.alloc} />}
      {defs && data.attrs && <Ratings defs={defs} ratings={data.ratings ?? ratingValues(defs, data.attrs)} />}

      {data.methods && data.methods.length > 0 && (
        <p className="cw-card-methods">{t("cap.card.methods", { list: data.methods.map((m) => methodName(m)).join(tk("listSep")) })}</p>
      )}
    </aside>
  );
}
