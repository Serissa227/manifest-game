//! 世界摘要：由内核生成、有长度上限的文字，供 AI 提示词模板使用。
//!
//! 摘要只包含游戏内信息（日期、物价、势力、事件、商会、殖民、新闻），不含任何玩家本机信息。
//! 内容名称全部取自静态数据；货币单位与纪年取自 `rules.toml [world]`。

use crate::calendar::{Calendar, Season};
use crate::colony::Claim;
use crate::defs::{EffectKind, WorldRules};
use crate::diplomacy::DiploStatus;
use crate::fixed::Money;
use crate::fixed::{Fx, mul_div};
use crate::ids::*;
use crate::news::{NewsFact, YearFacts};
use crate::world::World;
use std::fmt::Write;

pub mod ai;
pub mod context;
pub mod ripple;
pub mod text;

fn season_name(s: Season) -> &'static str {
    match s {
        Season::Spring => "春",
        Season::Summer => "夏",
        Season::Autumn => "秋",
        Season::Winter => "冬",
    }
}

pub fn status_name(s: DiploStatus) -> &'static str {
    match s {
        DiploStatus::Peace => "和平",
        DiploStatus::Tension => "紧张",
        DiploStatus::War => "战争",
        DiploStatus::Truce => "停战",
    }
}

pub fn owner_name(world: &World, owner: OwnerId) -> String {
    match owner {
        OwnerId::Player => "玩家商号".to_string(),
        OwnerId::Company(c) => world.defs.company(c).name.clone(),
    }
}

/// 截断到最多 `max` 个字符。
pub fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// 纪年日期：如“航海历1502年1月13日（春）”。
pub fn world_date_text(rules: &WorldRules, day: u32) -> String {
    world_date_text_in(rules, &Calendar::default(), day)
}

pub fn world_date_text_in(rules: &WorldRules, calendar: &Calendar, day: u32) -> String {
    let d = calendar.date_of(day);
    format!(
        "{}{}年{}月{}日（{}）",
        rules.era,
        rules.calendar_year(d.year),
        d.month,
        d.day,
        season_name(calendar.season_of(day))
    )
}

/// 纪年年份：`year_index` 为从 0 开始的年序，如 0 → “1502年”。
pub fn year_text(rules: &WorldRules, year_index: u32) -> String {
    format!("{}年", rules.calendar_year(year_index + 1))
}

/// 金额：如“1234 金币”。
pub fn money_text(rules: &WorldRules, v: Money) -> String {
    format!("{v} {}", rules.currency)
}

/// 事实的文字描述。
pub fn fact_text(world: &World, fact: &NewsFact) -> String {
    let defs = &world.defs;
    match fact {
        NewsFact::PriceHigh { loc, good } => format!("{}的{}价格高企", defs.loc(*loc).name, defs.good(*good).name),
        NewsFact::PriceLow { loc, good } => format!("{}的{}价格低迷", defs.loc(*loc).name, defs.good(*good).name),
        NewsFact::Shortage { loc, good } => format!("{}的{}严重短缺", defs.loc(*loc).name, defs.good(*good).name),
        NewsFact::Relation { a, b, status } => {
            format!("{}与{}的关系处于{}", defs.faction(*a).name, defs.faction(*b).name, status_name(*status))
        }
        NewsFact::EventActive { event } => format!("{}正在发生", defs.event_type(*event).name),
    }
}

/// 预测方法的中文名（世界摘要用）。
fn method_name(m: crate::defs::ForecastMethod) -> &'static str {
    match m {
        crate::defs::ForecastMethod::Naive => "照旧",
        crate::defs::ForecastMethod::Trend => "顺势",
        crate::defs::ForecastMethod::Revert => "回归",
    }
}

