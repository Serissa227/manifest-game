//! H08 甲板闲话的数据分片（`voyage/banter.toml`，逻辑名 `banter.toml`）：严格读入、校验，转成内核的定义表。
//! 规则（频率、冷却）在 `rules.toml [banter]`。同伴可以还没有句子（退回岗位句、老水手）。
use super::{Issues, check_keys, load_optional};
use crate::worlds::EffectiveWorld;
use manifest_core::banter::{BanterDef, BanterReply, known_trigger};
use manifest_core::captain::CaptainDefs;
use manifest_core::defs::MateDef;
use serde::Deserialize;

const FILE: &str = "banter.toml";

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    #[serde(default)]
    banter: Vec<Raw>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Raw {
    key: String,
    trigger: String,
    mate: Option<String>,
    role: Option<String>,
    text: String,
    reply: Option<RawReply>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawReply {
    label: String,
    answer: String,
    #[serde(default = "one")]
    affinity: i64,
}

fn one() -> i64 {
    1
}

/// 读入闲话表；分片没登记时为空表。
pub(super) fn load(
    dir: &EffectiveWorld,
    mates: &[MateDef],
    cast: &manifest_core::cast::CastDefs,
    captain: &CaptainDefs,
    issues: &mut Issues,
) -> Vec<BanterDef> {
    let raw: File = load_optional(dir, FILE, issues).unwrap_or_default();
    check_keys(FILE, "banter", raw.banter.iter().map(|b| (b.key.as_str(), b.text.as_str())), issues);
    let mut out = Vec::new();
    for b in raw.banter {
        let at = b.key.clone();
        if !known_trigger(&b.trigger) {
            issues.push(FILE, &at, format!("没有这个触发键：{}", b.trigger));
        }
        if b.mate.is_some() && b.role.is_some() {
            issues.push(FILE, &at, "mate 与 role 只能写一个");
        }
        if let Some(m) = &b.mate
            && !mates.iter().any(|d| &d.key == m)
            && cast.person(m).is_none_or(|p| p.mate.is_none())
        {
            issues.push(FILE, &at, format!("没有这位航海士：{m}"));
        }
        if let Some(r) = &b.role
            && !captain.roles.iter().any(|d| &d.key == r)
        {
            issues.push(FILE, &at, format!("没有这个岗位：{r}"));
        }
        if b.text.trim().is_empty() || b.text.chars().count() > 80 {
            issues.push(FILE, &at, "text 不能为空，也不要超过 80 个字（角上冒一句话）");
        }
        let reply = b.reply.map(|r| {
            if r.label.trim().is_empty() || r.answer.trim().is_empty() || !(0..=5).contains(&r.affinity) {
                issues.push(FILE, &at, "reply 的 label、answer 不能为空，affinity 须在 0–5 之间");
            }
            BanterReply { label: r.label, answer: r.answer, affinity: r.affinity }
        });
        out.push(BanterDef { key: b.key, trigger: b.trigger, mate: b.mate, role: b.role, text: b.text, reply });
    }
    out
}
