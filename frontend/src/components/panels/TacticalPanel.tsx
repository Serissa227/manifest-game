import { useId, useState } from "react";
import { drawSeaTile, drawWindRose } from "../../art/extras";
import { useBattleSfx } from "../../audio/sfx";
import { toDataURL } from "../../art/render";
import { shipArtKey } from "../../art/ships";
import { Sprite } from "../../art/Sprite";
import { useView } from "../../hooks/useView";
import { t, tk } from "../../i18n";
import { api } from "../../ipc/api";
import type { StaticView, TacticalEvent, TacticalOrder, Unit } from "../../ipc/types";
import { useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { ActionButton } from "../common";
import { EmptyState } from "../feedback";
import { closeWindow } from "../shell/shellState";
import { Bar, Icon } from "./PanelKit";
import { fleetFlag, shipPx, type ShipLook } from "./panelArt";

const SIZE = 22;
const SQRT3 = Math.sqrt(3);
// 六角方向（轴坐标）在屏幕上的单位向量：0 东、1 东北、2 西北、3 西、4 西南、5 东南
const DIR_VEC: [number, number][] = [
  [1, 0],
  [0.5, -0.866],
  [-0.5, -0.866],
  [-1, 0],
  [-0.5, 0.866],
  [0.5, 0.866],
];
/** 转向按钮上的箭头（装饰，对辅助技术隐藏）。 */
const DIR_GLYPH = ["→", "↗", "↖", "←", "↙", "↘"];
/** 船图在棋盘上的放大倍数（棋盘坐标单位）。 */
const SHIP_SCALE = 1.75;

function pixel(q: number, r: number): [number, number] {
  return [SIZE * SQRT3 * (q + r / 2), SIZE * 1.5 * r];
}

function hexPoints(q: number, r: number): string {
  const [cx, cy] = pixel(q, r);
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + SIZE * Math.cos(a)).toFixed(1)},${(cy + SIZE * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function board(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q) + Math.abs(r) + Math.abs(q + r) <= 2 * radius) out.push([q, r]);
    }
  }
  return out;
}

function eventText(e: TacticalEvent): string {
  if (typeof e === "string") return tk(`tev.${e}`);
  if ("Fire" in e) return tk("tev.Fire", e.Fire);
  if ("Sunk" in e) return tk("tev.Sunk", e.Sunk);
  return tk("tev.Board", {
    from: e.Board.from,
    to: e.Board.to,
    result: e.Board.captured ? t("tevCaptured") : t("tevRepelled"),
  });
}

/** 单位的船图外观：我方挂舰队的旗，海盗是黑帆；耐久不足一半时画成受损。 */
function unitLook(statics: StaticView, u: Unit, flag: string): ShipLook {
  return {
    kind: u.kind,
    key: shipArtKey(statics.ships, u.kind),
    sail: statics.ships[u.kind]?.sail ?? "square",
    flag: u.player ? flag : undefined,
    pirate: !u.player,
    damaged: u.hp * 2 < u.max_hp,
  };
}

