//! 第八批 E4 的经济数据（docs/ECONOMY.md 6.4、6.5）：`rules.toml` 的 `[population]`、`[workshops]`、`[provisions]`，
//! `goods.toml` 的 `need` 与 `group`，以及 `data/workshops.toml`（城镇工坊）与配方的投入产出校验（Hawkins–Simon 条件）。

use super::{Issues, fx, in_range, lookup};
use crate::raw::{
    CommerceRaw, Dec, InfoRaw, MerchantsRaw, MoneyRaw, OpenMarketRaw, PoliciesRaw, PopulationRaw, ProvisionsRaw,
    WorkshopRulesRaw,
};
use manifest_core::defs::{
    CommerceRules, GoodDef, InfoRules, LocKind, LocationDef, MerchantRules, MoneyRules, NeedTier, OpenMarketRules,
    PolicyRules, PopulationRules, ProvisionRules, RecipeDef, WorkshopDef, WorkshopRules,
};
use manifest_core::fixed::{Curve, Fx};
use manifest_core::ids::*;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

const RULES: &str = "rules.toml";
pub(super) const WORKSHOPS: &str = "workshops.toml";
/// 工坊接手的份额上限（至少留一成家庭手工，本地生产者才有产能可调）。
const MAX_SHARE: f64 = 0.9;

/// `data/workshops.toml`（可选文件）。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkshopsFile {
    #[serde(default)]
    workshops: Vec<WorkshopRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkshopRaw {
    loc: String,
    recipe: String,
    share: Dec,
}

fn check_ranges(section: &str, items: &[(&str, Dec, f64, f64)], is: &mut Issues) {
    for (name, v, lo, hi) in items {
        if !in_range(v.value(), *lo, *hi) {
            is.push(RULES, format!("{section}.{name}"), format!("必须在 {lo} 到 {hi} 之间"));
        }
    }
}

/// `[population]`：人口、繁荣度与需求层级。缺省关闭。
pub(super) fn population(raw: Option<PopulationRaw>, is: &mut Issues) -> PopulationRules {
    let Some(r) = raw else { return PopulationRules::default() };
    if !(1..=10_000).contains(&r.per_development) {
        is.push(RULES, "population.per_development", "必须在 1 到 10000 之间");
    }
    check_ranges(
        "population",
        &[
            ("min_ratio", r.min_ratio, 0.05, 1.0),
            ("max_ratio", r.max_ratio, 1.0, 10.0),
            ("growth", r.growth, 0.0, 0.05),
            ("prosperity_daily", r.prosperity_daily, 0.001, 1.0),
            ("sensitivity", r.sensitivity, 0.1, 20.0),
            ("tier_min", r.tier_min, 0.05, 1.0),
            ("tier_max", r.tier_max, 1.0, 5.0),
            ("substitution_rate", r.substitution_rate, 0.0, 1.0),
            ("substitution_cap", r.substitution_cap, 0.5, 1.0),
        ],
        is,
    );
    for (k, (w, e)) in r.weights.iter().zip(&r.elasticity).enumerate() {
        check_ranges(
            "population",
            &[(&format!("weights[{k}]"), *w, 0.0, 1.0), (&format!("elasticity[{k}]"), *e, 0.0, 2.0)],
            is,
        );
    }
    let sum: f64 = r.weights.iter().map(|w| w.value()).sum();
    if (sum - 1.0).abs() > 0.001 {
        is.push(RULES, "population.weights", format!("三层权重之和必须为 1（现在是 {sum}）"));
    }
    // 滞回：进入与解除的门槛
    let pair = |name: &str, v: [Dec; 2], ok: bool, what: &str, is: &mut Issues| {
        if !ok {
            is.push(
                RULES,
                format!("population.{name}"),
                format!("{what}（现在是 [{}, {}]）", v[0].value(), v[1].value()),
            );
        }
    };
    let (f, d, b, g) = (r.famine, r.depression, r.boom, r.glut);
    pair(
        "famine",
        f,
        0.0 < f[0].value() && f[0].value() < f[1].value() && f[1].value() <= 1.5,
        "要求 0 < 进入 < 解除 ≤ 1.5",
        is,
    );
    pair(
        "depression",
        d,
        0.0 < d[0].value() && d[0].value() < d[1].value() && d[1].value() < 50.0,
        "要求 0 < 进入 < 解除 < 50",
        is,
    );
    pair(
        "boom",
        b,
        50.0 < b[1].value() && b[1].value() < b[0].value() && b[0].value() <= 100.0,
        "要求 50 < 解除 < 进入 ≤ 100",
        is,
    );
    pair(
        "glut",
        g,
        1.0 < g[1].value() && g[1].value() < g[0].value() && g[0].value() <= 5.0,
        "要求 1 < 解除 < 进入 ≤ 5",
        is,
    );
    PopulationRules {
        enabled: r.enabled,
        per_development: r.per_development,
        min_ratio: fx(r.min_ratio),
        max_ratio: fx(r.max_ratio),
        growth: fx(r.growth),
        prosperity_daily: fx(r.prosperity_daily),
        sensitivity: fx(r.sensitivity),
        weights: r.weights.map(fx),
        elasticity: r.elasticity.map(fx),
        tier_min: fx(r.tier_min),
        tier_max: fx(r.tier_max),
        substitution_rate: fx(r.substitution_rate),
        substitution_cap: fx(r.substitution_cap),
        famine: (fx(f[0]), fx(f[1])),
        depression: (fx(d[0]), fx(d[1])),
        boom: (fx(b[0]), fx(b[1])),
        glut: (fx(g[0]), fx(g[1])),
    }
}

