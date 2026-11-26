//! 新类型的准入、保守专名门禁与通过裁决后才写入的缓存。
use super::*;

pub enum Reservation {
    Account(crate::account_budget::Ticket),
    Local { month: u32, reserved: u64 },
}

pub fn binding(world: &World) -> String {
    let start = world.defs.scenarios.get(world.state.scenario.idx()).map(|s| (s.start_date, s.control_date));
    serde_json::to_string(&(world.state.seed, world.state.scenario, start, &world.state.protagonist))
        .unwrap_or_default()
}

impl AiPipeline {
    pub(super) fn f9_language_vars(&self, world: &World, vars: &mut BTreeMap<String, String>) {
        redact_context_locations(world, vars);
        self.language_vars(world.day(), vars);
        let Some((_, to)) = &self.locale else { return };
        if to.locale.is_chinese() {
            return;
        }
        let mut pairs = Vec::new();
        for (i, loc) in
            world.defs.locations.iter().enumerate().filter(|(i, _)| world.location_visible(LocId::from_idx(*i)))
        {
            if let Some(display) = to.defs.locations.get(i)
                && loc.name != display.name
            {
                pairs.push(format!("{} = {}", loc.name, display.name));
            }
        }
        for person in
            world.defs.cast.persons.iter().filter(|p| person_known(world, &p.key) && world.person_alive(&p.key))
        {
            if let Some(display) = to.defs.cast.person(&person.key)
                && person.name != display.name
            {
                pairs.push(format!("{} = {}", person.name, display.name));
            }
        }
        let mut glossary = String::new();
        for pair in pairs {
            if glossary.chars().count() + pair.chars().count() < GLOSSARY_MAX {
                glossary.push_str(&pair);
                glossary.push('\n');
            }
        }
        vars.insert("glossary".into(), glossary);
    }
    pub fn with_account_budget(mut self, account: Arc<crate::account_budget::AccountBudget>) -> Self {
        let binding = account.bind().unwrap_or(0);
        self.account_budget = Some((account, binding));
        self
    }
    pub(in crate::pipeline) fn reserve(&self, day: u32, calendar: &Calendar, tokens: u64) -> Option<Reservation> {
        if let Some((account, binding)) = &self.account_budget {
            return account.reserve(*binding, day, calendar, self.limits, tokens).map(Reservation::Account);
        }
        let month = calendar.month_index(day);
        let mut inner = self.inner.lock().ok()?;
        if month > inner.budget.month {
            inner.budget = BudgetStatus { month, ..Default::default() };
        }
        if month < inner.budget.month
            || inner.budget.calls_used >= self.limits.0
            || inner.budget.tokens_used >= self.limits.1
            || inner.budget.tokens_used.checked_add(tokens).is_none_or(|v| v > self.limits.1)
        {
            return None;
        }
        inner.budget.calls_used += 1;
        inner.budget.tokens_used += tokens;
        Some(Reservation::Local { month, reserved: tokens })
    }
    pub(in crate::pipeline) fn settle(&self, ticket: Reservation, actual: u64) {
        match ticket {
            Reservation::Account(ticket) => {
                if let Some((account, _)) = &self.account_budget {
                    account.record(ticket, actual);
                }
            }
            Reservation::Local { month, reserved } => {
                if let Ok(mut inner) = self.inner.lock()
                    && inner.budget.month == month
                {
                    inner.budget.tokens_used = inner.budget.tokens_used.saturating_sub(reserved).saturating_add(actual);
                }
            }
        }
    }
    pub(in crate::pipeline) async fn process_f9(&self, task: AiTask) -> AiOutcome {
        let kind = task.kind;
        let day = task.day;
        let TaskExtra::F9(ctx) = &task.extra else {
            return AiOutcome { task, source: None, verdict: None, intent: None };
        };
        let output = task_schema(&task);
        let schema = serde_json::to_string(&output.schema).unwrap_or_default();
        let (system, user, max_tokens, version) = self.render(kind, &task.vars, &schema);
        self.audit(day, kind, "提示词", format!("v{version}; {} chars", system.chars().count() + user.chars().count()));
        let key = blake3::hash(
            format!(
                "{}|{}|{}|{}|{version}|{system}|{user}",
                task.ctx.defs.world_key,
                task.ctx.defs.meta.hash,
                ctx.binding,
                kind.key()
            )
            .as_bytes(),
        )
        .to_hex()
        .to_string();
        let use_llm = matches!(self.mode, AiMode::Mock | AiMode::Live) && self.provider.is_some();
        let mut raw = None;
        if use_llm {
            if let Some(hit) = self.cache_get(&key) {
                // 每一轮自由对话都占用次数，缓存只节约 token。
                if let Some(ticket) = self.reserve(day, &task.ctx.defs.calendar, 0) {
                    self.settle(ticket, 0);
                    raw = Some((hit, ProposalSource::Cache));
                    self.audit(day, kind, "缓存命中", "ai.cache");
                } else {
                    self.audit(day, kind, "预算", "ai.budget");
                }
            } else if self.gate.as_ref().is_some_and(|gate| !gate.try_acquire()) {
                self.audit(day, kind, "预算", "ai.gate");
            } else {
                // 字节数给出比字符数更保守的输入上界；输出覆盖 Anthropic 适配器的四倍、至少 4000 额度。
                let output_ceiling = u64::from(max_tokens).saturating_mul(4).max(4000);
                let estimated = (system.len() as u64)
                    .saturating_add(user.len() as u64)
                    .saturating_add(schema.len() as u64)
                    .saturating_add(output_ceiling)
                    .saturating_add(1024);
                if let Some(ticket) = self.reserve(day, &task.ctx.defs.calendar, estimated) {
                    let request = LlmRequest {
                        system,
                        user,
                        max_tokens,
                        tier: self.tier,
                        hint: task.offline.as_ref().map(Proposal::body_json),
                    };
                    if let Some(provider) = &self.provider {
                        match provider.complete_with(&request, Some(&output)).await {
                            Ok(response) => {
                                let tokens = response.input_tokens.saturating_add(response.output_tokens);
                                self.settle(ticket, tokens);
                                if let Some(gate) = &self.gate {
                                    gate.record(tokens);
                                }
                                self.audit(day, kind, "LLM 输出", format!("ai.response; {tokens} tokens"));
                                raw = Some((response.text, ProposalSource::Llm));
                            }
                            Err(_) => self.audit(day, kind, "降级", "ai.provider_unavailable"),
                        }
                    }
                } else {
                    self.audit(day, kind, "预算", "ai.budget");
                }
            }
        }
        let (proposal, source) = match raw {
            Some((raw, source)) => match parse_proposal(kind, &raw) {
                Ok((p, _)) => (Some(p), Some(source)),
                Err(_) => {
                    self.audit(day, kind, "解析", "ai.invalid_json");
                    (None, Some(source))
                }
            },
            None => {
                self.audit(day, kind, "离线模板", "ai.offline");
                (task.offline.clone(), Some(ProposalSource::Offline))
            }
        };
        let reject = |reason: String| Verdict {
            decision: Decision::Reject,
            proposal: None,
            reasons: vec![reason],
            confidence: 1.0,
            score: 0.0,
            via: "rule".into(),
        };
        let verdict = if let Some(proposal) = proposal {
            let rule = RuleAdjudicator::default().adjudicate(&proposal, &task.ctx);
            let gate = ctx.check(&proposal).and_then(|()| ctx.guard.check(&task, &proposal));
            let mut verdict = match gate {
                Err(reason) => reject(reason),
                Ok(()) => rule,
            };
            if verdict.decision != Decision::Reject
                && source == Some(ProposalSource::Llm)
                && self.adjudicator.is_remote()
            {
                // 远程裁决同样计入次数；不允许旁路在预算用尽后继续联网。
                // 缓存只收已经通过远程裁决的结果，命中时重新查本地规则与当前语境即可。
                let estimate = (proposal.body_json().to_string().len() as u64).saturating_add(4096);
                if let Some(_ticket) = self.reserve(day, &task.ctx.defs.calendar, estimate) {
                    verdict = self.adjudicator.adjudicate(&proposal, &task.ctx).await;
                } else {
                    verdict = reject("ai.budget".into());
                }
            }
            if verdict.decision != Decision::Reject {
                if let Some(accepted) = &verdict.proposal {
                    if let Err(reason) = ctx.check(accepted).and_then(|()| ctx.guard.check(&task, accepted)) {
                        verdict = reject(reason);
                    } else {
                        let rule = RuleAdjudicator::default().adjudicate(accepted, &task.ctx);
                        if rule.decision == Decision::Reject {
                            verdict = rule;
                        }
                    }
                } else {
                    verdict = reject("ai.empty_verdict".into());
                }
            }
            if verdict.decision != Decision::Reject
                && source == Some(ProposalSource::Llm)
                && let Some(accepted) = &verdict.proposal
            {
                self.cache_put(key, accepted.body_json().to_string());
            }
            self.audit(
                day,
                kind,
                "裁决",
                if verdict.decision == Decision::Reject { "ai.rejected" } else { "ai.accepted" },
            );
            Some(verdict)
        } else {
            None
        };
        AiOutcome { task, source, verdict, intent: None }
    }
}

