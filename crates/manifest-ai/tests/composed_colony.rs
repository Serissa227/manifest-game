//! 殖民相关的组合事件效果在 AI 层：Schema 由数据生成（殖民点、殖民地建筑、发现物的 key 目录），
//! 提案与内核效果往返一致，规则裁决器对越界、对象不存在、用错地点、交战势力占地等提案给出理由并拒绝；
//! 裁决器看不到的局势（殖民地是否存在、殖民点归属）由内核校验拒绝。全部使用真实数据，不访问任何服务。

use manifest_ai::adjudicator::check_composed;
use manifest_ai::proposal::{ComposedEffectRaw as E, ComposedEventProposal};
use manifest_ai::resolve::{ALL_BUILDINGS, raw_from_effect, resolve_composed_effect};
use manifest_ai::schema::{check_strict, output_schema};
use manifest_ai::{AdjudicationContext, Decision, Proposal, RuleAdjudicator};
use manifest_core::composed::ComposedSource;
use manifest_core::defs::EffectKind;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::ids::ScenarioId;
use manifest_core::{Command, StaticData, World};
use manifest_data::ProposalKind;
use std::sync::{Arc, OnceLock};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_default().unwrap_or_else(|e| panic!("{e}"))).clone()
}

fn world() -> World {
    World::new(defs(), ScenarioId(0), 5).unwrap()
}

fn ctx(w: &World) -> AdjudicationContext {
    AdjudicationContext {
        defs: w.defs.clone(),
        relations: w.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
    }
}

struct Keys {
    site: String,
    port: String,
    faction: String,
    discovery: String,
}

fn keys(w: &World) -> Keys {
    let d = &w.defs;
    Keys {
        site: d.locations.iter().find(|l| l.is_site()).unwrap().key.clone(),
        port: d.locations.iter().find(|l| l.is_port()).unwrap().key.clone(),
        faction: d.factions[0].key.clone(),
        discovery: d.discoveries[0].key.clone(),
    }
}

fn proposal(effects: Vec<E>) -> ComposedEventProposal {
    ComposedEventProposal {
        title: "拓荒者的秋天".into(),
        narrative: "据拓荒者寄回内海的书信所述，新大陆今年风调雨顺，垦地上的人们都说这是好兆头。".into(),
        effects,
    }
}