/** 战术海战：六角格回合制。点击高亮格移动，点击射程内的敌船开火，相邻可接舷。 */
export default function TacticalPanel() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "tactical_battles");
  const submit = useGame((s) => s.submit);
  const id = overview?.tactical_battles[0] ?? null;
  const { data, reload } = useView(id === null ? null : `battle:${id}`, () => api.battle(id ?? 0));
  const [selected, setSelected] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const v2 = useIsV2();
  // 音效：战报里新出现的开炮、命中、落空、击沉、接舷
  useBattleSfx(data?.battle ?? null);
  if (!statics || id === null)
    // 没有进行中的海战（打完了窗口还开着）：新界面给一个下一步“回到航海图”；旧界面照旧只有一行字
    return (
      <EmptyState
        text={t("btNone")}
        hint={t("v2.dialogs.tactical.noneHint")}
        action={{
          label: t("v2.dialogs.tactical.toChart"),
          onClick: () => {
            useGame.getState().setStage("chart");
            closeWindow();
          },
        }}
      />
    );
  if (!data) return null;
  const b = data.battle;
  const opts = data.options.find((o) => o.unit === selected) ?? data.options[0];
  const unitId = opts?.unit ?? null;
  const order = async (o: TacticalOrder) => {
    await submit({ TacticalCommand: { owner: "player", battle: id, order: o } });
    reload();
  };
  const name = (u: Unit) => `#${u.id} ${statics.ships[u.kind]?.name ?? ""}`;
  const moves = new Map((opts?.moves ?? []).map(([q, r, c]) => [`${q},${r}`, c]));
  const wind = b.wind % 6;
  const [wx, wy] = DIR_VEC[wind];
  // 棋盘是横向的六边形：宽、高分别留出半格边距
  const halfW = SIZE * SQRT3 * (b.radius + 0.5) + 10;
  const halfH = SIZE * (1.5 * b.radius + 1) + 10;
  const myFleet = overview?.fleets.find((f) => f.id === b.fleet);
  const flag = myFleet ? fleetFlag(statics, myFleet) : (statics.factions[0]?.color ?? "#c8373a");
  // 像素贴图（没有画布的环境里为 null，退回纯色）
  const seaUrl = toDataURL(drawSeaTile(0), "pn-seatile-0");
  const roseUrl = toDataURL(drawWindRose(wind), `pn-windrose-${wind}`);
  const seaFill = seaUrl ? `url(#${uid}-sea)` : undefined;
  // 选中船的命令（转向、接舷、开火）与回合的命令（撤退、结束回合）：两种界面一样，新界面多包一层命令台（见下）
  const orders = unitId !== null && opts && (
    <div className="row pn-orders">
      <span className="pn-orders-label">{t("btFacing")}</span>
      {[0, 1, 2, 3, 4, 5].map((f) => (
        <button key={f} className="btn pn-facing" onClick={() => void order({ Turn: { unit: unitId, facing: f } })}>
          <span aria-hidden="true" className="pn-glyph">
            {DIR_GLYPH[f]}
          </span>
          {tk(`facing.${f}`)}
        </button>
      ))}
      {opts.board.map((target) => (
        <ActionButton key={target} onClick={() => order({ Board: { unit: unitId, target } })}>
          {t("btBoard")} #{target}
        </ActionButton>
      ))}
      {opts.fire.map((target) => (
        <ActionButton key={target} onClick={() => order({ Fire: { unit: unitId, target } })}>
          {t("btFire")} #{target}
        </ActionButton>
      ))}
    </div>
  );
  const endTurn = (
    <div className="row">
      <ActionButton kind="danger" onClick={() => order("Retreat")}>
        {t("btRetreat")}
      </ActionButton>
      <ActionButton kind="primary" onClick={() => order("EndTurn")}>
        {t("btEndTurn")}
      </ActionButton>
    </div>
  );
  return (
    <div data-testid="tactical-panel" className="pn pn-tactical">
      <p className="pn-battle-head">
        <Icon name="battle" />
        {t("btTurn", { turn: b.turn, max: data.max_turns })} · {t("labelValue", { label: t("btWind"), value: tk(`facing.${wind}`) })}
        <Icon name="wind" className="pn-wind-icon" />
      </p>
      <p className="sub">{t("btHelp", { range: data.gun_range })}</p>
      <div className="pn-hexframe">
        <svg
          className="hexmap pn-hexmap"
          viewBox={`${-halfW} ${-halfH} ${halfW * 2} ${halfH * 2}`}
          width="100%"
          style={{ maxHeight: 460 }}
          role="img"
          aria-label={t("tab.battle")}
        >
          {seaUrl && (
            <defs>
              <pattern id={`${uid}-sea`} patternUnits="userSpaceOnUse" width={32} height={32}>
                <image href={seaUrl} width={32} height={32} className="pn-px" />
              </pattern>
            </defs>
          )}
          {board(b.radius).map(([q, r]) => {
            const cost = moves.get(`${q},${r}`);
            return (
              <g key={`${q},${r}`}>
                <polygon points={hexPoints(q, r)} className="hex" style={seaFill ? { fill: seaFill } : undefined} />
                {cost !== undefined && (
                  <polygon
                    points={hexPoints(q, r)}
                    className="hex reach"
                    data-testid={`hex-${q}-${r}`}
                    onClick={() => {
                      if (unitId !== null) void order({ Move: { unit: unitId, q, r } });
                    }}
                  />
                )}
              </g>
            );
          })}
          {roseUrl ? (
            <image
              href={roseUrl}
              x={-halfW + 2}
              y={-halfH + 2}
              width={40}
              height={40}
              className="pn-px"
              aria-hidden="true"
            />
          ) : (
            <line
              x1={-halfW + 22}
              y1={-halfH + 22}
              x2={-halfW + 22 + wx * 20}
              y2={-halfH + 22 + wy * 20}
              className="wind"
            />
          )}
          {b.units
            .filter((u) => u.status === "Active")
            .map((u) => {
              const [cx, cy] = pixel(u.q, u.r);
              const [fx, fy] = DIR_VEC[u.facing % 6];
              const firable = !u.player && opts?.fire.includes(u.id);
              const ship = shipPx(unitLook(statics, u, flag), "small");
              const url = toDataURL(ship, `pn-unit-${u.kind}-${u.player ? flag : "pirate"}-${u.hp * 2 < u.max_hp ? 1 : 0}`);
              const w = ship.w * SHIP_SCALE;
              const h = ship.h * SHIP_SCALE;
              // 船头朝西（西北、西、西南）时水平翻转
              const west = fx < 0;
              const hpRatio = u.max_hp > 0 ? Math.max(0, u.hp / u.max_hp) : 0;
              // 船头方向的小三角
              const tip: [number, number] = [fx * SIZE * 0.95, fy * SIZE * 0.95];
              const side: [number, number] = [-fy * 5, fx * 5];
              const base: [number, number] = [fx * SIZE * 0.6, fy * SIZE * 0.6];
              return (
                <g
                  key={u.id}
                  data-testid={`unit-${u.id}`}
                  transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)})`}
                  className={
                    u.player
                      ? u.id === unitId
                        ? "unit mine selected"
                        : "unit mine"
                      : firable
                        ? "unit enemy target"
                        : "unit enemy"
                  }
                  onClick={() => {
                    if (u.player) setSelected(u.id);
                    else if (firable && unitId !== null) void order({ Fire: { unit: unitId, target: u.id } });
                  }}
                >
                  <ellipse className="pn-unit-ring" cx={0} cy={4} rx={SIZE * 0.72} ry={SIZE * 0.42} />
                  <polygon
                    className="pn-unit-bow"
                    points={`${tip[0].toFixed(1)},${tip[1].toFixed(1)} ${(base[0] + side[0]).toFixed(1)},${(base[1] + side[1]).toFixed(1)} ${(base[0] - side[0]).toFixed(1)},${(base[1] - side[1]).toFixed(1)}`}
                  />
                  {url ? (
                    <image
                      href={url}
                      x={-w / 2}
                      y={6 - h}
                      width={w}
                      height={h}
                      className="pn-px"
                      transform={west ? "scale(-1 1)" : undefined}
                    />
                  ) : (
                    <>
                      <circle r={SIZE * 0.55} />
                      <line x1={0} y1={0} x2={fx * SIZE * 0.9} y2={fy * SIZE * 0.9} />
                    </>
                  )}
                  <rect className="pn-unit-hp-bg" x={-12} y={9} width={24} height={4} />
                  <rect
                    className={hpRatio > 0.6 ? "pn-unit-hp ok" : hpRatio > 0.3 ? "pn-unit-hp warn" : "pn-unit-hp bad"}
                    x={-11.5}
                    y={9.5}
                    width={Math.max(0, 23 * hpRatio)}
                    height={3}
                  />
                  <text x={SIZE * 0.62} y={-6} textAnchor="middle" className="pn-unit-id">
                    {u.id}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
      {v2 && (
        // 新界面：棋盘下的图例——黄铜框的格子能去、红色虚线圈的敌船能打、白色虚线圈是正在指挥的船
        <ul className="bt-legend" aria-label={t("v2.dialogs.tactical.legend")}>
          <li>
            <span className="bt-swatch is-move" aria-hidden="true" />
            {t("v2.dialogs.tactical.legendMove")}
          </li>
          <li>
            <span className="bt-swatch is-target" aria-hidden="true" />
            {t("v2.dialogs.tactical.legendTarget")}
          </li>
          <li>
            <span className="bt-swatch is-selected" aria-hidden="true" />
            {t("v2.dialogs.tactical.legendSelected")}
          </li>
        </ul>
      )}
      <div className="units pn-units">
        {b.units.map((u) => (
          <div key={u.id} className={`${u.player ? "mine" : "enemy"} pn-unit-row ${u.status === "Active" ? "" : "gone"}`}>
            <span className="pn-unit-art">
              <Sprite px={shipPx(unitLook(statics, u, flag), "small")} scale={1} />
            </span>
            {u.player ? t("btMine") : t("btEnemy")} ·{" "}
            {u.status === "Active"
              ? t("btUnit", { name: name(u), hp: u.hp, max: u.max_hp, crew: u.crew, guns: u.guns, mp: u.mp_left })
              : u.status === "Sunk"
                ? t("btUnitSunk", { name: name(u) })
                : t("btUnitCaptured", { name: name(u) })}
            {u.status === "Active" && <Bar value={u.hp} max={u.max_hp} tone="hp" />}
          </div>
        ))}
      </div>
      {v2 ? (
        // 新界面：命令与“结束回合”收进一个贴在窗口下沿的命令台（手机上在拇指够得到的地方），棋盘与战报在它后面滚动
        <div className="bt-dock" data-testid="tactical-dock">
          {orders}
          {endTurn}
        </div>
      ) : (
        <>
          {orders}
          {endTurn}
        </>
      )}
      <ol className="log pn-battle-log">
        {[...b.log].reverse().map(([turn, e], i) => (
          <li key={i}>
            <small>{t("btTurn", { turn, max: data.max_turns })}</small> {eventText(e)}
          </li>
        ))}
      </ol>
    </div>
  );
}
