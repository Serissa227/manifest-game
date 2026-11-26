//! FRAMEWORK §8.3 的封闭词表。百分数只在接入属性钩子时转换为基点。

use super::ItemsRules;
use crate::captain::AttrHook;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectLimit {
    pub single: i64,
    pub total: i64,
}

macro_rules! effects {
    ($( $variant:ident => ($key:literal, $label:literal, $hook:ident, $scale:literal, $single:literal, $total:literal) ),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum EffectKind { $( $variant ),+ }
        impl EffectKind {
            pub const ALL: &'static [Self] = &[$( Self::$variant ),+];
            pub fn key(self) -> &'static str { match self { $( Self::$variant => $key ),+ } }
            pub fn label(self) -> &'static str { match self { $( Self::$variant => $label ),+ } }
            pub fn hook(self) -> (AttrHook, i64) { match self { $( Self::$variant => (AttrHook::$hook, $scale) ),+ } }
            pub fn ceiling(self) -> EffectLimit { match self { $( Self::$variant => EffectLimit {single: $single, total: $total} ),+ } }
        }
    }
}
effects! {
    SpeedPct => ("speed_pct", "航速", FlagshipSpeed, 100, 30, 50),
    Upwind => ("upwind", "逆风航行", Upwind, 1, 15, 30),
    StormGuardPct => ("storm_guard_pct", "风暴防护", StormCheck, 100, 30, 50),
    FogSailing => ("fog_sailing", "雾中航行", FogSailing, 1, 1, 1),
    Sight => ("sight", "视野", FogReveal, 1, 4, 8),
    SupplyPct => ("supply_pct", "补给节省", SupplyDiscount, 100, 30, 50),
    LandingPct => ("landing_pct", "登陆", Landing, 100, 30, 50),
    TaxPct => ("tax_pct", "税费减免", TaxDiscount, 100, 30, 50),
    BargainPct => ("bargain_pct", "议价", BargainDiscount, 100, 30, 50),
    PriceHint => ("price_hint", "行情精度", MarketWindow, 1, 10, 20),
    DuelPct => ("duel_pct", "决斗", Duel, 100, 30, 50),
    BoardingPct => ("boarding_pct", "白刃战", Melee, 100, 30, 50),
    GunneryPct => ("gunnery_pct", "炮击", NavalCombat, 100, 30, 50),
    Ward => ("ward", "护身", CreatureCheck, 1, 10, 20),
    MoraleDaily => ("morale_daily", "每日士气", Morale, 1, 3, 5),
    DiseaseGuardPct => ("disease_guard_pct", "疾病防护", DiseaseGuard, 100, 30, 50),
    WagePct => ("wage_pct", "工资减免", WageDiscount, 100, 30, 50),
    AffinityPct => ("affinity_pct", "好感增益", AffinityGain, 100, 30, 50),
    FindPct => ("find_pct", "发现物探查", Find, 100, 30, 50),
    ChartReveal => ("chart_reveal", "海图揭示", ChartReveal, 1, 1, 1),
    Arcana => ("arcana", "秘术强度", SpellPower, 1, 30, 50),
    Spell => ("spell", "附带法术", Spell, 1, 1, 1),
    ActivityPct => ("activity_pct", "活动收益", Activity, 100, 30, 50),
    FatiguePct => ("fatigue_pct", "疲劳减免", Fatigue, 100, 30, 50),
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Effect {
    pub kind: EffectKind,
    pub value: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub culture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spell: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
}
impl Effect {
    pub fn plain(kind: EffectKind, value: i64) -> Self {
        Self { kind, value, activity: None, tag: None, culture: None, spell: None, region: None }
    }
    pub fn text(&self) -> String {
        let unit = if self.kind.key().ends_with("_pct") { "%" } else { "" };
        let target = self
            .activity
            .as_ref()
            .or(self.tag.as_ref())
            .or(self.culture.as_ref())
            .or(self.spell.as_ref())
            .or(self.region.as_ref())
            .map(|s| format!("（{s}）"))
            .unwrap_or_default();
        format!("{}{target} +{}{unit}", self.kind.label(), self.value)
    }
    pub fn applies(&self, context: &EffectContext<'_>) -> bool {
        self.activity.as_deref().is_none_or(|s| context.activity == Some(s))
            && self.tag.as_deref().is_none_or(|s| context.tags.contains(&s))
            && self.culture.as_deref().is_none_or(|s| context.culture == Some(s))
            && self.spell.as_deref().is_none_or(|s| context.spell == Some(s))
            && self.region.as_deref().is_none_or(|s| context.region == Some(s))
    }
}

#[derive(Default)]
pub struct EffectContext<'a> {
    pub activity: Option<&'a str>,
    pub culture: Option<&'a str>,
    pub tags: &'a [&'a str],
    pub spell: Option<&'a str>,
    pub region: Option<&'a str>,
}

