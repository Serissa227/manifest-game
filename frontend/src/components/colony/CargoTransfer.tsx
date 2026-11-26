// 殖民地装卸：舰队停在自己的殖民地时，在船舱与殖民地仓库（Holder 为 { Warehouse: 殖民点 }）之间搬货。
// 每行一种商品：数量输入 + “全部 / 一半”快捷键 + 卸货或装船按钮；数量默认取“能搬的全部”。
// 新界面（v2）：卸货 / 装船按钮上写明这一下搬多少（“卸货 60”），一次点击做什么一目了然；
// 搬不了时按钮写明原因（aria-describedby 指过去）：对面满了，按钮只写动作，原因在这一栏的标题下写一次（每行都一样，不逐行重复）；
// 数量超出空位或存货、填了 0，原因写在这一行里，并给“改成 N”。
import { useId, useState, type ReactNode } from "react";
import { t } from "../../i18n";
import type { CargoLine, Holder } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton, NumInput, Select } from "../common";
import { EmptyState, InlineError } from "../feedback";
import { closeWindow } from "../shell/shellState";
import { GoodChip, Meter } from "./bits";

/** 装卸用到的殖民地字段（ColonyView 的子集）。 */
export interface CargoColony {
  loc: number;
  /** 殖民地人口（有值时显示“带殖民者上船”） */
  population?: number;
  stock: CargoLine[];
  capacity: number;
  used: number;
  fleets_here: number[];
}

/**
 * 船员不足时从自己的殖民地带殖民者上船（内核的 HireCrew 在自己的殖民地从殖民者中招人，按招募费计价，至少留 1 人）。
 * 默认补到最低船员；不需要补时显示当前人手。
 */
function CrewFromColony({
  fleetId,
  crew,
  crewMin,
  crewMax,
  population,
}: {
  fleetId: number;
  crew: number;
  crewMin: number;
  crewMax: number;
  population: number;
}) {
  const submit = useGame((s) => s.submit);
  const most = Math.max(0, Math.min(crewMax - crew, population - 1));
  const [count, setCount] = useState<number | null>(null);
  const n = Math.max(0, Math.min(most, count ?? Math.max(crewMin - crew, 0)));
  return (
    <div className="colony-crew" data-testid="colony-crew">
      <p className="sub">
        {t("colony.crewLine", { id: fleetId, crew, min: crewMin, max: crewMax, pop: population })}
        {crew < crewMin && <strong className="warn"> {t("colony.crewShort")}</strong>}
      </p>
      {most > 0 && (
        <div className="row">
          <NumInput label={t("colony.takeAboardCount")} value={n} min={0} max={most} onChange={setCount} />
          <ActionButton
            disabled={n <= 0}
            onClick={() => submit({ HireCrew: { owner: "player", fleet: fleetId, count: n } })}
          >
            {t("colony.takeAboard", { n })}
          </ActionButton>
          <span className="hint">{t("colony.takeAboardHint")}</span>
        </div>
      )}
    </div>
  );
}

export function CargoTransfer({ colony }: { colony: CargoColony }) {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets");
  const submit = useGame((s) => s.submit);
  const [picked, setPicked] = useState<number | null>(null);
  if (!statics || !overview) return null;
  const fleets = overview.fleets.filter((f) => colony.fleets_here.includes(f.id));
  const fleet = fleets.find((f) => f.id === picked) ?? fleets[0];
  // 新界面：“下一步”打开航海图（把船开过来）；旧界面照旧一行字
  if (!fleet)
    return (
      <EmptyState
        className="is-compact"
        text={t("colony.cargoNoFleet")}
        action={{
          label: t("v2.business.ex.emptyAction"),
          onClick: () => {
            useGame.getState().setStage("chart");
            closeWindow();
          },
        }}
      />
    );
  const colonyRoom = Math.max(0, colony.capacity - colony.used);
  const shipRoom = Math.max(0, fleet.capacity - fleet.used);
  const move = (from: Holder, to: Holder) => (good: number, qty: number) =>
    submit({ Transfer: { owner: "player", from, to, good, qty } });
  return (
    <div className="colony-cargo" data-testid="colony-cargo">
      {colony.population !== undefined && (
        <CrewFromColony fleetId={fleet.id} crew={fleet.crew} crewMin={fleet.crew_min} crewMax={fleet.crew_max} population={colony.population} />
      )}
      {fleets.length > 1 && (
        <Select
          label={t("colony.cargoFleet")}
          value={fleet.id}
          options={fleets.map((f) => ({ value: f.id, label: t("holder.fleet", { id: f.id }) }))}
          onChange={setPicked}
        />
      )}
      <div className="colony-cargo-cols">
        <CargoColumn
          title={t("colony.cargoShip")}
          sub={t("holder.fleet", { id: fleet.id })}
          used={fleet.used}
          capacity={fleet.capacity}
          lines={fleet.cargo}
          room={colonyRoom}
          dest="colony"
          verb={t("colony.unload")}
          empty={t("colony.shipEmpty")}
          testPrefix="unload"
          onMove={move({ Fleet: fleet.id }, { Warehouse: colony.loc })}
        />
        <CargoColumn
          title={t("colony.cargoColony")}
          used={colony.used}
          capacity={colony.capacity}
          lines={colony.stock}
          room={shipRoom}
          dest="hold"
          verb={t("colony.load")}
          empty={t("colony.stockEmpty")}
          testPrefix="load"
          onMove={move({ Warehouse: colony.loc }, { Fleet: fleet.id })}
        />
      </div>
    </div>
  );
}