/// `[workshops]`：城镇工坊的规则。缺省关闭。
pub(super) fn workshop_rules(raw: Option<WorkshopRulesRaw>, is: &mut Issues) -> WorkshopRules {
    let Some(r) = raw else { return WorkshopRules::default() };
    check_ranges(
        "workshops",
        &[
            ("min_ratio", r.min_ratio, 0.01, 1.0),
            ("max_ratio", r.max_ratio, 1.0, 10.0),
            ("stop_below", r.stop_below, 0.0, 2.0),
            ("restart_above", r.restart_above, 0.0, 3.0),
        ],
        is,
    );
    if r.restart_above.value() < r.stop_below.value() {
        is.push(RULES, "workshops.restart_above", "复工门槛不能低于停工门槛");
    }
    WorkshopRules {
        enabled: r.enabled,
        min_ratio: fx(r.min_ratio),
        max_ratio: fx(r.max_ratio),
        stop_below: fx(r.stop_below),
        restart_above: fx(r.restart_above),
    }
}

/// `[merchants]`：本地商人的预期与囤货（ECONOMY.md 6.6、8.3）。缺省关闭。
pub(super) fn merchants(raw: Option<MerchantsRaw>, is: &mut Issues) -> MerchantRules {
    let Some(r) = raw else { return MerchantRules::default() };
    check_ranges(
        "merchants",
        &[
            ("memory", r.memory, 0.0, 1.0),
            ("inertia", r.inertia, 0.0, 0.99),
            ("intensity", r.intensity, 0.0, 10.0),
            ("min_share", r.min_share, 0.0, 0.25),
            ("hoard_base", r.hoard_base, 0.0, 1.0),
            ("hoard_max", r.hoard_max, 0.0, 1.0),
            ("hoard_speed", r.hoard_speed, 0.0, 20.0),
            ("hoard_adjust", r.hoard_adjust, 0.0, 1.0),
            ("holding_cost", r.holding_cost, 0.0, 0.1),
            ("rumor_amplitude", r.rumor_amplitude, 0.0, 1.0),
            ("rumor_decay", r.rumor_decay, 0.0, 0.99),
        ],
        is,
    );
    if !(1..=1_000).contains(&r.scale) {
        is.push(RULES, "merchants.scale", "必须在 1 到 1000 之间");
    }
    if !(1..=3_600).contains(&r.anchor_days) {
        is.push(RULES, "merchants.anchor_days", "必须在 1 到 3600 之间");
    }
    if r.hoard_base.value() > r.hoard_max.value() {
        is.push(RULES, "merchants.hoard_base", "平常的存货不能超过上限 hoard_max");
    }
    MerchantRules {
        enabled: r.enabled,
        memory: fx(r.memory),
        inertia: fx(r.inertia),
        intensity: fx(r.intensity),
        min_share: fx(r.min_share),
        scale: r.scale,
        anchor_days: r.anchor_days,
        hoard_base: fx(r.hoard_base),
        hoard_max: fx(r.hoard_max),
        hoard_speed: fx(r.hoard_speed),
        hoard_adjust: fx(r.hoard_adjust),
        holding_cost: fx(r.holding_cost),
        rumor_amplitude: fx(r.rumor_amplitude),
        rumor_decay: fx(r.rumor_decay),
    }
}