/// 世界摘要。
pub fn world_summary(world: &World, max_chars: usize) -> String {
    // 新世界不向模型暴露全知市场与未知港口；经典摘要保持原始字节。
    if world.defs.world_key != "classic" {
        return context::known_summary(world, max_chars);
    }
    let defs = &world.defs;
    let wr = &defs.rules.world;
    let mut s = String::new();
    let _ = writeln!(s, "日期：{}", world_date_text_in(wr, &world.defs.calendar, world.day()));

    // 物价偏离最大的若干条
    let mut anomalies: Vec<(i64, LocId, GoodId, i64, i64)> = Vec::new();
    for (li, ls) in world.state.locations.iter().enumerate() {
        for (g, e) in &ls.market {
            let pct = mul_div(e.price - e.base_price, 100, e.base_price.max(1));
            anomalies.push((pct.abs(), LocId::from_idx(li), *g, e.price, pct));
        }
    }
    anomalies.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    let _ = writeln!(s, "物价异常：");
    for (_, loc, good, price, pct) in anomalies.iter().take(8) {
        let _ = writeln!(
            s,
            "- {} {} 现价 {}（较基准 {:+}%）",
            defs.loc(*loc).name,
            defs.good(*good).name,
            money_text(wr, *price),
            pct
        );
    }

    let tense: Vec<String> = world
        .state
        .relations
        .iter()
        .filter(|r| r.status != DiploStatus::Peace)
        .map(|r| {
            format!("{}—{}：{}（{}）", defs.faction(r.a).name, defs.faction(r.b).name, status_name(r.status), r.value)
        })
        .collect();
    let _ = writeln!(s, "势力关系：{}", if tense.is_empty() { "各方和平".to_string() } else { tense.join("；") });

    // 目录事件逐条列出，组合事件按事件合并（见 composed.rs）
    let _ = writeln!(s, "进行中的事件：{}", world.active_events_text());

    let _ = writeln!(s, "商会：");
    for a in world.state.agents.values().filter(|a| a.owner.company().is_some()) {
        let fleets = world.fleets_of(a.owner).count();
        let state = if a.bankrupt {
            "已破产".to_string()
        } else {
            // 预测方法与近 30 天内的展望（ECONOMY.md 8.9）
            let method = if defs.rules.npc.v2.enabled {
                format!("，预测方法：{}", method_name(world.company_method(a.owner)))
            } else {
                String::new()
            };
            let views = a
                .strategy
                .as_ref()
                .and_then(|st| st.outlook.as_ref())
                .filter(|o| o.day + crate::commerce::OUTLOOK_DAYS > world.day() && !o.views.is_empty())
                .map(|o| {
                    let v: Vec<String> =
                        o.views.iter().map(|(g, v)| format!("{}{:+}", defs.good(*g).name, v)).collect();
                    format!("，展望：{}", v.join("、"))
                })
                .unwrap_or_default();
            format!("净资产约 {}，舰队 {fleets} 支{method}{views}", money_text(wr, a.ledger.equity()))
        };
        let _ = writeln!(s, "- {}：{}", owner_name(world, a.owner), state);
    }

    // 重点市场：库存最紧的几处（库存 / 目标库存）与产能变化最大的产地（周期所处的阶段）
    let mut tight: Vec<(i64, LocId, GoodId)> = Vec::new();
    let mut cycle: Vec<(i64, LocId, GoodId, i64)> = Vec::new();
    for (li, ls) in world.state.locations.iter().enumerate() {
        for (g, e) in &ls.market {
            tight.push((mul_div(e.stock, 100, e.target.max(1)), LocId::from_idx(li), *g));
            if e.producer.k0 > 0 {
                let r = e.producer.capacity_ratio().raw() / 100;
                cycle.push(((r - 100).abs(), LocId::from_idx(li), *g, r));
            }
        }
    }
    tight.sort();
    let tight: Vec<String> =
        tight.iter().take(5).map(|(r, l, g)| format!("{}{} {r}%", defs.loc(*l).name, defs.good(*g).name)).collect();
    let _ = writeln!(s, "库存最紧（库存 / 目标库存）：{}", tight.join("；"));
    cycle.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    if cycle.first().is_some_and(|c| c.0 >= 5) {
        let c: Vec<String> = cycle
            .iter()
            .take(3)
            .map(|(_, l, g, r)| {
                let phase = if *r >= 100 { "扩产" } else { "减产" };
                format!("{}{}{phase}中（产能为开局的 {r}%）", defs.loc(*l).name, defs.good(*g).name)
            })
            .collect();
        let _ = writeln!(s, "产能周期：{}", c.join("；"));
    }
    // 进行中的势力政策（ECONOMY.md 6.10、8.4）
    let today = world.day();
    let policies: Vec<&str> = world
        .state
        .events
        .composed
        .iter()
        .filter(|r| r.end() > today)
        .filter(|r| {
            r.effects.iter().any(|e| {
                matches!(
                    e.effect,
                    EffectKind::ExportBan | EffectKind::ImportTariff | EffectKind::ExportTariff | EffectKind::Subsidy
                )
            })
        })
        .map(|r| r.title.as_str())
        .collect();
    if !policies.is_empty() {
        let _ = writeln!(s, "进行中的政策：{}", policies.join("；"));
    }

    if defs.site_ids().next().is_some() || !world.state.colonies.is_empty() {
        let _ = writeln!(s, "殖民：{}", colony_text(world));
    }

    let recent: Vec<&str> = world.state.news.news.iter().rev().take(3).map(|n| n.text.as_str()).collect();
    if !recent.is_empty() {
        let _ = writeln!(s, "近期传闻：{}", recent.join(" / "));
    }
    truncate_chars(&s, max_chars)
}