/** 卸货 / 装船（v2）：同 ActionButton 一样点了等办完、期间不可用，另外能用 aria-describedby 指向这一行写的原因。 */
function MoveButton({
  disabled,
  describedBy,
  onClick,
  children,
}: {
  disabled: boolean;
  describedBy?: string;
  onClick: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn primary"
      disabled={disabled || busy}
      aria-describedby={describedBy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

/** v2：这一行现在搬不了的原因（没有就是 null）；能改成可以搬的数量时给出那个数。对面满了不在这里（整栏写一次）。 */
function moveBlock(dest: "hold" | "colony", have: number, room: number, value: number): { reason: string; fixTo: number } | null {
  const most = Math.min(have, room);
  if (value <= 0) return { reason: t("v2.business.col.qtyMin"), fixTo: most };
  if (value > have && have <= room) return { reason: t("v2.business.col.onlyHave", { n: have }), fixTo: most };
  if (value > room) return { reason: t(dest === "hold" ? "v2.business.col.holdLeft" : "v2.business.col.colonyLeft", { n: room }), fixTo: most };
  return null;
}

/** 一侧的货物：每种商品一行。标题栏显示这一侧的仓位与空位；room 是对面的空位（搬过去最多能放多少），dest 是对面是什么（写原因用）。 */
function CargoColumn({
  title,
  sub,
  used,
  capacity,
  lines,
  room,
  dest,
  verb,
  empty,
  testPrefix,
  onMove,
}: {
  title: string;
  sub?: string;
  used: number;
  capacity: number;
  lines: CargoLine[];
  room: number;
  dest: "hold" | "colony";
  verb: string;
  empty: string;
  testPrefix: string;
  onMove: (good: number, qty: number) => Promise<unknown>;
}) {
  const statics = useGame((s) => s.statics);
  const v2 = useIsV2();
  const whyId = useId();
  // 用户改过的数量；没改过的按“能搬的全部”
  const [qty, setQty] = useState<Record<number, number>>({});
  if (!statics) return null;
  const items = lines.filter((l) => l.qty > 0);
  // v2：对面满了——每一行都搬不了，原因在标题下写一次，每个按钮都指向它
  const full = v2 && room <= 0 && items.length > 0;
  const fullId = `${whyId}-full`;
  return (
    <section className="colony-cargo-col">
      <header className="colony-cargo-head">
        <strong>{title}</strong>
        {sub && <small>{sub}</small>}
        <span className="colony-cargo-cap">
          {t("colony.capacity", { used, capacity })}
          <Meter value={used} max={capacity} tone="cargo" warn={capacity > 0 && used >= capacity} />
        </span>
        <small>{t("colony.cargoRoom", { n: Math.max(0, capacity - used) })}</small>
      </header>
      {full && (
        <InlineError
          tone="blocked"
          compact
          id={fullId}
          className="colony-cargo-full"
          reason={t(dest === "hold" ? "v2.business.col.holdFull" : "v2.business.col.colonyFull")}
        />
      )}
      {items.length === 0 ? (
        <EmptyState className="is-compact" text={empty} />
      ) : (
        <ul className="colony-cargo-list">
          {items.map((l) => {
            const most = Math.min(l.qty, room);
            const value = qty[l.good] ?? most;
            const set = (v: number) => setQty((m) => ({ ...m, [l.good]: v }));
            const name = statics.goods[l.good]?.name ?? String(l.good);
            const doMove = async () => {
              const r = await onMove(l.good, value);
              if (r) setQty((m) => Object.fromEntries(Object.entries(m).filter(([k]) => Number(k) !== l.good)));
            };
            const block = v2 && !full ? moveBlock(dest, l.qty, room, value) : null;
            const rowWhy = `${whyId}-${l.good}`;
            return (
              <li key={l.good} className="colony-cargo-row" data-testid={`${testPrefix}-${l.good}`}>
                <GoodChip statics={statics} good={l.good}>
                  {t("colony.times", { n: l.qty })}
                </GoodChip>
                <NumInput label={t("colony.qtyOf", { name })} value={value} min={1} max={l.qty} onChange={set} />
                <button type="button" className="btn colony-quick" disabled={most <= 0} onClick={() => set(most)}>
                  {t("colony.all")}
                </button>
                <button
                  type="button"
                  className="btn colony-quick"
                  disabled={most <= 0}
                  onClick={() => set(Math.max(1, Math.min(most, Math.floor(l.qty / 2))))}
                >
                  {t("colony.half")}
                </button>
                {v2 ? (
                  <MoveButton disabled={full || block !== null} describedBy={full ? fullId : block ? rowWhy : undefined} onClick={doMove}>
                    {/* 满了或数量不到 1 时只写动作（不出现“装船 0”）；超出时照写填的数，原因在下面 */}
                    {room <= 0 || value <= 0 ? verb : t("v2.business.col.moveN", { verb, n: value })}
                  </MoveButton>
                ) : (
                  <ActionButton kind="primary" disabled={value <= 0 || value > l.qty || value > room} onClick={doMove}>
                    {verb}
                  </ActionButton>
                )}
                {block && (
                  <InlineError
                    tone="blocked"
                    compact
                    id={rowWhy}
                    reason={block.reason}
                    action={block.fixTo > 0 ? { label: t("v2.business.col.fixTo", { n: block.fixTo }), onClick: () => set(block.fixTo) } : undefined}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