/// `[info]`：信息时效（ECONOMY.md 第 7 节）——告示板保留的天数与行情通报的价格。缺省用内置值。
pub(super) fn info(raw: Option<InfoRaw>, is: &mut Issues) -> InfoRules {
    let Some(r) = raw else { return InfoRules::default() };
    if !(1..=3_600).contains(&r.board_days) {
        is.push(RULES, "info.board_days", "必须在 1 到 3600 之间");
    }
    for (name, v) in [("report_base", r.report_base), ("report_per_port", r.report_per_port)] {
        if !(0..=1_000_000).contains(&v) {
            is.push(RULES, format!("info.{name}"), "必须在 0 到 1000000 之间");
        }
    }
    InfoRules {
        board_days: r.board_days.clamp(1, 3_600) as u32,
        report_base: r.report_base,
        report_per_port: r.report_per_port,
    }
}

/// `[npc.v2]`：商会 2.0（ECONOMY.md 6.7）。缺省关闭。
pub(super) fn commerce(raw: Option<CommerceRaw>, max_fleets: usize, is: &mut Issues) -> CommerceRules {
    let Some(r) = raw else { return CommerceRules::default() };
    if r.fleets_per_worth <= 0 {
        is.push(RULES, "npc.v2.fleets_per_worth", "必须大于 0");
    }
    if r.max_fleets_cap < max_fleets || r.max_fleets_cap > 30 {
        is.push(RULES, "npc.v2.max_fleets_cap", format!("必须在 max_fleets（{max_fleets}）到 30 之间"));
    }
    if r.retire_years > 200 {
        is.push(RULES, "npc.v2.retire_years", "必须在 0 到 200 之间（0 表示不换新）");
    }
    if !(0..=20).contains(&r.reserve_ships) {
        is.push(RULES, "npc.v2.reserve_ships", "必须在 0 到 20 之间");
    }
    if !(1..=1_000).contains(&r.license_multiple) {
        is.push(RULES, "npc.v2.license_multiple", "必须在 1 到 1000 之间");
    }
    check_ranges(
        "npc.v2",
        &[("dividend_share", r.dividend_share, 0.0, 1.0), ("player_reaction", r.player_reaction, 0.0, 1.0)],
        is,
    );
    CommerceRules {
        enabled: r.enabled,
        fleets_per_worth: r.fleets_per_worth.max(1),
        max_fleets_cap: r.max_fleets_cap,
        retire_years: r.retire_years,
        dividend_share: fx(r.dividend_share),
        reserve_ships: r.reserve_ships,
        hedge: r.hedge,
        player_reaction: fx(r.player_reaction),
        license_multiple: r.license_multiple,
    }
}

