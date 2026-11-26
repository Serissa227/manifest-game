//! 历史显示字段按事件与结果key覆盖；规则字段不进入语言schema。
use super::{Entry, FileSpec, Slot, entry};
use manifest_core::StaticData;

/// 全文件审计传入的是经典定义；其他世界的历史分片也须通过真实schema才登记。
pub(super) fn registered_files(world: &std::path::Path) -> Vec<String> {
    let source = super::Source::directory(&world.join("history"));
    source
        .files()
        .into_iter()
        .filter_map(|rel| {
            let text = source.join(&rel).read().ok()?;
            let defs: manifest_core::history::HistoryDefs = toml::from_str(&text).ok()?;
            (!defs.is_empty()).then(|| format!("history/{rel}"))
        })
        .collect()
}

pub(super) fn specs(defs: &StaticData, source: &str) -> FileSpec {
    specs_of(&defs.history, source)
}

pub(super) fn specs_of(defs: &manifest_core::history::HistoryDefs, source: &str) -> FileSpec {
    let mut campaigns = Vec::new();
    let mut vars = Vec::new();
    let mut outlooks = Vec::new();
    let mut endings = Vec::new();
    for (i, c) in defs.campaigns.iter().enumerate().filter(|(_, c)| c.source == source) {
        let mut fields = vec![("name", &c.name)];
        if !c.summary.is_empty() {
            fields.push(("summary", &c.summary));
        }
        campaigns.push(entry(&c.key, Slot::HistoryCampaign(i), &fields));
        for (j, o) in c.outlooks.iter().enumerate() {
            outlooks.push(entry(&format!("{}:{}", c.key, o.key), Slot::HistoryOutlook(i, j), &[("name", &o.name)]));
        }
        for (j, e) in c.endings.iter().enumerate() {
            endings.push(entry(&format!("{}:{}", c.key, e.key), Slot::HistoryEnding(i, j), &[("text", &e.text)]));
        }
        for (j, v) in c.vars.iter().enumerate() {
            vars.push(entry(&format!("{}:{}", c.key, v.key), Slot::HistoryVar(i, j), &[("name", &v.name)]));
        }
    }
    let mut events = Vec::new();
    let mut reasons = Vec::new();
    let mut sides = Vec::new();
    let mut outcomes = Vec::new();
    let mut levers = Vec::new();
    for (i, e) in defs.events.iter().enumerate().filter(|(_, e)| e.source == source) {
        let mut fields = vec![("title", &e.title), ("summary", &e.summary)];
        if let Some(region) = &e.region {
            fields.push(("region", region));
        }
        events.push(entry(&e.key, Slot::HistoryEvent(i), &fields));
        for (j, text) in e.why_hard.iter().enumerate() {
            reasons.push(entry(&format!("{}:{j}", e.key), Slot::HistoryReason(i, j), &[("text", text)]));
        }
        for (j, s) in e.sides.iter().enumerate() {
            sides.push(entry(&format!("{}:{}", e.key, s.key), Slot::HistorySide(i, j), &[("name", &s.name)]));
        }
        for (j, l) in e.levers.iter().enumerate() {
            let mut fields = vec![("label", &l.label)];
            if let Some(risk) = &l.risk {
                fields.push(("risk", risk));
            }
            if let Some(note) = &l.note {
                fields.push(("note", note));
            }
            levers.push(entry(&format!("{}:{}", e.key, l.key), Slot::HistoryLever(i, j), &fields));
        }
        for (j, o) in e.outcomes.iter().enumerate() {
            outcomes.push(Entry {
                key: format!("{}:{}", e.key, o.key),
                slot: Slot::HistoryOutcome(i, j),
                fields: [("news", &o.news), ("chronicle", &o.chronicle)]
                    .into_iter()
                    .filter(|(_, v)| !v.is_empty())
                    .map(|(k, v)| (k, v.clone()))
                    .collect(),
            });
        }
    }
    FileSpec::new(source)
        .table("campaigns", campaigns)
        .table("vars", vars)
        .table("outlooks", outlooks)
        .table("endings", endings)
        .table("events", events)
        .table("reasons", reasons)
        .table("sides", sides)
        .table("outcomes", outcomes)
        .table("levers", levers)
}

pub(super) fn apply(defs: &mut StaticData, slot: Slot, field: &str, value: String) {
    match (slot, field) {
        (Slot::HistoryCampaign(i), "name") => defs.history.campaigns[i].name = value,
        (Slot::HistoryCampaign(i), "summary") => defs.history.campaigns[i].summary = value,
        (Slot::HistoryVar(i, j), "name") => defs.history.campaigns[i].vars[j].name = value,
        (Slot::HistoryOutlook(i, j), "name") => defs.history.campaigns[i].outlooks[j].name = value,
        (Slot::HistoryEnding(i, j), "text") => defs.history.campaigns[i].endings[j].text = value,
        (Slot::HistoryLever(i, j), "label") => defs.history.events[i].levers[j].label = value,
        (Slot::HistoryLever(i, j), "note") => defs.history.events[i].levers[j].note = Some(value),
        (Slot::HistoryEvent(i), "title") => defs.history.events[i].title = value,
        (Slot::HistoryEvent(i), "summary") => defs.history.events[i].summary = value,
        (Slot::HistoryEvent(i), "region") => defs.history.events[i].region = Some(value),
        (Slot::HistoryReason(i, j), "text") => defs.history.events[i].why_hard[j] = value,
        (Slot::HistoryLever(i, j), "risk") => defs.history.events[i].levers[j].risk = Some(value),
        (Slot::HistorySide(i, j), "name") => defs.history.events[i].sides[j].name = value,
        (Slot::HistoryOutcome(i, j), "news") => defs.history.events[i].outcomes[j].news = value,
        (Slot::HistoryOutcome(i, j), "chronicle") => defs.history.events[i].outcomes[j].chronicle = value,
        _ => {}
    }
}
