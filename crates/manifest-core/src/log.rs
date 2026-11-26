//! 世界事件日志：结构化记录，由界面按字符串表格式化显示。

use crate::fixed::Money;
use crate::ids::*;
use serde::{Deserialize, Serialize};

// 旧望见日志只由玩家探索产生；缺失归属时按原来的来源读入。
fn sighted_owner() -> OwnerId {
    OwnerId::Player
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogEvent {
    pub day: u32,
    pub kind: LogKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LogKind {
    Arrived {
        fleet: FleetId,
        owner: OwnerId,
        loc: LocId,
    },
    Storm {
        fleet: FleetId,
        owner: OwnerId,
        damage: i64,
        cargo_lost: i64,
    },
    PirateTribute {
        fleet: FleetId,
        owner: OwnerId,
        cargo_lost: i64,
        cash_lost: Money,
    },
    Disease {
        fleet: FleetId,
        owner: OwnerId,
        deaths: i64,
    },
    Starvation {
        fleet: FleetId,
        owner: OwnerId,
        deaths: i64,
    },
    Mutiny {
        fleet: FleetId,
        owner: OwnerId,
        deserters: i64,
        cargo_lost: i64,
    },
    ShipSunk {
        fleet: FleetId,
        owner: OwnerId,
        ship: ShipTypeId,
    },
    FleetLost {
        fleet: FleetId,
        owner: OwnerId,
    },
    NewFleet {
        fleet: FleetId,
        owner: OwnerId,
    },
    Popular {
        loc: LocId,
        good: GoodId,
    },
    /// 港口的市况变为繁荣、萧条、饥荒或过剩（回到平稳不记；ECONOMY.md 6.4）
    PortCondition {
        loc: LocId,
        condition: crate::people::Condition,
    },
    Bankrupt {
        owner: OwnerId,
    },
    Reorganized {
        owner: OwnerId,
    },
    Robbery {
        caravan: CaravanId,
        owner: OwnerId,
        cargo_lost: i64,
    },
    CaravanArrived {
        caravan: CaravanId,
        owner: OwnerId,
        loc: LocId,
    },
    IndustryStalled {
        industry: IndustryId,
        owner: OwnerId,
    },
    ContractCompleted {
        contract: ContractId,
        owner: OwnerId,
    },
    ContractFailed {
        contract: ContractId,
        owner: OwnerId,
    },
    Diplomacy {
        a: FactionId,
        b: FactionId,
        status: crate::diplomacy::DiploStatus,
    },
    AllyPort {
        loc: LocId,
        owner: OwnerId,
    },
    LoanDefault {
        owner: OwnerId,
        loan: LoanId,
    },
    MarginCall {
        owner: OwnerId,
        exchange: ExchangeId,
        shortfall: Money,
    },
    ForcedLiquidation {
        owner: OwnerId,
        exchange: ExchangeId,
    },
    FuturesDelivery {
        owner: OwnerId,
        contract: FuturesId,
        units: i64,
        missing: i64,
    },
    EventStarted {
        event: EventTypeId,
        loc: Option<LocId>,
        good: Option<GoodId>,
    },
    /// 与海盗交战
    NavalBattle {
        fleet: FleetId,
        owner: OwnerId,
        result: crate::battle::BattleResult,
        cargo_lost: i64,
        cash_lost: Money,
        captured: i64,
    },
    /// 建立殖民地
    ColonyFounded {
        colony: ColonyId,
        owner: OwnerId,
        loc: LocId,
    },
    /// 殖民地建筑完工
    ColonyBuilt {
        colony: ColonyId,
        owner: OwnerId,
        loc: LocId,
        building: ColonyBuildingId,
        level: u8,
    },
    /// 殖民地断粮（开始断粮时与此后每 30 天记一次）
    ColonyStarving {
        colony: ColonyId,
        owner: OwnerId,
        loc: LocId,
        deaths: i64,
    },
    /// 殖民地遭海盗袭击
    ColonyRaided {
        colony: ColonyId,
        owner: OwnerId,
        loc: LocId,
        cargo_lost: i64,
        deaths: i64,
    },
    /// 殖民地疫病
    ColonyEpidemic {
        colony: ColonyId,
        owner: OwnerId,
        loc: LocId,
        deaths: i64,
    },
    /// 失去殖民地（放弃、人口耗尽或破产出售）
    ColonyLost {
        colony: ColonyId,
        owner: OwnerId,
        loc: LocId,
        reason: crate::colony::LossReason,
    },
    /// 势力占领了一处殖民点
    SiteClaimed {
        loc: LocId,
        faction: FactionId,
    },
    /// 发现（玩家舰队的视野覆盖到发现物）
    Discovered {
        discovery: DiscoveryId,
        owner: OwnerId,
    },
    /// 在港口报告发现，领取赏金与名声
    DiscoveryReported {
        discovery: DiscoveryId,
        owner: OwnerId,
        loc: LocId,
        reward: Money,
        fame: i64,
    },
    /// 组合事件开始（`loc` 为效果涉及的第一个地点）
    ComposedEventStarted {
        composed: u32,
        title: String,
        loc: Option<LocId>,
    },
    /// 主角的生日：旗舰船员为主角庆贺
    Birthday {
        owner: OwnerId,
    },
    /// 主角跟麾下的算学奇才学会了一种奇才之法
    CaptainLearned {
        owner: OwnerId,
        mate: MateId,
        method: String,
    },
    /// 势力的财政（ECONOMY.md 6.9）：国库亏空加税（`raised`）或富余减税；`mult` 为新的税率系数，`treasury` 为月末的国库余额
    FiscalTax {
        faction: FactionId,
        mult: crate::fixed::Fx,
        raised: bool,
        treasury: Money,
    },
    /// 剧情事件（故事线的一章或一次奇遇）有了结果：选了第几个选项；`choice` 为空表示当天没有回应、奇遇就此作罢
    StoryResolved {
        fleet: FleetId,
        owner: OwnerId,
        source: crate::story::StorySource,
        choice: Option<u32>,
    },
    /// 内容更新后，读档修整了物品、书目或货架中的失效引用。
    ItemsReconciled,
    /// 手动航行碰岸、遇到边界或封冻海面，在最后一个海格停船。
    NavigationStopped {
        fleet: FleetId,
        owner: OwnerId,
        minute: u16,
    },
    /// H03：远处望见风暴团（进入视野两倍以内）。
    StormSighted {
        fleet: FleetId,
        owner: OwnerId,
        minute: u16,
    },
    /// H08：向附近的船喊了话（`what` 是做了什么，中文）。
    Hailed {
        fleet: FleetId,
        owner: OwnerId,
        what: String,
    },
    /// H08：在海上所见的小卡片上做了选择（`what` 是所见与选项，中文）。
    SightingChosen {
        fleet: FleetId,
        owner: OwnerId,
        what: String,
    },
    /// H06：甩掉了按分钟追击的海盗。
    ShookOff {
        fleet: FleetId,
        owner: OwnerId,
    },
    /// H03：远处望见雾团（进入视野两倍以内）。
    FogSighted {
        fleet: FleetId,
        owner: OwnerId,
        minute: u16,
    },
    /// 内容更新后修整人物的失效引用。
    CastReconciled,
    /// 内容更新后修整章节、选项与见闻的失效引用。
    StoryReconciled,
    /// 一旬已完成结算；续跑不会重复记账。
    UpbringingSettled {
        month: [u32; 2],
        slot: u8,
    },
    UpbringingReconciled,
    /// 首次看见地点，经典世界不产生。
    LocationSighted {
        loc: LocId,
        #[serde(default = "sighted_owner")]
        owner: OwnerId,
    },
    LandingRisk {
        fleet: FleetId,
        owner: OwnerId,
        risk: crate::navigation::landing::LandingRisk,
    },
    LandingFinished {
        fleet: FleetId,
        owner: OwnerId,
        days: u16,
    },
    /// 养成期待回应的章节所有选项都被硬条件锁住，自动作罢，不让时钟停死（任务单 U03 / A2）。经典世界不产生。
    Story2Abandoned {
        track: String,
        chapter: String,
    },
    /// 家乡期满一段时间，家里准许出门远足（引擎发放 `outing_permission`，任务单 U03 / A3）。经典世界不产生。
    OutingPermitted,
    /// H07：首航一对港口（从 `origin` 到 `loc`）；`fame` 是给的名声（航程太短时为 0）。经典世界不产生。
    RouteFirst {
        fleet: FleetId,
        owner: OwnerId,
        origin: LocId,
        loc: LocId,
        days: u32,
        fame: i64,
    },
    /// H07：打破一对港口的航时纪录（旧纪录 `previous` 天）。经典世界不产生。
    RouteRecord {
        fleet: FleetId,
        owner: OwnerId,
        origin: LocId,
        loc: LocId,
        days: u32,
        previous: u32,
        fame: i64,
    },
    /// 每月 1 日的商馆分红汇总（T02）：分出去的合计、发了几座港口、其中几座被上限压住；分得最多的港口与它的合计；
    /// 玩家分到的合计与港口数。各港各投资者的明细在 `WorldState.house.dividends`。经典世界不产生。
    HouseDividends {
        total: Money,
        ports: u32,
        capped: u32,
        loc: LocId,
        top: Money,
        player: Money,
        player_ports: u32,
    },
    /// 港口遭劫，投资者的累计投资折损（T02）：折损合计、涉及几位投资者、其中玩家折损多少。经典世界不产生。
    HouseSacked {
        loc: LocId,
        total: Money,
        investors: u32,
        player: Money,
    },
    /// 商馆代办替人成交了一笔（T03）：在哪里、买（`buy`）还是卖、什么货、几件、现金变动（买入含税、卖出扣税）、代办费。经典世界不产生。
    AgencyFilled {
        owner: OwnerId,
        loc: LocId,
        good: GoodId,
        buy: bool,
        qty: i64,
        total: Money,
        fee: Money,
    },
    /// 现金为负，代办把买单撤了、预留金退回现金（T03）。经典世界不产生。
    AgencyRefunded {
        owner: OwnerId,
        loc: LocId,
        good: GoodId,
        refund: Money,
    },
    /// H02 船况与船员（疲劳事故、进水、坏血病、怠工……）。经典世界不产生。
    VoyageWear {
        fleet: FleetId,
        owner: OwnerId,
        event: crate::seafaring::WearEvent,
        n: i64,
    },
    /// H05 收帆锚泊、派人上岸做差事（几件、全部做完要几天）。经典世界不产生。
    ShoreStarted {
        fleet: FleetId,
        owner: OwnerId,
        tasks: i64,
        days: i64,
    },
    /// H05 一件岸上差事做完（所得：水、粮是件数，船材是份数，倾船刮底是清掉的附着点数）。经典世界不产生。
    ShoreDone {
        fleet: FleetId,
        owner: OwnerId,
        task: crate::seafaring::ShoreTask,
        gain: i64,
    },
    /// S02：带震慑特性的名船令海盗放弃本次遭遇。
    PirateDeterred {
        fleet: FleetId,
        owner: OwnerId,
    },
    /// S02：故事或人物加入授予名船，船名由视图按揭晓旗标解析。
    LegendShipGranted {
        fleet: FleetId,
        owner: OwnerId,
        ship: String,
    },
    /// E03：可见港口的当前阶段变化，升降都记。
    PortStage {
        loc: LocId,
        from: u8,
        to: u8,
    },
    /// E03：条件条目首次开放。
    MarketOpened {
        loc: LocId,
        good: GoodId,
    },
    /// H10h：自动领航开始慢行，同舰队每天至多一条。
    AutopilotCreep {
        fleet: FleetId,
        owner: OwnerId,
        minute: u16,
    },
    /// H10h：所有前进与离岸办法都受阻，收帆等待。
    AutopilotWait {
        fleet: FleetId,
        owner: OwnerId,
        minute: u16,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{World, replay::StartParams, save::SaveFile};
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn old_sighting_log_defaults_to_player_and_explicit_owner_round_trips() {
        let old: LogEvent = serde_json::from_value(json!({"day":3,"kind":{"LocationSighted":{"loc":1}}})).unwrap();
        assert_eq!(old.kind, LogKind::LocationSighted { loc: LocId(1), owner: OwnerId::Player });
        assert_eq!(serde_json::to_value(&old).unwrap()["kind"]["LocationSighted"]["owner"], "player");
        let explicit = LogEvent {
            day: 3,
            kind: LogKind::LocationSighted { loc: LocId(1), owner: OwnerId::Company(CompanyId(2)) },
        };
        assert_eq!(serde_json::from_value::<LogEvent>(serde_json::to_value(&explicit).unwrap()).unwrap(), explicit);
    }

    #[test]
    fn sightings_have_player_owner_and_old_save_logs_resume_identically() {
        let mut defs = crate::testkit::tiny_defs();
        Arc::make_mut(&mut defs).manual_navigation = true;
        Arc::make_mut(&mut defs).navigation.hide_unknown_ports = true;
        let mut world = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
        // 开局只初始化迷雾；日推进会通过真实探索流程记录首次望见。
        world.end_day().unwrap();
        let sightings: Vec<_> = world
            .state
            .log
            .iter()
            .filter_map(|event| match event.kind {
                LogKind::LocationSighted { owner, .. } => Some(owner),
                _ => None,
            })
            .collect();
        assert!(!sightings.is_empty());
        assert!(sightings.iter().all(|owner| *owner == OwnerId::Player));
        let save = SaveFile::new(&defs, StartParams::new(ScenarioId(0), 42), world.state.clone(), vec![]);
        let mut legacy = serde_json::to_value(&save).unwrap();
        for event in legacy["snapshot"]["log"].as_array_mut().unwrap() {
            if let Some(payload) = event["kind"].get_mut("LocationSighted") {
                payload.as_object_mut().unwrap().remove("owner");
            }
        }
        let loaded = SaveFile::from_json(&legacy.to_string()).unwrap();
        assert_eq!(loaded, save);
        let mut restored = World::from_snapshot(defs, loaded.snapshot).unwrap();
        world.end_day().unwrap();
        restored.end_day().unwrap();
        assert_eq!(world.state_hash(), restored.state_hash());
        let mut classic = World::new(crate::testkit::tiny_defs(), ScenarioId(0), 42).unwrap();
        classic.end_day().unwrap();
        assert!(!classic.state.log.iter().any(|event| matches!(event.kind, LogKind::LocationSighted { .. })));
    }
}