/// `[market.open]`：开放市场（各地收购全部商品、出售以特产为主）。缺省关闭。
pub(super) fn open_market(raw: Option<OpenMarketRaw>, is: &mut Issues) -> OpenMarketRules {
    let Some(r) = raw else { return OpenMarketRules::default() };
    check_ranges(
        "market.open",
        &[
            ("sell_min_ratio", r.sell_min_ratio, 0.3, 3.0),
            ("demand_scale", r.demand_scale, 0.05, 5.0),
            ("road_factor", r.road_factor, 0.5, 10.0),
        ],
        is,
    );
    if !(0..=100).contains(&r.sell_min_goods) {
        is.push(RULES, "market.open.sell_min_goods", "必须在 0 到 100 之间");
    }
    if !(2..=1_000).contains(&r.min_demand) {
        is.push(RULES, "market.open.min_demand", "必须在 2 到 1000 之间（清单以外的商品只收不卖，产量要低于消耗）");
    }
    let points: Vec<(Fx, Fx)> = r.ratio_curve.iter().map(|[x, y]| (fx(*x), fx(*y))).collect();
    let curve = Curve::new(points);
    if curve.points.is_empty() {
        is.push(RULES, "market.open.ratio_curve", "至少需要一个点");
    } else if !curve.is_non_increasing() {
        is.push(RULES, "market.open.ratio_curve", "距离必须严格递增、产量 / 消耗必须单调不增");
    } else if curve.points.first().map(|p| p.0) != Some(Fx::ZERO) {
        is.push(RULES, "market.open.ratio_curve", "第一个点的距离必须为 0");
    }
    if curve.points.iter().any(|(_, y)| *y < Fx::from_pct(30) || *y > Fx::ONE) {
        is.push(
            RULES,
            "market.open.ratio_curve",
            "产量 / 消耗必须在 0.3 到 1 之间（与市场清单的 0.3–3.0 一致，且只收不卖的商品产量不高于消耗）",
        );
    }
    OpenMarketRules {
        enabled: r.enabled,
        sell_min_ratio: fx(r.sell_min_ratio),
        sell_min_goods: r.sell_min_goods.clamp(0, 100) as usize,
        ratio_curve: curve,
        demand_scale: fx(r.demand_scale),
        min_demand: r.min_demand.clamp(2, 1_000),
        road_factor: fx(r.road_factor),
        listed_import_inflow: r.listed_import_inflow,
    }
}

/// `[provisions]`：舰队补给的口粮从当地市场买。缺省关闭。
pub(super) fn provisions(
    raw: Option<ProvisionsRaw>,
    good_ids: &BTreeMap<String, GoodId>,
    is: &mut Issues,
) -> ProvisionRules {
    let Some(r) = raw else { return ProvisionRules::default() };
    if !(1..=20).contains(&r.rations) {
        is.push(RULES, "provisions.rations", "必须在 1 到 20 之间");
    }
    if r.local && r.goods.is_empty() {
        is.push(RULES, "provisions.goods", "从当地市场补给时至少要有一种口粮商品");
    }
    let mut goods = Vec::new();
    for k in &r.goods {
        if let Some(g) = lookup(good_ids, k, RULES, "provisions.goods", "商品", is) {
            if goods.contains(&g) {
                is.push(RULES, "provisions.goods", format!("商品“{k}”重复"));
            }
            goods.push(g);
        }
    }
    ProvisionRules { local: r.local, goods, rations: r.rations }
}

