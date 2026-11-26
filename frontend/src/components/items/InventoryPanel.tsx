// 行囊（FRAMEWORK §8，docs/UI-CONTRACT.md I4）：左边是穿戴者（主角与在队的航海士）的纸娃娃——七个装备槽与装备前后的属性；
// 右边是物品栏（按装备、书、礼物、消耗品、藏品、关键物品分类，稀有度高的在前）；点一件看详情，可以装备、卸下、使用、读。
// 下方两页：书目（读过的书按类别计数）与套装（集齐给称号与效果），以及送礼的累计与收藏估值。
// 新界面（v2；旧界面不变）：物品栏是一张账页，一行一件（名字不截断、写稀有度与种类），常用的一键（装上 / 读 / 使用）在行的右边，
// 不用先选中再操作；选中的详情在右边一栏（一开始就留着，写一句“点一件看详情”，点第一下时列表不会变窄、跳位置）；
// 手机上（竖屏、横屏）详情从底部升起（抽屉，有抓手与 ×），列表停在原处不滚走；空的分类给“看全部物品”。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isCompact, useLayout } from "../../hooks/useViewport";
import { useView } from "../../hooks/useView";
import { money, t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import { captainAssetId, mateAssetId } from "../../art/portraitCast";
import type { EquipSlot, ItemLine } from "../../ipc/types";
import { useGame } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { EmptyState, Loading } from "../feedback";
import { PortraitArt } from "../portrait/PortraitArt";
import Sheet from "../shell/Sheet";
import { captainPortrait } from "../start/captain";
import { ItemDetail, ItemSlotIcon } from "./ItemParts";
import { FILTERS, SLOTS, isEquipment, matches, setProgress, slotToEquip, sortItems, type ItemFilter } from "./itemKit";

type Page = "bag" | "books" | "sets";

export default function InventoryPanel() {
  const statics = useGame((s) => s.statics);
  const submit = useGame((s) => s.submit);
  const look = useGame((s) => s.overview?.captain?.portrait ?? 0);
  const captainAsset = useGame((s) => s.overview?.captain_asset ?? null);
  const inv = useView("inventory", () => api.inventory(), { quiet: true }).data;
  const [wearer, setWearer] = useState<string>("captain");
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("bag");
  const [busy, setBusy] = useState(false);
  const v2 = useIsV2();
  // 新界面在手机上（竖屏、横屏）：详情放进从底部升起的抽屉，点的那一行不会被滚走
  const layout = useLayout();
  const sheet = v2 && isCompact(layout);
  // 新界面的其余布局：选中一件时把详情滚进视野（只在窄到详情排到列表下面时才会动；详情一栏在右边时停在顶上，本来就看得见）
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (v2 && !sheet && selected) detailRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [v2, sheet, selected]);

  const attrName = useCallback((k: string) => statics?.captain?.attributes.find((a) => a.key === k)?.name ?? k, [statics]);
  if (!inv) return <Loading v1={<p className="ts-empty">{t("loading")}</p>} />;

  const w = inv.wearers.find((x) => x.key === wearer) ?? inv.wearers[0];
  // 穿戴者的头像：后端没给时，船长用顶栏那一张（专属头像或按外貌编号），航海士按 key 找专属头像
  const wearerAsset = w.key === "captain" ? (captainAsset ?? captainAssetId(look)) : mateAssetId({ name: w.name, key: w.key });
  const items = sortItems(inv.items.filter((it) => matches(filter, it)));
  const byKey = new Map(inv.items.map((it) => [it.key, it]));
  const sel = selected ? (byKey.get(selected) ?? null) : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const equip = (it: ItemLine) => {
    if (!w) return;
    const slot = slotToEquip(w, it);
    if (slot) void run(() => submit({ Equip: { owner: "player", wearer: w.key, slot, item: it.key } }));
  };
  const unequip = (slot: EquipSlot) => w && void run(() => submit({ Unequip: { owner: "player", wearer: w.key, slot } }));
  const wornBy = (it: ItemLine) => !!w?.slots.some((s) => s.item === it.key);
  const read = (it: ItemLine) => void run(() => submit({ ReadBook: { owner: "player", book: it.key } }));
  const use = (it: ItemLine) => void run(() => submit({ UseItem: { owner: "player", item: it.key } }));
  // 新界面：物品行里的一键（每行最多一个：装上 > 读 > 使用；穿着的写“穿戴中”）。条件与详情里的按钮相同
  const canRead = (it: ItemLine) => !!it.book && !it.book.read && it.book.can_read !== "no";
  // 一次只能读一本：这本正在读写“正在读”；在读别的书时“读”不可用，原因写在这一行的说明里（readWhy），按钮指向它
  const readingThis = (it: ItemLine) => !!inv.reading && inv.reading.book === it.key;
  const readWhy = (it: ItemLine) => (canRead(it) && inv.reading && !readingThis(it) ? t("v2.fleet.readAfter", { name: inv.reading.name }) : null);
  const quick = (it: ItemLine): ReactNode => {
    if (w && wornBy(it)) return <span className="it-worn-tag">{t("v2.fleet.worn")}</span>;
    const button = (label: string, name: string, onClick: () => void, disabled = false, why?: string) => (
      <button type="button" className="btn small it-quick" aria-label={name} aria-describedby={why} disabled={busy || disabled} onClick={onClick}>
        {label}
      </button>
    );
    if (w && isEquipment(it.kind) && it.qty > it.equipped && slotToEquip(w, it)) return button(t("v2.fleet.equip"), t("v2.fleet.equipNamed", { wearer: w.name, item: it.name }), () => equip(it));
    if (canRead(it) && readingThis(it)) return <span className="it-worn-tag it-reading-tag">{t("v2.fleet.readingThis")}</span>;
    if (canRead(it)) return button(t("v2.fleet.read"), t("v2.fleet.readNamed", { item: it.name }), () => read(it), !!inv.reading, readWhy(it) ? `it-why-${it.key}` : undefined);
    if (it.can_use) return button(t("v2.fleet.use"), t("v2.fleet.useNamed", { item: it.name }), () => use(it));
    return null;
  };

  const filters = (
    <div className="ub-tabs" role="tablist" aria-label={t("it.filters")}>
      {FILTERS.map((f) => (
        <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? "ub-tab is-on" : "ub-tab"} onClick={() => setFilter(f)}>
          {tk(`it.filter.${f}`)}
        </button>
      ))}
    </div>
  );
  const all = filter === "all";
  const list =
    items.length === 0 ? (
      // 新界面：写明为什么空，别的分类里有东西时一键“看全部物品”；旧界面照旧一行字
      <EmptyState
        v1={<p className="ts-empty">{t("it.empty")}</p>}
        text={all && inv.items.length === 0 ? t("v2.fleet.itemsEmpty") : t("it.empty")}
        hint={inv.items.length === 0 ? t("v2.fleet.itemsEmptyHint") : t("v2.fleet.filterEmptyHint")}
        action={!all && inv.items.length > 0 ? { label: t("v2.fleet.showAll"), onClick: () => setFilter("all") } : undefined}
      />
    ) : (
      <ul className="it-grid">
        {items.map((it) => (
          <li key={it.key} className={v2 ? "it-row" : undefined}>
            <button
              type="button"
              className="it-grid-btn"
              aria-pressed={it.key === selected}
              aria-label={it.name}
              aria-describedby={v2 ? `it-meta-${it.key}` : undefined}
              onClick={() => setSelected(it.key)}
            >
              <ItemSlotIcon item={it} selected={it.key === selected} />
              <span className="it-grid-name">{it.name}</span>
              {v2 && (
                <span className="it-grid-meta" id={`it-meta-${it.key}`}>
                  <span className={`it-rarity-tag it-rarity-${it.rarity}`}>{tk(`it.rarity.${it.rarity}`)}</span>
                  <span>{tk(`it.kind.${it.kind}`)}</span>
                  {/* 行内一键做不了的原因（在读别的书）：写在名字下面这一行，右边灰掉的“读”用 aria-describedby 指过来 */}
                  {readWhy(it) && (
                    <span className="it-quick-why" id={`it-why-${it.key}`}>
                      {readWhy(it)}
                    </span>
                  )}
                </span>
              )}
            </button>
            {v2 && quick(it)}
          </li>
        ))}
      </ul>
    );
  const detail = sel && (
    <ItemDetail
      item={sel}
      attrName={attrName}
      actions={
        <>
          {isEquipment(sel.kind) && !wornBy(sel) && sel.qty > sel.equipped && (
            <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={() => equip(sel)}>
              {t("it.equipOn", { name: w?.name ?? "" })}
            </button>
          )}
          {sel.book && !sel.book.read && sel.book.can_read !== "no" && (
            <button type="button" className="ts-btn ts-btn-small" disabled={busy || !!inv.reading} onClick={() => read(sel)}>
              {t("it.read")}
            </button>
          )}
          {sel.can_use && (
            <button type="button" className="ts-btn ts-btn-small" disabled={busy} onClick={() => use(sel)}>
              {t("it.use")}
            </button>
          )}
        </>
      }
    />
  );
  const reading = inv.reading && (
    <p className="it-reading" data-testid="reading">
      {t("it.reading", { name: inv.reading.name, done: inv.reading.done_days, total: inv.reading.total_days })}
      <span className="it-reading-bar">
        <span style={{ width: `${Math.round((inv.reading.done_days / Math.max(1, inv.reading.total_days)) * 100)}%` }} />
      </span>
    </p>
  );
  return (
    <div className="it-panel" data-testid="inventory">
      <div className="ub-tabs it-pages" role="tablist" aria-label={t("it.pages")}>
        {(["bag", "books", "sets"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={page === p} className={page === p ? "ub-tab is-on" : "ub-tab"} onClick={() => setPage(p)}>
            {tk(`it.page.${p}`)}
          </button>
        ))}
        <span className="it-summary">
          {t("it.summary", { value: money(inv.collection_value), gifts: inv.gifts.count, read: inv.bibliography.read })}
        </span>
      </div>

      {page === "bag" && (
        <div className="it-bag">
          {w && (
            <section className="it-doll" aria-label={t("it.doll")}>
              {inv.wearers.length > 1 && (
                <select aria-label={t("it.wearer")} value={w.key} onChange={(e) => setWearer(e.target.value)}>
                  {inv.wearers.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
              <PortraitArt asset={w.portrait ?? wearerAsset} fallback={() => captainPortrait(look)} size={112} className="it-doll-face" label={w.name} />
              <ul className="it-slots">
                {SLOTS.map((slot) => {
                  const key = w.slots.find((s) => s.slot === slot)?.item ?? null;
                  const it = key ? (byKey.get(key) ?? null) : null;
                  return (
                    <li key={slot} className="it-slot" data-slot={slot}>
                      <button type="button" className="it-slot-btn" onClick={() => it && setSelected(it.key)} aria-label={t("it.slotLabel", { slot: tk(`it.slot.${slot}`), item: it?.name ?? t("it.slotEmpty") })}>
                        <ItemSlotIcon item={it} size="small" selected={!!it && it.key === selected} />
                        <span className="it-slot-name">{tk(`it.slot.${slot}`)}</span>
                        <span className="it-slot-item">{it?.name ?? "—"}</span>
                      </button>
                      {it && (
                        <button type="button" className="ts-btn ts-btn-small it-unequip" disabled={busy} onClick={() => unequip(slot)} aria-label={t("it.unequipNamed", { name: it.name })}>
                          {t("it.unequip")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {w.attrs.length > 0 && (
                <ul className="it-attrs" aria-label={t("it.attrs")}>
                  {w.attrs.map((a) => (
                    <li key={a.attr}>
                      {attrName(a.attr)} <b>{a.base}</b>
                      {a.equipped !== a.base && <span className={a.equipped > a.base ? "is-good" : "is-cost"}> → {a.equipped}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section className="it-list" aria-label={t("it.list")}>
            {v2 ? (
              // 新界面：分类、列表与“正在读”在左，详情在右（.it-detail-wrap 跟着滚动停在顶上；还没选时留着这一栏、写一句提示）；
              // 手机上详情在抽屉里（见下面），这里没有右边一栏
              <>
                <div className="it-list-main">
                  {filters}
                  {reading}
                  {list}
                </div>
                {!sheet && (
                  <div className={detail ? "it-detail-wrap" : "it-detail-wrap is-hint"} ref={detailRef}>
                    {detail || <p className="it-detail-hint">{t("v2.fleet.itemPick")}</p>}
                  </div>
                )}
              </>
            ) : (
              <>
                {filters}
                {list}
                {detail}
                {reading}
              </>
            )}
          </section>
          {/* 新界面·手机：选中的物品在底部升起的抽屉里（抓手、×、点遮罩或 Esc 收起；收起时取消选中，焦点回到点的那一行） */}
          {sheet && sel && (
            <Sheet title={sel.name} onClose={() => setSelected(null)} className="it-sheet" testId="item-sheet">
              {detail}
            </Sheet>
          )}
        </div>
      )}

      {page === "books" && (
        <section className="it-books" aria-label={t("it.page.books")}>
          <p className="it-lead">{t("it.booksLead", { n: inv.bibliography.read, kinds: inv.bibliography.categories.filter((c) => c.count > 0).length })}</p>
          <ul className="it-cats">
            {inv.bibliography.categories.map((c) => (
              <li key={c.key} className={c.count > 0 ? "has" : undefined}>
                <span>{c.name}</span>
                <b>{c.count}</b>
              </li>
            ))}
          </ul>
          {inv.bibliography.recent.length > 0 && (
            <ol className="it-recent">
              {inv.bibliography.recent.map((b) => (
                <li key={b.key}>
                  <span>{b.name}</span>
                  <small>{t("ub.dateYmd", { y: b.on[0], m: b.on[1], d: b.on[2] })}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* 新界面：一套都没有时写一句（旧界面照旧是空的列表） */}
      {page === "sets" && v2 && inv.sets.length === 0 && <EmptyState text={t("v2.fleet.setsEmpty")} />}
      {page === "sets" && !(v2 && inv.sets.length === 0) && (
        <ul className="it-sets" aria-label={t("it.page.sets")}>
          {inv.sets.map((s) => (
            <li key={s.key} className={s.done ? "it-set is-done" : "it-set"}>
              <p className="it-set-head">
                <b>{s.name}</b>
                <span>{t("it.setHave", { have: s.have, total: s.items.length })}</span>
              </p>
              <span className="it-set-bar">
                <span style={{ width: `${Math.round(setProgress(s.have, s.items.length) * 100)}%` }} />
              </span>
              <p className="it-set-bonus">{s.bonus}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
