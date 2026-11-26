//! 物品分片与封闭效果的严格校验；不把错误的效果默默丢弃。
use super::{Issues, check_keys, load_optional};
use crate::worlds::EffectiveWorld;
use manifest_core::captain::CaptainDefs;
use manifest_core::defs::RegionDef;
use manifest_core::items::{
    effects::{Effect, EffectKind},
    *,
};
use std::collections::BTreeSet;

const FILE: &str = "items.toml";

pub(super) fn rules(raw: Option<ItemsRules>, issues: &mut Issues) -> ItemsRules {
    let r = raw.unwrap_or_default();
    if !(1..=100).contains(&r.shelf_slots)
        || !(1..=1_000).contains(&r.stock)
        || !(0..=10_000 - manifest_core::news::MAX_DISCOUNT.0).contains(&r.sell_bp)
        || !(1..=365).contains(&r.use_days)
        || !(1..=10_000).contains(&r.xp_per_point)
    {
        issues.push(
            "rules.toml",
            "items",
            "货架 1–100 格、库存 1–1000、收购基点不得超过最低折扣买价、使用天数 1–365、成长阈值 1–10000",
        );
    }
    if r.attribute_bonus.single < 0
        || r.attribute_bonus.single > 10
        || r.attribute_bonus.total < r.attribute_bonus.single
        || r.attribute_bonus.total > 20
    {
        issues.push("rules.toml", "items.attribute_bonus", "要求 0 <= single <= 10 且 single <= total <= 20");
    }
    for (kind, limit) in &r.effects {
        let hard = kind.ceiling();
        if limit.single < 0 || limit.single > hard.single || limit.total < limit.single || limit.total > hard.total {
            issues.push("rules.toml", format!("items.effects.{}", kind.key()), "单件与叠加上限无效或超过引擎上限");
        }
    }
    r
}