/// 殖民竞赛的概况：各方殖民地、各势力占领的殖民点、尚无主的殖民点。
pub fn colony_text(world: &World) -> String {
    let defs = &world.defs;
    let mut parts: Vec<String> = Vec::new();
    let mine: Vec<&crate::colony::Colony> = world.colonies_of(OwnerId::Player).collect();
    if !mine.is_empty() {
        let pop: i64 = mine.iter().map(|c| c.population).sum();
        parts.push(format!("玩家商号殖民地 {} 处（人口 {pop}）", mine.len()));
    }
    let claims: Vec<String> = defs
        .faction_ids()
        .filter_map(|f| {
            let n = world.state.locations.iter().filter(|l| l.claim == Some(Claim::Faction(f))).count();
            (n > 0).then(|| format!("{} {n} 处", defs.faction(f).name))
        })
        .collect();
    if !claims.is_empty() {
        parts.push(format!("各国占领殖民点：{}", claims.join("、")));
    }
    let free = defs.site_ids().filter(|l| world.claim_of(*l).is_none()).count();
    parts.push(format!("尚无主的殖民点 {free} 处"));
    parts.join("；")
}

/// 事件目录：封闭集合中的全部事件类型、所需参数与范围（写进事件导演的提示词）。
pub fn event_catalog(world: &World) -> String {
    let defs = &world.defs;
    let mut s = String::new();
    for e in &defs.events {
        let mut params: Vec<String> = Vec::new();
        let k = e.effect;
        // 限定了地点、海区或势力的事件类型把可选的 key 列出来（不限定时文字与原来相同）
        if k.needs_loc() {
            if e.locs.is_empty() {
                params.push(if e.port_only { "loc（港口 key）".into() } else { "loc（地点 key）".into() });
            } else {
                let keys: Vec<&str> = e.locs.iter().map(|l| defs.loc(*l).key.as_str()).collect();
                params.push(format!("loc（{}）", keys.join("/")));
            }
        }
        if k.needs_good() {
            if e.goods.is_empty() {
                params.push("good（商品 key）".into());
            } else {
                let keys: Vec<&str> = e.goods.iter().map(|g| defs.good(*g).key.as_str()).collect();
                params.push(format!("good（{}）", keys.join("/")));
            }
        }
        if k.needs_region() {
            if e.regions.is_empty() {
                params.push("region（海区 key）".into());
            } else {
                let keys: Vec<&str> = e.regions.iter().map(|r| defs.region(*r).key.as_str()).collect();
                params.push(format!("region（{}）", keys.join("/")));
            }
        }
        let factions = || -> String {
            if e.factions.is_empty() {
                "势力 key".into()
            } else {
                e.factions.iter().map(|f| defs.faction(*f).key.as_str()).collect::<Vec<_>>().join("/")
            }
        };
        if k.needs_faction_a() {
            params.push(format!("faction_a（{}）", factions()));
        }
        if k.needs_faction_b() {
            params.push(format!("faction_b（{}）", factions()));
        }
        if let (true, Some((lo, hi))) = (k.needs_mult(), e.mult) {
            params.push(format!("mult（{lo}–{hi}）"));
        }
        if let (true, Some((lo, hi))) = (k.needs_days(), e.days) {
            params.push(format!("days（{lo}–{hi}）"));
        }
        if let (true, Some((lo, hi))) = (k.needs_delta(), e.delta) {
            params.push(format!("delta（{lo}–{hi}）"));
        }
        let _ = writeln!(s, "- {}：{}。参数：{}", e.key, e.name, params.join("，"));
    }
    s
}

