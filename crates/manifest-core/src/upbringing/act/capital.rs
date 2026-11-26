//! 同一份资本组装供预览与结业使用；只返回数据，不发放奖励。
use super::*;
use crate::{FactionId, StaticData};

pub fn row_value(d: &StaticData, r: &ActRules, kind: &str, key: &str, qty: i64, condition: Option<u8>) -> i64 {
    qty * match kind {
        "cash" => 1,
        "crew" => r.capital_value.crew,
        "food" => r.capital_value.food,
        "water" => r.capital_value.water,
        "mate" => r.capital_value.mate,
        "ally" => r.capital_value.ally,
        "ship" => {
            d.ships.iter().find(|s| s.key == key).map_or(0, |s| s.price * i64::from(condition.unwrap_or(100)) / 100)
        }
        "cargo" => d.goods.iter().find(|g| g.key == key).map_or(0, |g| g.base_price),
        "item" => d.items.item(key).filter(|i| !i.flags.key).map_or(0, |i| i.price),
        "license" => d.factions.iter().find(|f| f.key == key).map_or(0, |f| f.license_price),
        _ => 0,
    }
}
pub fn definition_value(d: &StaticData, r: &ActRules, c: &ActCapitalDef) -> i64 {
    // 数据保留旧粮水列；校验与实际交接都按同一补给天数估值。
    let supplies = crate::fleet::supplies_for_days(d, c.crew, r.review.opening_provision_days);
    let mut value = c.cash
        + c.crew * r.capital_value.crew
        + supplies * (r.capital_value.food + r.capital_value.water)
        + i64::from(c.mates) * r.capital_value.mate
        + i64::from(c.allies) * r.capital_value.ally;
    for s in &c.ships {
        value += row_value(d, r, "ship", s, 1, c.ship_condition);
    }
    for (kind, map) in [("cargo", &c.cargo), ("item", &c.items)] {
        for (k, q) in map {
            value += row_value(d, r, kind, k, *q, None);
        }
    }
    for l in &c.licenses {
        value += row_value(d, r, "license", l, 1, None);
    }
    value
}
impl World {
    fn act_add_row(
        &self,
        rows: &mut Vec<CapitalRow>,
        kind: &str,
        key: &str,
        qty: i64,
        source: &str,
        condition: Option<u8>,
    ) {
        if qty == 0 {
            return;
        }
        let r = self.act_rules().cloned().unwrap_or_default();
        rows.push(CapitalRow {
            kind: kind.into(),
            key: key.into(),
            qty,
            value: row_value(&self.defs, &r, kind, key, qty, condition),
            source: source.into(),
            condition,
        });
    }
    pub fn act_build_capital(&self, band: &str, path: &str) -> (Capital, Vec<CapitalRow>) {
        let family = self.upbringing_family();
        let r = self.act_rules().cloned().unwrap_or_default();
        let mut c = family.and_then(|f| f.completion.as_ref()).map(|c| c.capital.clone()).unwrap_or_default();
        c.cash = 0;
        c.ships.clear();
        c.crew = 0;
        c.food = 0;
        c.water = 0;
        c.cargo.clear();
        c.licenses.clear();
        c.mates.clear();
        c.allies.clear();
        c.ship_condition = None;
        c.items.retain(|k, _| self.defs.items.item(k).is_some_and(|i| i.flags.key));
        let mut rows = Vec::new();
        for (k, q) in &c.items {
            self.act_add_row(&mut rows, "item", k, *q, "common", None);
        }
        let Some(row) = self
            .defs
            .upbringing
            .act_capital
            .iter()
            .find(|c| family.is_some_and(|f| c.family == f.key) && c.band == band && c.path == path)
        else {
            return (c, rows);
        };
        c.cash = row.cash;
        c.ships = row.ships.clone();
        c.crew = row.crew;
        c.ship_condition = row.ship_condition;
        // 裁决：实际交接的补给统一为十天，清单与预览也采用同一数量。
        let supplies = crate::fleet::supplies_for_days(&self.defs, c.crew, r.review.opening_provision_days);
        c.food = supplies;
        c.water = supplies;
        c.cargo = row.cargo.clone();
        c.items.extend(row.items.clone());
        c.licenses = row.licenses.clone();
        let grade = format!("grade:{band}");
        let aspiration = format!("aspiration:{}", if path.is_empty() { "default" } else { path });
        for (kind, qty) in [("cash", c.cash), ("crew", c.crew), ("food", c.food), ("water", c.water)] {
            self.act_add_row(&mut rows, kind, kind, qty, &grade, None);
        }
        for ship in &c.ships {
            self.act_add_row(&mut rows, "ship", ship, 1, &grade, c.ship_condition);
        }
        for (kind, map) in [("cargo", &row.cargo), ("item", &row.items)] {
            for (key, q) in map {
                self.act_add_row(&mut rows, kind, key, *q, &aspiration, None);
            }
        }
        for key in &row.licenses {
            self.act_add_row(&mut rows, "license", key, 1, &aspiration, None);
        }
        let mut preferred = family
            .and_then(|f| f.completion.as_ref())
            .map(|c| {
                c.friends
                    .iter()
                    .filter(|f| self.upbringing_requirements(&f.when))
                    .map(|f| f.person.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        preferred.retain(|p| self.person_alive(p));
        let mut rest = self.act_people();
        let order = |a: &String, b: &String| {
            self.affection(b)
                .map_or(0, |a| a.affinity)
                .cmp(&self.affection(a).map_or(0, |a| a.affinity))
                .then_with(|| a.cmp(b))
        };
        preferred.sort_by(order);
        rest.sort_by(order);
        rest.retain(|p| !preferred.contains(p));
        preferred.extend(rest);
        for kind in ["mate", "ally"] {
            let slots = if kind == "mate" { row.mates } else { row.allies };
            let mut used = 0;
            for person in &preferred {
                if used >= slots {
                    break;
                }
                if c.mates.contains(person)
                    || c.allies.contains(person)
                    || self.act_person_level(person) < if kind == "mate" { 3 } else { 2 }
                {
                    continue;
                }
                if kind == "mate"
                    && (!self.defs.cast.person(person).and_then(|p| p.mate.as_ref()).is_some_and(|m| m.joinable)
                        || self
                            .person_mate(person)
                            .is_none_or(|id| self.state.mates.get(&id).is_some_and(|m| m.owner.is_some())))
                {
                    continue;
                }
                if kind == "mate" {
                    c.mates.push(person.clone());
                } else {
                    c.allies.push(person.clone());
                }
                self.act_add_row(&mut rows, kind, person, 1, &format!("{kind}:{person}"), None);
                used += 1;
            }
            let cash =
                i64::from(slots - used) * if kind == "mate" { r.capital_value.mate } else { r.capital_value.ally };
            c.cash += cash;
            self.act_add_row(&mut rows, "cash", "cash", cash, &format!("slot_cash:{kind}"), None);
        }
        for duty in self.defs.upbringing.act_duties.iter().filter(|d| {
            family.is_some_and(|f| d.family == f.key)
                && d.milestone > 0
                && self.state.upbringing.as_ref().and_then(|s| s.act.family_duty.get(&d.key)).copied().unwrap_or(0)
                    >= d.milestone
        }) {
            let source = format!("family_duty:{}", duty.key);
            c.cash += duty.award.cash;
            self.act_add_row(&mut rows, "cash", "cash", duty.award.cash, &source, None);
            for (k, q) in &duty.award.items {
                *c.items.entry(k.clone()).or_default() += q;
                self.act_add_row(&mut rows, "item", k, *q, &source, None);
            }
            for k in &duty.award.licenses {
                if !c.licenses.contains(k) {
                    c.licenses.push(k.clone());
                    self.act_add_row(&mut rows, "license", k, 1, &source, None);
                }
            }
            if duty.award.repair_ship && c.ship_condition.is_some() {
                c.ship_condition = None;
                for row in rows.iter_mut().filter(|r| r.kind == "ship") {
                    row.source = source.clone();
                    row.condition = None;
                    row.value = row_value(&self.defs, &r, "ship", &row.key, row.qty, None);
                }
            }
        }
        if let Some(ending) = self.upbringing_best_ending() {
            for (k, q) in &ending.award.items {
                rows.push(CapitalRow {
                    kind: "item".into(),
                    key: k.clone(),
                    qty: *q,
                    value: 0,
                    source: format!("ending:{}", ending.key),
                    condition: None,
                });
            }
        }
        if self.act_rank() == 4
            && let Some(review) =
                self.defs.upbringing.act_review.iter().find(|a| family.is_some_and(|f| a.family == f.key))
        {
            for k in &review.rank_licenses {
                if !c.licenses.contains(k) {
                    c.licenses.push(k.clone());
                    self.act_add_row(&mut rows, "license", k, 1, "rank:4", None);
                }
            }
            for (k, q) in &review.rank_items {
                *c.items.entry(k.clone()).or_default() += q;
                self.act_add_row(&mut rows, "item", k, *q, "rank:4", None);
            }
        }
        self.act_add_row(&mut rows, "cash", "cash", self.act_savings().kept, "savings", None);
        for rumor in self.act_valid_rumors() {
            rows.push(CapitalRow {
                kind: "rumor".into(),
                key: rumor.key.clone(),
                qty: 1,
                value: self.defs.rules.info.report_per_port,
                source: format!("rumor:{}", rumor.key),
                condition: None,
            });
        }
        for good in self.act_known_goods() {
            self.act_add_row(&mut rows, "known_good", good, 1, &format!("known_good:{good}"), None);
        }
        (c, rows)
    }
    pub fn act_capital_preview(&self) -> CapitalPreview {
        // 养成中唯一能立即决定的交接是跳过；使用与结业相同的缺省成长和档次。
        // 只改投影，不推进日期，也不把预览中的奖励写回真实世界。
        if self.upbringing_active()
            && !self.upbringing_skipping()
            && self.state.upbringing.as_ref().is_some_and(|s| s.phase != Phase::Graduation)
        {
            let mut projected = self.clone();
            if let Some(s) = &mut projected.state.upbringing {
                s.skipping = true;
            }
            if projected.apply_skipped_growth().is_ok() {
                return projected.act_capital_preview();
            }
        }
        let score = self.act_score();
        let chosen = self.state.upbringing.as_ref().and_then(|s| s.path.clone());
        let path = chosen
            .as_deref()
            .and_then(|k| self.defs.upbringing.paths.iter().find(|p| p.key == k))
            .filter(|p| self.upbringing_requirements(&p.requirements));
        let graduation = self.state.upbringing.as_ref().and_then(|s| s.graduation.as_ref());
        let record = graduation.and_then(|g| g.act.as_ref());
        let band = if let Some(record) = record {
            record.band.clone()
        } else if self.upbringing_skipping() {
            self.act_rules().map_or("bing", |r| r.skip_band.as_str()).into()
        } else {
            score.band
        };
        let rows = record.map_or_else(
            || self.act_build_capital(&band, path.map_or("", |p| p.key.as_str())).1,
            |record| record.rows.clone(),
        );
        let mut savings = self.act_savings();
        if let Some(record) = record {
            savings.cash = record.given + record.kept;
            savings.given = record.given;
            savings.kept = record.kept;
            let rules = self.act_rules().cloned().unwrap_or_default();
            savings.score = (record.given / rules.savings.score_per).min(rules.savings.score_max);
        }
        CapitalPreview {
            guarantee: self.act_capital_guarantee(&band),
            band,
            aspiration: graduation.map_or(chosen, |g| g.path.clone()),
            fulfilled: graduation.map_or(path.is_some(), |g| g.path_fulfilled),
            value: rows.iter().map(|r| r.value).sum(),
            rows,
            savings,
            skip_band: self.act_rules().map_or("bing", |r| r.skip_band.as_str()).into(),
        }
    }
    pub(crate) fn act_graduation_capital(&mut self, path: &str) -> Result<(Capital, ActGraduation), CommandError> {
        let score = self.act_score();
        let savings = self.act_savings();
        let band = if self.upbringing_skipping() {
            self.act_rules().map_or("bing", |r| r.skip_band.as_str()).into()
        } else {
            score.band
        };
        let (capital, rows) = self.act_build_capital(&band, path);
        self.act_pay(savings.given).map_err(|e| CommandError::Internal(e.to_string()))?;
        self.state.story2.flags.insert(format!("ub_grade_{band}"));
        if self.act_rules().is_some_and(|r| r.guarantee.bands.contains(&band)) {
            self.state.story2.flags.insert("family_guarantee".into());
        }
        Ok((
            capital,
            ActGraduation {
                band,
                score: score.total,
                items: score.items,
                rows,
                given: savings.given,
                kept: savings.kept,
            },
        ))
    }
    pub(crate) fn grant_capital_condition(
        &mut self,
        capital: &Capital,
        fleet: Option<crate::FleetId>,
    ) -> Result<(), CommandError> {
        if let Some(condition) = capital.ship_condition
            && let Some(id) = fleet
        {
            let mut discount = 0;
            for ship in &mut self.fleet_mut(id)?.ships {
                ship.durability = (ship.max_durability * i64::from(condition) / 100).max(1);
                let value = ship.book_value * i64::from(condition) / 100;
                discount += ship.book_value - value;
                ship.book_value = value;
            }
            if discount > 0 {
                let day = self.day();
                self.agent_mut(OwnerId::Player)?
                    .ledger
                    .post(
                        crate::ledger::JournalEntry::new(
                            day,
                            crate::ledger::Memo::Opening,
                            crate::ledger::CashClass::Financing,
                        )
                        .dr(crate::ledger::Account::Capital, discount)
                        .cr(crate::ledger::Account::Ships, discount),
                    )
                    .map_err(CoreError::from)?;
            }
        }
        for key in &capital.licenses {
            let id = self
                .defs
                .factions
                .iter()
                .position(|f| f.key == *key)
                .map(FactionId::from_idx)
                .ok_or_else(|| CommandError::NotFound(key.clone()))?;
            let agent = self.agent_mut(OwnerId::Player)?;
            if !agent.licenses.contains(&id) {
                agent.licenses.push(id);
            }
        }
        Ok(())
    }
}

impl World {
    /// 只投影这一档的作保条款，不发旗、不借款。
    pub fn act_capital_guarantee(&self, band: &str) -> Option<CapitalGuarantee> {
        let rules = &self.act_rules()?.guarantee;
        rules
            .bands
            .iter()
            .any(|key| key == band)
            .then_some(CapitalGuarantee { amount: rules.amount, rate_pct: rules.rate_pct })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn capital_guarantee_truth_table() {
        println!("band | skip | effective_band | eligible | amount | rate_pct | serialized");
        for (index, band) in ["ding", "bing", "yi", "jia", "te"].into_iter().enumerate() {
            for skip in [false, true] {
                let mut defs = (*crate::testkit::captain_defs()).clone();
                let mut rules = ActRules::default();
                let threshold = |i| if i <= index { 0 } else { i64::MAX };
                rules.bands.bing = threshold(1);
                rules.bands.yi = threshold(2);
                rules.bands.jia = threshold(3);
                rules.bands.te = threshold(4);
                defs.rules.upbringing.act = Some(rules);
                defs.scenarios[0].upbringing = true;
                defs.upbringing.families.push(
                    serde_json::from_value(serde_json::json!({
                        "key":"family", "name":"", "scenario":defs.scenarios[0].key,
                        "home":defs.locations[0].key, "born":[1489,6,1], "gender":"f",
                        "graduation":[1506,1,1],
                        "stages":[{"from":[1502,1,1], "stage":"home", "name":"", "at":defs.locations[0].key}]
                    }))
                    .expect("family"),
                );
                let mut world = World::new(Arc::new(defs), crate::ScenarioId(0), 42).expect("world");
                world.state.upbringing = Some(UpbringingState {
                    family: "family".into(),
                    phase: Phase::Graduation,
                    skipping: skip,
                    ..Default::default()
                });
                assert_eq!(world.act_score().band, band);
                let preview = world.act_capital_preview();
                let effective = if skip { "bing" } else { band };
                let eligible = skip || index < 2;
                let expected = eligible.then_some(CapitalGuarantee { amount: 1500, rate_pct: 50 });
                assert_eq!(preview.band, effective);
                assert_eq!(preview.guarantee, expected);
                let json = serde_json::to_value(&preview).expect("preview_json");
                assert_eq!(json.get("guarantee").is_some(), eligible);
                println!(
                    "{band} | {skip} | {effective} | {eligible} | {:?} | {:?} | {}",
                    preview.guarantee.as_ref().map(|g| g.amount),
                    preview.guarantee.as_ref().map(|g| g.rate_pct),
                    json.get("guarantee").is_some()
                );
            }
        }
    }
}