fn key_valid(key: &str) -> bool {
    !key.is_empty() && key.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

fn effects(effects: &[Effect], rules: &ItemsRules, key: &str, regions: &[RegionDef], issues: &mut Issues) {
    let mut totals = std::collections::BTreeMap::<EffectKind, i64>::new();
    for e in effects {
        let total = totals.entry(e.kind).or_default();
        *total = total.saturating_add(e.value.max(0));
        if e.value < 0 || *total > rules.limit(e.kind).single {
            issues.push(FILE, key, format!("{} 超过单件上限", e.kind.key()));
        }
        if (e.activity.is_some() && e.kind != EffectKind::ActivityPct)
            || ((e.tag.is_some() || e.culture.is_some()) && e.kind != EffectKind::AffinityPct)
            || (e.spell.is_some() != (e.kind == EffectKind::Spell))
            || (e.region.is_some() != (e.kind == EffectKind::ChartReveal))
        {
            issues.push(FILE, key, format!("{} 的限定参数不匹配", e.kind.key()));
        }
        if let Some(region) = &e.region
            && !regions.iter().any(|r| r.key == *region)
        {
            issues.push(FILE, key, format!("未知海区 {region}"));
        }
        for target in [&e.activity, &e.tag, &e.culture, &e.spell].into_iter().flatten() {
            if !key_valid(target) {
                issues.push(FILE, key, "效果目标 key 无效");
            }
        }
    }
}

pub(super) fn load(
    dir: &EffectiveWorld,
    captain: &CaptainDefs,
    regions: &[RegionDef],
    rules: &ItemsRules,
    issues: &mut Issues,
) -> ItemsDefs {
    if !dir.module_enabled("items") {
        return ItemsDefs::default();
    }
    let defs: ItemsDefs = load_optional(dir, FILE, issues).unwrap_or_default();
    validate(&defs, captain, regions, rules, issues);
    defs
}

fn validate(defs: &ItemsDefs, captain: &CaptainDefs, regions: &[RegionDef], rules: &ItemsRules, issues: &mut Issues) {
    check_keys(FILE, "items", defs.items.iter().map(|x| (x.key.as_str(), x.name.as_str())), issues);
    check_keys(FILE, "sets", defs.sets.iter().map(|x| (x.key.as_str(), x.name.as_str())), issues);
    check_keys(FILE, "book_categories", defs.book_categories.iter().map(|x| (x.key.as_str(), x.name.as_str())), issues);
    for i in &defs.items {
        if !(1..=5).contains(&i.rarity) || !(0..=1_000_000_000).contains(&i.price) {
            issues.push(FILE, &i.key, "rarity 应为 1–5，price 应为 0–1000000000");
        }
        for (attr, value) in &i.bonus {
            if captain.attribute_index(attr).is_none() || *value < 0 || *value > rules.attribute_bonus.single {
                issues.push(FILE, &i.key, format!("未知属性或单件加成超限：{attr}"));
            }
        }
        effects(&i.effects, rules, &i.key, regions, issues);
        effects(&i.uses, rules, &i.key, regions, issues);
        if let Some(shop) = &i.shop
            && (shop.weight <= 0
                || shop.weight > 1_000_000
                || !(1..=5).contains(&shop.min_size)
                || shop.seasons.iter().any(|s| *s > 3)
                || i.protected())
        {
            issues.push(FILE, &i.key, "shop 权重、规模、季节无效，或关键物品不能出售");
        }
        if let Some(chart) = &i.chart {
            for key in &chart.regions {
                if !regions.iter().any(|r| &r.key == key) {
                    issues.push(FILE, &i.key, format!("未知海区 {key}"));
                }
            }
        }
        if (i.kind == ItemKind::Book) != i.read.is_some() {
            issues.push(FILE, &i.key, "书必须有 read，其他类别不能有 read");
        }
        if let Some(read) = &i.read {
            if !(1..=3650).contains(&read.days) || !defs.book_categories.iter().any(|c| c.key == read.category) {
                issues.push(FILE, &i.key, "阅读天数无效或未知书目类别");
            }
            for (attr, xp) in &read.gains {
                if captain.attribute_index(attr).is_none() || !(0..=10_000).contains(xp) {
                    issues.push(FILE, &i.key, format!("阅读成长属性未知或经验超限：{attr}"));
                }
            }
            if read.lang.as_ref().is_some_and(|k| !key_valid(k))
                || i.work.as_ref().is_some_and(|k| !key_valid(k))
                || read.skills.iter().any(|s| !key_valid(&s.skill) || !(0..=10_000).contains(&s.xp))
                || read.records.iter().any(|key| !key_valid(key))
            {
                issues.push(FILE, &i.key, "作品、语言或技能经验无效");
            }
            // 地理揭示严格引用海区/海图；见闻旗标另用 records，不能把拼错的海区静默当作旗标。
            for key in &read.reveals {
                if !regions.iter().any(|r| &r.key == key) && defs.item(key).is_none_or(|i| i.chart.is_none()) {
                    issues.push(FILE, &i.key, format!("reveals 引用了不存在的海区或海图：{key}"));
                }
            }
        }
        if let Some(base) = &i.variant_of
            && (base == &i.key || defs.item(base).is_none())
        {
            issues.push(FILE, &i.key, format!("variant_of 引用无效：{base}"));
        }
    }
    for set in &defs.sets {
        let unique: BTreeSet<_> = set.items.iter().collect();
        if set.threshold() == 0
            || set.threshold() > unique.len()
            || unique.len() != set.items.len()
            || set.items.iter().any(|k| defs.item(k).is_none())
        {
            issues.push(FILE, &set.key, "套装门槛无效、成员重复或引用了未知物品");
        }
        effects(&set.bonus, rules, &set.key, regions, issues);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sell_price_cannot_exceed_the_lowest_discounted_buy_price() {
        let ceiling = 10_000 - manifest_core::news::MAX_DISCOUNT.0;
        let mut issues = Issues::default();
        rules(Some(ItemsRules { sell_bp: ceiling, ..Default::default() }), &mut issues);
        assert!(issues.list.is_empty());
        rules(Some(ItemsRules { sell_bp: ceiling + 1, ..Default::default() }), &mut issues);
        assert_eq!(issues.list.len(), 1);
    }
    #[test]
    fn invalid_effect_caps_and_references_are_reported() {
        let mut issues = Issues::default();
        let mut r = ItemsRules { sell_bp: 10_001, ..Default::default() };
        r.effects.insert(EffectKind::SpeedPct, manifest_core::items::effects::EffectLimit { single: 500, total: 999 });
        rules(Some(r), &mut issues);
        assert_eq!(issues.list.len(), 2);
        let defs: ItemsDefs = toml::from_str(
            r#"
[[book_categories]]
key = "test"
name = "测试"
[[items]]
key = "bad"
name = "坏书"
kind = "book"
rarity = 1
price = 10
effects = [{kind = "speed_pct", value = 31}]
read = {days = 1, category = "test", reveals = ["missing"]}
"#,
        )
        .expect("结构合法");
        let mut issues = Issues::default();
        validate(&defs, &CaptainDefs::default(), &[], &ItemsRules::default(), &mut issues);
        assert_eq!(issues.list.len(), 2);
        assert!(issues.list.iter().any(|i| i.message.contains("missing")));
    }
}