/// 可引用的对象键（地点、商品、海区、势力、商会）。
pub fn key_catalog(world: &World) -> String {
    if world.defs.world_key != "classic" {
        return context::known_catalog(world, 3_000);
    }
    let defs = &world.defs;
    let join = |v: Vec<String>| v.join("、");
    let mut s = String::new();
    let _ = writeln!(
        s,
        "港口：{}",
        join(defs.locations.iter().filter(|l| l.is_port()).map(|l| format!("{}={}", l.key, l.name)).collect())
    );
    let _ = writeln!(s, "商品：{}", join(defs.goods.iter().map(|g| format!("{}={}", g.key, g.name)).collect()));
    let _ = writeln!(s, "海区：{}", join(defs.regions.iter().map(|g| format!("{}={}", g.key, g.name)).collect()));
    let _ = writeln!(s, "势力：{}", join(defs.factions.iter().map(|g| format!("{}={}", g.key, g.name)).collect()));
    let _ = writeln!(s, "商会：{}", join(defs.companies.iter().map(|g| format!("{}={}", g.key, g.name)).collect()));
    s
}

/// 年度事实的文字（编年史素材）。
pub fn year_facts_text(world: &World, f: &YearFacts) -> String {
    let defs = &world.defs;
    let wr = &defs.rules.world;
    let mut s = String::new();
    let _ = writeln!(s, "{}", year_text(wr, f.year));
    let events: Vec<&str> = f.events.iter().map(|e| defs.event_type(*e).name.as_str()).collect();
    let _ = writeln!(s, "发生的事件：{}", if events.is_empty() { "无".to_string() } else { events.join("、") });
    if !f.composed.is_empty() {
        let _ = writeln!(s, "其他大事：{}", f.composed.join("、"));
    }
    let wars: Vec<String> =
        f.wars.iter().map(|(a, b)| format!("{}与{}", defs.faction(*a).name, defs.faction(*b).name)).collect();
    let _ = writeln!(s, "战争：{}", if wars.is_empty() { "无".to_string() } else { wars.join("、") });
    let bankrupt: Vec<String> = f.bankrupt.iter().map(|o| owner_name(world, *o)).collect();
    let _ = writeln!(s, "破产：{}", if bankrupt.is_empty() { "无".to_string() } else { bankrupt.join("、") });
    if let Some(r) = f.richest {
        let _ = writeln!(s, "最富有者：{}", owner_name(world, r));
    }
    let _ = writeln!(s, "玩家商号净资产：{}", money_text(wr, f.player_net_worth));
    s
}

/// 效果说明的键与中文文字（显示层按语言取文字：`data/texts.toml` 与英文覆盖的 `[hints]`）。
pub const HINTS: &[(&str, &str)] = &[
    ("supply_up", "产量上升"),
    ("supply_down", "产量下降"),
    ("demand_up", "需求旺盛"),
    ("demand_down", "需求萎缩"),
    ("popularity", "一时流行"),
    ("storm_up", "风暴频发"),
    ("storm_down", "风平浪静"),
    ("pirates_up", "海盗猖獗"),
    ("pirates_down", "海盗收敛"),
    ("relation", "外交风向变化"),
    ("tax_up", "关税上调"),
    ("tax_down", "关税下调"),
    ("development", "港口建设变化"),
    ("credit_tight", "银根收紧"),
    ("credit_easy", "银根放松"),
    ("industry", "工艺变化"),
    ("colony_output_up", "殖民地增产"),
    ("colony_output_down", "殖民地减产"),
    ("colony_morale", "殖民地士气变化"),
    ("colony_morale_up", "殖民地士气高涨"),
    ("colony_morale_down", "殖民地士气低落"),
    ("colony_growth_up", "移民涌入"),
    ("colony_growth_down", "人口增长放缓"),
    ("site_claim", "殖民点易主"),
    ("discovery_rumor", "发现物的传闻"),
    ("export_ban", "禁止运出"),
    ("import_tariff", "进口关税"),
    ("export_tariff", "出口税"),
    ("subsidy", "产量补贴"),
];

/// 效果说明键对应的中文文字（未知的键原样返回空串）。
pub fn hint_zh(key: &str) -> &'static str {
    HINTS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v).unwrap_or("")
}

