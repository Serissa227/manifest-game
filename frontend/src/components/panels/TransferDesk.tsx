// 装卸台：同一处的两个“能放货的地方”（舰队、商队、本地仓库）之间搬货（内核命令 Transfer，逐行由内核校验：同一处、货够、放得下）。
// 与交易所的交易台同一套手感：两边并排（窄窗口上下叠放），每行直接调要搬的数量（加减可长按、Shift ×10、滚轮、拖动），
// 一键“全部 →”立即搬；调好的数量在底下合计（两边各搬几种几件、搬完后的装载），“搬运”一次搬完。
// 原来的仓库页是一个列出全部七十多种商品的下拉框 + 数量框 + “存入 / 取出”，只能在旗舰队与仓库之间搬，商队根本没有装卸的地方。
// 新界面（v2）：只有一处能放货、这里又还没有仓库时，空状态里一键“租 200 单位的仓库”（与仓库页租用那一行同一条命令 RentWarehouse）；
// 新界面里容量（租用、买下）排在装卸台下面，说明改写“在下面租一间仓库”。v1 照旧只有一句说明（“在上面租”）。
import { useState } from "react";
import { money, num, t } from "../../i18n";
import type { CargoLine, PortView } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { Select } from "../common";
import { EmptyState } from "../feedback";
import { GoodIcon } from "./MarketRows";
import { useFlash } from "./tradeHooks";
import { LoadBar, QtyStepper } from "./tradeKit";
import { fitMoves, holderOptions, loadOf, moveKey as key, type HolderOpt, type Load, type MoveDir as Dir, type Moves } from "./trade";

interface SideProps {
  dir: Dir;
  holder: HolderOpt;
  options: HolderOpt[];
  onPick: (value: string) => void;
  load: Load;
  /** 搬完后这边的装载 */
  after: number;
  /** 对面的名字与空位（这边往对面搬最多能放多少） */
  other: HolderOpt;
  room: number;
  moves: Moves;
  busy: boolean;
  flash: Record<number, number>;
  setQty: (good: number, n: number) => void;
  onAll: (line: CargoLine) => void;
  label: string;
}