/// 先对单件同类效果合计限幅，再按稳定 key 的来源顺序叠加，最后限总幅。
/// 条件在叠加之前匹配，因此不同标签不能绕过同种效果的总上限。
pub fn aggregate<'a>(
    sources: impl IntoIterator<Item = (&'a str, &'a [Effect])>,
    rules: &ItemsRules,
    context: &EffectContext<'_>,
) -> BTreeMap<EffectKind, i64> {
    let mut sources: Vec<_> = sources.into_iter().collect();
    sources.sort_by_key(|(key, _)| *key);
    let mut total = BTreeMap::<EffectKind, i64>::new();
    for (_, effects) in sources {
        let mut single = BTreeMap::<EffectKind, i64>::new();
        for e in effects.iter().filter(|e| e.applies(context)) {
            let v = single.entry(e.kind).or_default();
            *v = v.saturating_add(e.value.max(0)).min(rules.limit(e.kind).single);
        }
        for (kind, value) in single {
            let v = total.entry(kind).or_default();
            *v = v.saturating_add(value).min(rules.limit(kind).total);
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vocabulary_is_closed_and_unknown_fields_fail() {
        assert_eq!(EffectKind::ALL.len(), 24);
        assert!(serde_json::from_str::<Effect>(r#"{"kind":"cash","value":100}"#).is_err());
        assert!(serde_json::from_str::<Effect>(r#"{"kind":"speed_pct","value":1,"vaule":9}"#).is_err());
    }
    #[test]
    fn caps_apply_per_source_and_total_in_stable_order() {
        let a = vec![Effect::plain(EffectKind::SpeedPct, i64::MAX); 2];
        let b = vec![Effect::plain(EffectKind::SpeedPct, 30)];
        let r = ItemsRules::default();
        let ctx = EffectContext::default();
        let one = aggregate([("a", a.as_slice())], &r, &ctx);
        assert_eq!(one[&EffectKind::SpeedPct], 30);
        let both = aggregate([("b", b.as_slice()), ("a", a.as_slice())], &r, &ctx);
        assert_eq!(both[&EffectKind::SpeedPct], 50);
        assert_eq!(both, aggregate([("a", a.as_slice()), ("b", b.as_slice())], &r, &ctx));
    }
    #[test]
    fn scoped_effects_do_not_leak_and_world_can_tighten_caps() {
        let mut e = Effect::plain(EffectKind::AffinityPct, 20);
        e.tag = Some("music".into());
        let es = [e];
        let mut r = ItemsRules::default();
        r.effects.insert(EffectKind::AffinityPct, EffectLimit { single: 8, total: 10 });
        assert!(aggregate([("skill", es.as_slice())], &r, &EffectContext::default()).is_empty());
        let context = EffectContext { tags: &["music"], ..Default::default() };
        assert_eq!(
            aggregate([("skill", es.as_slice()), ("title", es.as_slice())], &r, &context)[&EffectKind::AffinityPct],
            10
        );
    }
}