/// 已知信件与日志仍可能引用未见地点；提示词沿用视图的知识边界，事实指纹保持原值。
fn redact_context_locations(world: &World, vars: &mut BTreeMap<String, String>) {
    let mut hidden: Vec<&str> = world
        .defs
        .locations
        .iter()
        .enumerate()
        .filter(|(i, _)| !world.location_visible(LocId::from_idx(*i)))
        .flat_map(|(_, loc)| [loc.key.as_str(), loc.name.as_str()])
        .collect();
    hidden.extend(
        world
            .defs
            .discoveries
            .iter()
            .enumerate()
            .filter(|(i, _)| !world.state.explore.discovered.contains_key(&manifest_core::DiscoveryId::from_idx(*i)))
            .flat_map(|(_, discovery)| [discovery.key.as_str(), discovery.name.as_str()]),
    );
    hidden.retain(|name| !name.is_empty());
    hidden.sort_by_key(|name| std::cmp::Reverse(name.len()));
    hidden.dedup();
    let redact = |text: &str| {
        let mut text = text.to_owned();
        for name in &hidden {
            text = text.replace(name, "[unknown]");
        }
        text
    };
    fn visit(value: &mut serde_json::Value, redact: &impl Fn(&str) -> String) {
        match value {
            serde_json::Value::String(text) => *text = redact(text),
            serde_json::Value::Array(values) => values.iter_mut().for_each(|v| visit(v, redact)),
            serde_json::Value::Object(values) => values.values_mut().for_each(|v| visit(v, redact)),
            _ => {}
        }
    }
    for key in ["summary", "memory", "persona"] {
        if let Some(text) = vars.get_mut(key) {
            if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(text) {
                visit(&mut value, &redact);
                if let Ok(encoded) = serde_json::to_string(&value) {
                    *text = encoded;
                }
            } else {
                *text = redact(text);
            }
        }
    }
}

/// AI 的人物词表与专名门禁只收见过面的人物。
pub(super) fn person_known(world: &World, key: &str) -> bool {
    world.state.cast.persons.get(key).is_some_and(|s| s.met)
}
