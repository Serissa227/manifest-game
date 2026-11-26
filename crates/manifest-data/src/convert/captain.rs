//! `data/captain.toml`：主角身世与属性（docs/ECONOMY.md 第 5 节）。文件不存在时开局不设身世。

use super::{Issues, lookup};
use manifest_core::calendar::Calendar;
use manifest_core::captain::*;
use manifest_core::defs::GoodDef;
use manifest_core::ids::*;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
mod tests;

pub(super) const FILE: &str = "captain.toml";
/// 起始货物的货值上限（金币）。
const MAX_GOODS_VALUE: i64 = 3_000;
/// 现行星座的个数（十二星座）。
const ZODIAC_SIGNS: usize = 12;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CaptainFile {
    #[serde(default)]
    points: PointsRaw,
    #[serde(default)]
    groups: Vec<GroupRaw>,
    #[serde(default)]
    ratings: Vec<RatingRaw>,
    #[serde(default)]
    abilities: Vec<AbilityRaw>,
    #[serde(default)]
    roles: Vec<RoleRaw>,
    attributes: Vec<AttributeRaw>,
    #[serde(default)]
    signs: Vec<SignRaw>,
    #[serde(default)]
    questions: Vec<QuestionRaw>,
    #[serde(default)]
    options: Vec<OptionRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PointsRaw {
    base: i64,
    free: i64,
    creation_cap: i64,
    max: i64,
    genius_numeracy: i64,
    manual_numeracy: i64,
    learn_numeracy: i64,
    learn_days: u32,
    age_min: i64,
    age_max: i64,
    age_default: i64,
    birthday_morale: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AttributeRaw {
    #[serde(default)]
    group: Option<String>,
    #[serde(default)]
    hooks: Vec<HookRaw>,
    #[serde(default)]
    hidden: bool,
    key: String,
    name: String,
    desc: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignRaw {
    key: String,
    name: String,
    desc: String,
    attribute: String,
    /// 现行星座的首日 [月, 日]
    #[serde(default)]
    start: Option<Vec<u32>>,
    /// 旧版星宫：只为旧存档保留，不参与按生日判定
    #[serde(default)]
    legacy: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct QuestionRaw {
    key: String,
    title: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OptionRaw {
    key: String,
    question: String,
    name: String,
    text: String,
    #[serde(default)]
    attrs: BTreeMap<String, i64>,
    #[serde(default)]
    effect: Option<EffectRaw>,
    /// 只给某位推荐角色用（带主角的剧本的 key；可选）
    #[serde(default)]
    hero: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EffectRaw {
    kind: String,
    #[serde(default)]
    value: Option<i64>,
    #[serde(default)]
    region: Option<String>,
    #[serde(default)]
    good: Option<String>,
    #[serde(default)]
    qty: Option<i64>,
    #[serde(default)]
    amount: Option<i64>,
    #[serde(default)]
    months: Option<u32>,
}

impl Default for PointsRaw {
    fn default() -> Self {
        Self {
            base: 1,
            free: 5,
            creation_cap: 7,
            max: 10,
            genius_numeracy: 7,
            manual_numeracy: 4,
            learn_numeracy: 5,
            learn_days: 360,
            age_min: 16,
            age_max: 45,
            age_default: 18,
            birthday_morale: 5,
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GroupRaw {
    key: String,
    name: String,
    range: [i64; 2],
    start: Option<i64>,
    free: Option<i64>,
    creation_cap: Option<i64>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HookRaw {
    hook: String,
    per_point: i64,
    max: Option<i64>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RatingRaw {
    key: String,
    name: String,
    weights: BTreeMap<String, i64>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AbilityRaw {
    key: String,
    name: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RoleHookRaw {
    hook: String,
    per_point: i64,
    max: Option<i64>,
    ability: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RoleRaw {
    key: String,
    name: String,
    ability: String,
    scope: RoleScope,
    #[serde(default)]
    hooks: Vec<RoleHookRaw>,
    legacy: Option<String>,
    /// H01：岗位窗口里的一句“在海上管什么”
    #[serde(default)]
    desc: String,
}

fn check_key(key: &str, item: &str, seen: &mut BTreeSet<String>, is: &mut Issues) {
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
        is.push(FILE, item, "key 须为小写英文、数字与下划线");
    }
    if !seen.insert(key.to_string()) {
        is.push(FILE, item, "key 重复");
    }
}
fn hook(raw: &HookRaw, rules: &AttributeRules, item: &str, is: &mut Issues) -> Option<HookDef> {
    let Some(hook) = AttrHook::parse(&raw.hook) else {
        is.push(FILE, item, format!("未知钩子“{}”", raw.hook));
        return None;
    };
    if !(0..=10_000).contains(&raw.per_point) {
        is.push(FILE, item, "钩子 per_point 系数须在 0–10000 之间");
    }
    if raw.max.is_some_and(|m| m < 0 || m > rules.cap(hook)) {
        is.push(FILE, item, format!("钩子 max 超出全局上限 {}", rules.cap(hook)));
    }
    Some(HookDef { hook, per_point: raw.per_point, max: raw.max })
}
pub(super) fn attribute_rules(raw: Option<BTreeMap<String, i64>>, is: &mut Issues) -> AttributeRules {
    let mut rules = AttributeRules::default();
    for (key, cap) in raw.unwrap_or_default() {
        match AttrHook::parse(&key) {
            None => is.push("rules.toml", format!("attributes.{key}"), "未知钩子"),
            Some(h) if cap < 0 || cap > h.ceiling() => {
                is.push("rules.toml", format!("attributes.{key}"), format!("全局上限须在 0–{} 之间", h.ceiling()))
            }
            Some(h) => {
                rules.caps.insert(h, cap);
            }
        }
    }
    rules
}

/// 转换时需要的其他各表。
pub(super) struct Tables<'a> {
    pub rules: &'a AttributeRules,
    pub calendar: &'a manifest_core::calendar::Calendar,
    pub good_ids: &'a BTreeMap<String, GoodId>,
    pub goods: &'a [GoodDef],
    pub region_ids: &'a BTreeMap<String, RegionId>,
}

fn nonempty(v: &str, item: &str, field: &str, is: &mut Issues) {
    if v.trim().is_empty() {
        is.push(FILE, item, format!("{field} 不能为空"));
    }
}

fn effect(raw: &EffectRaw, t: &Tables, item: &str, is: &mut Issues) -> Option<StartEffect> {
    let within = |v: Option<i64>, lo: i64, hi: i64, name: &str, is: &mut Issues| -> Option<i64> {
        match v {
            Some(v) if (lo..=hi).contains(&v) => Some(v),
            Some(v) => {
                is.push(FILE, item, format!("effect.{name} = {v} 超出范围 {lo}…{hi}"));
                None
            }
            None => {
                is.push(FILE, item, format!("effect 缺少 {name}"));
                None
            }
        }
    };
    match raw.kind.as_str() {
        "cash_pct" => within(raw.value, -20, 20, "value", is).map(StartEffect::CashPct),
        "reputation" => within(raw.value, -10, 10, "value", is).map(StartEffect::Reputation),
        "fame" => within(raw.value, 0, 20, "value", is).map(StartEffect::Fame),
        "morale" => within(raw.value, 0, 20, "value", is).map(StartEffect::Morale),
        "chart" => {
            let Some(k) = &raw.region else {
                is.push(FILE, item, "effect 缺少 region");
                return None;
            };
            lookup(t.region_ids, k, FILE, item, "海区", is).map(StartEffect::Chart)
        }
        "rumor" => Some(StartEffect::Rumor),
        "goods" => {
            let Some(k) = &raw.good else {
                is.push(FILE, item, "effect 缺少 good");
                return None;
            };
            let g = lookup(t.good_ids, k, FILE, item, "商品", is)?;
            let qty = within(raw.qty, 1, 500, "qty", is)?;
            let value = t.goods.get(g.idx()).map(|d| d.base_price).unwrap_or(0) * qty;
            if value > MAX_GOODS_VALUE {
                is.push(FILE, item, format!("起始货物的货值 {value} 超过上限 {MAX_GOODS_VALUE}"));
                return None;
            }
            Some(StartEffect::Goods(g, qty))
        }
        "loan" => {
            let amount = within(raw.amount, 1_000, 20_000, "amount", is)?;
            let months = within(raw.months.map(i64::from), 6, 24, "months", is)?;
            Some(StartEffect::Loan { amount, months: months as u32 })
        }
        other => {
            is.push(
                FILE,
                item,
                format!(
                    "未知的开局效果“{other}”，应为 cash_pct / reputation / fame / morale / chart / rumor / goods / loan"
                ),
            );
            None
        }
    }
}

pub(super) fn convert(raw: Option<CaptainFile>, t: &Tables, is: &mut Issues) -> CaptainDefs {
    let Some(raw) = raw else { return CaptainDefs::default() };
    let p = &raw.points;
    let points = CaptainPoints {
        base: p.base,
        free: p.free,
        creation_cap: p.creation_cap,
        max: p.max,
        genius_numeracy: p.genius_numeracy,
        manual_numeracy: p.manual_numeracy,
        learn_numeracy: p.learn_numeracy,
        learn_days: p.learn_days,
        age_min: p.age_min,
        age_max: p.age_max,
        age_default: p.age_default,
        birthday_morale: p.birthday_morale,
    };
    if p.base < 0 || p.free < 0 || p.creation_cap < p.base || p.max < p.creation_cap || p.max > 10 {
        is.push(FILE, "points", "须满足 0 ≤ base ≤ creation_cap ≤ max ≤ 10，free ≥ 0");
    }
    if !(1..=p.max).contains(&p.genius_numeracy)
        || !(1..=p.max).contains(&p.learn_numeracy)
        || !(0..=p.max).contains(&p.manual_numeracy)
        || p.learn_days == 0
    {
        is.push(
            FILE,
            "points",
            "genius_numeracy、learn_numeracy 须在 1 到 max 之间，manual_numeracy 在 0 到 max 之间，learn_days 至少为 1",
        );
    }
    if p.age_min < 1 || p.age_max < p.age_min || !(0..=50).contains(&p.birthday_morale) {
        is.push(FILE, "points", "年龄范围须满足 1 ≤ age_min ≤ age_max，birthday_morale 须在 0 到 50 之间");
    }
    if !(p.age_min..=p.age_max).contains(&p.age_default) {
        is.push(
            FILE,
            "points",
            format!("age_default = {} 须在 age_min {} 与 age_max {} 之间", p.age_default, p.age_min, p.age_max),
        );
    }

    let legacy = raw.groups.is_empty();
    let mut groups = Vec::new();
    let mut seen = BTreeSet::new();
    for g in &raw.groups {
        let item = format!("groups[{}]", g.key);
        check_key(&g.key, &item, &mut seen, is);
        nonempty(&g.name, &item, "name", is);
        let [lo, hi] = g.range;
        let start = g.start.unwrap_or(lo);
        let free = g.free.unwrap_or(0);
        let cap = g.creation_cap.unwrap_or(hi);
        if lo < 0 || hi < lo || hi > 10_000 || start < lo || start > cap || cap > hi || !(0..=1_000_000).contains(&free)
        {
            is.push(
                FILE,
                &item,
                "组须满足 0 ≤ range[0] ≤ start ≤ creation_cap ≤ range[1] ≤ 10000，free 在 0–1000000 之间",
            );
        }
        groups.push(AttributeGroup {
            key: g.key.clone(),
            name: g.name.clone(),
            range: g.range,
            start,
            free,
            creation_cap: cap,
        });
    }
    if legacy {
        groups.push(AttributeGroup::classic(&points));
    }
    let keys: Vec<&str> = raw.attributes.iter().map(|a| a.key.as_str()).collect();
    if legacy && keys != ATTRIBUTES {
        is.push(FILE, "attributes", format!("属性须按顺序正好是 {}（自定义属性须声明 groups）", ATTRIBUTES.join("、")));
    }
    let mut seen = BTreeSet::new();
    let mut attributes = Vec::new();
    for a in &raw.attributes {
        let item = format!("attributes[{}]", a.key);
        check_key(&a.key, &item, &mut seen, is);
        nonempty(&a.name, &item, "name", is);
        let group = a.group.as_deref().unwrap_or(if legacy { "classic" } else { "" });
        if !groups.iter().any(|g| g.key == group) {
            is.push(FILE, &item, format!("组不存在：{group}"));
        }
        let mut hooks = Vec::new();
        let mut hook_keys = BTreeSet::new();
        for h in &a.hooks {
            if !hook_keys.insert(h.hook.clone()) {
                is.push(FILE, &item, "钩子重复");
            }
            if let Some(h) = hook(h, t.rules, &item, is) {
                hooks.push(h);
            }
        }
        if legacy && a.hooks.is_empty() {
            hooks = classic_hooks(&a.key);
        }
        attributes.push(AttributeDef {
            key: a.key.clone(),
            name: a.name.clone(),
            desc: a.desc.clone(),
            group: group.into(),
            hidden: a.hidden,
            hooks,
        });
    }
    if attributes.is_empty() {
        is.push(FILE, "attributes", "至少需要一项属性");
    }
    let attr_index = |key: &str| attributes.iter().position(|a| a.key == key);
    let mut ratings = Vec::new();
    for r in &raw.ratings {
        let item = format!("ratings[{}]", r.key);
        check_key(&r.key, &item, &mut seen, is);
        nonempty(&r.name, &item, "name", is);
        let mut weights = Vec::new();
        for (k, w) in &r.weights {
            if !(1..=10_000).contains(w) {
                is.push(FILE, &item, "评价权重须为 1–10000 的整数");
            }
            match attr_index(k) {
                Some(i) => weights.push((i, *w)),
                None => is.push(FILE, &item, format!("评价权重引用未知属性“{k}”")),
            }
        }
        if weights.is_empty() || weights.iter().try_fold(0i64, |a, (_, w)| a.checked_add(*w)).is_none_or(|s| s > 10_000)
        {
            is.push(FILE, &item, "评价权重不能为空，合计不得超过 10000");
        }
        ratings.push(RatingDef { key: r.key.clone(), name: r.name.clone(), weights });
    }
    let mut abilities = classic_abilities();
    let mut ability_keys: BTreeSet<String> = abilities.iter().map(|a| a.key.clone()).collect();
    for a in &raw.abilities {
        let item = format!("abilities[{}]", a.key);
        check_key(&a.key, &item, &mut ability_keys, is);
        nonempty(&a.name, &item, "name", is);
        abilities.push(AbilityDef { key: a.key.clone(), name: a.name.clone() });
    }
    let mut roles = Vec::new();
    let mut role_keys = BTreeSet::new();
    let mut legacy_slots = BTreeSet::new();
    for r in &raw.roles {
        let item = format!("roles[{}]", r.key);
        check_key(&r.key, &item, &mut role_keys, is);
        nonempty(&r.name, &item, "name", is);
        if !ability_keys.contains(&r.ability) {
            is.push(FILE, &item, format!("岗位引用未知能力“{}”", r.ability));
        }
        let mut hooks = Vec::new();
        let mut hook_keys = BTreeSet::new();
        for h in &r.hooks {
            let ability = h.ability.as_deref().unwrap_or(&r.ability);
            if !ability_keys.contains(ability) {
                is.push(FILE, &item, format!("岗位钩子引用未知能力“{ability}”"));
            }
            if !hook_keys.insert(h.hook.clone()) {
                is.push(FILE, &item, "岗位钩子重复");
            }
            if let Some(effect) =
                hook(&HookRaw { hook: h.hook.clone(), per_point: h.per_point, max: h.max }, t.rules, &item, is)
            {
                hooks.push(RoleHook { effect, ability: ability.into() });
            }
        }
        let slot = r.legacy.as_deref().and_then(|key| {
            let found = classic_roles().into_iter().find(|r| r.key == key);
            if found.as_ref().is_none_or(|f| f.scope != r.scope) {
                is.push(FILE, &item, "legacy 须引用同一 scope 的经典岗位");
            }
            if !legacy_slots.insert(key.to_string()) {
                is.push(FILE, &item, "legacy 岗位绑定重复");
            }
            found.and_then(|f| f.legacy)
        });
        roles.push(RoleDef {
            key: r.key.clone(),
            name: r.name.clone(),
            ability: r.ability.clone(),
            scope: r.scope,
            legacy: slot,
            hooks,
            desc: r.desc.clone(),
        });
    }
    if raw.roles.is_empty() {
        roles = classic_roles();
    }

    // 星座：现行的十二星座写首日（start = [月, 日]），按生日判定；旧版星宫（legacy = true）只为旧存档保留，不写首日。
    // key 在两者之间也不能重复（存档按 key 记下主角的星座）。
    let mut sign_keys = BTreeSet::new();
    let mut signs = Vec::new();
    for s in &raw.signs {
        let item = format!("signs[{}]", s.key);
        if !sign_keys.insert(s.key.clone()) {
            is.push(FILE, &item, "key 重复");
        }
        nonempty(&s.name, &item, "name", is);
        let start = match (s.legacy, s.start.as_deref()) {
            (true, None) => None,
            (true, Some(_)) => {
                is.push(FILE, &item, "旧版星宫（legacy = true）不参与按生日判定，不能写 start");
                None
            }
            (false, None) => {
                is.push(FILE, &item, "缺少 start（首日 [月, 日]）；只为旧存档保留的星宫请写 legacy = true");
                None
            }
            (false, Some(&[month, day])) if MonthDay::new(month, day).is_valid_in(t.calendar) => {
                Some(MonthDay::new(month, day))
            }
            (false, Some(v)) => {
                is.push(FILE, &item, format!("start = {v:?} 不是{}里的日子：须写成合法的 [月, 日]", t.calendar.era()));
                None
            }
        };
        let Some(attribute) = attr_index(&s.attribute) else {
            is.push(FILE, &item, format!("未知的属性“{}”", s.attribute));
            continue;
        };
        signs.push(SignDef { key: s.key.clone(), name: s.name.clone(), desc: s.desc.clone(), attribute, start });
    }

    // 问题与选项
    let mut qkeys: BTreeMap<String, usize> = BTreeMap::new();
    let mut questions = Vec::new();
    for q in &raw.questions {
        let item = format!("questions[{}]", q.key);
        if qkeys.insert(q.key.clone(), questions.len()).is_some() {
            is.push(FILE, &item, "key 重复");
        }
        nonempty(&q.title, &item, "title", is);
        questions.push(QuestionDef { key: q.key.clone(), title: q.title.clone(), prompt: q.prompt.clone() });
    }
    if legacy && questions.is_empty() {
        is.push(FILE, "questions", "至少需要一道身世问题");
    }
    let mut okeys = BTreeSet::new();
    let mut options = Vec::new();
    let mut per_question = vec![0usize; questions.len()];
    for o in &raw.options {
        let item = format!("options[{}]", o.key);
        if !okeys.insert(o.key.clone()) {
            is.push(FILE, &item, "key 重复（选项的 key 在整个文件里唯一）");
        }
        nonempty(&o.name, &item, "name", is);
        nonempty(&o.text, &item, "text", is);
        let Some(&question) = qkeys.get(&o.question) else {
            is.push(FILE, &item, format!("未知的问题“{}”", o.question));
            continue;
        };
        // 开局向导只列出不带 hero 的选项：每道问题至少要有两个
        if o.hero.is_none() {
            per_question[question] += 1;
        }
        let mut attrs = vec![0i64; attributes.len()];
        for (k, v) in &o.attrs {
            match attr_index(k) {
                Some(i) if (0..=3).contains(v) => attrs[i] = *v,
                Some(_) => is.push(FILE, &item, format!("attrs.{k} = {v} 须在 0 到 3 之间")),
                None => is.push(FILE, &item, format!("未知的属性“{k}”")),
            }
        }
        if attrs.iter().sum::<i64>() > 3 {
            is.push(FILE, &item, "一个选项的属性加点合计不能超过 3");
        }
        let eff = o.effect.as_ref().and_then(|e| effect(e, t, &item, is));
        options.push(OptionDef {
            key: o.key.clone(),
            question,
            name: o.name.clone(),
            text: o.text.clone(),
            attrs,
            effect: eff,
            hero: o.hero.clone(),
        });
    }
    for (i, n) in per_question.iter().enumerate() {
        if *n < 2 {
            is.push(FILE, format!("questions[{}]", questions[i].key), "每道问题至少要有两个选项");
        }
    }
    // 自由分配的点数必须总能分完：身世（每题至多 3 点）与星座（1 点）加得再集中，开局上限之下也要留得出 free 点的空位
    for g in &groups {
        let n = attributes.iter().filter(|a| a.group == g.key).count() as i64;
        if n == 0 {
            is.push(FILE, format!("groups[{}]", g.key), "组内至少需要一项属性");
        }
        let background: i64 = (0..questions.len())
            .map(|qi| {
                options
                    .iter()
                    .filter(|o| o.question == qi)
                    .map(|o| {
                        o.attrs
                            .iter()
                            .enumerate()
                            .filter(|(i, _)| attributes[*i].group == g.key)
                            .map(|(_, v)| *v)
                            .sum::<i64>()
                    })
                    .max()
                    .unwrap_or(0)
            })
            .sum();
        let sign = i64::from(signs.iter().any(|s| attributes[s.attribute].group == g.key));
        let most = n.saturating_mul(g.start).saturating_add(background).saturating_add(sign);
        if n.saturating_mul(g.creation_cap).saturating_sub(most.min(n.saturating_mul(g.creation_cap))) < g.free {
            is.push(
                FILE,
                if legacy { "points".into() } else { format!("groups[{}]", g.key) },
                "开局上限太低，放不下 free 点",
            );
        }
    }
    let defs = CaptainDefs { points, attributes, groups, ratings, abilities, roles, legacy, signs, questions, options };
    if legacy || !defs.signs.is_empty() {
        check_zodiac(&defs, t.calendar, is);
    }
    defs
}

/// 现行星座的日期区间：正好十二个；按首日排好后每个到下一个首日的前一天为止（摩羯座跨年），
/// 须互不重叠（没有两个星座同一天开始）、首尾相接、合起来正好一年 360 天——生日落在哪一天都恰好属于一个星座。
fn check_zodiac(defs: &CaptainDefs, calendar: &Calendar, is: &mut Issues) {
    let spans = defs.zodiac_spans_in(calendar);
    let year_days = calendar.year_days();
    if (defs.legacy && spans.len() != ZODIAC_SIGNS) || spans.is_empty() {
        is.push(
            FILE,
            "signs",
            format!("现行星座（写了 start 的）须正好十二个，现在有 {} 个；其余的请写 legacy = true", spans.len()),
        );
    }
    let mut total = 0;
    for (i, (s, span)) in spans.iter().enumerate() {
        let (next, next_span) = spans[(i + 1) % spans.len()];
        let date = |d: MonthDay| format!("{} 月 {} 日", d.month, d.day);
        if span.days == 0 {
            is.push(
                FILE,
                format!("signs[{}]", s.key),
                format!("与 signs[{}] 同一天（{}）开始，日期区间重叠", next.key, date(span.first)),
            );
        } else if MonthDay::from_ordinal_in(span.last.ordinal_in(calendar).unwrap_or(0) + 1, calendar)
            != next_span.first
        {
            is.push(
                FILE,
                format!("signs[{}]", s.key),
                format!("日期区间 {}–{} 没有与 signs[{}] 首尾相接", date(span.first), date(span.last), next.key),
            );
        }
        total += span.days;
    }
    if total != year_days {
        is.push(FILE, "signs", format!("现行星座的日期区间合起来须正好一年 {year_days} 天，现在是 {total} 天"));
    }
}
