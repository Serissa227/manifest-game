//! 引导玩法清单；只保存稳定键与作者注释，显示名交给界面。
use super::{ChapterDef, TrackDef, TrackKind, graph};
use crate::StaticData;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct QuestRules {
    pub enabled: bool,
    pub guide: bool,
    pub reveal_days: u32,
}

impl Default for QuestRules {
    fn default() -> Self {
        Self { enabled: false, guide: false, reveal_days: 180 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Upbringing,
    Voyage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Chain {
    Basic,
    Advanced,
    Exempt,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct GuideDefs {
    pub panels: Vec<Panel>,
    pub mechanics: Vec<Mechanic>,
    pub lines: Vec<Line>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Panel {
    pub key: String,
    pub phase: Phase,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mechanic {
    pub key: String,
    pub phase: Phase,
    pub chain: Chain,
    #[serde(default)]
    pub proof: Vec<String>,
    pub panel: Option<String>,
    #[serde(default)]
    pub note: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum Coverage {
    All(String),
    Keys(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Line {
    pub key: String,
    pub protagonist: String,
    pub family: String,
    #[serde(default)]
    pub upbringing: Vec<String>,
    #[serde(default)]
    pub voyage: Vec<String>,
    pub handoff: Handoff,
    pub coverage: Coverage,
    #[serde(default)]
    pub assumes: Vec<Assumption>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Handoff {
    pub after: String,
    pub track: String,
    pub chapter: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assumption {
    pub flag: String,
    pub why: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Go {
    pub port: Option<String>,
    pub place: Option<String>,
    pub panel: Option<String>,
}

pub fn phase(t: &TrackDef) -> Phase {
    if t.upbringing || t.academy { Phase::Upbringing } else { Phase::Voyage }
}

/// 已经结构校验的引导按分支唯一的 next 前进；仍保留环保护供工具读取坏数据。
pub fn chapters(t: &TrackDef) -> Vec<&ChapterDef> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut key = t.start.as_str();
    while seen.insert(key) {
        let Some(c) = t.chapter(key) else { break };
        out.push(c);
        let Some(o) = c.choices.first() else { break };
        key = &o.next;
    }
    out
}

pub fn structure(d: &StaticData) -> Vec<String> {
    let g = &d.guide;
    let mut errors = Vec::new();
    for (kind, keys) in [
        ("panel", g.panels.iter().map(|x| &x.key).collect::<Vec<_>>()),
        ("mechanic", g.mechanics.iter().map(|x| &x.key).collect()),
        ("line", g.lines.iter().map(|x| &x.key).collect()),
    ] {
        let mut seen = BTreeSet::new();
        for k in keys {
            if k.is_empty() || !k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') || !seen.insert(k) {
                errors.push(format!("guide:{kind}: 无效或重复键 {k}"));
            }
        }
    }
    let producers = graph::external_flag_sources(d)
        .into_iter()
        .chain(
            d.story2
                .tracks
                .iter()
                .flat_map(|t| &t.chapters)
                .flat_map(graph::branches)
                .flat_map(|b| b.effects)
                .filter_map(|e| match e {
                    super::Effect::Flag { flag, value: true } => Some(flag),
                    _ => None,
                }),
        )
        .collect::<BTreeSet<_>>();
    for m in &g.mechanics {
        if m.chain == Chain::Exempt && m.reason.as_ref().is_none_or(|s| s.trim().is_empty()) {
            errors.push(format!("guide:mechanic:{}: exempt 缺 reason", m.key));
        }
        if m.panel.as_ref().is_some_and(|p| !g.panels.iter().any(|x| &x.key == p)) {
            errors.push(format!("guide:mechanic:{}: 未知 panel", m.key));
        }
        for proof in &m.proof {
            let ok = match proof.split_once(':') {
                Some(("deed", k)) => super::deeds::Deed::from_key(k).is_some(),
                Some(("panel", k)) => g.panels.iter().any(|p| p.key == k),
                Some(("flag", k)) => producers.contains(k),
                Some(("cond", k)) => super::conditions::CONDITION_KEYS.contains(&k),
                _ => false,
            };
            if !ok {
                errors.push(format!("guide:mechanic:{}: proof 引用无效 {proof}", m.key));
            }
        }
    }
    for line in &g.lines {
        let family = d.upbringing.family(&line.family);
        if family.is_none_or(|f| !f.protagonists.contains(&line.protagonist)) {
            errors.push(format!("guide:{}: 家庭或主角不符", line.key));
        }
        for (keys, expected) in [(&line.upbringing, Phase::Upbringing), (&line.voyage, Phase::Voyage)] {
            for key in keys {
                if d.story2.track(key).is_none_or(|t| t.kind != TrackKind::Guide || phase(t) != expected) {
                    errors.push(format!("guide:{}:{key}: 轨道不存在、不是 guide 或期不符", line.key));
                }
            }
        }
        let valid_coverage = match &line.coverage {
            Coverage::All(s) => s == "all",
            Coverage::Keys(keys) => keys.iter().all(|k| g.mechanics.iter().any(|m| &m.key == k)),
        };
        if !valid_coverage {
            errors.push(format!("guide:{}: coverage 无效", line.key));
        }
        if !line.voyage.contains(&line.handoff.after)
            || d.story2.track(&line.handoff.track).and_then(|t| t.chapter(&line.handoff.chapter)).is_none()
        {
            errors.push(format!("guide:{}: handoff 引用无效", line.key));
        }
        for a in &line.assumes {
            if a.why.trim().is_empty() || !producers.contains(&a.flag) {
                errors.push(format!("guide:{}: assumes {} 缺理由或实际设置者", line.key, a.flag));
            }
        }
    }
    for t in &d.story2.tracks {
        let lines =
            g.lines.iter().filter(|l| l.upbringing.contains(&t.key) || l.voyage.contains(&t.key)).collect::<Vec<_>>();
        if t.kind == TrackKind::Guide {
            let occurrences =
                g.lines.iter().flat_map(|l| l.upbringing.iter().chain(&l.voyage)).filter(|k| **k == t.key).count();
            if occurrences != 1 {
                errors.push(format!("guide:{}: 引导轨道必须恰好属于一条线", t.key));
            }
            if chapters(t).len() != t.chapters.len()
                || chapters(t).last().and_then(|c| c.choices.first()).is_none_or(|o| o.next != "done")
            {
                errors.push(format!("guide:{}: 引导轨道有环或不在链上的章节", t.key));
            }
        }
        for c in &t.chapters {
            let prefix = format!("guide:{}:{}", t.key, c.key);
            if c.hint.as_ref().is_some_and(|s| s.trim().is_empty() || s.chars().count() > 120) {
                errors.push(format!("{prefix}: hint 为空或超过 120 字"));
            }
            if t.kind == TrackKind::Guide {
                let branches = graph::branches(c);
                if !c.once
                    || c.stage.is_some()
                    || c.window.is_some()
                    || branches.is_empty()
                    || branches.iter().any(|b| b.next != branches[0].next || b.next == "failed")
                {
                    errors.push(format!(
                        "{prefix}: 引导必须为 once 链、无 stage/window，所有分支 next 相同且终止于 done"
                    ));
                }
                if d.upbringing.event_gates.contains_key(&t.key) {
                    errors.push(format!("{prefix}: 引导不能登记到养成排期"));
                }
            }
            for teach in &c.teaches {
                if t.kind != TrackKind::Guide || !g.mechanics.iter().any(|m| &m.key == teach && m.phase == phase(t)) {
                    errors.push(format!("{prefix}: teaches {teach} 未知、期不符或不在 guide"));
                }
            }
            if let Some(go) = &c.go {
                if go.port.is_some() && go.place.is_some() {
                    errors.push(format!("{prefix}: go.port 与 go.place 互斥"));
                }
                if go.port.as_ref().is_some_and(|p| !d.locations.iter().any(|l| &l.key == p && l.is_port())) {
                    errors.push(format!("{prefix}: go.port 不是港口"));
                }
                if go.panel.as_ref().is_some_and(|p| !g.panels.iter().any(|x| &x.key == p)) {
                    errors.push(format!("{prefix}: go.panel 未知"));
                }
                if let Some(place) = &go.place {
                    let families = if lines.is_empty() {
                        d.upbringing.families.iter().collect::<Vec<_>>()
                    } else {
                        lines.iter().filter_map(|l| d.upbringing.family(&l.family)).collect()
                    };
                    let valid = phase(t) == Phase::Upbringing
                        && families.iter().any(|f| {
                            f.places.iter().any(|p| &p.key == place)
                                || f.stages.iter().filter_map(|s| s.academy.as_ref()).any(|a| {
                                    d.upbringing
                                        .academies
                                        .iter()
                                        .any(|x| &x.key == a && x.places.iter().any(|p| &p.key == place))
                                })
                                || f.routes.iter().any(|r| {
                                    d.upbringing
                                        .academies
                                        .iter()
                                        .any(|a| a.key == r.academy && a.places.iter().any(|p| &p.key == place))
                                })
                        });
                    if !valid {
                        errors.push(format!("{prefix}: go.place 不在本线家庭或学院"));
                    }
                }
            }
            let count = c.when.iter().flat_map(super::deeds::condition_deeds).count()
                + c.objectives.iter().flat_map(|o| super::deeds::objective_deeds(&o.kind)).count();
            let marked = super::deeds::chapter_deed_marks(c);
            if count > 8 || marked.len() > 8 {
                errors.push(format!("{prefix}: 一章 deed 条件与目标合计超过 8"));
            }
        }
    }
    errors
}
