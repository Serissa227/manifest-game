//! 主角身世的视图（`docs/ECONOMY.md` 第 5 节）：开局向导用的身世数据（按当前语言），与概览里的主角档案。

use crate::views::{Ctx, PLAYER};
use manifest_core::World;
use manifest_core::captain::{SignDef, StartEffect};
use serde::Serialize;

/// 点数规则。
#[derive(Clone, Debug, Serialize)]
pub struct PointsView {
    pub base: i64,
    pub free: i64,
    pub creation_cap: i64,
    pub max: i64,
    pub genius_numeracy: i64,
    pub manual_numeracy: i64,
    pub learn_numeracy: i64,
    pub learn_days: u32,
    pub age_min: i64,
    pub age_max: i64,
    /// 开局向导里年龄的缺省值
    pub age_default: i64,
    pub birthday_morale: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AttributeView {
    pub group: String,
    pub hidden: bool,
    pub key: String,
    pub name: String,
    pub desc: String,
}

/// 星座：现行的十二星座按生日（月、日）判定；旧版星宫只为旧存档保留名字与特性。
#[derive(Clone, Debug, Serialize)]
pub struct SignView {
    pub key: String,
    pub name: String,
    pub desc: String,
    /// 加一点的属性 key
    pub attribute: String,
    /// 现行星座的首日与末日 [月, 日]（都含；摩羯座跨年：[12, 22] 到 [1, 19]）；旧版星宫为空
    pub start: Option<[u32; 2]>,
    pub end: Option<[u32; 2]>,
    /// 旧版星宫：不参与按生日判定
    pub legacy: bool,
}

/// 开局效果（界面按 kind 与参数写成一句话）。
#[derive(Clone, Debug, Serialize)]
pub struct EffectView {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<i64>,
    /// 海区编号（chart）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<u16>,
    /// 商品编号与数量（goods）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub good: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qty: Option<i64>,
    /// 贷款金额与期限（loan）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub months: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct OptionView {
    pub key: String,
    pub name: String,
    pub text: String,
    /// 属性加点（只列非零的，[属性 key, 点数]）
    pub attrs: Vec<(String, i64)>,
    pub effect: Option<EffectView>,
    /// 只给某位推荐角色用（带主角的剧本的 key）：开局向导不列出它
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hero: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct QuestionView {
    pub key: String,
    pub title: String,
    pub prompt: String,
    pub options: Vec<OptionView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct GroupView {
    pub key: String,
    pub name: String,
    pub range: [i64; 2],
    pub start: i64,
    pub free: i64,
    pub creation_cap: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct RatingView {
    pub key: String,
    pub name: String,
    pub weights: Vec<(String, i64)>,
}
#[derive(Clone, Debug, Serialize)]
pub struct RoleView {
    pub key: String,
    pub name: String,
    pub ability: String,
    pub scope: manifest_core::captain::RoleScope,
    /// H01：一句“在海上管什么”；没写时不输出
    #[serde(skip_serializing_if = "String::is_empty")]
    pub desc: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AbilityView {
    pub key: String,
    pub name: String,
}

/// 开局向导用的身世数据；数据里没有 captain.toml 时整体为空。
#[derive(Clone, Debug, Serialize)]
pub struct CaptainDefsView {
    pub points: PointsView,
    pub groups: Vec<GroupView>,
    pub ratings: Vec<RatingView>,
    pub roles: Vec<RoleView>,
    pub abilities: Vec<AbilityView>,
    pub attributes: Vec<AttributeView>,
    /// 现行的十二星座在前（按数据顺序：白羊座起），旧版星宫在后
    pub signs: Vec<SignView>,
    pub questions: Vec<QuestionView>,
}

fn effect_view(e: &StartEffect) -> EffectView {
    let mut v = EffectView { kind: "", value: None, region: None, good: None, qty: None, amount: None, months: None };
    match *e {
        StartEffect::CashPct(x) => (v.kind, v.value) = ("cash_pct", Some(x)),
        StartEffect::Reputation(x) => (v.kind, v.value) = ("reputation", Some(x)),
        StartEffect::Fame(x) => (v.kind, v.value) = ("fame", Some(x)),
        StartEffect::Morale(x) => (v.kind, v.value) = ("morale", Some(x)),
        StartEffect::Chart(r) => (v.kind, v.region) = ("chart", Some(r.0)),
        StartEffect::Rumor => v.kind = "rumor",
        StartEffect::Goods(g, q) => (v.kind, v.good, v.qty) = ("goods", Some(g.0), Some(q)),
        StartEffect::Loan { amount, months } => (v.kind, v.amount, v.months) = ("loan", Some(amount), Some(months)),
    }
    v
}

/// 身世数据（名字与文字按 `ctx` 的语言）。
pub fn captain_defs_view(ctx: Ctx<'_>) -> Option<CaptainDefsView> {
    let c = &ctx.names.captain;
    if !c.enabled() {
        return None;
    }
    let p = &c.points;
    let spans = c.zodiac_spans_in(&ctx.names.calendar);
    let sign_view = |s: &SignDef| {
        let span = spans.iter().find(|(x, _)| x.key == s.key).map(|(_, span)| span);
        SignView {
            key: s.key.clone(),
            name: s.name.clone(),
            desc: s.desc.clone(),
            attribute: c.check_key(s.attribute).to_string(),
            start: span.map(|x| [x.first.month, x.first.day]),
            end: span.map(|x| [x.last.month, x.last.day]),
            legacy: s.is_legacy(),
        }
    };
    Some(CaptainDefsView {
        abilities: c.abilities.iter().map(|a| AbilityView { key: a.key.clone(), name: a.name.clone() }).collect(),
        groups: c
            .groups
            .iter()
            .map(|g| GroupView {
                key: g.key.clone(),
                name: g.name.clone(),
                range: g.range,
                start: g.start,
                free: g.free,
                creation_cap: g.creation_cap,
            })
            .collect(),
        ratings: c
            .ratings
            .iter()
            .map(|r| RatingView {
                key: r.key.clone(),
                name: r.name.clone(),
                weights: r.weights.iter().map(|(i, w)| (c.check_key(*i).to_string(), *w)).collect(),
            })
            .collect(),
        roles: c
            .roles
            .iter()
            .map(|r| RoleView {
                key: r.key.clone(),
                name: r.name.clone(),
                ability: r.ability.clone(),
                scope: r.scope,
                desc: r.desc.clone(),
            })
            .collect(),
        points: PointsView {
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
        },
        attributes: c
            .attributes
            .iter()
            .map(|a| AttributeView {
                key: a.key.clone(),
                name: a.name.clone(),
                desc: a.desc.clone(),
                group: a.group.clone(),
                hidden: a.hidden,
            })
            .collect(),
        signs: c
            .signs
            .iter()
            .filter(|s| !s.is_legacy())
            .chain(c.signs.iter().filter(|s| s.is_legacy()))
            .map(sign_view)
            .collect(),
        questions: c
            .questions
            .iter()
            .enumerate()
            .map(|(qi, q)| QuestionView {
                key: q.key.clone(),
                title: q.title.clone(),
                prompt: q.prompt.clone(),
                options: c
                    .options
                    .iter()
                    .filter(|o| o.question == qi)
                    .map(|o| OptionView {
                        key: o.key.clone(),
                        name: o.name.clone(),
                        text: o.text.clone(),
                        attrs: o
                            .attrs
                            .iter()
                            .enumerate()
                            .filter(|(_, v)| **v != 0)
                            .map(|(i, v)| (c.check_key(i).to_string(), *v))
                            .collect(),
                        effect: o.effect.as_ref().map(effect_view),
                        hero: o.hero.clone(),
                    })
                    .collect(),
            })
            .collect(),
    })
}

/// 概览里的主角档案。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ProfileView {
    pub birthday: manifest_core::captain::Birthday,
    /// 星座 key 与名字（旧存档里的旧版星宫也按 key 找到名字）
    pub sign: String,
    pub sign_name: String,
    /// 身世五问的回答（选项 key）
    pub answers: Vec<String>,
    /// 世界属性（[属性 key, 数值]）
    pub attrs: Vec<(String, i64)>,
    pub ratings: Vec<(String, i64)>,
    /// 主角本人会的奇才之法（开局自选与学会的）
    pub methods: Vec<String>,
    pub created: u32,
}

pub fn profile_view(ctx: Ctx<'_>, world: &World) -> Option<ProfileView> {
    let c = world.captain_profile(PLAYER)?;
    Some(ProfileView {
        birthday: c.birthday,
        sign: c.sign.clone(),
        sign_name: ctx.names.captain.sign(&c.sign).map(|s| s.name.clone()).unwrap_or_default(),
        answers: c.answers.clone(),
        attrs: ctx.names.captain.attributes.iter().enumerate().map(|(i, a)| (a.key.clone(), c.attr(i))).collect(),
        ratings: ctx
            .names
            .captain
            .ratings
            .iter()
            .enumerate()
            .map(|(i, r)| {
                (r.key.clone(), ctx.names.captain.check_value(&c.attrs, ctx.names.captain.attributes.len() + i))
            })
            .collect(),
        methods: c.methods().map(str::to_string).collect(),
        created: c.created,
    })
}
