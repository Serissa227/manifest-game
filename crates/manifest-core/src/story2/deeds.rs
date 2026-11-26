//! 持久行为计数；每个行为只有一个来源，不依赖截断的日志。
use super::{Condition, ObjectiveKind, Status};
use crate::{Command, CommandOutcome, World, ids::OwnerId, log::LogKind};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Deed {
    Buy,
    Sell,
    SellProfit,
    Depart,
    Arrive,
    InnDay,
    Resupply,
    HireCrew,
    HireMate,
    AssignMate,
    Repair,
    Refit,
    BuyShip,
    Invest,
    RentWarehouse,
    PlaceOrder,
    BuildIndustry,
    AcceptContract,
    DeliverContract,
    Deposit,
    Borrow,
    PlanRoute,
    Autopilot,
    Hail,
    Sighting,
    Landing,
    ShoreTask,
    ReportDiscovery,
    ReadNews,
    MarketReport,
    Talk,
    Gift,
    BuyItem,
    Equip,
    ReadBook,
    UseItem,
    BidAuction,
    BattleWin,
    Jettison,
    StandingOrders,
    Transfer,
    Steer,
    License,
    Marque,
    BuyChart,
    SellShip,
    Nets,
    Dive,
    Discover,
    FormCaravan,
    FoundColony,
    Recruit,
    JoinSociety,
    CastSpell,
    Propagate,
    Contribute,
    CommissionShip,
    BanterReply,
    UbPlan,
    UbFocus,
    UbTown,
    UbMeet,
    UbGift,
    UbBuy,
    UbHelp,
    UbContestEnter,
    UbContestWin,
    UbExcursion,
    UbExamPass,
    UbCompanion,
    UbSeasonReview,
    UbSettle,
    UbChoosePath,
    UbMarker,
    UbRestDay,
    DismissCrew,
    UbTierUp,
    UbAction,
    UbTalkDeep,
    UbJob,
    UbRankUp,
    UbRest,
    UbSelfStudy,
    UbTemplate,
    UbTierOpen,
    UbMissionDone,
    UbMasterTest,
    UbVoyage,
    UbFamilyDuty,
    UbRumor,
}
impl Deed {
    pub const ALL: [Self; 90] = [
        Self::Buy,
        Self::Sell,
        Self::SellProfit,
        Self::Depart,
        Self::Arrive,
        Self::InnDay,
        Self::Resupply,
        Self::HireCrew,
        Self::HireMate,
        Self::AssignMate,
        Self::Repair,
        Self::Refit,
        Self::BuyShip,
        Self::Invest,
        Self::RentWarehouse,
        Self::PlaceOrder,
        Self::BuildIndustry,
        Self::AcceptContract,
        Self::DeliverContract,
        Self::Deposit,
        Self::Borrow,
        Self::PlanRoute,
        Self::Autopilot,
        Self::Hail,
        Self::Sighting,
        Self::Landing,
        Self::ShoreTask,
        Self::ReportDiscovery,
        Self::ReadNews,
        Self::MarketReport,
        Self::Talk,
        Self::Gift,
        Self::BuyItem,
        Self::Equip,
        Self::ReadBook,
        Self::UseItem,
        Self::BidAuction,
        Self::BattleWin,
        Self::Jettison,
        Self::StandingOrders,
        Self::Transfer,
        Self::Steer,
        Self::License,
        Self::Marque,
        Self::BuyChart,
        Self::SellShip,
        Self::Nets,
        Self::Dive,
        Self::Discover,
        Self::FormCaravan,
        Self::FoundColony,
        Self::Recruit,
        Self::JoinSociety,
        Self::CastSpell,
        Self::Propagate,
        Self::Contribute,
        Self::CommissionShip,
        Self::BanterReply,
        Self::UbPlan,
        Self::UbFocus,
        Self::UbTown,
        Self::UbMeet,
        Self::UbGift,
        Self::UbBuy,
        Self::UbHelp,
        Self::UbContestEnter,
        Self::UbContestWin,
        Self::UbExcursion,
        Self::UbExamPass,
        Self::UbCompanion,
        Self::UbSeasonReview,
        Self::UbSettle,
        Self::UbChoosePath,
        Self::UbMarker,
        Self::UbRestDay,
        Self::DismissCrew,
        Self::UbTierUp,
        Self::UbAction,
        Self::UbTalkDeep,
        Self::UbJob,
        Self::UbRankUp,
        Self::UbRest,
        Self::UbSelfStudy,
        Self::UbTemplate,
        Self::UbTierOpen,
        Self::UbMissionDone,
        Self::UbMasterTest,
        Self::UbVoyage,
        Self::UbFamilyDuty,
        Self::UbRumor,
    ];
    pub fn key(self) -> &'static str {
        match self {
            Self::Buy => "buy",
            Self::Sell => "sell",
            Self::SellProfit => "sell_profit",
            Self::Depart => "depart",
            Self::Arrive => "arrive",
            Self::InnDay => "inn_day",
            Self::Resupply => "resupply",
            Self::HireCrew => "hire_crew",
            Self::HireMate => "hire_mate",
            Self::AssignMate => "assign_mate",
            Self::Repair => "repair",
            Self::Refit => "refit",
            Self::BuyShip => "buy_ship",
            Self::Invest => "invest",
            Self::RentWarehouse => "rent_warehouse",
            Self::PlaceOrder => "place_order",
            Self::BuildIndustry => "build_industry",
            Self::AcceptContract => "accept_contract",
            Self::DeliverContract => "deliver_contract",
            Self::Deposit => "deposit",
            Self::Borrow => "borrow",
            Self::PlanRoute => "plan_route",
            Self::Autopilot => "autopilot",
            Self::Hail => "hail",
            Self::Sighting => "sighting",
            Self::Landing => "landing",
            Self::ShoreTask => "shore_task",
            Self::ReportDiscovery => "report_discovery",
            Self::ReadNews => "read_news",
            Self::MarketReport => "market_report",
            Self::Talk => "talk",
            Self::Gift => "gift",
            Self::BuyItem => "buy_item",
            Self::Equip => "equip",
            Self::ReadBook => "read_book",
            Self::UseItem => "use_item",
            Self::BidAuction => "bid_auction",
            Self::BattleWin => "battle_win",
            Self::Jettison => "jettison",
            Self::StandingOrders => "standing_orders",
            Self::Transfer => "transfer",
            Self::Steer => "steer",
            Self::License => "license",
            Self::Marque => "marque",
            Self::BuyChart => "buy_chart",
            Self::SellShip => "sell_ship",
            Self::Nets => "nets",
            Self::Dive => "dive",
            Self::Discover => "discover",
            Self::FormCaravan => "form_caravan",
            Self::FoundColony => "found_colony",
            Self::Recruit => "recruit",
            Self::JoinSociety => "join_society",
            Self::CastSpell => "cast_spell",
            Self::Propagate => "propagate",
            Self::Contribute => "contribute",
            Self::CommissionShip => "commission_ship",
            Self::BanterReply => "banter_reply",
            Self::UbPlan => "ub_plan",
            Self::UbFocus => "ub_focus",
            Self::UbTown => "ub_town",
            Self::UbMeet => "ub_meet",
            Self::UbGift => "ub_gift",
            Self::UbBuy => "ub_buy",
            Self::UbHelp => "ub_help",
            Self::UbContestEnter => "ub_contest_enter",
            Self::UbContestWin => "ub_contest_win",
            Self::UbExcursion => "ub_excursion",
            Self::UbExamPass => "ub_exam_pass",
            Self::UbCompanion => "ub_companion",
            Self::UbSeasonReview => "ub_season_review",
            Self::UbSettle => "ub_settle",
            Self::UbChoosePath => "ub_choose_path",
            Self::UbMarker => "ub_marker",
            Self::UbRestDay => "ub_rest_day",
            Self::DismissCrew => "dismiss_crew",
            Self::UbTierUp => "ub_tier_up",
            Self::UbAction => "ub_action",
            Self::UbTalkDeep => "ub_talk_deep",
            Self::UbJob => "ub_job",
            Self::UbRankUp => "ub_rank_up",
            Self::UbRest => "ub_rest",
            Self::UbSelfStudy => "ub_self_study",
            Self::UbTemplate => "ub_template",
            Self::UbTierOpen => "ub_tier_open",
            Self::UbMissionDone => "ub_mission_done",
            Self::UbMasterTest => "ub_master_test",
            Self::UbVoyage => "ub_voyage",
            Self::UbFamilyDuty => "ub_family_duty",
            Self::UbRumor => "ub_rumor",
        }
    }
    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.key() == key)
    }
    pub fn reserved(self) -> bool {
        matches!(
            self,
            Self::UbFocus
                | Self::UbTown
                | Self::UbMeet
                | Self::UbHelp
                | Self::UbSeasonReview
                | Self::UbRestDay
                | Self::UbVoyage
                | Self::UbRumor
        )
    }
    pub fn upbringing(self) -> bool {
        self.key().starts_with("ub_")
    }
}

