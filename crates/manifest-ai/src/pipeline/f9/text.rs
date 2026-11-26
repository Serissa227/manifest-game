//! 四类文字提案共享事实指纹，原始玩法字段和历史对照不由模型改写。
use super::*;
use manifest_core::summary::text::{self as records, TextRecord, TextTarget};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LetterProposal {
    pub text: String,
    #[serde(deserialize_with = "super::nullable_string")]
    pub request: Option<String>,
}

pub fn body(proposal: &Proposal) -> Option<&str> {
    match proposal {
        Proposal::Narration(p) | Proposal::AltChronicle(p) | Proposal::Diary(p) => Some(&p.text),
        Proposal::Letter(p) => Some(&p.text),
        _ => None,
    }
}

pub fn check(proposal: &Proposal, target: &TextTarget, requests: &[String]) -> Result<(), String> {
    if proposal.kind().key() != target.kind() {
        return Err("ai.text_kind".into());
    }
    let text = body(proposal).ok_or_else(|| "ai.text_kind".to_string())?;
    ai::check_text(text, records::TEXT_CHARS).map_err(|_| "ai.text".to_string())?;
    if let Proposal::Letter(p) = proposal
        && p.request.as_ref().is_some_and(|key| !requests.contains(key))
    {
        return Err("ai.letter_request".into());
    }
    Ok(())
}

impl AiPipeline {
    pub(in crate::pipeline) fn prepare_text(&self, world: &World, request: TaskRequest) -> Option<AiTask> {
        let target = match request {
            TaskRequest::Narration { event, phase } => TextTarget::Narration { event, phase },
            TaskRequest::Letter { id, purpose } => TextTarget::Letter { id, purpose },
            TaskRequest::AltChronicle { year } => TextTarget::AltChronicle { year },
            TaskRequest::Diary { year, month } => TextTarget::Diary { year, month },
            _ => return None,
        };
        let kind = ProposalKind::ALL.into_iter().find(|kind| kind.key() == target.kind())?;
        let snapshot = records::snapshot(world, &target)?;
        let variant_seed = u32::from_str_radix(snapshot.proof.get(..8)?, 16).ok()?;
        let templates = self.content.templates.f9.get(kind.key())?.clone();
        let section = if templates.contains_key(&snapshot.section) { snapshot.section } else { "voice_generic".into() };
        let ctx = F9Context {
            binding: runtime::binding(world),
            guard: guard::Guard::new(world),
            request: RequestContext::Text {
                target: target.clone(),
                proof: snapshot.proof,
                requests: snapshot.requests.clone(),
                section: section.clone(),
                variant_seed,
            },
            params: snapshot.params,
            templates,
        };
        let text = ctx.line(&section, variant_seed)?;
        let offline = match kind {
            ProposalKind::Narration => Proposal::Narration(crate::proposal::TextProposal { text: text.clone() }),
            ProposalKind::Letter => Proposal::Letter(LetterProposal { text: text.clone(), request: None }),
            ProposalKind::AltChronicle => Proposal::AltChronicle(crate::proposal::TextProposal { text: text.clone() }),
            ProposalKind::Diary => Proposal::Diary(crate::proposal::TextProposal { text: text.clone() }),
            _ => return None,
        };
        let RequestContext::Text { proof, .. } = &ctx.request else {
            return None;
        };
        records::check(
            world,
            &TextRecord {
                target,
                proof: proof.clone(),
                day: world.day(),
                text,
                request: None,
                source: ai::AiSource::Template,
                fallback: ctx.line(&section, variant_seed)?,
                section: section.clone(),
                variant: variant_seed as usize % ctx.templates.get(&section)?.len().max(1),
                params: ctx.params.clone(),
            },
        )
        .ok()?;
        let mut vars = BTreeMap::from([
            (
                "summary".into(),
                if snapshot.facts.chars().count() <= 6000 {
                    snapshot.facts
                } else {
                    serde_json::to_string(&ctx.params).ok()?
                },
            ),
            (
                "persona".into(),
                ctx.templates
                    .get(&section)
                    .map(|lines| lines.iter().map(|line| fill(line, &ctx.params)).collect::<Vec<_>>().join("\n"))
                    .unwrap_or_default(),
            ),
            ("options".into(), serde_json::to_string(&snapshot.requests).ok()?),
            ("world_lore".into(), self.content.lore.summary.clone()),
            ("world_terms".into(), format!("{}\n{}", self.content.lore.terms, context::known_catalog(world, 3000))),
            ("world_taboos".into(), self.content.lore.taboos.clone()),
            (
                "calendar".into(),
                manifest_core::summary::world_date_text_in(&world.defs.rules.world, &world.defs.calendar, world.day()),
            ),
        ]);
        self.f9_language_vars(world, &mut vars);
        Some(AiTask {
            kind,
            day: world.day(),
            vars,
            offline: Some(offline),
            offline_tpl: None,
            ctx: AdjudicationContext {
                defs: world.defs.clone(),
                relations: world.state.relations.iter().map(|r| (r.a, r.b, r.status)).collect(),
            },
            extra: TaskExtra::F9(Box::new(ctx)),
        })
    }

    pub(super) fn finalize_text(&self, world: &World, outcome: &AiOutcome) -> Vec<Command> {
        let Some(proposal) = outcome.accepted() else {
            return Vec::new();
        };
        let TaskExtra::F9(ctx) = &outcome.task.extra else {
            return Vec::new();
        };
        let RequestContext::Text { target, proof, requests, section, variant_seed } = &ctx.request else {
            return Vec::new();
        };
        if check(proposal, target, requests).is_err() {
            return Vec::new();
        }
        let Some(text) = body(proposal) else {
            return Vec::new();
        };
        let request = if let Proposal::Letter(p) = proposal { p.request.clone() } else { None };
        let source = if matches!(outcome.source, Some(ProposalSource::Llm | ProposalSource::Cache)) {
            ai::AiSource::Model
        } else {
            ai::AiSource::Template
        };
        let command = Command::RecordAiText {
            record: TextRecord {
                target: target.clone(),
                proof: proof.clone(),
                day: outcome.task.day,
                text: text.into(),
                request,
                source,
                fallback: ctx.line(section, *variant_seed).unwrap_or_default(),
                section: section.clone(),
                variant: *variant_seed as usize % ctx.templates.get(section).map_or(1, |lines| lines.len().max(1)),
                params: ctx.params.clone(),
            },
        };
        if command.validate(world).is_ok() { vec![command] } else { Vec::new() }
    }
}
