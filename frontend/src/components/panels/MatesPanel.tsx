import type { IconName } from "../../art/icons";
import { mateAssetId } from "../../art/portraitCast";
import { mateLook } from "../../art/portraits";
import { useView } from "../../hooks/useView";
import { money, num, t, tk } from "../../i18n";
import { tz } from "../../i18n/zhOnly";
import { api } from "../../ipc/api";
import { locById } from "../../ipc/byId";
import type { MateRole, MateView, RoleDefView, RoleView } from "../../ipc/types";
import { geniusLine } from "../../forecast/labels";
import { useGame, useOverviewFields } from "../../store/game";
import { useIsV2 } from "../../ui/uiMode";
import { BiName } from "../BiName";
import { ActionButton, Select } from "../common";
import { EmptyState, InlineError, useConfirm } from "../feedback";
import { goFacility } from "./goFacility";
import { abilityName, assignedKey, assignedLabel, assignedOptions, assignedRole, extraAbilities, scopeIcon, worldRoles } from "./mateRoles";
import { Bar, Icon, PnSection, Portrait, type BarTone } from "./PanelKit";

/** 任命的编码：界面下拉框的取值 ⇄ 内核的 MateRole（世界岗位见 mateRoles.ts）。 */
function roleKey(r: RoleView): string {
  if (r.kind === "assigned") return assignedKey(r);
  return r.target === null ? r.kind : `${r.kind}:${r.target}`;
}

function toRole(key: string): MateRole {
  const assigned = assignedRole(key);
  if (assigned) return assigned;
  const [kind, target] = key.split(":");
  const id = Number(target);
  switch (kind) {
    case "captain":
      return { Captain: id };
    case "caravan":
      return { CaravanLeader: id };
    case "industry":
      return { IndustryManager: id };
    case "accountant":
      return "Accountant";
    case "trader":
      return "Trader";
    default:
      return "None";
  }
}

function roleLabel(r: RoleView, roles: readonly RoleDefView[] | null): string {
  if (r.kind === "assigned") return assignedLabel(r, roles);
  return tk(`role.${r.kind}`, { target: r.target ?? "" });
}

/** 职务徽记的图标（世界岗位按作用对象）。 */
const ROLE_ICON: Record<Exclude<RoleView["kind"], "assigned">, IconName> = {
  none: "anchor",
  captain: "fleet",
  accountant: "report",
  trader: "market",
  caravan: "caravan",
  industry: "industry",
};

function roleIcon(r: RoleView): IconName {
  return r.kind === "assigned" ? scopeIcon(r.scope) : (ROLE_ICON[r.kind] ?? "anchor");
}

const ABILITIES: { key: "navigation" | "trade" | "combat" | "management"; label: "pnAbilityNav" | "pnAbilityTrade" | "pnAbilityCombat" | "pnAbilityMgmt"; tone: BarTone }[] = [
  { key: "navigation", label: "pnAbilityNav", tone: "nav" },
  { key: "trade", label: "pnAbilityTrade", tone: "trade" },
  { key: "combat", label: "pnAbilityCombat", tone: "combat" },
  { key: "management", label: "pnAbilityMgmt", tone: "mgmt" },
];

