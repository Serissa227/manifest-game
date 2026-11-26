//! 远足状态由已访问节点和邻接关系导出；节点奖励只有首次解开时结算。
use super::*;
use crate::{CommandError, CoreError, OwnerId, World};
impl World {
    pub fn excursion_node_state(&self, excursion: &str, node: &str) -> NodeState {
        let Some(e) = self.defs.upbringing.excursion(excursion) else { return NodeState::Unknown };
        let Some(s) = self.state.upbringing.as_ref() else { return NodeState::Unknown };
        if let Some(state) = s.excursion_nodes.get(excursion).and_then(|nodes| nodes.get(node)) {
            return *state;
        }
        if e.starts.iter().any(|k| k == node)
            || e.nodes.iter().any(|n| {
                s.excursion_nodes.get(excursion).is_some_and(|nodes| nodes.contains_key(&n.key))
                    && n.links.iter().any(|k| k == node)
            })
        {
            NodeState::New
        } else {
            NodeState::Unknown
        }
    }
    pub fn check_excursion(&self, excursion: &str, node: &str) -> Result<(), CommandError> {
        let e = self.defs.upbringing.excursion(excursion).ok_or_else(|| CommandError::NotFound(excursion.into()))?;
        if !self.excursion_available(e) || !e.nodes.iter().any(|n| n.key == node) {
            return Err(CommandError::Precondition("远足不在此处或节点不存在".into()));
        }
        if let Some(n) = e.nodes.iter().find(|n| n.key == node)
            && !n.steps.is_empty()
        {
            self.native_excursion_open(e, n)?;
            return if self.excursion_node_state(excursion, node) == NodeState::Unknown {
                Err(CommandError::Precondition("还没有发现前往此处的路径".into()))
            } else {
                Ok(())
            };
        }
        match self.excursion_node_state(excursion, node) {
            NodeState::Unknown => Err(CommandError::Precondition("还没有发现前往此处的路径".into())),
            NodeState::Solved => Err(CommandError::Precondition("此处已经解开，不能重复领取奖励".into())),
            _ => Ok(()),
        }
    }
    pub(crate) fn settle_excursion(
        &mut self,
        choice: &AfterChoice,
        index: u8,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        let (Some(key), Some(node)) = (&choice.excursion, &choice.node) else { return Ok(Vec::new()) };
        self.check_excursion(key, node).map_err(|e| CoreError::Internal(e.to_string()))?;
        self.record_deed(crate::story2::deeds::Deed::UbExcursion, 1);
        let definition = self
            .defs
            .upbringing
            .excursion(key)
            .and_then(|e| e.nodes.iter().find(|n| &n.key == node))
            .cloned()
            .ok_or_else(|| CoreError::Internal("远足节点不存在".into()))?;
        if !definition.steps.is_empty() {
            return self.settle_native_excursion(key, &definition, choice, index, result);
        }
        let seen = self.excursion_node_state(key, node) == NodeState::Seen;
        let prepared = definition.tools.iter().all(|item| self.item_quantity(OwnerId::Player, item) > 0)
            && definition.growth.iter().all(|(attr, min)| self.upbringing_growth(attr) >= *min)
            && definition.companion_skills.iter().all(|skill| {
                choice.companion.as_ref().is_some_and(|person| {
                    self.defs.upbringing.helpers.get(person).is_some_and(|skills| skills.contains(skill))
                })
            });
        let solved = seen
            && prepared
            && !self.upbringing_rng(&format!("excursion:{key}:{node}"), index, 1).chance_bp(definition.danger);
        if let Some(s) = &mut self.state.upbringing {
            s.excursion_nodes
                .entry(key.clone())
                .or_default()
                .insert(node.clone(), if solved { NodeState::Solved } else { NodeState::Seen });
        }
        if !solved {
            result.line = definition.hint;
            return Ok(Vec::new());
        }
        for (attr, amount) in &definition.rewards {
            *result.growth.entry(attr.clone()).or_default() += self.gain_upbringing_growth(attr, *amount);
        }
        for (item, qty) in &definition.items {
            self.grant_item(OwnerId::Player, item, i64::from(*qty)).map_err(|e| CoreError::Internal(e.to_string()))?;
            *result.items.entry(item.clone()).or_default() += i64::from(*qty);
        }
        Ok(definition.events)
    }
}