/// 事件效果说明的键（按系数判断方向）。
pub fn effect_hint_key(kind: EffectKind, mult: Option<Fx>) -> &'static str {
    let up = mult.is_some_and(|m| m > Fx::ONE);
    let pick = |a: &'static str, b: &'static str| if up { a } else { b };
    match kind {
        EffectKind::GoodSupply | EffectKind::SupplyShift | EffectKind::LocationSupply => {
            pick("supply_up", "supply_down")
        }
        EffectKind::GoodDemand | EffectKind::DemandShift | EffectKind::LocationDemand => {
            pick("demand_up", "demand_down")
        }
        EffectKind::Popularity => "popularity",
        EffectKind::RegionStorm => pick("storm_up", "storm_down"),
        EffectKind::RegionPirates => pick("pirates_up", "pirates_down"),
        EffectKind::RelationShift => "relation",
        EffectKind::FactionTax => pick("tax_up", "tax_down"),
        EffectKind::Development => "development",
        EffectKind::InterestShift => pick("credit_tight", "credit_easy"),
        EffectKind::IndustryEfficiency => "industry",
        EffectKind::ColonyOutput => pick("colony_output_up", "colony_output_down"),
        EffectKind::ColonyMorale => "colony_morale",
        EffectKind::ColonyGrowth => pick("colony_growth_up", "colony_growth_down"),
        EffectKind::SiteClaim => "site_claim",
        EffectKind::DiscoveryRumor => "discovery_rumor",
        EffectKind::ExportBan => "export_ban",
        EffectKind::ImportTariff => "import_tariff",
        EffectKind::ExportTariff => "export_tariff",
        EffectKind::Subsidy => "subsidy",
    }
}

/// 事件效果说明的键（按全部参数判断方向，例如士气的升降）。
pub fn effect_hint_key_for(kind: EffectKind, p: &crate::events::EventParams) -> &'static str {
    match (kind, p.delta) {
        (EffectKind::ColonyMorale, Some(d)) if d > 0 => "colony_morale_up",
        (EffectKind::ColonyMorale, Some(_)) => "colony_morale_down",
        _ => effect_hint_key(kind, p.mult),
    }
}

/// 事件效果的简短说明（界面与离线模板用）。
pub fn effect_hint(kind: EffectKind, mult: Option<Fx>) -> &'static str {
    hint_zh(effect_hint_key(kind, mult))
}

/// 事件效果的简短说明（按全部参数判断方向，例如士气的升降）。
pub fn effect_hint_for(kind: EffectKind, p: &crate::events::EventParams) -> &'static str {
    hint_zh(effect_hint_key_for(kind, p))
}

/// 月报事实的文字（市场月报的提示词用；ECONOMY.md 8.5）。
pub fn report_facts_text(world: &World, f: &crate::report::ReportFacts) -> String {
    let defs = &world.defs;
    let mut lines: Vec<String> = Vec::new();
    if let Some((l, g, pct)) = f.riser {
        lines.push(format!(
            "- 涨得最多：{}的{}，月均价比前一个月涨 {}%",
            defs.loc(l).name,
            defs.good(g).name,
            pct / 100
        ));
    }
    if let Some((l, g, pct)) = f.faller {
        lines.push(format!(
            "- 跌得最多：{}的{}，月均价比前一个月跌 {}%",
            defs.loc(l).name,
            defs.good(g).name,
            -pct / 100
        ));
    }
    if let Some((l, g)) = f.shortage {
        lines.push(format!("- 最短缺：{}的{}（库存不到目标的三成）", defs.loc(l).name, defs.good(g).name));
    }
    if let Some(p) = &f.policy {
        lines.push(format!("- 进行中的政策：{p}"));
    }
    if let Some((l, v)) = f.money {
        let state = if v < Fx::ONE { "钱袋吃紧，物价走低" } else { "钱袋充裕，物价走高" };
        lines.push(format!("- 钱袋：{}{state}（报价为往常的 {}%）", defs.loc(l).name, v.raw() / 100));
    }
    if let Some((c, g, v)) = f.outlook {
        let view = if v > 0 { "看好" } else { "看淡" };
        lines.push(format!("- 商会展望：{}{view}{}", owner_name(world, OwnerId::Company(c)), defs.good(g).name));
    }
    lines.join("\n")
}