/** 四项能力条（数值 0–100）；第九批的世界追加的能力（如“观星”）接在后面，名字按能力表或属性名。 */
function Abilities({ m }: { m: MateView }) {
  const statics = useGame((s) => s.statics);
  const extra = extraAbilities(m.abilities);
  return (
    <div className="pn-abilities" title={t("mtAbilities", { nav: m.navigation, trade: m.trade, combat: m.combat, mgmt: m.management })}>
      {ABILITIES.map((a) => (
        <div key={a.key} className="pn-ability">
          <span className="pn-ability-label">{t(a.label)}</span>
          <Bar value={m[a.key]} max={100} tone={a.tone} />
          <span className="pn-ability-v">{m[a.key]}</span>
        </div>
      ))}
      {extra.map(([key, v]) => {
        const name = abilityName(statics, key);
        return (
          <div key={key} className="pn-ability is-extra" data-ability={key} title={t("cap.card.attr", { name, value: v })}>
            <span className="pn-ability-label">{name}</span>
            <Bar value={v} max={100} tone="nav" />
            <span className="pn-ability-v">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 招募某等级航海士所需的名声（DiscoveriesView.mate_fame 只列出需要名声的等级）；不需要时为 0。 */
function fameNeed(level: number, rungs: [number, number][] | undefined): number {
  return rungs?.find(([l]) => l === level)?.[1] ?? 0;
}

/** 解雇确认框里的后果：航海士回老家港口的酒馆，还能再请。 */
function dismissBody(m: MateView, role: string | null): string {
  const name = m.name;
  return role ? t("v2.fleet.dismissBodyRole", { name, role }) : t("v2.fleet.dismissBody", { name });
}

/**
 * 航海士：麾下航海士的能力、等级、薪水、忠诚与任命；各港酒馆可招募的航海士。
 * 高等级航海士标出所需名声；舰队或商队停在其所在港口时可直接招募，名声不足时招募按钮禁用并说明原因。
 * 新界面（v2）另有（旧界面不变）：还没有航海士时一键“去酒馆”（舰队停在港口时；殖民点没有酒馆）；解雇先确认
 * （收不回来：要回老家的酒馆重新付雇金）；
 * 各港的航海士一行一位，招募按钮在行的右边，名声不够、人在别的港口时原因就地写在行里。
 */
export default function MatesPanel() {
  const statics = useGame((s) => s.statics);
  // 按字段选取（P14a）：只取用到的顶层字段，没变就不重渲染
  const overview = useOverviewFields("fleets", "caravans", "fame");
  const submit = useGame((s) => s.submit);
  const selectedFleet = useGame((s) => s.selectedFleet);
  const v2 = useIsV2();
  const confirm = useConfirm();
  const { data } = useView("mates", () => api.mates());
  const { data: industries } = useView("industries", () => api.industries());
  const { data: explore } = useView("discoveries", () => api.discoveries());
  if (!statics || !overview || !data) return null;
  const fame = explore?.fame ?? overview.fame ?? 0;
  // 玩家的舰队或商队停靠的地点（与内核 HireMate 的前提一致）
  const present = (loc: number) => overview.fleets.some((f) => f.docked === loc) || overview.caravans.some((c) => c.at === loc);
  // 去酒馆：停着的舰队所在的港口（先看选中的舰队）。只算港口——锚泊在殖民点（kind 为 site）时那里没有酒馆，照在海上的说法、不给按钮
  const portOf = (loc: number | null | undefined) => (loc !== null && loc !== undefined && locById(statics, loc)?.kind === "port" ? loc : null);
  const dockedAt = portOf(overview.fleets.find((f) => f.id === selectedFleet)?.docked) ?? overview.fleets.map((f) => portOf(f.docked)).find((l) => l !== null) ?? null;
  const locName = (loc: number) => locById(statics, loc)?.name ?? "";
  // 世界定义了自己的岗位时（UI-CONTRACT I2）任命菜单列出“岗位 × 目标”；经典世界照旧
  const roles = worldRoles(statics.captain);
  const options: { value: string; label: string }[] = roles
    ? [
        { value: "none", label: tk("role.none") },
        ...assignedOptions(roles, {
          fleets: overview.fleets.map((f) => f.id),
          caravans: overview.caravans.map((c) => c.id),
          industries: (industries?.industries ?? []).map((i) => i.id),
        }),
      ]
    : [
        { value: "none", label: tk("role.none") },
        ...overview.fleets.map((f) => ({ value: `captain:${f.id}`, label: tk("role.captain", { target: f.id }) })),
        { value: "accountant", label: tk("role.accountant") },
        { value: "trader", label: tk("role.trader") },
        ...overview.caravans.map((c) => ({ value: `caravan:${c.id}`, label: tk("role.caravan", { target: c.id }) })),
        ...(industries?.industries ?? []).map((i) => ({
          value: `industry:${i.id}`,
          label: tk("role.industry", { target: i.id }),
        })),
      ];
  const help = roles
    ? t("cap.role.help", { list: roles.map((r) => t("cap.role.helpItem", { role: r.name, ability: abilityName(statics, r.ability) })).join(tk("listSep")) })
    : t("mtRoleHelp");
  // 新界面：解雇先问一句（主按钮写明解雇谁；有岗位时写明岗位会空出来），办成后提示条回一句
  const dismiss = (m: MateView) => {
    const role = m.role.kind === "none" ? null : roleLabel(m.role, roles ?? statics.captain?.roles ?? null);
    return confirm.run(
      {
        title: t("v2.fleet.dismissTitle", { name: m.name }),
        body: dismissBody(m, role),
        confirmLabel: t("v2.fleet.dismissConfirm", { name: m.name }),
        done: t("v2.fleet.dismissed", { name: m.name }),
      },
      () => submit({ DismissMate: { owner: "player", mate: m.id } }),
    );
  };
  return (
    <div data-testid="mates-panel" className="pn pn-mates">
      {roles && roles.some((r) => r.desc) ? (
        // H01：世界给岗位写了“在海上管什么”时，收成一行可展开的说明（少占屏）
        <details className="sub pn-help pn-duties" data-testid="role-duties">
          <summary>{tz("posts.duties")}</summary>
          <ul>
            {roles.map((r) => (
              <li key={r.key}>
                {r.desc ? tz("posts.duty", { role: r.name, ability: abilityName(statics, r.ability), desc: r.desc }) : r.name}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="sub pn-help">{help}</p>
      )}
      <PnSection title={t("mtHired")} icon="mate">
        {data.hired.length === 0 ? (
          // 新界面：下一步去本港的酒馆（在海上时只写靠港以后）；旧界面照旧一行字（与 common.tsx 的 Empty 相同）
          <EmptyState
            text={t("mtNone")}
            hint={dockedAt !== null ? t("v2.fleet.matesHint") : t("v2.fleet.matesHintSea")}
            action={dockedAt !== null ? { label: t("v2.fleet.goTavern"), onClick: () => goFacility(dockedAt, "tavern") } : undefined}
          />
        ) : (
          data.hired.map((m) => {
            const current = roleKey(m.role);
            const opts = options.some((o) => o.value === current)
              ? options
              : [...options, { value: current, label: roleLabel(m.role, roles) }];
            return (
              <article key={m.id} className="pn-card pn-mate" data-testid={`mate-${m.id}`}>
                <div className="pn-mate-side">
                  <Portrait
                    spec={mateLook(statics, m)}
                    asset={mateAssetId(m)}
                    scale={2}
                    label={t("pnMatePortrait", { name: m.name })}
                    className="gold"
                  />
                  <span className="pn-level">{t("pnLevelBadge", { level: m.level })}</span>
                </div>
                <div className="pn-mate-main">
                  <header className="pn-mate-head">
                    <BiName as="strong" className="pn-mate-name" zh={m.name} en={m.name_en} />
                    <span className={`pn-role pn-role-${m.role.kind}`}>
                      <Icon name={roleIcon(m.role)} />
                      {roleLabel(m.role, roles ?? statics.captain?.roles ?? null)}
                    </span>
                  </header>
                  <p className="sub">{t("mtLevel", { level: m.level, xp: m.xp })}</p>
                  <Abilities m={m} />
                  <div className="pn-mate-pay">
                    <span>
                      <Icon name="coin" />
                      {t("mtSalary", { salary: m.salary, loyalty: m.loyalty })}
                    </span>
                    <Bar value={m.loyalty} max={100} tone="loyal" />
                  </div>
                  <p className="pn-bio">{m.bio}</p>
                  {geniusLine(m.methods) && <p className="pn-genius">{geniusLine(m.methods)}</p>}
                  <div className="row">
                    <Select
                      label={t("mtRole")}
                      value={current}
                      options={opts}
                      onChange={(v) => void submit({ AssignMate: { owner: "player", mate: m.id, role: toRole(v) } })}
                    />
                    <ActionButton
                      kind="danger"
                      onClick={() => {
                        // 新界面先问一句（对话框自己管“正在办”，按钮不跟着等）；旧界面照旧直接办
                        if (v2) void dismiss(m);
                        else return submit({ DismissMate: { owner: "player", mate: m.id } });
                      }}
                    >
                      {t("mtDismiss")}
                    </ActionButton>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </PnSection>
      <PnSection title={t("mtAvailable")} icon="tavern">
        <ul className="pn-recruits">
          {data.available.map((m) => {
            const need = fameNeed(m.level, explore?.mate_fame);
            const short = fame < need;
            const here = present(m.at);
            const at = (
              <span className="pn-recruit-at">
                <Icon name="tavern" />
                {t("mtAt", { loc: locName(m.at) })}
              </span>
            );
            const cost = (
              <span className="pn-recruit-cost">
                <Icon name="coin" />
                {t("pnHireCost", { cost: money(m.hire_cost) })}
              </span>
            );
            const fameTag = need > 0 && (
              <span className={short ? "pn-recruit-fame short" : "pn-recruit-fame"}>
                <Icon name="fame" />
                {t("pnFameNeed", { fame: need })}
              </span>
            );
            // 新界面：名声不够（招募按钮不可用）或人在别的港口（没有按钮）时，原因就地写在行里；名声的原因与按钮关联（aria-describedby，旧界面没有）
            const whyId = `recruit-why-${m.id}`;
            const hire = (
              <ActionButton kind="primary" disabled={short} describedBy={v2 && short ? whyId : undefined} onClick={() => submit({ HireMate: { owner: "player", mate: m.id } })}>
                {t("mtHire", { cost: num(m.hire_cost) })}
              </ActionButton>
            );
            return (
              <li key={m.id} className="pn-card pn-recruit" data-testid={`recruit-${m.id}`}>
                <Portrait spec={mateLook(statics, m)} asset={mateAssetId(m)} label={t("pnMatePortrait", { name: m.name })} />
                <div className="pn-recruit-main">
                  <header className="pn-mate-head">
                    <BiName as="strong" className="pn-mate-name" zh={m.name} en={m.name_en} />
                    <span className="pn-level small">{t("pnLevelBadge", { level: m.level })}</span>
                  </header>
                  {v2 ? (
                    // 名声不够时要求只写一次：下面的就地原因里已经写了“需要 n”，这里不再放红色的“需名声 n”小签
                    <p className="pn-recruit-facts">
                      {at}
                      {cost}
                      {!short && fameTag}
                    </p>
                  ) : (
                    at
                  )}
                  <Abilities m={m} />
                  {!v2 && cost}
                  {!v2 && fameTag}
                  {v2 ? (
                    short ? (
                      <InlineError tone="blocked" id={whyId} reason={t("pnFameShort", { need, fame })} />
                    ) : (
                      // 人在别的港口：不是出错，只写下一步去哪儿
                      !here && <p className="pn-recruit-hint">{t("v2.fleet.hireAt", { loc: locName(m.at) })}</p>
                    )
                  ) : (
                    short && <p className="pn-fame-short">{t("pnFameShort", { need, fame })}</p>
                  )}
                  {!v2 && here && <div className="row pn-recruit-hire">{hire}</div>}
                </div>
                {/* 新界面：招募按钮在行的右边（手机上整宽放在行的下面） */}
                {v2 && here && <div className="pn-recruit-side">{hire}</div>}
              </li>
            );
          })}
        </ul>
      </PnSection>
      {confirm.dialog}
    </div>
  );
}
