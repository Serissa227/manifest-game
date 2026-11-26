//! 计划中的阅读复用物品系统；每旬只安排一次，已完成作品不会再次发奖励。
use super::Phase;
use crate::{OwnerId, World};
impl World {
    pub(crate) fn prepare_upbringing_reading(&mut self) {
        let Some(s) = self.state.upbringing.as_ref() else { return };
        // 记“已经为哪一格准备过”：按旬用旬序；按周（U05）用那一格结算日的日号，一个月里不会重复。
        let (limit, tag) = if self.upbringing_weekly() {
            let slots = self.upbringing_week_slots();
            let tag = slots.get(usize::from(s.next_slot)).map_or(0, |(_, date)| date[2] as u8);
            (slots.len() as u8, tag)
        } else {
            (3, s.next_slot)
        };
        if s.phase != Phase::Running || s.next_slot >= limit || s.reading_slot == Some((s.month, tag)) {
            return;
        }
        let slot = (s.month, tag);
        let book = s.plan.get(s.next_slot as usize).and_then(|p| p.after.as_ref()).and_then(|c| c.book.clone());
        if let Some(book) = book
            && let Ok(reading) = self.choose_reading(OwnerId::Player, &book, None)
        {
            crate::items::reading::apply(self, OwnerId::Player, reading);
        }
        if let Some(s) = &mut self.state.upbringing {
            s.reading_slot = Some(slot);
        }
    }
}
