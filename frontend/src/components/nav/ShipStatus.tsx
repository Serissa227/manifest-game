// H02 船况、口粮与船员状态（docs/VOYAGE-PLAN.md §3.6）：航行视图的状态区与常设命令面板。
// - 状态区：船体、帆缆、船底、人手（船员 / 病号）、疲劳、断鲜、船材——缺省只显示图标与数字，悬停看说明，点一下展开成带名字的一列；
//   有问题的那一项变色（注意 = 黄铜，要紧 = 红）。士气与粮水天数已在仪表上，不重复。
// - 常设命令：口粮、节奏、自动项（进风暴收半帆、海上修理、粮水提醒），设一次一直生效；改动立即提交 Voyage 命令。
// 规则关着的世界（后端不给 wear）什么也不画。
import { useState } from "react";
import { tz, type ZhOnlyKey } from "../../i18n/zhOnly";
import type { NavView, Pace, Rations, StandingOrders, WearView } from "../../ipc/types";
import { Icon } from "../panels/PanelKit";
import { gauges, promiseNote, sendJettison, sendOrders } from "./shipStatusKit";
import { useGame } from "../../store/game";

/** 航行视图的船况状态区。点一下展开带名字的一列，再点收起。 */
export function ShipStatus({ wear }: { wear: WearView }) {
  const [open, setOpen] = useState(false);
  const list = gauges(wear);
  const year = useGame((s) => s.overview?.calendar_year ?? null);
  const notes: string[] = [];
  if (wear.slowdown) notes.push(tz("wear.note.slowdown"));
  const promise = promiseNote(wear, year);
  if (promise) notes.push(promise);
  if (wear.load_slow > 0) notes.push(tz("wear.note.load", { v: wear.load_slow }));
  return (
    <div className={open ? "ship-status open" : "ship-status"} data-testid="ship-status">
      <button
        type="button"
        className="ship-status-toggle"
        aria-expanded={open}
        aria-label={tz("wear.title")}
        title={tz(open ? "wear.collapse" : "wear.expand")}
        onClick={() => setOpen(!open)}
      >
        <ul className="ship-gauges">
          {list.map((g) => (
            <li key={g.key} className={`ship-gauge ${g.level}`} title={g.tip} data-testid={`wear-${g.key}`}>
              <Icon name={g.icon} />
              {open && <span className="ship-gauge-label">{tz(`wear.label.${g.key}` as ZhOnlyKey)}</span>}
              <span className="ship-gauge-value">{g.value}</span>
            </li>
          ))}
        </ul>
      </button>
      {notes.length > 0 && (
        <p className="ship-status-note" role="status" data-testid="wear-notes">
          {notes.join(tz("wear.sep"))}
        </p>
      )}
      {open && <p className="ship-status-speed">{tz("wear.speed", { v: wear.speed_pct })}</p>}
    </div>
  );
}

const RATIONS: Rations[] = ["full", "reduced", "half"];
const PACES: Pace[] = ["easy", "normal", "hard"];
const ALERTS = [0, 3, 5, 7, 10, 15];

/** 常设命令的小菜单（与自动航行、登陆同一种弹出卡）。 */
export function OrdersMenu({ nav, onClose, id, onSent }: { nav: NavView; onClose: () => void; id?: string; onSent?: () => void }) {
  const w = nav.wear;
  if (!w) return null;
  const o: StandingOrders = { auto_reef: true, auto_repair: true, supply_alert: 7, ...w.orders };
  const send = (next: Partial<StandingOrders>) =>
    void sendOrders(nav.fleet, { ...o, ...next }).then((ok) => {
      if (ok) onSent?.();
    });
  return (
    <div className="nav-pop orders-pop" id={id} role="dialog" aria-label={tz("orders.title")} data-testid="orders-menu">
      <h4>{tz("orders.title")}</h4>
      <fieldset className="orders-row">
        <legend>{tz("orders.rations")}</legend>
        {RATIONS.map((r) => (
          <button
            key={r}
            type="button"
            className={o.rations === r ? "nav-pop-item active" : "nav-pop-item"}
            aria-pressed={o.rations === r}
            title={tz(`orders.rations.${r}.tip` as ZhOnlyKey)}
            data-testid={`orders-rations-${r}`}
            onClick={() => send({ rations: r })}
          >
            {tz(`orders.rations.${r}` as ZhOnlyKey)}
          </button>
        ))}
      </fieldset>
      <fieldset className="orders-row">
        <legend>{tz("orders.pace")}</legend>
        {PACES.map((p) => (
          <button
            key={p}
            type="button"
            className={o.pace === p ? "nav-pop-item active" : "nav-pop-item"}
            aria-pressed={o.pace === p}
            title={tz(`orders.pace.${p}.tip` as ZhOnlyKey)}
            data-testid={`orders-pace-${p}`}
            onClick={() => send({ pace: p })}
          >
            {tz(`orders.pace.${p}` as ZhOnlyKey)}
          </button>
        ))}
      </fieldset>
      <fieldset className="orders-checks">
        <legend>{tz("orders.auto")}</legend>
        <label>
          <input type="checkbox" checked={o.auto_reef !== false} data-testid="orders-auto-reef" onChange={(e) => send({ auto_reef: e.target.checked })} />
          {tz("orders.autoReef")}
        </label>
        <label>
          <input type="checkbox" checked={o.auto_repair !== false} data-testid="orders-auto-repair" onChange={(e) => send({ auto_repair: e.target.checked })} />
          {tz("orders.autoRepair", { n: w.timber })}
        </label>
        <label>
          {tz("orders.alert")}
          <select value={o.supply_alert ?? 7} data-testid="orders-alert" onChange={(e) => send({ supply_alert: Number(e.target.value) })}>
            {ALERTS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? tz("orders.alertOff") : tz("orders.alertDays", { n })}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <button type="button" className="nav-pop-close" onClick={onClose}>
        {tz("orders.close")}
      </button>
    </div>
  );
}

const SHARES = [10, 30];

/** 抛货：两档（一成 / 三成），从最不值钱的货抛起；写明约几件，点了就抛。被追时在操作栏里一眼找得到。 */
export function JettisonMenu({ nav, onClose, id, onSent }: { nav: NavView; onClose: () => void; id?: string; onSent?: () => void }) {
  const cargo = nav.wear?.cargo ?? 0;
  if (!nav.wear || cargo <= 0) return null;
  return (
    <div className="nav-pop" id={id} role="menu" aria-label={tz("wear.jettison")} data-testid="jettison-menu">
      <h4>{tz("wear.jettison")}</h4>
      <p className="nav-note">{tz("wear.jettisonHint")}</p>
      <div className="nav-pop-row">
        {SHARES.map((pct) => {
          const n = Math.ceil((cargo * pct) / 100);
          return (
            <button
              key={pct}
              type="button"
              role="menuitem"
              className="nav-pop-item"
              data-testid={`jettison-${pct}`}
              onClick={() => {
                onClose();
                void sendJettison(nav.fleet, pct).then((ok) => {
                  if (ok) {
                    useGame.getState().notify(tz("wear.jettisonDone", { n }));
                    onSent?.();
                  }
                });
              }}
            >
              <span>{tz("wear.jettisonShare", { pct })}</span>
              <small>{tz("wear.jettisonShareTip", { n })}</small>
            </button>
          );
        })}
      </div>
      <button type="button" className="nav-pop-close" onClick={onClose}>
        {tz("orders.close")}
      </button>
    </div>
  );
}