function Side({ dir, holder, options, onPick, load, after, other, room, moves, busy, flash, setQty, onAll, label }: SideProps) {
  const statics = useGame((s) => s.statics);
  const lines = load.cargo.filter((c) => c.qty > 0);
  const staged = (g: number) => moves[key(dir, g)] ?? 0;
  const othersStaged = (g: number) => lines.reduce((a, c) => (c.good === g ? a : a + staged(c.good)), 0);
  const arrow = dir === "lr" ? "→" : "←";
  return (
    <section className="tr-side" data-testid={`tr-side-${dir}`}>
      <header className="tr-head">
        <Select label={label} value={holder.value} options={options.map((o) => ({ value: o.value, label: o.label }))} onChange={onPick} />
        <span className="tr-load">
          {t("mk.load", { used: num(load.used), capacity: num(load.capacity) })}
          {after !== load.used && <span className={after > load.capacity ? "tr-after bad" : "tr-after"}> → {num(after)}</span>}
        </span>
        <LoadBar used={load.used} capacity={load.capacity} after={after} />
      </header>
      {lines.length === 0 ? (
        <p className="empty tr-empty">{t("tr.empty")}</p>
      ) : (
        <ul className="tr-list">
          {lines.map((c) => {
            const g = statics?.goods[c.good];
            const name = g?.name ?? String(c.good);
            const max = Math.max(0, Math.min(c.qty, room - othersStaged(c.good)));
            const n = staged(c.good);
            const f = flash[c.good];
            return (
              <li
                key={c.good}
                className={["tr-row", n > 0 ? "staged" : "", f ? `mk-flash mk-flash-${f % 2}` : ""].filter(Boolean).join(" ")}
                data-testid={`tr-${dir}-${c.good}`}
              >
                <span className="tr-good">
                  <GoodIcon good={g} />
                  <span className="tr-name">{name}</span>
                  <span className="tr-qty">×{num(c.qty)}</span>
                </span>
                <QtyStepper
                  value={Math.max(n, 0)}
                  max={Math.max(max, n)}
                  onChange={(v) => setQty(c.good, v)}
                  label={t("tr.qtyTo", { good: name, holder: other.label })}
                  decLabel={t("tr.dec")}
                  incLabel={t("tr.inc")}
                  disabled={busy}
                  testId={`tr-step-${dir}-${c.good}`}
                />
                <button
                  type="button"
                  className="btn small tr-all"
                  disabled={busy || room <= 0}
                  aria-label={t("tr.allTo", { good: name, holder: other.label })}
                  title={room <= 0 ? t("tr.noRoom", { holder: other.label }) : t("tr.allTo", { good: name, holder: other.label })}
                  onClick={() => onAll(c)}
                >
                  {dir === "lr" ? `${t("mk.all")} ${arrow}` : `${arrow} ${t("mk.all")}`}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 空状态里一键租用的仓库容量（与 WarehouseTab 租用那一行的缺省值相同）。 */
const RENT_DEFAULT = 200;

export default function TransferDesk({ port }: { port: PortView }) {
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "caravans");
  const statics = useGame((s) => s.statics);
  const holders = holderOptions(port);
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [raw, setRaw] = useState<Moves>({});
  const [busy, setBusy] = useState(false);
  const [flash, fireFlash] = useFlash();
  if (holders.length < 2) {
    const v1 = (
      <p className="sub tr-need" data-testid="tr-need">
        {t("tr.needTwo")}
      </p>
    );
    // 还没有仓库、又有船队或商队在这里：一键租一间（容量与仓库页租用那一行的缺省值相同）
    const rent = port.warehouse.capacity === 0 && holders.length === 1 && statics ? RENT_DEFAULT : 0;
    const perDay = statics ? Math.floor((rent * statics.rules.warehouse_rent_per_100) / 100) : 0;
    return (
      <EmptyState
        className="tr-need"
        text={t("v2.port.trNeedTwo")}
        action={
          rent > 0
            ? {
                label: t("v2.port.trRent", { n: num(rent), v: money(perDay) }),
                onClick: () => void useGame.getState().submit({ RentWarehouse: { owner: "player", loc: port.loc, capacity: rent } }),
              }
            : undefined
        }
        v1={v1}
      />
    );
  }
  const left = holders.find((h) => h.value === leftKey) ?? holders[0];
  const right =
    holders.find((h) => h.value === rightKey && h.value !== left.value) ??
    holders.find((h) => h.value !== left.value && "Warehouse" in h.holder) ??
    holders.find((h) => h.value !== left.value) ??
    holders[1];
  const a = loadOf(overview, port, left.holder);
  const b = loadOf(overview, port, right.holder);
  const moves = fitMoves(raw, a, b);
  const sum = (dir: Dir) =>
    Object.entries(moves)
      .filter(([k]) => k.startsWith(`${dir}:`))
      .reduce((acc, [, n]) => ({ kinds: acc.kinds + 1, qty: acc.qty + n }), { kinds: 0, qty: 0 });
  const lr = sum("lr");
  const rl = sum("rl");
  const total = lr.kinds + rl.kinds;
  const roomA = Math.max(0, a.capacity - a.used);
  const roomB = Math.max(0, b.capacity - b.used);
  const goodName = (g: number) => statics?.goods[g]?.name ?? String(g);

  const setQty = (dir: Dir, good: number, n: number) => setRaw((m) => ({ ...fitMoves(m, a, b), [key(dir, good)]: Math.max(0, n) }));
  const pick = (side: "left" | "right", value: string) => {
    setRaw({});
    if (side === "left") {
      // 选成了右边那一个：两边对调
      if (value === right.value) setRightKey(left.value);
      setLeftKey(value);
    } else {
      if (value === left.value) setLeftKey(right.value);
      setRightKey(value);
    }
  };
  const swap = () => {
    setRaw({});
    setLeftKey(right.value);
    setRightKey(left.value);
  };

  const move = async (dir: Dir, good: number, qty: number) => {
    const [from, to] = dir === "lr" ? [left.holder, right.holder] : [right.holder, left.holder];
    const r = await useGame.getState().submit({ Transfer: { owner: "player", from, to, good, qty } });
    if (r) fireFlash([good]);
    return !!r;
  };
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const moveAll = (dir: Dir, line: CargoLine) =>
    run(async () => {
      const room = dir === "lr" ? roomB : roomA;
      const n = Math.min(line.qty, room);
      if (n <= 0) return;
      if (await move(dir, line.good, n)) {
        setRaw((m) => {
          const next = { ...m };
          delete next[key(dir, line.good)];
          return next;
        });
        useGame.getState().notify(t("tr.movedOne", { good: goodName(line.good), qty: num(n), holder: (dir === "lr" ? right : left).label }));
      }
    });
  const go = () =>
    run(async () => {
      let kinds = 0;
      let qty = 0;
      const left_: Record<string, number> = {};
      // 两个方向各自放得下（整理时按各自的空位算），先后无妨
      for (const [k, n] of Object.entries(moves)) {
        const [dir, g] = k.split(":");
        if (await move(dir as Dir, Number(g), n)) {
          kinds += 1;
          qty += n;
        } else {
          left_[k] = n;
        }
      }
      setRaw(left_);
      if (kinds > 0) useGame.getState().notify(t("tr.done", { n: kinds, qty: num(qty) }));
    });

  const sideProps = { options: holders, busy, flash };
  return (
    <div className="tr-desk" data-testid="transfer-desk">
      <div className="tr-sides">
        <Side
          {...sideProps}
          dir="lr"
          holder={left}
          onPick={(v) => pick("left", v)}
          load={a}
          after={a.used - lr.qty + rl.qty}
          other={right}
          room={roomB}
          moves={moves}
          setQty={(g, n) => setQty("lr", g, n)}
          onAll={(c) => void moveAll("lr", c)}
          label={t("tr.sideA")}
        />
        <button type="button" className="btn tr-swap" onClick={swap} disabled={busy} aria-label={t("tr.swap")} title={t("tr.swap")}>
          ⇄
        </button>
        <Side
          {...sideProps}
          dir="rl"
          holder={right}
          onPick={(v) => pick("right", v)}
          load={b}
          after={b.used - rl.qty + lr.qty}
          other={left}
          room={roomA}
          moves={moves}
          setQty={(g, n) => setQty("rl", g, n)}
          onAll={(c) => void moveAll("rl", c)}
          label={t("tr.sideB")}
        />
      </div>
      {total > 0 && (
        <div className="tr-foot" data-testid="tr-foot">
          <span className="tr-sum">
            {lr.kinds > 0 && <span>{t("tr.sumTo", { holder: right.label, n: lr.kinds, qty: num(lr.qty) })}</span>}
            {rl.kinds > 0 && <span>{t("tr.sumTo", { holder: left.label, n: rl.kinds, qty: num(rl.qty) })}</span>}
          </span>
          <button type="button" className="btn" disabled={busy} onClick={() => setRaw({})}>
            {t("mk.clear")}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void go()} data-testid="tr-go">
            {busy ? t("tr.going") : t("tr.go", { n: total })}
          </button>
        </div>
      )}
    </div>
  );
}
