// 道具店（FRAMEWORK §8.5，docs/UI-CONTRACT.md I4）：港口窗口里的一页。货架按港口的文化与规模每月换货；每行一键买一件，
// 下面是自己身上能卖的东西（按道具店的收购价）。价格、库存与能不能买都以后端为准。
// 新界面（v2）：“买”灰掉时原因都写在这一行（卖完了与换货日、现金还差多少；原来只写后端给的原因）；没有道具店时是空状态。v1 不变。
import { useCallback, useState } from "react";
import { useView } from "../../hooks/useView";
import { money, t } from "../../i18n";
import { api } from "../../ipc/api";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState, Loading } from "../feedback";
import { ItemDetail, ItemSlotIcon } from "./ItemParts";
import { sortItems } from "./itemKit";

export default function ShopPanel({ loc }: { loc: number }) {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const cash = useGame((s) => s.overview?.cash ?? 0);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v2 = useIsV2();

  // 货架：还没取到为 undefined（载入中），这里没有道具店或取不到为 null
  const shopView = useView(`itemshop:${loc}`, () => api.itemShop(loc), { quiet: true });
  const shop = shopView.status === "error" ? null : shopView.status === "loading" && shopView.data === null ? undefined : shopView.data;
  const inv = useView("inventory", () => api.inventory(), { quiet: true }).data;

  const attrName = useCallback((k: string) => statics?.captain?.attributes.find((a) => a.key === k)?.name ?? k, [statics]);
  if (shop === undefined) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;
  if (shop === null) return <EmptyState text={t("it.noShop")} v1={<p className="ts-empty">{t("it.noShop")}</p>} />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const sellable = sortItems((inv?.items ?? []).filter((it) => it.can_sell && it.qty > it.equipped));
  const sellPrice = (price: number) => Math.floor((price * shop.sell_bp) / 10000);
  const shown = selected ? (shop.offers.find((o) => o.item === selected)?.line ?? sellable.find((it) => it.key === selected) ?? null) : null;

  return (
    <div className="it-shop" data-testid="item-shop">
      <p className="it-lead">
        {shop.name}
        <span className="it-restock">{t("it.restock", { y: shop.restock[0], m: shop.restock[1], d: shop.restock[2] })}</span>
      </p>
      <ul className="it-offers" aria-label={t("it.offers")}>
        {shop.offers.map((o) => (
          <li key={o.item} className={o.enabled ? "it-offer" : "it-offer is-blocked"} data-testid={`offer-${o.item}`}>
            <button type="button" className="it-offer-main" onClick={() => setSelected(o.item)} aria-pressed={selected === o.item}>
              <ItemSlotIcon item={o.line} qty={o.stock} size="small" />
              <span className="it-offer-name">{o.line.name}</span>
              <span className="it-offer-price">{money(o.price)}</span>
            </button>
            <button
              type="button"
              className="ts-btn ts-btn-small"
              disabled={busy || !o.enabled || o.stock <= 0 || cash < o.price}
              title={o.blocked_reason}
              onClick={() => void run(() => submit({ BuyItem: { owner: "player", loc, item: o.item, qty: 1, max_total: o.price } }))}
            >
              {t("it.buy")}
            </button>
            {!o.enabled && o.blocked_reason && <span className="it-why">{o.blocked_reason}</span>}
            {v2 && o.enabled && o.stock <= 0 && <span className="it-why">{t("v2.port.soldOut", { y: shop.restock[0], m: shop.restock[1], d: shop.restock[2] })}</span>}
            {v2 && o.enabled && o.stock > 0 && cash < o.price && <span className="it-why">{t("sy.short", { v: money(o.price - cash) })}</span>}
          </li>
        ))}
      </ul>
      {sellable.length > 0 && (
        <>
          <h4 className="it-sub">{t("it.sellTitle")}</h4>
          <ul className="it-offers" aria-label={t("it.sellTitle")}>
            {sellable.map((it) => (
              <li key={it.key} className="it-offer">
                <button type="button" className="it-offer-main" onClick={() => setSelected(it.key)} aria-pressed={selected === it.key}>
                  <ItemSlotIcon item={it} size="small" qty={it.qty - it.equipped} />
                  <span className="it-offer-name">{it.name}</span>
                  <span className="it-offer-price">{money(sellPrice(it.price))}</span>
                </button>
                <button
                  type="button"
                  className="ts-btn ts-btn-small"
                  disabled={busy}
                  onClick={() => void run(() => submit({ SellItem: { owner: "player", loc, item: it.key, qty: 1, min_total: sellPrice(it.price) } }))}
                >
                  {t("it.sell")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {shown && <ItemDetail item={shown} attrName={attrName} />}
    </div>
  );
}
