// 物品的公共小件：带稀有度边框的图标格、物品详情（名字、种类、稀有度、加成、效果、书的信息、出处、典故）。
import { money, t, tk } from "../../i18n";
import type { ItemLine } from "../../ipc/types";
import { ShellIcon } from "../shell/ShellIcon";
import { publicImage } from "../../art/imageUrl";
import { useIsV2 } from "../../ui/uiMode";
import { itemIconKey, kindIcon } from "./itemKit";
import { shownSources } from "../shownText";

/** 图标格：稀有度决定边框颜色；数量大于 1 时角标；已装备的打一个小勾。 */
export function ItemSlotIcon({ item, size = "normal", qty, selected }: { item: ItemLine | null; size?: "normal" | "small" | "large"; qty?: number; selected?: boolean }) {
  if (!item) return <span className={`it-icon it-icon--${size} it-icon--empty`} aria-hidden />;
  const art = itemIconKey(item);
  return (
    <span className={`it-icon it-icon--${size} it-rarity-${item.rarity}${art ? " it-icon--art" : ""}${selected ? " is-selected" : ""}`} data-item={item.key}>
      {art ? (
        <img className="it-icon-img" src={publicImage(`items/${art}.webp`)} alt="" aria-hidden decoding="async" loading="lazy" draggable={false} />
      ) : (
        <ShellIcon name={kindIcon(item.kind)} scale={size === "small" ? 2 : 3} />
      )}
      {(qty ?? item.qty) > 1 && <span className="it-qty">{qty ?? item.qty}</span>}
      {item.equipped > 0 && <span className="it-worn" aria-label={t("it.equipped")} />}
    </span>
  );
}

/** 物品详情。actions 放按钮（装备、使用、读、送、卖……）。 */
export function ItemDetail({ item, attrName, actions }: { item: ItemLine; attrName: (k: string) => string; actions?: React.ReactNode }) {
  // 新界面里抬头放大图（有专属图标时）：手绘图在 48 像素的格子里看不出细节
  const v2 = useIsV2();
  const big = v2 && itemIconKey(item) !== null;
  return (
    <article className={`it-detail it-rarity-${item.rarity}`} aria-label={item.name} data-testid="item-detail">
      <header className="it-detail-head">
        <ItemSlotIcon item={item} size={big ? "large" : "normal"} />
        <div>
          <h4 className="it-name">{item.name}</h4>
          <p className="it-kind">
            <span className={`it-rarity-tag it-rarity-${item.rarity}`}>{tk(`it.rarity.${item.rarity}`)}</span>
            {tk(`it.kind.${item.kind}`)}
            {item.key_item && <span className="it-key">{t("it.keyItem")}</span>}
          </p>
        </div>
      </header>
      {item.desc && <p className="it-desc">{item.desc}</p>}
      {(item.bonus.length > 0 || item.effects.length > 0) && (
        <ul className="it-effects">
          {item.bonus.map((b) => (
            <li key={b.attr} className="it-bonus">
              {attrName(b.attr)} {b.value > 0 ? `+${b.value}` : b.value}
            </li>
          ))}
          {item.effects.map((e, i) => (
            <li key={`${e.kind}-${i}`}>{e.text}</li>
          ))}
        </ul>
      )}
      {item.book && (
        <p className="it-book">
          {t("it.bookLine", { category: item.book.category_name, days: item.book.days })}
          {item.book.lang_name && <span>{t("it.bookLang", { lang: item.book.lang_name })}</span>}
          {item.book.published && <span>{t("it.bookYear", { y: item.book.published })}</span>}
          <span className={item.book.read ? "is-good" : undefined}>{item.book.read ? t("it.bookRead") : tk(`it.canRead.${item.book.can_read}`)}</span>
        </p>
      )}
      {/* 标签是数据里的英文键（送礼匹配、校对标记都在里面），新界面不把它原样摆给玩家 */}
      {!v2 && item.tags.length > 0 && <p className="it-tags">{item.tags.join(" · ")}</p>}
      {item.lore && <p className="it-lore">{item.lore}</p>}
      {(item.basis || shownSources(item.sources).length > 0) && (
        <p className="it-source">
          {item.basis && <span className="it-basis">{tk(`it.basis.${item.basis}`)}</span>}
          {shownSources(item.sources).join("；")}
        </p>
      )}
      <p className="it-price">{t("it.price", { v: money(item.price) })}</p>
      {actions && <div className="it-actions">{actions}</div>}
    </article>
  );
}