/// `[policies]`：势力的经济政策的规则触发（ECONOMY.md 6.10）。缺省关闭。
pub(super) fn policies(raw: Option<PoliciesRaw>, good_ids: &BTreeMap<String, GoodId>, is: &mut Issues) -> PolicyRules {
    let Some(r) = raw else { return PolicyRules::default() };
    check_ranges(
        "policies",
        &[
            ("staple_ratio", r.staple_ratio, 1.1, 5.0),
            ("export_share", r.export_share, 0.1, 10.0),
            ("export_tax", r.export_tax, 1.1, 5.0),
        ],
        is,
    );
    for (name, v) in [("ban_days", r.ban_days), ("export_tax_days", r.export_tax_days)] {
        if !(1..=360).contains(&v) {
            is.push(RULES, format!("policies.{name}"), "必须在 1 到 360 之间");
        }
    }
    let mut staples = Vec::new();
    for k in &r.staples {
        if let Some(g) = lookup(good_ids, k, RULES, "policies.staples", "商品", is) {
            if staples.contains(&g) {
                is.push(RULES, "policies.staples", format!("商品“{k}”重复"));
            }
            staples.push(g);
        }
    }
    PolicyRules {
        enabled: r.enabled,
        staples,
        staple_ratio: fx(r.staple_ratio),
        ban_days: r.ban_days.clamp(1, 360) as u32,
        export_share: fx(r.export_share),
        export_tax: fx(r.export_tax),
        export_tax_days: r.export_tax_days.clamp(1, 360) as u32,
    }
}

/// `[money]`：货币流通（ECONOMY.md 6.9）。缺省关闭。
pub(super) fn money(raw: Option<MoneyRaw>, is: &mut Issues) -> MoneyRules {
    let Some(r) = raw else { return MoneyRules::default() };
    check_ranges(
        "money",
        &[
            ("income_per_capita", r.income_per_capita, 0.0001, 100.0),
            ("leak", r.leak, 0.001, 0.5),
            ("liquidity_floor", r.liquidity_floor, 0.1, 1.0),
            ("liquidity_cap", r.liquidity_cap, 1.0, 10.0),
            ("spend_rate", r.spend_rate, 0.0, 2.0),
            ("works_share", r.works_share, 0.0, 1.0),
            ("navy_cut", r.navy_cut, 0.0, 0.9),
            ("war_share", r.war_share, 0.0, 5.0),
            ("tax_step", r.tax_step, 0.0, 0.5),
            ("tax_min", r.tax_min, 0.1, 1.0),
            ("tax_max", r.tax_max, 1.0, 5.0),
            ("company_overhead", r.company_overhead, 0.0, 0.2),
        ],
        is,
    );
    for (name, v, lo, hi) in [
        ("liquidity_root", r.liquidity_root, 1, 20),
        ("bank_reserve", r.bank_reserve, 0, 1_000_000_000),
        ("treasury_days", r.treasury_days, 0, 3_600),
        ("reserve_months", r.reserve_months, 0, 120),
        ("catch_up_months", r.catch_up_months, 1, 120),
        ("works_cap", r.works_cap, 0, 50),
        ("patrol_cost", r.patrol_cost, 1, 100_000_000),
        ("claim_cost", r.claim_cost, 0, 100_000_000),
        ("deficit_months", r.deficit_months, 0, 120),
        ("surplus_months", r.surplus_months, 1, 240),
    ] {
        if !(lo..=hi).contains(&v) {
            is.push(RULES, format!("money.{name}"), format!("必须在 {lo} 到 {hi} 之间"));
        }
    }
    MoneyRules {
        enabled: r.enabled,
        income_per_capita: fx(r.income_per_capita),
        leak: fx(r.leak),
        liquidity_root: r.liquidity_root.clamp(1, 20) as u32,
        liquidity_floor: fx(r.liquidity_floor),
        liquidity_cap: fx(r.liquidity_cap),
        bank_reserve: r.bank_reserve.max(0),
        treasury_days: r.treasury_days.max(0),
        reserve_months: r.reserve_months.max(0),
        spend_rate: fx(r.spend_rate),
        catch_up_months: r.catch_up_months.max(1),
        works_share: fx(r.works_share),
        works_cap: r.works_cap.max(0),
        patrol_cost: r.patrol_cost.max(1),
        navy_cut: fx(r.navy_cut),
        war_share: fx(r.war_share),
        claim_cost: r.claim_cost.max(0),
        deficit_months: r.deficit_months.max(0),
        surplus_months: r.surplus_months.max(1),
        tax_step: fx(r.tax_step),
        tax_min: fx(r.tax_min),
        tax_max: fx(r.tax_max),
        company_overhead: fx(r.company_overhead),
    }
}