/// 保留每次出现及其基线标记；校验按出现次数计上限，基线再按键去重。
pub(crate) fn condition_deeds(c: &Condition) -> Vec<(Deed, bool)> {
    match c {
        Condition::Deed { deed, since_entered, .. } => vec![(*deed, *since_entered)],
        Condition::Any { any } => any.iter().flat_map(condition_deeds).collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn objective_deeds(o: &ObjectiveKind) -> Vec<(Deed, bool)> {
    match o {
        ObjectiveKind::Deed { deed, since_entered, .. } => vec![(*deed, *since_entered)],
        ObjectiveKind::Any { any } => any.iter().flat_map(objective_deeds).collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn chapter_deed_marks(c: &super::ChapterDef) -> BTreeSet<Deed> {
    c.when
        .iter()
        .flat_map(condition_deeds)
        .chain(c.objectives.iter().flat_map(|o| objective_deeds(&o.kind)))
        .filter_map(|(deed, since)| since.then_some(deed))
        .chain(
            c.objectives
                .iter()
                .filter_map(|o| matches!(o.kind, ObjectiveKind::Battle { .. }).then_some(Deed::BattleWin)),
        )
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeedMark {
    pub chapter: String,
    pub entered: u32,
    pub counts: BTreeMap<Deed, u32>,
}

#[derive(Default)]
pub struct Pre {
    sale_cost: Option<i64>,
    docked: bool,
    unread: bool,
    exam_attempts: Option<u32>,
    upbringing: bool,
}

pub fn pre(cmd: &Command, w: &World) -> Pre {
    if !w.defs.rules.quests.enabled || cmd.owner() != Some(OwnerId::Player) {
        return Pre::default();
    }
    let mut out = Pre { upbringing: w.upbringing_active(), ..Pre::default() };
    match cmd {
        Command::Sell { good, qty, .. } | Command::SellFrom { good, qty, .. } => {
            out.sale_cost = w.state.agents.get(&OwnerId::Player).map(|a| a.book.clone().remove(*good, *qty));
        }
        Command::Autopilot { fleet, .. } => {
            out.docked = w.state.fleets.get(fleet).is_some_and(|f| f.docked_at().is_some());
        }
        Command::MarkNewsRead { ids, .. } => {
            out.unread = ids.iter().any(|id| w.state.story2.news.get(id).is_some_and(|n| !n.read));
        }
        Command::TakeExam { exam, .. } => {
            out.exam_attempts =
                Some(w.state.upbringing.as_ref().and_then(|s| s.exams.get(exam)).map_or(0, |e| e.attempts));
        }
        _ => {}
    }
    out
}

impl World {
    pub(crate) fn record_deed(&mut self, deed: Deed, amount: u32) {
        if self.defs.rules.quests.enabled && amount > 0 {
            let count = self.state.story2.deeds.entry(deed).or_default();
            *count = count.saturating_add(amount);
        }
    }

    pub(crate) fn record_command_deeds(&mut self, cmd: &Command, result: &CommandOutcome, pre: Pre) {
        if !self.defs.rules.quests.enabled || cmd.owner() != Some(OwnerId::Player) {
            return;
        }
        use Command::*;
        let deed = match cmd {
            Buy { .. } | BuyInto { .. } => Some(Deed::Buy),
            Sell { .. } | SellFrom { .. } => Some(Deed::Sell),
            Depart { .. } | SetSail { .. } => Some(Deed::Depart),
            Resupply { .. } => Some(Deed::Resupply),
            HireCrew { .. } => Some(Deed::HireCrew),
            HireMate { .. } => Some(Deed::HireMate),
            AssignMate { .. } => Some(Deed::AssignMate),
            Repair { .. } => Some(Deed::Repair),
            RefitShip { .. } => Some(Deed::Refit),
            BuyShip { .. } | FoundFleet { .. } => Some(Deed::BuyShip),
            InvestPort { .. } => Some(Deed::Invest),
            RentWarehouse { .. } | BuyWarehouse { .. } => Some(Deed::RentWarehouse),
            PlaceOrder { .. } => Some(Deed::PlaceOrder),
            BuildIndustry { .. } => Some(Deed::BuildIndustry),
            AcceptContract { .. } => Some(Deed::AcceptContract),
            DeliverContract { .. } => Some(Deed::DeliverContract),
            Deposit { .. } => Some(Deed::Deposit),
            Borrow { .. } => Some(Deed::Borrow),
            Autopilot { .. } => Some(Deed::Autopilot),
            Hail { .. } => Some(Deed::Hail),
            ResolveSighting { .. } => Some(Deed::Sighting),
            Landing { .. } => Some(Deed::Landing),
            Shore { order: crate::seafaring::ShoreOrder::Start { .. }, .. } => Some(Deed::ShoreTask),
            ReportDiscovery { .. } => Some(Deed::ReportDiscovery),
            MarkNewsRead { .. } if pre.unread => Some(Deed::ReadNews),
            BuyMarketReport { .. } => Some(Deed::MarketReport),
            Talk { .. } | TalkFree { .. } => Some(Deed::Talk),
            GiveItem { .. } | GiveGoods { .. } => Some(Deed::Gift),
            BuyItem { .. } => Some(Deed::BuyItem),
            Equip { .. } => Some(Deed::Equip),
            ReadBook { .. } => Some(Deed::ReadBook),
            UseItem { .. } => Some(Deed::UseItem),
            BidAuction { .. } => Some(Deed::BidAuction),
            Voyage {
                order:
                    crate::seafaring::VoyageOrder::Jettison { .. } | crate::seafaring::VoyageOrder::JettisonShare { .. },
                ..
            } => Some(Deed::Jettison),
            Voyage { order: crate::seafaring::VoyageOrder::SetOrders(..), .. } => Some(Deed::StandingOrders),
            Transfer { .. } => Some(Deed::Transfer),
            Steer { .. } => Some(Deed::Steer),
            BuyLicense { .. } => Some(Deed::License),
            BuyMarque { .. } => Some(Deed::Marque),
            BuyChart { .. } => Some(Deed::BuyChart),
            SellShip { .. } => Some(Deed::SellShip),
            Shore { order: crate::seafaring::ShoreOrder::Nets { on: true }, .. } => Some(Deed::Nets),
            Dive { .. } => Some(Deed::Dive),
            FormCaravan { .. } => Some(Deed::FormCaravan),
            FoundColony { .. } => Some(Deed::FoundColony),
            RecruitPerson { .. } => Some(Deed::Recruit),
            JoinSociety { .. } => Some(Deed::JoinSociety),
            CastSpell { .. } => Some(Deed::CastSpell),
            Propagate { .. } => Some(Deed::Propagate),
            Contribute { .. } => Some(Deed::Contribute),
            CommissionShip { .. } => Some(Deed::CommissionShip),
            BanterReply { .. } => Some(Deed::BanterReply),
            PlanLessons { .. } | PlanWeek { .. } | PlanMonth { .. } => Some(Deed::UbPlan),
            ChoosePath { .. } => Some(Deed::UbChoosePath),
            DismissCrew { .. } => Some(Deed::DismissCrew),
            _ => None,
        };
        if let Some(deed) = deed {
            self.record_deed(deed, 1);
        }
        if matches!(cmd, Sell { .. } | SellFrom { .. })
            && let (Some(cost), CommandOutcome::Traded(q)) = (pre.sale_cost, result)
            && q.total > cost
        {
            self.record_deed(Deed::SellProfit, 1);
        }
        if let Autopilot { route, .. } = cmd {
            if pre.docked {
                self.record_deed(Deed::Depart, 1);
            }
            if route.is_some() {
                self.record_deed(Deed::PlanRoute, 1);
            }
        }
        if pre.upbringing {
            if matches!(cmd, GiveItem { .. }) {
                self.record_deed(Deed::UbGift, 1);
            }
            if matches!(cmd, BuyItem { .. }) {
                self.record_deed(Deed::UbBuy, 1);
            }
            if let TakeExam { exam, .. } = cmd
                && let Some(before) = pre.exam_attempts
                && self
                    .state
                    .upbringing
                    .as_ref()
                    .and_then(|s| s.exams.get(exam))
                    .is_some_and(|e| e.passed && e.attempts == before.saturating_add(1))
            {
                self.record_deed(Deed::UbExamPass, 1);
            }
        }
    }

    pub(crate) fn record_log_deed(&mut self, kind: &LogKind) {
        let deed = match kind {
            LogKind::Arrived { owner: OwnerId::Player, .. } => Deed::Arrive,
            LogKind::NavalBattle { owner: OwnerId::Player, result: crate::battle::BattleResult::Won, .. } => {
                Deed::BattleWin
            }
            LogKind::Discovered { owner: OwnerId::Player, .. } => Deed::Discover,
            LogKind::UpbringingSettled { .. } => Deed::UbSettle,
            _ => return,
        };
        self.record_deed(deed, 1);
    }

    pub(crate) fn record_inn_day(&mut self) {
        if self.defs.manual_navigation
            && !self.upbringing_active()
            && self.fleets_of(OwnerId::Player).next().is_some()
            && self.fleets_of(OwnerId::Player).all(|f| f.docked_at().is_some())
        {
            self.record_deed(Deed::InnDay, 1);
        }
    }

    /// 当前章的入章后计数只读本轨道基线，旧档未补基线时给 0。
    pub fn deed_have(&self, deed: Deed, since_entered: bool, track: Option<&str>, entered: u32) -> u32 {
        if !self.defs.rules.quests.enabled {
            return 0;
        }
        let total = self.state.story2.deeds.get(&deed).copied().unwrap_or(0);
        if !since_entered {
            return total;
        }
        let Some((state, mark)) =
            track.and_then(|t| self.state.story2.tracks.get(t).zip(self.state.story2.deed_marks.get(t)))
        else {
            return 0;
        };
        if state.chapter != mark.chapter || entered != mark.entered || state.entered != entered {
            return 0;
        }
        mark.counts.get(&deed).map_or(0, |base| total.saturating_sub(*base))
    }

    pub(crate) fn refresh_deed_marks(&mut self) {
        if !self.defs.rules.quests.enabled {
            self.state.story2.deeds.clear();
            self.state.story2.deed_marks.clear();
            return;
        }
        let mut keep = BTreeSet::new();
        for (key, s) in &self.state.story2.tracks {
            if s.status != Status::Active {
                continue;
            }
            let Some(c) = self.defs.story2.track(key).and_then(|t| t.chapter(&s.chapter)) else { continue };
            let needed = chapter_deed_marks(c);
            if needed.is_empty() {
                continue;
            }
            keep.insert(key.clone());
            if self.state.story2.deed_marks.get(key).is_none_or(|m| m.chapter != s.chapter || m.entered != s.entered) {
                let counts =
                    needed.into_iter().map(|k| (k, self.state.story2.deeds.get(&k).copied().unwrap_or(0))).collect();
                self.state
                    .story2
                    .deed_marks
                    .insert(key.clone(), DeedMark { chapter: s.chapter.clone(), entered: s.entered, counts });
            }
        }
        self.state.story2.deed_marks.retain(|k, _| keep.contains(k));
    }
}
