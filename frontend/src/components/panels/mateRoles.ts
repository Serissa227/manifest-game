// 航海士的任命与能力（UI-CONTRACT I2）。
// - 经典世界（以及旧后端）：五种经典任职（舰长、会计、交易员、商队头领、产业管理人），命令照旧是 Captain / Accountant……；
// - 世界定义了自己的岗位（StaticView.captain.roles 里有经典五种以外的 key）：任命菜单列出“岗位 × 目标”，
//   目标按岗位的作用对象（舰队、商队、产业或商会）；提交 { Assigned: { role, target } }，role 是 roles 的下标。
//   岗位的作用对象后端视图还没有给出（RoleDefView.scope 缺省），这时按经典岗位的 key 推断，推断不了就把四种对象都列出来，
//   由内核校验（对象不合的任命会被拒绝并给出原因）。
// - 在任的视图：经典任职照旧；世界岗位为 { kind: "assigned", role, scope, target }，显示岗位名与目标。
import type { IconName } from "../../art/icons";
import { t, tk } from "../../i18n";
import type { CaptainDefsView, MateRole, RoleDefView, RoleScope, RoleView, StaticView } from "../../ipc/types";

/** 经典的五种岗位（内核 classic_roles 的 key）。 */
export const CLASSIC_ROLE_KEYS: readonly string[] = ["captain", "accountant", "trader", "caravan_leader", "industry_manager"];

/** 经典岗位的作用对象（与内核 classic_roles 一致）。 */
const CLASSIC_SCOPE: Readonly<Record<string, RoleScope>> = {
  captain: "fleet",
  accountant: "owner",
  trader: "owner",
  caravan_leader: "caravan",
  industry_manager: "industry",
};

/** 作用对象的排列顺序（推断不了时全部列出）。 */
const ALL_SCOPES: readonly RoleScope[] = ["fleet", "caravan", "industry", "owner"];

/** 世界定义的岗位：后端给了岗位表、且不全是经典的五种时为岗位表，否则为空（照经典的任命菜单）。 */
export function worldRoles(defs: CaptainDefsView | null | undefined): RoleDefView[] | null {
  const roles = defs?.roles ?? [];
  if (roles.length === 0 || roles.every((r) => CLASSIC_ROLE_KEYS.includes(r.key))) return null;
  return roles;
}

/** 岗位可以任命到哪些对象上。 */
export function roleScopes(r: RoleDefView): RoleScope[] {
  if (r.scope) return [r.scope];
  const classic = CLASSIC_SCOPE[r.key];
  return classic ? [classic] : [...ALL_SCOPES];
}

/** 可任命的目标：玩家的舰队、商队与产业（编号）。 */
export interface RoleTargets {
  fleets: readonly number[];
  caravans: readonly number[];
  industries: readonly number[];
}

/** 目标的写法：“舰队 #1”“商队 #2”“产业 #3”“商会”。 */
export function targetText(scope: RoleScope, id: number | null): string {
  return tk(`cap.role.target.${scope}`, { n: id ?? "" });
}

/** 世界岗位的名字（下标越界时写“岗位 #n”）。 */
export function roleName(roles: readonly RoleDefView[] | null | undefined, role: number): string {
  return roles?.[role]?.name ?? t("cap.role.unknown", { n: role });
}

/** 下拉框的取值：assigned:<岗位下标>:<对象>[:<目标编号>]。 */
export function assignedValue(role: number, scope: RoleScope, id: number | null): string {
  return id === null ? `assigned:${role}:${scope}` : `assigned:${role}:${scope}:${id}`;
}

/** 世界岗位的任命菜单（不含“待命”）：每个岗位按它的作用对象列出全部目标。 */
export function assignedOptions(roles: readonly RoleDefView[], targets: RoleTargets): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  roles.forEach((r, idx) => {
    for (const scope of roleScopes(r)) {
      const ids: (number | null)[] =
        scope === "owner" ? [null] : scope === "fleet" ? [...targets.fleets] : scope === "caravan" ? [...targets.caravans] : [...targets.industries];
      for (const id of ids) out.push({ value: assignedValue(idx, scope, id), label: t("cap.role.assigned", { role: r.name, target: targetText(scope, id) }) });
    }
  });
  return out;
}

/** 下拉框的取值 → 内核的 MateRole（不是世界岗位的取值为 null）。 */
export function assignedRole(value: string): MateRole | null {
  const [kind, role, scope, target] = value.split(":");
  if (kind !== "assigned") return null;
  const idx = Number(role);
  const id = Number(target);
  if (!Number.isInteger(idx) || idx < 0) return null;
  switch (scope) {
    case "owner":
      return { Assigned: { role: idx, target: "Owner" } };
    case "fleet":
      return Number.isInteger(id) ? { Assigned: { role: idx, target: { Fleet: id } } } : null;
    case "caravan":
      return Number.isInteger(id) ? { Assigned: { role: idx, target: { Caravan: id } } } : null;
    case "industry":
      return Number.isInteger(id) ? { Assigned: { role: idx, target: { Industry: id } } } : null;
    default:
      return null;
  }
}

/** 在任的世界岗位 → 下拉框的取值。 */
export function assignedKey(r: RoleView): string {
  return assignedValue(r.role ?? 0, r.scope ?? "owner", r.scope === "owner" ? null : r.target);
}

/** 在任的世界岗位的写法：“领航员（舰队 #1）”。 */
export function assignedLabel(r: RoleView, roles: readonly RoleDefView[] | null | undefined): string {
  const scope = r.scope ?? "owner";
  return t("cap.role.assigned", { role: roleName(roles, r.role ?? 0), target: targetText(scope, scope === "owner" ? null : r.target) });
}

/** 世界岗位的徽记图标（按作用对象）。 */
export function scopeIcon(scope: RoleScope | undefined): IconName {
  switch (scope) {
    case "fleet":
      return "fleet";
    case "caravan":
      return "caravan";
    case "industry":
      return "industry";
    default:
      return "report";
  }
}

/** 经典的四项能力（MateView 的顶层字段；任何世界都有）。 */
export const CLASSIC_ABILITIES: readonly string[] = ["navigation", "trade", "combat", "management"];

const CLASSIC_ABILITY_LABEL: Readonly<Record<string, "pnAbilityNav" | "pnAbilityTrade" | "pnAbilityCombat" | "pnAbilityMgmt">> = {
  navigation: "pnAbilityNav",
  trade: "pnAbilityTrade",
  combat: "pnAbilityCombat",
  management: "pnAbilityMgmt",
};

/**
 * 能力的名字：后端给了能力表时用它（契约与后端暂未输出），否则经典四项用界面的写法，
 * 其余按同 key 的属性名（如“领航”），都找不到时用 key。
 */
export function abilityName(statics: StaticView | null | undefined, key: string): string {
  const c = statics?.captain;
  const own = c?.abilities?.find((a) => a.key === key)?.name;
  if (own) return own;
  const classic = CLASSIC_ABILITY_LABEL[key];
  if (classic) return t(classic);
  return c?.attributes.find((a) => a.key === key)?.name ?? key;
}

/** 世界追加的能力（经典四项以外的，按后端的顺序）。旧后端没有 abilities 时为空。 */
export function extraAbilities(abilities: readonly [string, number][] | undefined): [string, number][] {
  return (abilities ?? []).filter(([k]) => !CLASSIC_ABILITIES.includes(k));
}