#[test]
fn schema_lists_colony_effects_with_catalogs_from_data() {
    let d = defs();
    let s = output_schema(ProposalKind::Composed, &d);
    check_strict(&s.schema).unwrap();
    let items = s.schema["properties"]["effects"]["items"]["anyOf"].as_array().unwrap();
    let variant = |key: &str| {
        items.iter().find(|v| v["properties"]["effect"]["enum"][0] == key).unwrap_or_else(|| panic!("缺少 {key}"))
    };
    let out = variant("colony_output");
    assert_eq!(out["properties"]["loc"]["$ref"], "#/$defs/site");
    assert_eq!(out["properties"]["building"]["$ref"], "#/$defs/colony_building");
    assert_eq!(variant("site_claim")["properties"]["loc"]["$ref"], "#/$defs/site");
    assert_eq!(variant("site_claim")["properties"]["faction"]["$ref"], "#/$defs/faction");
    assert_eq!(variant("discovery_rumor")["properties"]["discovery"]["$ref"], "#/$defs/discovery");
    for k in ["colony_morale", "colony_growth"] {
        assert_eq!(variant(k)["properties"]["loc"]["$ref"], "#/$defs/site");
    }
    // 边界来自 effects.toml
    let b = d.composed.bounds(EffectKind::ColonyMorale).unwrap();
    assert_eq!(variant("colony_morale")["properties"]["delta"]["minimum"].as_i64(), b.delta.map(|x| x.0));
    // key 目录：殖民点只列殖民点；建筑只列有产出的建筑并包含 all；发现物全部列出
    let defs_json = &s.schema["$defs"];
    let sites: Vec<&str> = defs_json["site"]["enum"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    assert_eq!(sites.len(), d.site_ids().count());
    assert!(sites.iter().all(|k| d.find_loc(k).is_some_and(|l| d.loc(l).is_site())));
    let buildings: Vec<&str> =
        defs_json["colony_building"]["enum"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    assert!(buildings.contains(&ALL_BUILDINGS) && buildings.contains(&"farm") && buildings.contains(&"plantation"));
    assert!(!buildings.contains(&"storehouse") && !buildings.contains(&"fort"), "没有产出的建筑不列出");
    let discoveries = defs_json["discovery"]["enum"].as_array().unwrap();
    assert_eq!(discoveries.len(), d.discoveries.len());
    // 有市场的地点目录不含殖民点
    let locs: Vec<&str> = defs_json["loc"]["enum"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    assert!(locs.iter().all(|k| !sites.contains(k)));
}

#[test]
fn colony_effects_round_trip_between_proposal_and_kernel() {
    let w = world();
    let k = keys(&w);
    let raws = vec![
        E::ColonyOutput { loc: k.site.clone(), building: "farm".into(), mult: 1.2, days: 30 },
        E::ColonyOutput { loc: k.site.clone(), building: ALL_BUILDINGS.into(), mult: 0.85, days: 30 },
        E::ColonyMorale { loc: k.site.clone(), delta: -4 },
        E::ColonyGrowth { loc: k.site.clone(), mult: 1.3, days: 60 },
        E::SiteClaim { loc: k.site.clone(), faction: k.faction.clone() },
        E::DiscoveryRumor { discovery: k.discovery.clone() },
    ];
    for raw in raws {
        let e = resolve_composed_effect(&w.defs, &raw).unwrap();
        assert_eq!(e.effect, raw.kind());
        assert_eq!(raw_from_effect(&w.defs, &e), Some(raw.clone()), "{raw:?}");
        // 提案 JSON 能按类型解析回来
        let body = serde_json::to_value(proposal(vec![raw.clone()])).unwrap();
        assert!(Proposal::from_body(ProposalKind::Composed, body).is_ok());
    }
    // "all" 解析为不指定建筑
    let all = resolve_composed_effect(
        &w.defs,
        &E::ColonyOutput { loc: k.site.clone(), building: ALL_BUILDINGS.into(), mult: 1.1, days: 30 },
    )
    .unwrap();
    assert_eq!(all.params.building, None);
}

/// 结构与静态规则都合法的殖民地提案：裁决器接受，但开局时还没有殖民地——内核按局势拒绝。
#[test]
fn legal_colony_proposal_passes_rules_but_kernel_checks_the_colony_exists() {
    let w = world();
    let k = keys(&w);
    let p = proposal(vec![
        E::ColonyOutput { loc: k.site.clone(), building: "farm".into(), mult: 1.2, days: 30 },
        E::ColonyMorale { loc: k.site.clone(), delta: 5 },
    ]);
    assert!(check_composed(&p, &ctx(&w)).is_empty(), "{:?}", check_composed(&p, &ctx(&w)));
    let v = RuleAdjudicator::default().adjudicate(&Proposal::Composed(p.clone()), &ctx(&w));
    assert_eq!(v.decision, Decision::Accept);
    let effects: Vec<_> = p.effects.iter().map(|e| resolve_composed_effect(&w.defs, e).unwrap()).collect();
    let cmd = Command::ApplyComposedEvent {
        title: p.title.clone(),
        text: p.narrative.clone(),
        effects,
        source: ComposedSource::Model,
    };
    let err = cmd.validate(&w).unwrap_err().to_string();
    assert!(err.contains("没有殖民地"), "{err}");
    // 占领殖民点与发现物传闻：开局第一年是保护期、玩家名声不足，同样由内核拒绝
    for raw in [
        E::SiteClaim { loc: k.site.clone(), faction: k.faction.clone() },
        E::DiscoveryRumor { discovery: k.discovery.clone() },
    ] {
        let p = proposal(vec![raw]);
        assert!(check_composed(&p, &ctx(&w)).is_empty());
        let effects: Vec<_> = p.effects.iter().map(|e| resolve_composed_effect(&w.defs, e).unwrap()).collect();
        let cmd =
            Command::ApplyComposedEvent { title: p.title, text: p.narrative, effects, source: ComposedSource::Model };
        assert!(cmd.validate(&w).is_err());
    }
}

/// 非法的殖民地提案：规则裁决器逐条给出理由并拒绝。
#[test]
fn illegal_colony_proposals_are_rejected_by_the_rule_adjudicator() {
    let w = world();
    let k = keys(&w);
    let b_out = w.defs.composed.bounds(EffectKind::ColonyOutput).unwrap();
    let low = b_out.mult.unwrap().0.raw() as f64 / 10_000.0 - 0.1;
    let cases: Vec<(&str, Vec<E>)> = vec![
        ("港口不是殖民点", vec![E::ColonyOutput { loc: k.port.clone(), building: "farm".into(), mult: 1.2, days: 30 }]),
        (
            "没有产出的建筑",
            vec![E::ColonyOutput { loc: k.site.clone(), building: "storehouse".into(), mult: 1.2, days: 30 }],
        ),
        (
            "不存在的建筑",
            vec![E::ColonyOutput { loc: k.site.clone(), building: "windmill".into(), mult: 1.2, days: 30 }],
        ),
        (
            "对殖民地过于严厉",
            vec![E::ColonyOutput { loc: k.site.clone(), building: "farm".into(), mult: low, days: 30 }],
        ),
        ("士气变化越界", vec![E::ColonyMorale { loc: k.site.clone(), delta: -40 }]),
        ("士气变化为 0", vec![E::ColonyMorale { loc: k.site.clone(), delta: 0 }]),
        ("增长天数越界", vec![E::ColonyGrowth { loc: k.site.clone(), mult: 1.2, days: 900 }]),
        ("不存在的殖民点", vec![E::ColonyGrowth { loc: "el_dorado".into(), mult: 1.2, days: 60 }]),
        ("港口不能被占领", vec![E::SiteClaim { loc: k.port.clone(), faction: k.faction.clone() }]),
        ("不存在的势力", vec![E::SiteClaim { loc: k.site.clone(), faction: "atlantis".into() }]),
        ("不存在的发现物", vec![E::DiscoveryRumor { discovery: "sunken_moon".into() }]),
        ("市场效果用在殖民点", vec![E::LocationSupply { loc: k.site.clone(), mult: 0.8, days: 30 }]),
        (
            "同一殖民地的产量效果重复",
            vec![
                E::ColonyOutput { loc: k.site.clone(), building: "farm".into(), mult: 1.2, days: 30 },
                E::ColonyOutput { loc: k.site.clone(), building: ALL_BUILDINGS.into(), mult: 1.1, days: 30 },
            ],
        ),
    ];
    for (name, effects) in cases {
        let p = proposal(effects);
        let reasons = check_composed(&p, &ctx(&w));
        assert!(!reasons.is_empty(), "{name}：应有拒绝理由");
        let v = RuleAdjudicator::default().adjudicate(&Proposal::Composed(p), &ctx(&w));
        assert_eq!(v.decision, Decision::Reject, "{name}：{reasons:?}");
        assert!(v.proposal.is_none());
    }
    // 外交：交战中的势力不能占领殖民点
    let mut war = ctx(&w);
    let f = w.defs.find_faction(&k.faction).unwrap();
    for r in war.relations.iter_mut().filter(|(a, b, _)| *a == f || *b == f) {
        r.2 = DiploStatus::War;
    }
    let reasons =
        check_composed(&proposal(vec![E::SiteClaim { loc: k.site.clone(), faction: k.faction.clone() }]), &war);
    assert!(reasons.iter().any(|r| r.contains("战争")), "{reasons:?}");
}