/// `goods.toml` 的 `need`（需求层级）。
pub(super) fn need(value: &Option<String>, item: &str, is: &mut Issues) -> Option<NeedTier> {
    let v = value.as_deref()?;
    let t = NeedTier::from_key(v);
    if t.is_none() {
        is.push("goods.toml", item, format!("need “{v}”无效，应为 essential、comfort 或 luxury"));
    }
    t
}

/// `goods.toml` 的 `group`（替代组）：按首次出现的顺序编号；每组至少两种商品，同组商品必须有同一需求层级。
pub(super) fn groups(raw: &[(String, Option<String>)], goods: &mut [GoodDef], is: &mut Issues) {
    let mut ids: Vec<&str> = Vec::new();
    for ((key, group), g) in raw.iter().zip(goods.iter_mut()) {
        let Some(name) = group.as_deref() else { continue };
        let idx = ids.iter().position(|x| *x == name).unwrap_or_else(|| {
            ids.push(name);
            ids.len() - 1
        });
        g.group = Some(idx as u16);
        if g.need.is_none() {
            is.push("goods.toml", format!("goods[{key}]"), format!("替代组“{name}”的商品必须有需求层级（need）"));
        }
    }
    for (idx, name) in ids.iter().enumerate() {
        let members: Vec<&GoodDef> = goods.iter().filter(|g| g.group == Some(idx as u16)).collect();
        if members.len() < 2 {
            is.push("goods.toml", "", format!("替代组“{name}”至少要有两种商品"));
        }
        let tiers: BTreeSet<_> = members.iter().filter_map(|g| g.need).collect();
        if tiers.len() > 1 {
            is.push("goods.toml", "", format!("替代组“{name}”的商品需求层级不一致"));
        }
    }
}

/// `data/workshops.toml`：每条挂到所在地点。地点须为有市场的港口或城市；配方须有投入、只有一种产出，
/// 产出与全部投入都在当地交易，产出在当地有产量；份额在 (0, 0.9]，同一地点同一产出的份额合计不超过 0.9。
pub(super) fn workshops(
    file: WorkshopsFile,
    loc_ids: &BTreeMap<String, LocId>,
    recipe_ids: &BTreeMap<String, RecipeId>,
    recipes: &[RecipeDef],
    locations: &mut [LocationDef],
    is: &mut Issues,
) {
    let mut seen: BTreeSet<(LocId, RecipeId)> = BTreeSet::new();
    for (i, w) in file.workshops.iter().enumerate() {
        let item = format!("workshops[{i}]（{} · {}）", w.loc, w.recipe);
        let loc = lookup(loc_ids, &w.loc, WORKSHOPS, &item, "地点", is);
        let recipe = lookup(recipe_ids, &w.recipe, WORKSHOPS, &item, "配方", is);
        let (Some(loc), Some(rid)) = (loc, recipe) else { continue };
        let def = &locations[loc.idx()];
        if def.kind == LocKind::Site {
            is.push(WORKSHOPS, &item, "殖民点没有城镇工坊");
            continue;
        }
        let r = &recipes[rid.idx()];
        if r.inputs.is_empty() {
            is.push(WORKSHOPS, &item, "采集类配方（没有投入）不能作为城镇工坊");
            continue;
        }
        let [(output, out_qty)] = r.outputs[..] else {
            is.push(WORKSHOPS, &item, "城镇工坊的配方只能有一种产出");
            continue;
        };
        let traded = |g: GoodId| def.market.iter().find(|m| m.good == g);
        match traded(output) {
            Some(m) if m.supply > 0 => {}
            _ => {
                is.push(WORKSHOPS, &item, "产出须在当地交易、并且当地有产量");
                continue;
            }
        }
        if let Some((g, _)) = r.inputs.iter().find(|(g, _)| traded(*g).is_none()) {
            is.push(WORKSHOPS, &item, format!("投入“{}”不在当地交易", g.0));
            continue;
        }
        let share = w.share.value();
        if !(share > 0.0 && share <= MAX_SHARE) {
            is.push(WORKSHOPS, &item, format!("share 必须大于 0、不超过 {MAX_SHARE}"));
            continue;
        }
        if !seen.insert((loc, rid)) {
            is.push(WORKSHOPS, &item, "同一地点的同一配方重复");
            continue;
        }
        let wd = WorkshopDef { recipe: rid, output, out_qty, inputs: r.inputs.clone(), share: fx(w.share) };
        let loc_def = &mut locations[loc.idx()];
        loc_def.workshops.push(wd);
        if loc_def.workshop_share(output) > fx(Dec::Float(MAX_SHARE)) {
            is.push(WORKSHOPS, &item, format!("同一地点同一产出的份额合计超过 {MAX_SHARE}"));
        }
    }
}

/// 配方的投入系数矩阵（加工配方；同一产出有几种配方时每个投入取最大的系数）：a[i][j] = 生产一件 j 要用的 i。
pub fn input_coefficients(recipes: &[RecipeDef], goods: usize) -> Vec<Vec<f64>> {
    let mut a = vec![vec![0.0f64; goods]; goods];
    for r in recipes.iter().filter(|r| !r.inputs.is_empty()) {
        for (out, oq) in &r.outputs {
            for (inp, iq) in &r.inputs {
                let c = *iq as f64 / (*oq).max(1) as f64;
                let cell = &mut a[inp.idx()][out.idx()];
                *cell = f64::max(*cell, c);
            }
        }
    }
    a
}

/// 非负矩阵的谱半径（幂迭代：从全 1 向量出发，取最后一百步增长率的几何平均）。
pub fn spectral_radius(a: &[Vec<f64>]) -> f64 {
    let n = a.len();
    let mut v = vec![1.0; n];
    let (steps, tail) = (400, 100);
    let mut log_sum = 0.0;
    for step in 0..steps {
        let mut w = vec![0.0; n];
        for (i, row) in a.iter().enumerate() {
            w[i] = row.iter().zip(&v).map(|(x, y)| x * y).sum();
        }
        let m = w.iter().cloned().fold(0.0, f64::max);
        if m <= 1e-300 {
            return 0.0;
        }
        if step >= steps - tail {
            log_sum += m.ln();
        }
        v = w.iter().map(|x| x / m).collect();
    }
    (log_sum / tail as f64).exp()
}

/// Hawkins–Simon 条件：投入系数矩阵的谱半径 < 1（生产网络能自给：每种加工品都能净产出）。
pub(super) fn check_leontief(recipes: &[RecipeDef], goods: usize, is: &mut Issues) {
    let rho = spectral_radius(&input_coefficients(recipes, goods));
    if rho >= 1.0 {
        is.push(
            "recipes.toml",
            "",
            format!("投入产出系数矩阵的谱半径 ρ = {rho:.3} ≥ 1：Hawkins–Simon 条件不成立，生产网络不能自给（有配方循环在净消耗自己的产出）"),
        );
    }
}

/// 按基准价的“产出价值 / 原料价值”（对偶价格检查）：低于 1 是亏本的配方，高于 2.5 是产出定价远高于原料。
pub fn recipe_value_ratio(r: &RecipeDef, goods: &[GoodDef]) -> Option<f64> {
    if r.inputs.is_empty() {
        return None;
    }
    let value = |list: &[(GoodId, i64)]| -> f64 {
        list.iter().map(|(g, q)| goods[g.idx()].base_price as f64 * *q as f64).sum()
    };
    let cost = value(&r.inputs);
    (cost > 0.0).then(|| value(&r.outputs) / cost)
}

/// 需求层级与替代组的对应（界面与说明用）：每层的商品数。
pub fn need_counts(goods: &[GoodDef]) -> [usize; 3] {
    let mut n = [0; 3];
    for g in goods {
        if let Some(t) = g.need {
            n[t.index()] += 1;
        }
    }
    n
}
