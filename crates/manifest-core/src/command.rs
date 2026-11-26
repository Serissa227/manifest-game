//! 命令：改变世界状态的唯一途径。
//!
//! 每种命令都有 `validate(&World)` 与 `apply(&mut World)`。`apply` 先完整校验，
//! 校验通过后才修改状态，因此失败的命令不会留下半途而废的改动。

use crate::bank::{self, BankPlan};
use crate::battle::{self, BattlePlan, TacticalOrder};
use crate::caravan::{self, CaravanPlan};
use crate::circulation::Sector;
use crate::colony::{self, ColonyPlan};
use crate::composed::{ComposedEffect, ComposedSource};
use crate::contract::{self, ContractPlan};
use crate::diplomacy::{self, PermitPlan};
use crate::error::{CommandError, Reason};
use crate::events::EventParams;
use crate::explore::{self, ChartPlan, ReportPlan};
use crate::fixed::Fx;
use crate::fixed::Money;
use crate::fleet::new_ship;
use crate::futures::{self, FuturesPlan};
use crate::ids::*;
use crate::industry::{self, IndustryPlan, Manager};
use crate::invest::{self, InvestPlan};
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::market::{Side, TradeQuote, quote};
use crate::mates::{self, MatePlan, MateRole};
use crate::news::{self, Intent, NewsFact, NewsSource};
use crate::text::{TextArg, TextRef};
use crate::treasury::Flow;
use crate::warehouse::{self, Holder, WarehousePlan};
use crate::world::{Fleet, FleetLocation, MAX_SHIPS_PER_FLEET, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 命令。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Command {
    // ── 现货与航海 ──
    /// 在舰队停靠的港口买入商品装船
    Buy {
        owner: OwnerId,
        fleet: FleetId,
        good: GoodId,
        qty: i64,
        max_total: Option<Money>,
    },
    /// 在舰队停靠的港口卖出船上商品
    Sell {
        owner: OwnerId,
        fleet: FleetId,
        good: GoodId,
        qty: i64,
        min_total: Option<Money>,
    },
    /// 出航（在海上时为改道）
    SetSail {
        owner: OwnerId,
        fleet: FleetId,
        dest: LocId,
    },
    /// 补给粮水
    Resupply {
        owner: OwnerId,
        fleet: FleetId,
        food: i64,
        water: i64,
    },
    HireCrew {
        owner: OwnerId,
        fleet: FleetId,
        count: i64,
    },
    DismissCrew {
        owner: OwnerId,
        fleet: FleetId,
        count: i64,
    },
    /// 修理全舰队
    Repair {
        owner: OwnerId,
        fleet: FleetId,
    },
    /// 买船：加入现有舰队，或在同港组建新舰队
    BuyShip {
        owner: OwnerId,
        fleet: FleetId,
        ship_type: ShipTypeId,
        new_fleet: bool,
    },
    /// 在有船厂的港口买船组建新舰队（无需已有舰队）
    FoundFleet {
        owner: OwnerId,
        at: LocId,
        ship_type: ShipTypeId,
    },
    SellShip {
        owner: OwnerId,
        fleet: FleetId,
        ship: u8,
    },
    RefitShip {
        owner: OwnerId,
        fleet: FleetId,
        ship: u8,
        refit: RefitId,
    },

    // ── 物流与仓库 ──
    /// 在持有者（舰队、商队或仓库）所在地买入商品存入持有者
    BuyInto {
        owner: OwnerId,
        holder: Holder,
        good: GoodId,
        qty: i64,
        max_total: Option<Money>,
    },
    /// 从持有者中取出商品在当地卖出
    SellFrom {
        owner: OwnerId,
        holder: Holder,
        good: GoodId,
        qty: i64,
        min_total: Option<Money>,
    },
    /// 在同一地点的两个持有者之间搬运货物
    Transfer {
        owner: OwnerId,
        from: Holder,
        to: Holder,
        good: GoodId,
        qty: i64,
    },
    /// 设定在某地租用的仓库容量（0 表示退租）
    RentWarehouse {
        owner: OwnerId,
        loc: LocId,
        capacity: i64,
    },
    /// 在某地购买仓库容量
    BuyWarehouse {
        owner: OwnerId,
        loc: LocId,
        capacity: i64,
    },

    // ── 商队 ──
    FormCaravan {
        owner: OwnerId,
        at: LocId,
        animal: AnimalId,
        count: i64,
    },
    SetGuards {
        owner: OwnerId,
        caravan: CaravanId,
        guards: i64,
    },
    CaravanTravel {
        owner: OwnerId,
        caravan: CaravanId,
        dest: LocId,
    },
    DisbandCaravan {
        owner: OwnerId,
        caravan: CaravanId,
    },

    // ── 委托运输 ──
    AcceptContract {
        owner: OwnerId,
        contract: ContractId,
    },
    DeliverContract {
        owner: OwnerId,
        contract: ContractId,
        holder: Holder,
    },

    // ── 产业 ──
    BuildIndustry {
        owner: OwnerId,
        loc: LocId,
        kind: IndustryTypeId,
        recipe: RecipeId,
    },
    ChangeRecipe {
        owner: OwnerId,
        industry: IndustryId,
        recipe: RecipeId,
    },
    UpgradeIndustry {
        owner: OwnerId,
        industry: IndustryId,
    },
    /// 雇佣（或解雇）NPC 管理人
    SetManager {
        owner: OwnerId,
        industry: IndustryId,
        hired: bool,
    },
    SellIndustry {
        owner: OwnerId,
        industry: IndustryId,
    },

    // ── 港口投资 ──
    InvestPort {
        owner: OwnerId,
        loc: LocId,
        amount: Money,
    },

    // ── 银行 ──
    Deposit {
        owner: OwnerId,
        amount: Money,
    },
    Withdraw {
        owner: OwnerId,
        amount: Money,
    },
    Borrow {
        owner: OwnerId,
        amount: Money,
        months: u32,
    },
    Repay {
        owner: OwnerId,
        loan: LoanId,
        amount: Money,
    },

    // ── 势力 ──
    BuyLicense {
        owner: OwnerId,
        faction: FactionId,
    },
    BuyMarque {
        owner: OwnerId,
        faction: FactionId,
    },

    // ── 期货 ──
    /// 买卖期货：正数为买入（做多），负数为卖出（做空）
    TradeFutures {
        owner: OwnerId,
        contract: FuturesId,
        lots: i64,
    },
    DepositMargin {
        owner: OwnerId,
        exchange: ExchangeId,
        amount: Money,
    },
    WithdrawMargin {
        owner: OwnerId,
        exchange: ExchangeId,
        amount: Money,
    },
    /// 选择到期时实物交割（true）或现金结算（false）
    SetDelivery {
        owner: OwnerId,
        contract: FuturesId,
        physical: bool,
    },

    // ── 航海士 ──
    /// 在酒馆招募航海士（须有舰队或商队在其所在港口）
    HireMate {
        owner: OwnerId,
        mate: MateId,
    },
    DismissMate {
        owner: OwnerId,
        mate: MateId,
    },
    /// 任命：舰长、会计、交易员、商队头领、产业管理人（None 表示撤销任命）
    AssignMate {
        owner: OwnerId,
        mate: MateId,
        role: MateRole,
    },

    // ── 探索 ──
    /// 购买某个海区的海图
    BuyChart {
        owner: OwnerId,
        region: RegionId,
    },

    /// 在港口报告已发现的发现物，领取赏金、声望与名声
    ReportDiscovery {
        owner: OwnerId,
        discovery: DiscoveryId,
        loc: LocId,
    },

    // ── 殖民地 ──
    /// 在舰队锚泊的殖民点建立殖民地：扣建立费与建立物资，settlers 名船员成为殖民者
    FoundColony {
        owner: OwnerId,
        fleet: FleetId,
        site: LocId,
        name: String,
        settlers: i64,
    },
    /// 开工建造或升级一座殖民地建筑（同一时间一个工程）
    BuildColony {
        owner: OwnerId,
        colony: ColonyId,
        building: ColonyBuildingId,
    },
    /// 设定殖民地税率档位（`rules.colony.tax_levels` 的下标）
    SetColonyTax {
        owner: OwnerId,
        colony: ColonyId,
        rate: u8,
    },
    /// 放弃殖民地：仓库存货与账面价值核销，殖民点恢复无主
    AbandonColony {
        owner: OwnerId,
        colony: ColonyId,
    },

    // ── 海战 ──
    /// 对待决的遭遇选择自动结算或战术海战
    EngageBattle {
        owner: OwnerId,
        battle: BattleId,
        tactical: bool,
    },
    /// 战术海战中的一个操作
    TacticalCommand {
        owner: OwnerId,
        battle: BattleId,
        order: TacticalOrder,
    },

    // ── 经裁决与内核校验的 AI 提案 ──
    /// 世界事件（封闭集合中的一种，参数在范围内）
    ApplyEvent {
        event: EventTypeId,
        params: EventParams,
    },
    /// 发布传闻：事实由内核挑选，真假在发布时由内核判定
    PublishNews {
        fact: NewsFact,
        source: NewsSource,
        credibility: u8,
        text: String,
        /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的文字为空）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tpl: Option<TextRef>,
    },
    /// 议价：意图由裁决器分类，折扣由内核计算
    ApplyBargain {
        owner: OwnerId,
        loc: LocId,
        intent: Intent,
        player_text: String,
        reply: String,
        /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的回复为空）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reply_tpl: Option<TextRef>,
    },
    /// 商会战略调整（参数由内核夹紧到允许范围）
    AdjustStrategy {
        company: CompanyId,
        risk: Fx,
        preferred: Vec<GoodId>,
    },
    /// 委托合同（可行性与报酬区间由内核校验）
    OfferContract {
        issuer: FactionId,
        good: GoodId,
        qty: i64,
        to: LocId,
        days: u32,
        reward: Money,
    },
    /// 编年史（纯文字）
    RecordChronicle {
        year: u32,
        text: String,
        /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的编年史为空）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tpl: Option<TextRef>,
    },
    /// 组合事件：从效果词表中组合的 1–N 条效果（边界见 data/effects.toml）；标题与叙事只是文字
    ApplyComposedEvent {
        title: String,
        text: String,
        effects: Vec<ComposedEffect>,
        /// 来源（模型 / 模板），只用于显示
        #[serde(default)]
        source: ComposedSource,
    },

    // ── 主角身世（ECONOMY.md 第 5 节）──
    /// 立下主角的身世：生日、身世五问的回答（选项 key，按问题顺序）、六项属性的自由分配点、开局算学够高时自选的奇才之法。
    /// 每局一次；开局效果只在第 0 天生效。
    CreateCaptain {
        owner: OwnerId,
        birthday: crate::captain::Birthday,
        answers: Vec<String>,
        alloc: Vec<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        genius: Option<String>,
    },

    // ── 商会展望（ECONOMY.md 8.2）──
    /// 商会展望（AI 提案，没有模型时由离线规则写）：对至多 4 种商品的看法（−2…+2）、预测方法、一句备忘（≤ 60 字）；
    /// 距上次 ≥ 25 天。看法让商会对这些商品的预期偏一点、30 天内消退；方法在滞后规则下切换。
    SetOutlook {
        company: CompanyId,
        views: Vec<(GoodId, i8)>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        method: Option<crate::defs::ForecastMethod>,
        memo: String,
        /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的为空）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tpl: Option<TextRef>,
    },

    /// 市场月报（AI 文本，没有模型时由离线模板写）：某海区刚结束的月份的行情，只写内核算出的事实（ECONOMY.md 8.5）
    RecordMarketReport {
        region: RegionId,
        month: u32,
        text: String,
        /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的为空）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tpl: Option<TextRef>,
    },

    // ── 信息时效（ECONOMY.md 第 7 节）──
    /// 选择行情情报：实时（经典）或随船传递。只在开局（第 0 天）时。
    SetInfoMode {
        owner: OwnerId,
        mode: crate::info::InfoMode,
    },
    /// 在港口的交易所买行情通报：告示板上所有比手上新的各港行情。
    BuyMarketReport {
        owner: OwnerId,
        loc: LocId,
    },

    // ── 剧情事件：推荐角色的故事线与奇遇 ──
    /// 回应等待中的剧情事件（故事线的一章或一次奇遇）：选第 `choice` 个选项（从 0 起）。
    /// JSON 形如 `{"StoryAnswer":{"owner":"player","choice":1}}`。
    StoryAnswer {
        owner: OwnerId,
        choice: u32,
    },
    // 第九批物品命令，只在枚举末尾追加。
    BuyItem {
        owner: OwnerId,
        loc: LocId,
        item: String,
        qty: i64,
        max_total: Option<Money>,
    },
    SellItem {
        owner: OwnerId,
        loc: LocId,
        item: String,
        qty: i64,
        min_total: Option<Money>,
    },
    UseItem {
        owner: OwnerId,
        item: String,
        #[serde(default)]
        target: Option<String>,
    },
    Equip {
        owner: OwnerId,
        wearer: String,
        slot: crate::items::equipment::EquipSlot,
        item: String,
    },
    Unequip {
        owner: OwnerId,
        wearer: String,
        slot: crate::items::equipment::EquipSlot,
    },
    ReadBook {
        owner: OwnerId,
        book: String,
        #[serde(default)]
        interpreter: Option<String>,
    },
    GiveItem {
        owner: OwnerId,
        person: String,
        item: String,
        qty: i64,
    },
    BidAuction {
        owner: OwnerId,
        auction: String,
        lot: String,
        amount: i64,
    },
    PassAuction {
        owner: OwnerId,
        auction: String,
        lot: String,
    },
    InspectLot {
        owner: OwnerId,
        auction: String,
        lot: String,
    },
    // 第九批人物命令，保持已有枚举序号不变。
    Talk {
        owner: OwnerId,
        person: String,
        topic: String,
    },
    GiveGoods {
        owner: OwnerId,
        person: String,
        good: GoodId,
        qty: i64,
    },
    RecruitPerson {
        owner: OwnerId,
        person: String,
    },
    RequestAudience {
        owner: OwnerId,
        person: String,
    },
    MarkNewsRead {
        owner: OwnerId,
        ids: Vec<String>,
    },
    /// 当天从 6:00 起的分钟；同一分钟按命令日志序号执行。
    Steer {
        owner: OwnerId,
        fleet: FleetId,
        minute: u16,
        heading: Option<u16>,
        sail: Option<crate::navigation::Sail>,
    },
    Depart {
        owner: OwnerId,
        fleet: FleetId,
        minute: u16,
        heading: u16,
    },
    /// 时间线贡献；payload 与 I7 契约一致。
    Contribute {
        owner: OwnerId,
        event: String,
        lever: String,
        payload: crate::history::Payload,
    },
    PlanMonth {
        owner: OwnerId,
        slots: Vec<crate::upbringing::PlanSlot>,
    },
    PlayContest {
        owner: OwnerId,
        contest: String,
        moves: crate::contests::Moves,
    },
    ChoosePath {
        owner: OwnerId,
        path: String,
    },
    TakeExam {
        owner: OwnerId,
        exam: String,
    },
    SkipUpbringing {
        owner: OwnerId,
    },
    Autopilot {
        owner: OwnerId,
        fleet: FleetId,
        dest: LocId,
        minute: u16,
        #[serde(default)]
        stop_at_known_edge: bool,
        /// H07 寻路偏好；不写时有领航员按“最快”、没有按距离（见 `World::resolve_route_pref`）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        route: Option<crate::navigation::routing::RoutePref>,
    },
    Landing {
        owner: OwnerId,
        fleet: FleetId,
        days: u16,
    },
    Propagate {
        owner: OwnerId,
        idea: String,
        loc: LocId,
        mode: crate::ideas::Mode,
    },
    JoinSociety {
        owner: OwnerId,
        society: String,
    },
    CastSpell {
        owner: OwnerId,
        spell: String,
        target: crate::arcana::Target,
    },
    RespondCreature {
        owner: OwnerId,
        encounter: String,
        response: crate::creatures::Response,
    },
    CommissionShip {
        owner: OwnerId,
        ship: String,
        loc: LocId,
    },
    Dive {
        owner: OwnerId,
        fleet: FleetId,
        discovery: DiscoveryId,
    },
    /// H06：向附近的船喊话（商船：换消息、买补给、结伴；海盗：买路、虚张声势、开战）。
    Hail {
        owner: OwnerId,
        fleet: FleetId,
        target: crate::hail::HailTarget,
        action: crate::hail::HailAction,
    },
    /// H08：回应今天这一句甲板闲话的小互动。
    BanterReply {
        owner: OwnerId,
    },
    /// H04：在海上所见的小卡片上选一个按钮。
    ResolveSighting {
        owner: OwnerId,
        fleet: FleetId,
        sighting: u32,
        choice: usize,
    },
    /// 应用层的自由对话入口；模型的结果另经系统命令交付。
    TalkFree {
        owner: OwnerId,
        person: String,
        text: String,
    },
    ApplyPersona {
        result: crate::summary::ai::PersonaResult,
    },
    ApplyDaily {
        result: crate::summary::ai::DailyResult,
    },
    RecordAiText {
        record: crate::summary::text::TextRecord,
    },
    ApplyRipple {
        result: crate::summary::ripple::RippleResult,
    },
    /// U05：按周排程的周程（本周各格，格序从 0 起；每格只填 `lesson` 或 `after` 之一）。
    /// 安排阶段与运行中都能提交：已经结算的格保留，没带补选的格写回常设周课表。
    PlanWeek {
        owner: OwnerId,
        slots: Vec<crate::upbringing::PlanSlot>,
    },

    // ── 商馆代办（T03）──
    /// 在有自己仓库的港口挂一张限价单（买单从现金里预留钱；卖单卖当地仓库里的货）
    PlaceOrder {
        owner: OwnerId,
        loc: LocId,
        good: GoodId,
        side: crate::agency::OrderSide,
        /// 限价（单价，不含税）
        limit: Money,
        qty: i64,
    },
    /// 撤掉一张挂单（预留金退回现金）
    CancelOrder {
        owner: OwnerId,
        order: u32,
    },
    /// H02：常设命令与港口里的几件事（改常设命令、买船材、刮船底、抛货）
    Voyage {
        owner: OwnerId,
        fleet: FleetId,
        order: crate::seafaring::VoyageOrder,
    },
    /// H05：岸上差事（派人上岸、召回）与下网
    Shore {
        owner: OwnerId,
        fleet: FleetId,
        order: crate::seafaring::ShoreOrder,
    },
    /// 置顶公开且仍在办的任务；None 恢复自动选择。
    PinQuest {
        owner: OwnerId,
        id: Option<String>,
    },
    /// U06K1：本阶段的整张课表。
    PlanLessons {
        owner: OwnerId,
        slots: Vec<crate::upbringing::LessonPlan>,
    },
    SaveTemplate {
        owner: OwnerId,
        slot: u8,
        kind: crate::upbringing::TemplateKind,
    },
    UseTemplate {
        owner: OwnerId,
        slot: u8,
        kind: crate::upbringing::TemplateKind,
    },
    StartWeek {
        owner: OwnerId,
    },
    DoAction {
        owner: OwnerId,
        place: String,
        action: crate::upbringing::ActAction,
    },
    EndFree {
        owner: OwnerId,
    },
    FamilyDuty {
        owner: OwnerId,
        duty: String,
    },
    CloseWeek {
        owner: OwnerId,
    },
    AnswerMoment {
        owner: OwnerId,
        pick: crate::upbringing::MomentPick,
    },
    MasterTest {
        owner: OwnerId,
        line: String,
        play: bool,
    },
    JoinVoyage {
        owner: OwnerId,
        voyage: String,
    },
}

/// 命令执行结果。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandOutcome {
    Traded(TradeQuote),
    Sailed { days_estimate: i64 },
    Paid { cost: Money },
    ShipBought { fleet: FleetId, cost: Money },
    ShipSold { proceeds: Money },
    CaravanFormed { caravan: CaravanId },
    IndustryBuilt { industry: IndustryId },
    LoanTaken { loan: LoanId },
    FuturesFilled { price: Money },
    Bargained { discount: Fx, bribe: Money },
    Done,
    ColonyFounded { colony: ColonyId },
    DiscoveryReported { reward: Money, fame: i64 },
}

/// 校验阶段的预计算结果。
enum Checked {
    Trade(Holder, TradeQuote),
    Route(Vec<Cell>, i64),
    Cost(Money),
    /// 补给：总费用与从当地市场买口粮的成交（按固定价时为 None）
    Supplies(Money, Option<TradeQuote>),
    Transfer(i64),
    Nothing,
    Wh(WarehousePlan),
    Car(CaravanPlan),
    Con(ContractPlan),
    Ind(IndustryPlan),
    Inv(InvestPlan),
    Bank(BankPlan),
    Permit(PermitPlan),
    Mate(MatePlan),
    Chart(ChartPlan),
    Battle(BattlePlan),
    Fut(FuturesPlan),
    Colony(ColonyPlan),
    Report(ReportPlan),
    Story(crate::story::StoryPlan),
    Captain(crate::captain::CaptainPlan),
    Bulletin(crate::info::BulletinPlan),
    ItemTrade(crate::items::shop::TradePlan),
    ItemUse(crate::items::inventory::UsePlan),
    Equipment(crate::items::equipment::EquipmentPlan),
    Reading(crate::items::reading::Reading),
    Gift(crate::items::gifts::GiftPlan),
    Auction(crate::auction::AuctionPlan),
    Cast(crate::cast::interactions::InteractionPlan),
    Story2(Box<crate::story2::queue::AnswerPlan>),
    Navigation(crate::navigation::orders::NavigationPlan),
    Landing(crate::navigation::landing::LandingPlan),
    Voyage(crate::seafaring::wear::VoyagePlan),
    Shore(crate::seafaring::shore::ShorePlan),
    History(Box<crate::world::WorldState>),
    Contest(Box<crate::contests::ContestPlan>),
    Upbringing(Box<crate::world::WorldState>),
    Agency(crate::agency::AgencyPlan),
}

impl Command {
    /// 只在接受命令时落实分钟投影；失败不能改变世界或队列。
    pub fn apply_at(&self, world: &mut World, minute: u16) -> Result<CommandOutcome, CommandError> {
        if !world.defs.manual_navigation {
            return self.apply(world);
        }
        if let Some(at) = self.navigation_minute() {
            crate::navigation::orders::check_minute(at, minute)?;
        }
        if matches!(self, Command::Landing { .. }) {
            crate::navigation::orders::check_minute(minute, world.state.navigation.minute)?;
        }
        let mut next = world.navigation_projection(minute)?;
        let outcome = self.apply(&mut next)?;
        next.state.navigation.traces.retain(|id, _| next.state.fleets.contains_key(id));
        next.state.navigation.arrived.retain(|id, _| next.state.fleets.contains_key(id));
        *world = next;
        Ok(outcome)
    }

    /// 分钟命令的时间戳；旧命令没有日内时间，不改变经典重放。
    pub fn navigation_minute(&self) -> Option<u16> {
        match self {
            Self::Steer { minute, .. } | Self::Depart { minute, .. } | Self::Autopilot { minute, .. } => Some(*minute),
            _ => None,
        }
    }

    /// 发出命令的所有者（系统命令为 None）。
    pub fn owner(&self) -> Option<OwnerId> {
        use Command::*;
        match self {
            Landing { owner, .. }
            | Voyage { owner, .. }
            | Shore { owner, .. }
            | Autopilot { owner, .. }
            | Buy { owner, .. }
            | Sell { owner, .. }
            | SetSail { owner, .. }
            | Resupply { owner, .. }
            | HireCrew { owner, .. }
            | DismissCrew { owner, .. }
            | Repair { owner, .. }
            | BuyShip { owner, .. }
            | FoundFleet { owner, .. }
            | SellShip { owner, .. }
            | RefitShip { owner, .. }
            | BuyInto { owner, .. }
            | SellFrom { owner, .. }
            | Transfer { owner, .. }
            | RentWarehouse { owner, .. }
            | BuyWarehouse { owner, .. }
            | FormCaravan { owner, .. }
            | SetGuards { owner, .. }
            | CaravanTravel { owner, .. }
            | DisbandCaravan { owner, .. }
            | AcceptContract { owner, .. }
            | DeliverContract { owner, .. }
            | BuildIndustry { owner, .. }
            | ChangeRecipe { owner, .. }
            | UpgradeIndustry { owner, .. }
            | SetManager { owner, .. }
            | SellIndustry { owner, .. }
            | InvestPort { owner, .. }
            | Deposit { owner, .. }
            | Withdraw { owner, .. }
            | Borrow { owner, .. }
            | Repay { owner, .. }
            | BuyLicense { owner, .. }
            | HireMate { owner, .. }
            | DismissMate { owner, .. }
            | AssignMate { owner, .. }
            | BuyChart { owner, .. }
            | ReportDiscovery { owner, .. }
            | FoundColony { owner, .. }
            | BuildColony { owner, .. }
            | SetColonyTax { owner, .. }
            | AbandonColony { owner, .. }
            | EngageBattle { owner, .. }
            | TacticalCommand { owner, .. }
            | BuyMarque { owner, .. }
            | TradeFutures { owner, .. }
            | DepositMargin { owner, .. }
            | WithdrawMargin { owner, .. }
            | SetDelivery { owner, .. }
            | BuyItem { owner, .. }
            | SellItem { owner, .. }
            | UseItem { owner, .. }
            | Equip { owner, .. }
            | Unequip { owner, .. }
            | ReadBook { owner, .. }
            | GiveItem { owner, .. }
            | BidAuction { owner, .. }
            | PassAuction { owner, .. }
            | InspectLot { owner, .. }
            | TalkFree { owner, .. }
            | Talk { owner, .. }
            | GiveGoods { owner, .. }
            | RecruitPerson { owner, .. }
            | RequestAudience { owner, .. }
            | Steer { owner, .. }
            | Depart { owner, .. }
            | MarkNewsRead { owner, .. }
            | Contribute { owner, .. }
            | Propagate { owner, .. }
            | RespondCreature { owner, .. }
            | CommissionShip { owner, .. }
            | Dive { owner, .. }
            | ResolveSighting { owner, .. }
            | Hail { owner, .. }
            | BanterReply { owner }
            | JoinSociety { owner, .. }
            | CastSpell { owner, .. }
            | PlanMonth { owner, .. }
            | PlanLessons { owner, .. }
            | SaveTemplate { owner, .. }
            | UseTemplate { owner, .. }
            | StartWeek { owner, .. }
            | DoAction { owner, .. }
            | EndFree { owner, .. }
            | FamilyDuty { owner, .. }
            | AnswerMoment { owner, .. }
            | MasterTest { owner, .. }
            | JoinVoyage { owner, .. }
            | CloseWeek { owner, .. }
            | PlanWeek { owner, .. }
            | PlaceOrder { owner, .. }
            | CancelOrder { owner, .. }
            | PlayContest { owner, .. }
            | ChoosePath { owner, .. }
            | TakeExam { owner, .. }
            | SkipUpbringing { owner }
            | StoryAnswer { owner, .. }
            | CreateCaptain { owner, .. }
            | SetInfoMode { owner, .. }
            | BuyMarketReport { owner, .. }
            | ApplyBargain { owner, .. } => Some(*owner),
            RecordAiText { .. }
            | ApplyRipple { .. }
            | ApplyPersona { .. }
            | ApplyDaily { .. }
            | ApplyEvent { .. }
            | PublishNews { .. }
            | AdjustStrategy { .. }
            | OfferContract { .. }
            | RecordChronicle { .. }
            | SetOutlook { .. }
            | RecordMarketReport { .. }
            | ApplyComposedEvent { .. } => None,
            PinQuest { owner, .. } => Some(*owner),
        }
    }

    /// 校验命令在当前世界状态下是否可执行。
    pub fn validate(&self, world: &World) -> Result<(), CommandError> {
        self.check(world).map(|_| ())
    }

    /// 校验并执行。
    pub fn apply(&self, world: &mut World) -> Result<CommandOutcome, CommandError> {
        let plan = self.check(world)?;
        let pre = crate::story2::deeds::pre(self, world);
        let result = self.execute(world, plan)?;
        world.record_command_deeds(self, &result, pre);
        world.prune_equipment();
        world.refresh_upbringing_stage();
        world.refresh_story2();
        if world.act_running() {
            world.act_refresh_markers(false);
        }
        world.act_refresh_missions().map_err(|e| CommandError::Internal(e.to_string()))?;
        Ok(result)
    }

    fn check(&self, world: &World) -> Result<Checked, CommandError> {
        use Command::*;
        // 新养成命令先认玩家身份，未知或破产的非玩家所有者也统一返回 NotOwner。
        if matches!(
            self,
            PlanLessons { .. }
                | SaveTemplate { .. }
                | UseTemplate { .. }
                | StartWeek { .. }
                | DoAction { .. }
                | EndFree { .. }
                | FamilyDuty { .. }
                | AnswerMoment { .. }
                | MasterTest { .. }
                | JoinVoyage { .. }
                | CloseWeek { .. }
        ) && self.owner() != Some(OwnerId::Player)
        {
            return Err(CommandError::NotOwner);
        }
        if let Some(owner) = self.owner() {
            let agent = world.agent(owner)?;
            if agent.bankrupt {
                return Err(CommandError::Bankrupt);
            }
        }
        crate::history::check_port_service(world, self)?;
        world.check_realm_command(self)?;
        world.check_training_command(self)?;
        let defs = &world.defs;
        let rules = &defs.rules;
        if world.act_running() && matches!(self, PlanWeek { .. } | PlanMonth { .. } | Talk { .. } | GiveItem { .. }) {
            return Err(crate::upbringing::act::reason("ub.act.use_action"));
        }
        match self {
            BidAuction { owner, auction, lot, amount } => {
                crate::auction::check(world, *owner, auction, lot, crate::auction::Action::Bid(*amount))
                    .map(Checked::Auction)
            }
            PassAuction { owner, auction, lot } => {
                crate::auction::check(world, *owner, auction, lot, crate::auction::Action::Pass).map(Checked::Auction)
            }
            InspectLot { owner, auction, lot } => {
                crate::auction::check(world, *owner, auction, lot, crate::auction::Action::Inspect)
                    .map(Checked::Auction)
            }
            PlayContest { owner, contest, moves } => {
                world.check_contest(*owner, contest, moves).map(|p| Checked::Contest(Box::new(p)))
            }
            ChoosePath { owner, path } => world.check_path(*owner, path).map(|_| Checked::Nothing),
            SkipUpbringing { owner } => world.check_skip_upbringing(*owner).map(Checked::Upbringing),
            TakeExam { owner, exam } => world.check_exam(*owner, exam).map(Checked::Upbringing),
            PlanLessons { .. }
            | SaveTemplate { .. }
            | UseTemplate { .. }
            | StartWeek { .. }
            | DoAction { .. }
            | EndFree { .. }
            | FamilyDuty { .. }
            | AnswerMoment { .. }
            | MasterTest { .. }
            | JoinVoyage { .. }
            | CloseWeek { .. } => world.check_act_command(self).map(Checked::Upbringing),
            PlanMonth { owner, slots } => world.check_month_plan(*owner, slots).map(|_| Checked::Nothing),
            PlanWeek { owner, slots } => world.check_week_plan(*owner, slots).map(|_| Checked::Nothing),
            TalkFree { owner, person, text } => {
                crate::summary::ai::check_free(world, *owner, person, text)?;
                Ok(Checked::Nothing)
            }
            ApplyPersona { result } => Ok(Checked::History(crate::summary::ai::check_persona(world, result)?)),
            RecordAiText { record } => {
                crate::summary::text::check(world, record)?;
                Ok(Checked::Nothing)
            }
            ApplyRipple { result } => crate::summary::ripple::check(world, result).map(Checked::History),
            ApplyDaily { result } => {
                crate::summary::ai::check_daily(world, result)?;
                Ok(Checked::Nothing)
            }
            Talk { owner, person, topic } => {
                crate::cast::interactions::check_talk(world, *owner, person, topic).map(Checked::Cast)
            }
            GiveGoods { owner, person, good, qty } => {
                crate::cast::interactions::check_goods(world, *owner, person, *good, *qty).map(Checked::Cast)
            }
            RecruitPerson { owner, person } => {
                crate::cast::interactions::check_recruit(world, *owner, person).map(Checked::Cast)
            }
            RequestAudience { owner, person } => {
                if *owner == OwnerId::Player {
                    crate::cast::interactions::check_audience(world, *owner, person).map(Checked::Cast)
                } else {
                    crate::history::contacts::check_audience(world, *owner, person).map(Checked::History)
                }
            }
            ReadBook { owner, book, interpreter } => {
                world.choose_reading(*owner, book, interpreter.as_deref()).map(Checked::Reading)
            }
            GiveItem { owner, person, item, qty } => {
                crate::items::gifts::check(world, *owner, person, item, *qty).map(Checked::Gift)
            }
            Equip { owner, wearer, slot, item } => {
                crate::items::equipment::check(world, *owner, wearer, *slot, Some(item)).map(Checked::Equipment)
            }
            Unequip { owner, wearer, slot } => {
                crate::items::equipment::check(world, *owner, wearer, *slot, None).map(Checked::Equipment)
            }
            BuyItem { owner, loc, item, qty, max_total } => {
                if world.act_running() {
                    return world.act_check_buy(*owner, *loc, item, *qty, *max_total).map(Checked::ItemTrade);
                }
                crate::items::shop::check_trade(world, *owner, *loc, item, *qty, *max_total, true)
                    .map(Checked::ItemTrade)
            }
            SellItem { owner, loc, item, qty, min_total } => {
                crate::items::shop::check_trade(world, *owner, *loc, item, *qty, *min_total, false)
                    .map(Checked::ItemTrade)
            }
            UseItem { owner, item, target } => {
                crate::items::inventory::check_use(world, *owner, item, target.as_deref()).map(Checked::ItemUse)
            }
            Buy { owner, fleet, good, qty, max_total } => {
                check_trade(world, *owner, Holder::Fleet(*fleet), *good, *qty, Side::Buy, *max_total)
            }
            Sell { owner, fleet, good, qty, min_total } => {
                check_trade(world, *owner, Holder::Fleet(*fleet), *good, *qty, Side::Sell, *min_total)
            }
            BuyInto { owner, holder, good, qty, max_total } => {
                check_trade(world, *owner, *holder, *good, *qty, Side::Buy, *max_total)
            }
            SellFrom { owner, holder, good, qty, min_total } => {
                check_trade(world, *owner, *holder, *good, *qty, Side::Sell, *min_total)
            }
            Transfer { owner, from, to, good, qty } => {
                if *qty <= 0 || from == to {
                    return Err(CommandError::InvalidQuantity);
                }
                let a = world.holder_location(*owner, *from)?;
                let b = world.holder_location(*owner, *to)?;
                if a != b {
                    return Err(CommandError::WrongLocation);
                }
                let have = world.holder_qty(*owner, *from, *good);
                if have < *qty {
                    return Err(CommandError::InsufficientCargo { have });
                }
                let free = world.holder_free(*owner, *to);
                if free < *qty {
                    return Err(CommandError::InsufficientCapacity { need: *qty, free });
                }
                Ok(Checked::Transfer(*qty))
            }
            Voyage { owner, fleet, order } => {
                crate::seafaring::wear::check_order(world, *owner, *fleet, order).map(Checked::Voyage)
            }
            Shore { owner, fleet, order } => {
                crate::seafaring::shore::check_order(world, *owner, *fleet, order).map(Checked::Shore)
            }
            Landing { owner, fleet, days } => {
                crate::navigation::landing::check(world, *owner, *fleet, *days).map(Checked::Landing)
            }
            Autopilot { owner, fleet, dest, minute, stop_at_known_edge, route } => {
                crate::navigation::autopilot::check(world, *owner, *fleet, *dest, *minute, *stop_at_known_edge, *route)
                    .map(Checked::Navigation)
            }
            Steer { owner, fleet, minute, heading, sail } => crate::navigation::orders::check_steer(
                world,
                *owner,
                *fleet,
                crate::navigation::Steering { minute: *minute, heading: *heading, sail: *sail },
            )
            .map(Checked::Navigation),
            Depart { owner, fleet, minute, heading } => {
                crate::navigation::orders::check_depart(world, *owner, *fleet, *minute, *heading)
                    .map(Checked::Navigation)
            }
            SetSail { owner, fleet, dest } => {
                if defs.manual_navigation && *owner == OwnerId::Player {
                    return Err(Reason::new("navigation.manual_only", "请使用手动出港与操舵命令").rule());
                }
                let f = own_fleet(world, *owner, *fleet)?;
                if world.fleet_in_battle(*fleet) {
                    return Err(Reason::new("fleet.in_battle", "舰队正在交战").rule());
                }
                let dest_def =
                    defs.locations.get(dest.idx()).ok_or_else(|| CommandError::NotFound(format!("{dest:?}")))?;
                // 港口与殖民点（锚泊）都可以作为目的地
                if !dest_def.is_port() && !dest_def.is_site() {
                    return Err(CommandError::NotAPort);
                }
                if f.docked_at() == Some(*dest) {
                    return Err(CommandError::SameLocation);
                }
                if let FleetLocation::AtSea(v) = &f.location
                    && v.destination() == Some(*dest)
                {
                    return Err(CommandError::SameLocation);
                }
                let need = f.crew_min(defs);
                if f.crew < need {
                    return Err(CommandError::CrewBelowMinimum { need, have: f.crew });
                }
                world.check_navigation(f, *dest)?;
                // 帷幕世界的两项查询都会执行 A*；同一条路径同时提供逐格路线与预计天数。
                let (path, days) = world.route_with_days(f, *dest).ok_or(CommandError::NoRoute)?;
                Ok(Checked::Route(path, days))
            }
            Resupply { owner, fleet, food, water } => {
                let f = own_fleet(world, *owner, *fleet)?;
                let loc = f.docked_at().ok_or(CommandError::NotDocked)?;
                if defs.loc(loc).is_site() && !world.colony_has_dock(*owner, loc) {
                    return Err(Reason::new("colony.dock_resupply", "殖民点须有自己殖民地的码头才能补给").rule());
                }
                if *food < 0 || *water < 0 || (*food == 0 && *water == 0) {
                    return Err(CommandError::InvalidQuantity);
                }
                let need = food + water;
                if f.free_capacity() < need {
                    return Err(CommandError::InsufficientCapacity { need, free: f.free_capacity() });
                }
                // 口粮从当地市场买（ECONOMY.md 6.4；规则关闭或买不到时按固定价）
                let (food_cost, from_market) = crate::market::provisions_quote(world, loc, *food);
                let cost = food_cost + water * rules.water_price;
                need_cash(world, *owner, cost)?;
                Ok(Checked::Supplies(cost, from_market))
            }
            HireCrew { owner, fleet, count } => {
                let f = own_fleet(world, *owner, *fleet)?;
                let loc = f.docked_at().ok_or(CommandError::NotDocked)?;
                if *count <= 0 {
                    return Err(CommandError::InvalidQuantity);
                }
                // 殖民点没有酒馆；只有在自己的殖民地可以请殖民者上船（至少留下 1 人），
                // 免得减员后的舰队因船员不足困在殖民地出不了港
                if defs.loc(loc).is_site() {
                    let colonists = world.colony_at(loc).filter(|c| c.owner == *owner).map(|c| c.population);
                    match colonists {
                        None => return Err(Reason::new("colony.no_crew", "殖民点没有可招募的船员").rule()),
                        Some(p) if *count > p - 1 => {
                            return Err(Reason::new(
                                "colony.keep_one",
                                format!("殖民地只有 {p} 人，至少要留下 1 人（最多招募 {}）", (p - 1).max(0)),
                            )
                            .arg("population", TextArg::Int(p))
                            .arg("max", TextArg::Int((p - 1).max(0)))
                            .rule());
                        }
                        Some(_) => {}
                    }
                }
                // 港口与城市：新船员来自当地人口（ECONOMY.md 6.4），人口不能招到下限以下（World::hands_for_hire）
                if let Some(most) = world.hands_for_hire(loc)
                    && *count > most
                {
                    let pop = world.people(loc).map(|p| p.pop).unwrap_or(0);
                    return Err(Reason::new(
                        "port.no_hands",
                        format!("港口人手不足：人口 {pop}，最多还能招募 {most} 人"),
                    )
                    .arg("population", TextArg::Int(pop))
                    .arg("max", TextArg::Int(most))
                    .rule());
                }
                let max = f.crew_max(defs);
                if f.crew + count > max {
                    return Err(CommandError::CrewOverMaximum { max });
                }
                let cost = count * rules.crew_hire_cost;
                need_cash(world, *owner, cost)?;
                Ok(Checked::Cost(cost))
            }
            DismissCrew { owner, fleet, count } => {
                let f = own_fleet(world, *owner, *fleet)?;
                f.docked_at().ok_or(CommandError::NotDocked)?;
                if *count <= 0 || *count > f.crew {
                    return Err(CommandError::InvalidQuantity);
                }
                Ok(Checked::Nothing)
            }
            Repair { owner, fleet } => {
                let f = own_fleet(world, *owner, *fleet)?;
                let loc = f.docked_at().ok_or(CommandError::NotDocked)?;
                if defs.loc(loc).is_site() && !world.colony_has_dock(*owner, loc) {
                    return Err(Reason::new("colony.dock_repair", "殖民点须有自己殖民地的码头才能修船").rule());
                }
                let cost = world.repair_cost(f);
                if cost <= 0 {
                    return Err(CommandError::NotDamaged);
                }
                need_cash(world, *owner, cost)?;
                Ok(Checked::Cost(cost))
            }
            BuyShip { owner, fleet, ship_type, new_fleet } => {
                let f = own_fleet(world, *owner, *fleet)?;
                let loc = f.docked_at().ok_or(CommandError::NotDocked)?;
                if defs.ships.get(ship_type.idx()).is_none() {
                    return Err(CommandError::NotFound(format!("{ship_type:?}")));
                }
                no_unique_ship(world, *ship_type)?;
                // 船厂清单随发展度（T02 `[shipyard_growth]`；关闭时就是数据里的清单）
                if !world.shipyard_sells(loc, *ship_type) {
                    return Err(CommandError::NoShipyard);
                }
                if !new_fleet && f.ships.len() >= MAX_SHIPS_PER_FLEET {
                    return Err(CommandError::FleetFull);
                }
                let cost = defs.ship(*ship_type).price;
                need_cash(world, *owner, cost)?;
                Ok(Checked::Cost(cost))
            }
            FoundFleet { owner, at, ship_type } => {
                let loc = defs.locations.get(at.idx()).ok_or_else(|| CommandError::NotFound(format!("{at:?}")))?;
                if defs.ships.get(ship_type.idx()).is_none() {
                    return Err(CommandError::NotFound(format!("{ship_type:?}")));
                }
                no_unique_ship(world, *ship_type)?;
                if !loc.shipyard.contains(ship_type) && !world.shipyard_sells(*at, *ship_type) {
                    return Err(CommandError::NoShipyard);
                }
                let cost = defs.ship(*ship_type).price;
                need_cash(world, *owner, cost)?;
                Ok(Checked::Cost(cost))
            }
            SellShip { owner, fleet, ship } => {
                let f = own_fleet(world, *owner, *fleet)?;
                let loc = f.docked_at().ok_or(CommandError::NotDocked)?;
                if defs.loc(loc).shipyard.is_empty() {
                    return Err(CommandError::NoShipyard);
                }
                let s = f.ships.get(*ship as usize).ok_or_else(|| CommandError::NotFound(format!("船只 {ship}")))?;
                if defs.ship(s.kind).unique {
                    return Err(Reason::new("shipyard.unique_sell", "这艘船不能卖给船厂").rule());
                }
                if f.ships.len() <= 1 {
                    return Err(CommandError::LastShip);
                }
                let remaining_cap = f.capacity() - s.capacity;
                if f.used() > remaining_cap {
                    return Err(CommandError::InsufficientCapacity { need: f.used(), free: remaining_cap });
                }
                let remaining_crew_max = f.crew_max(defs) - crate::legend_ships::crew_max(defs, s);
                if f.crew > remaining_crew_max {
                    return Err(CommandError::CrewOverMaximum { max: remaining_crew_max });
                }
                Ok(Checked::Cost(world.ship_resale(s)))
            }
            RefitShip { owner, fleet, ship, refit } => {
                let f = own_fleet(world, *owner, *fleet)?;
                let loc = f.docked_at().ok_or(CommandError::NotDocked)?;
                if defs.loc(loc).shipyard.is_empty() {
                    return Err(CommandError::NoShipyard);
                }
                let s = f.ships.get(*ship as usize).ok_or_else(|| CommandError::NotFound(format!("船只 {ship}")))?;
                let r = defs.refits.get(refit.idx()).ok_or_else(|| CommandError::NotFound(format!("{refit:?}")))?;
                if s.refits.contains(refit) {
                    return Err(CommandError::RefitApplied);
                }
                need_cash(world, *owner, r.price)?;
                Ok(Checked::Cost(r.price))
            }
            RentWarehouse { owner, loc, capacity } => {
                no_site_facility(world, *loc)?;
                warehouse::check_rent(world, *owner, *loc, *capacity).map(Checked::Wh)
            }
            BuyWarehouse { owner, loc, capacity } => {
                no_site_facility(world, *loc)?;
                warehouse::check_buy(world, *owner, *loc, *capacity).map(Checked::Wh)
            }
            FormCaravan { owner, at, animal, count } => {
                caravan::check_form(world, *owner, *at, *animal, *count).map(Checked::Car)
            }
            SetGuards { owner, caravan, guards } => {
                caravan::check_guards(world, *owner, *caravan, *guards).map(Checked::Car)
            }
            CaravanTravel { owner, caravan, dest } => {
                caravan::check_travel(world, *owner, *caravan, *dest).map(Checked::Car)
            }
            DisbandCaravan { owner, caravan } => caravan::check_disband(world, *owner, *caravan).map(Checked::Car),
            AcceptContract { owner, contract } => contract::check_accept(world, *owner, *contract).map(Checked::Con),
            DeliverContract { owner, contract, holder } => {
                contract::check_deliver(world, *owner, *contract, *holder).map(Checked::Con)
            }
            BuildIndustry { owner, loc, kind, recipe } => {
                no_site_facility(world, *loc)?;
                industry::check_build(world, *owner, *loc, *kind, *recipe).map(Checked::Ind)
            }
            ChangeRecipe { owner, industry, recipe } => {
                industry::check_recipe(world, *owner, *industry, *recipe).map(Checked::Ind)
            }
            UpgradeIndustry { owner, industry } => industry::check_upgrade(world, *owner, *industry).map(Checked::Ind),
            PlaceOrder { owner, loc, good, side, limit, qty } => {
                crate::agency::check_place(world, *owner, *loc, *good, *side, *limit, *qty).map(Checked::Agency)
            }
            CancelOrder { owner, order } => crate::agency::check_cancel(world, *owner, *order).map(Checked::Agency),
            SetManager { owner, industry, hired } => {
                let m = if *hired { Manager::Hired } else { Manager::None };
                industry::check_manager(world, *owner, *industry, m).map(Checked::Ind)
            }
            SellIndustry { owner, industry } => industry::check_sell(world, *owner, *industry).map(Checked::Ind),
            InvestPort { owner, loc, amount } => invest::check(world, *owner, *loc, *amount).map(Checked::Inv),
            Deposit { owner, amount } => bank::check_deposit(world, *owner, *amount).map(Checked::Bank),
            Withdraw { owner, amount } => bank::check_withdraw(world, *owner, *amount).map(Checked::Bank),
            Borrow { owner, amount, months } => bank::check_borrow(world, *owner, *amount, *months).map(Checked::Bank),
            Repay { owner, loan, amount } => bank::check_repay(world, *owner, *loan, *amount).map(Checked::Bank),
            BuyLicense { owner, faction } => diplomacy::check_license(world, *owner, *faction).map(Checked::Permit),
            HireMate { owner, mate } => mates::check_hire(world, *owner, *mate).map(Checked::Mate),
            DismissMate { owner, mate } => mates::check_dismiss(world, *owner, *mate).map(Checked::Mate),
            AssignMate { owner, mate, role } => mates::check_assign(world, *owner, *mate, *role).map(Checked::Mate),
            BuyChart { owner, region } => explore::check_chart(world, *owner, *region).map(Checked::Chart),
            ReportDiscovery { owner, discovery, loc } => {
                explore::check_report(world, *owner, *discovery, *loc).map(Checked::Report)
            }
            FoundColony { owner, fleet, site, name, settlers } => {
                colony::check_found(world, *owner, *fleet, *site, name, *settlers).map(Checked::Colony)
            }
            BuildColony { owner, colony: c, building } => {
                colony::check_build(world, *owner, *c, *building).map(Checked::Colony)
            }
            SetColonyTax { owner, colony: c, rate } => colony::check_tax(world, *owner, *c, *rate).map(Checked::Colony),
            AbandonColony { owner, colony: c } => colony::check_abandon(world, *owner, *c).map(Checked::Colony),
            EngageBattle { owner, battle, tactical } => {
                battle::check_engage(world, *owner, *battle, *tactical).map(Checked::Battle)
            }
            TacticalCommand { owner, battle, order } => {
                battle::check_order(world, *owner, *battle, *order).map(Checked::Battle)
            }
            BuyMarque { owner, faction } => diplomacy::check_marque(world, *owner, *faction).map(Checked::Permit),
            TradeFutures { owner, contract, lots } => {
                futures::check_trade(world, *owner, *contract, *lots).map(Checked::Fut)
            }
            DepositMargin { owner, exchange, amount } => {
                futures::check_deposit(world, *owner, *exchange, *amount).map(Checked::Fut)
            }
            WithdrawMargin { owner, exchange, amount } => {
                futures::check_withdraw(world, *owner, *exchange, *amount).map(Checked::Fut)
            }
            SetDelivery { owner, contract, physical } => {
                futures::check_delivery(world, *owner, *contract, *physical).map(Checked::Fut)
            }
            ApplyEvent { event, params } => {
                world.validate_event(*event, params)?;
                Ok(Checked::Nothing)
            }
            PublishNews { fact, credibility, text, tpl, .. } => {
                world.check_publish(fact, text, *credibility)?;
                tpl.as_ref().map_or(Ok(()), TextRef::check)?;
                Ok(Checked::Nothing)
            }
            ApplyBargain { owner, loc, player_text, reply, reply_tpl, .. } => {
                world.check_bargain(*owner, *loc, player_text, reply)?;
                reply_tpl.as_ref().map_or(Ok(()), TextRef::check)?;
                Ok(Checked::Nothing)
            }
            AdjustStrategy { company, preferred, .. } => {
                let owner = OwnerId::Company(*company);
                let agent = world.agent(owner)?;
                if agent.bankrupt || agent.strategy.is_none() {
                    return Err(CommandError::Bankrupt);
                }
                if preferred.len() > 3 || preferred.iter().any(|g| defs.goods.get(g.idx()).is_none()) {
                    return Err(CommandError::OutOfRange("偏好商品最多 3 种且必须存在".into()));
                }
                let last = world.state.news.strategy_last.get(company).copied();
                if last.is_some_and(|d| d + news::STRATEGY_INTERVAL > world.state.day) {
                    return Err(CommandError::Precondition("战略调整过于频繁".into()));
                }
                Ok(Checked::Nothing)
            }
            OfferContract { issuer, good, qty, to, days, reward } => {
                contract::check_offer(world, *issuer, *good, *qty, *to, *days as i64, *reward)?;
                let month = defs.calendar.month_index(world.state.day);
                if world.state.news.ai_contracts.get(&month).copied().unwrap_or(0) >= news::MAX_AI_CONTRACTS_PER_MONTH {
                    return Err(CommandError::Precondition("本月 AI 发布的合同已达上限".into()));
                }
                Ok(Checked::Nothing)
            }
            RecordChronicle { year, text, tpl } => {
                news::check_text(text, news::MAX_CHRONICLE_CHARS)?;
                tpl.as_ref().map_or(Ok(()), TextRef::check)?;
                let current = world.state.day / defs.calendar.year_days();
                if *year >= current {
                    return Err(CommandError::OutOfRange("只能为已结束的年份撰写编年史".into()));
                }
                if world.state.news.chronicles.iter().any(|c| c.year == *year) {
                    return Err(CommandError::Precondition("该年份已有编年史".into()));
                }
                Ok(Checked::Nothing)
            }
            ApplyComposedEvent { title, text, effects, .. } => {
                world.validate_composed(title, text, effects)?;
                Ok(Checked::Nothing)
            }
            CreateCaptain { owner, birthday, answers, alloc, genius } => {
                crate::captain::check_create(world, *owner, *birthday, answers, alloc, genius.as_deref())
                    .map(Checked::Captain)
            }
            StoryAnswer { owner, choice } => {
                if world.story2_is_front() {
                    crate::story2::queue::check_answer(world, *owner, *choice).map(|p| Checked::Story2(Box::new(p)))
                } else if world.state.story.pending.is_none() && world.creature_pending().is_some() {
                    let (e, c) =
                        world.creature_pending().ok_or_else(|| crate::societies::blocked("creature.no_encounter"))?;
                    let response = c
                        .responses
                        .get(*choice as usize)
                        .ok_or_else(|| crate::societies::blocked("creature.response"))?;
                    crate::creatures::check(world, *owner, &e.id, *response).map(Checked::History)
                } else {
                    crate::story::check_answer(world, *owner, *choice).map(Checked::Story)
                }
            }
            CastSpell { owner, spell, target } => {
                crate::arcana::check(world, *owner, spell, target).map(Checked::History)
            }
            RespondCreature { owner, encounter, response } => {
                crate::creatures::check(world, *owner, encounter, *response).map(Checked::History)
            }
            CommissionShip { owner, ship, loc } => {
                crate::legend_ships::check(world, *owner, ship, *loc).map(Checked::History)
            }
            Dive { owner, fleet, discovery } => {
                crate::legend_ships::mechanics::check_dive(world, *owner, *fleet, *discovery).map(Checked::History)
            }
            BanterReply { owner } => crate::banter::check_reply(world, *owner).map(Checked::History),
            Hail { owner, fleet, target, action } => {
                crate::hail::check(world, *owner, *fleet, *target, *action).map(Checked::History)
            }
            ResolveSighting { owner, fleet, sighting, choice } => {
                crate::sightings::check_resolve(world, *owner, *fleet, *sighting, *choice).map(Checked::History)
            }
            JoinSociety { owner, society } => crate::societies::check(world, *owner, society).map(Checked::History),
            Propagate { owner, idea, loc, mode } => {
                crate::ideas::check(world, *owner, idea, *loc, *mode).map(Checked::History)
            }
            Contribute { owner, event, lever, payload } => {
                crate::history::contribution::check(world, *owner, event, lever, payload).map(Checked::History)
            }
            MarkNewsRead { owner, ids } => {
                crate::story2::queue::check_read(world, *owner, ids).map(|_| Checked::Nothing)
            }
            SetInfoMode { owner, .. } => crate::info::check_mode(world, *owner).map(|_| Checked::Nothing),
            SetOutlook { company, views, memo, tpl, .. } => {
                crate::commerce::check_outlook(world, *company, views, memo, tpl.as_ref()).map(|_| Checked::Nothing)
            }
            RecordMarketReport { region, month, text, tpl } => {
                crate::report::check_report(world, *region, *month, text, tpl.as_ref()).map(|_| Checked::Nothing)
            }
            BuyMarketReport { owner, loc } => crate::info::check_report(world, *owner, *loc).map(Checked::Bulletin),
            PinQuest { owner, id } => world.check_pin_quest(*owner, id).map(|_| Checked::Nothing),
        }
    }

    fn execute(&self, world: &mut World, checked: Checked) -> Result<CommandOutcome, CommandError> {
        use Command::*;
        let day = world.state.day;
        let defs = world.defs.clone();
        let owner = self.owner();
        match (self, checked) {
            (Voyage { owner, .. }, Checked::Voyage(plan)) => {
                crate::seafaring::wear::apply_order(world, *owner, plan)?;
                Ok(CommandOutcome::Done)
            }
            (Shore { .. }, Checked::Shore(plan)) => {
                crate::seafaring::shore::apply_order(world, plan)?;
                Ok(CommandOutcome::Done)
            }
            (Landing { .. }, Checked::Landing(plan)) => {
                crate::navigation::landing::apply(world, plan)?;
                Ok(CommandOutcome::Done)
            }
            (Steer { .. } | Depart { .. } | Autopilot { .. }, Checked::Navigation(plan)) => {
                crate::navigation::orders::apply(world, plan)?;
                Ok(CommandOutcome::Done)
            }
            (BidAuction { .. } | PassAuction { .. } | InspectLot { .. }, Checked::Auction(p)) => {
                crate::auction::apply(world, p)?;
                Ok(CommandOutcome::Done)
            }
            (
                Contribute { .. }
                | Propagate { .. }
                | RequestAudience { .. }
                | JoinSociety { .. }
                | CommissionShip { .. }
                | Dive { .. }
                | ResolveSighting { .. }
                | Hail { .. }
                | BanterReply { .. }
                | StoryAnswer { .. }
                | CastSpell { .. }
                | RespondCreature { .. },
                Checked::History(state),
            ) => {
                world.state = *state;
                world.observe_history();
                Ok(CommandOutcome::Done)
            }
            (
                TakeExam { .. }
                | SkipUpbringing { .. }
                | PlanLessons { .. }
                | SaveTemplate { .. }
                | UseTemplate { .. }
                | StartWeek { .. }
                | DoAction { .. }
                | EndFree { .. }
                | FamilyDuty { .. }
                | AnswerMoment { .. }
                | MasterTest { .. }
                | JoinVoyage { .. }
                | CloseWeek { .. },
                Checked::Upbringing(state),
            ) => {
                world.state = *state;
                Ok(CommandOutcome::Done)
            }
            (ChoosePath { path, .. }, Checked::Nothing) => {
                if let Some(s) = &mut world.state.upbringing {
                    s.path = Some(path.clone());
                    if let Some(p) = world.defs.upbringing.paths.iter().find(|p| &p.key == path) {
                        for event in &p.events {
                            if !s.event_backlog.contains(event) {
                                s.event_backlog.push(event.clone());
                            }
                        }
                    }
                }
                Ok(CommandOutcome::Done)
            }
            (PlanMonth { slots, .. }, Checked::Nothing) => {
                world.apply_month_plan(slots.clone());
                Ok(CommandOutcome::Done)
            }
            (PlanWeek { slots, .. }, Checked::Nothing) => {
                world.apply_week_plan(slots.clone(), true);
                Ok(CommandOutcome::Done)
            }
            (PlayContest { .. }, Checked::Contest(plan)) => {
                world.state = plan.state;
                Ok(CommandOutcome::Done)
            }
            (StoryAnswer { .. }, Checked::Story2(plan)) => {
                world.state = plan.state;
                Ok(CommandOutcome::Done)
            }
            (MarkNewsRead { ids, .. }, Checked::Nothing) => {
                for id in ids {
                    if let Some(n) = world.state.story2.news.get_mut(id) {
                        n.read = true;
                    }
                }
                Ok(CommandOutcome::Done)
            }
            (TalkFree { .. }, Checked::Nothing) => Ok(CommandOutcome::Done),
            (ApplyPersona { .. }, Checked::History(state)) => {
                world.state = *state;
                world.observe_history();
                Ok(CommandOutcome::Done)
            }
            (RecordAiText { record }, Checked::Nothing) => {
                crate::summary::text::apply(world, record);
                Ok(CommandOutcome::Done)
            }
            (ApplyRipple { .. }, Checked::History(state)) => {
                world.state = *state;
                Ok(CommandOutcome::Done)
            }
            (ApplyDaily { result }, Checked::Nothing) => {
                crate::summary::ai::apply_daily(world, result);
                Ok(CommandOutcome::Done)
            }
            (Talk { .. } | GiveGoods { .. } | RecruitPerson { .. } | RequestAudience { .. }, Checked::Cast(p)) => {
                crate::cast::interactions::apply(world, p)?;
                Ok(CommandOutcome::Done)
            }
            (ReadBook { owner, .. }, Checked::Reading(p)) => {
                crate::items::reading::apply(world, *owner, p);
                Ok(CommandOutcome::Done)
            }
            (GiveItem { .. }, Checked::Gift(p)) => {
                crate::items::gifts::apply(world, p);
                Ok(CommandOutcome::Done)
            }
            (Equip { .. } | Unequip { .. }, Checked::Equipment(p)) => {
                crate::items::equipment::apply(world, p);
                world.refresh_trade_bonus();
                Ok(CommandOutcome::Done)
            }
            (BuyItem { .. } | SellItem { .. }, Checked::ItemTrade(p)) => {
                crate::items::shop::trade(world, p)?;
                Ok(CommandOutcome::Done)
            }
            (UseItem { .. }, Checked::ItemUse(p)) => {
                crate::items::inventory::use_item(world, p)?;
                Ok(CommandOutcome::Done)
            }
            (Buy { owner, good, qty, .. } | BuyInto { owner, good, qty, .. }, Checked::Trade(holder, q)) => {
                exec_buy(world, *owner, holder, *good, *qty, &q)?;
                Ok(CommandOutcome::Traded(q))
            }
            (Sell { owner, good, qty, .. } | SellFrom { owner, good, qty, .. }, Checked::Trade(holder, q)) => {
                exec_sell(world, *owner, holder, *good, *qty, &q)?;
                Ok(CommandOutcome::Traded(q))
            }
            (Transfer { owner, from, to, good, .. }, Checked::Transfer(qty)) => {
                let moved = world.holder_take(*owner, *from, *good, qty)?;
                world.holder_add(*owner, *to, *good, moved)?;
                Ok(CommandOutcome::Done)
            }
            (SetSail { fleet, dest, .. }, Checked::Route(path, days)) => {
                let from = world.fleet(*fleet)?.docked_at();
                world.start_voyage(*fleet, *dest, path)?;
                world.fleet_mut(*fleet)?.idle_days = 0;
                // 信息时效：从港口出发时记下那里此刻的行情，舰队带着它上路
                if let Some(from) = from {
                    world.info_depart(*fleet, from);
                }
                Ok(CommandOutcome::Sailed { days_estimate: days })
            }
            (Resupply { owner, fleet, food, water }, Checked::Supplies(cost, from_market)) => {
                world.book_external(
                    *owner,
                    Flow::Supplies,
                    world.fleet_town(*fleet),
                    JournalEntry::new(day, Memo::Supplies, CashClass::Operating)
                        .dr(Account::Supplies, cost)
                        .cr(Account::Cash, cost),
                )?;
                // 从当地市场买的口粮：库存减少、价格随之变化（记在买方名下）
                if let Some(q) = &from_market {
                    world.apply_trade_to_market(q, Some(*owner));
                }
                let f = world.fleet_mut(*fleet)?;
                f.food += food;
                f.water += water;
                Ok(CommandOutcome::Paid { cost })
            }
            (HireCrew { owner, fleet, count }, Checked::Cost(cost)) => {
                world.book_external(
                    *owner,
                    Flow::CrewHire,
                    world.fleet_town(*fleet),
                    JournalEntry::new(day, Memo::CrewHire, CashClass::Operating)
                        .dr(Account::Wages, cost)
                        .cr(Account::Cash, cost),
                )?;
                let f = world.fleet_mut(*fleet)?;
                f.crew += count;
                let at = f.docked_at();
                // 在自己的殖民地招募：新船员来自殖民者
                if let Some(loc) = at.filter(|l| defs.loc(*l).is_site())
                    && let Some(c) = world.state.colonies.values_mut().find(|c| c.loc == loc && c.owner == *owner)
                {
                    c.population -= count;
                }
                // 港口与城市：新船员来自当地人口
                if let Some(loc) = at {
                    world.adjust_population(loc, -count);
                }
                Ok(CommandOutcome::Paid { cost })
            }
            (DismissCrew { fleet, count, .. }, Checked::Nothing) => {
                let f = world.fleet_mut(*fleet)?;
                f.crew -= count;
                // 在港口与城市遣散的船员留在当地
                if let Some(loc) = f.docked_at() {
                    world.adjust_population(loc, *count);
                }
                Ok(CommandOutcome::Done)
            }
            (Repair { owner, fleet }, Checked::Cost(cost)) => {
                world.book_external(
                    *owner,
                    Flow::Repair,
                    world.fleet_town(*fleet),
                    JournalEntry::new(day, Memo::Repair, CashClass::Operating)
                        .dr(Account::Repairs, cost)
                        .cr(Account::Cash, cost),
                )?;
                for s in world.fleet_mut(*fleet)?.ships.iter_mut() {
                    s.durability = s.max_durability;
                }
                Ok(CommandOutcome::Paid { cost })
            }
            (BuyShip { owner, fleet, ship_type, new_fleet }, Checked::Cost(cost)) => {
                book_ship_purchase(world, *owner, world.fleet_town(*fleet), cost)?;
                let mut ship = new_ship(&defs, *ship_type);
                // 商会 2.0 的老船退役按下水日期算船龄（关闭时不记，与旧版一致）
                if defs.rules.npc.v2.enabled {
                    ship.built = day;
                }
                let target = if *new_fleet {
                    let loc = world.fleet(*fleet)?.docked_at().ok_or(CommandError::NotDocked)?;
                    spawn_fleet(world, *owner, loc, ship)
                } else {
                    world.fleet_mut(*fleet)?.ships.push(ship);
                    *fleet
                };
                Ok(CommandOutcome::ShipBought { fleet: target, cost })
            }
            (FoundFleet { owner, at, ship_type }, Checked::Cost(cost)) => {
                book_ship_purchase(world, *owner, world.town_sector(*at), cost)?;
                let mut ship = new_ship(&defs, *ship_type);
                if defs.rules.npc.v2.enabled {
                    ship.built = day;
                }
                let id = spawn_fleet(world, *owner, *at, ship);
                Ok(CommandOutcome::ShipBought { fleet: id, cost })
            }
            (SellShip { owner, fleet, ship }, Checked::Cost(proceeds)) => {
                let s = world.fleet_mut(*fleet)?.ships.remove(*ship as usize);
                world.record_legend_ship_sale(&s);
                let book = s.book_value;
                let mut entry = JournalEntry::new(day, Memo::ShipSale, CashClass::Investing)
                    .dr(Account::Cash, proceeds)
                    .cr(Account::Ships, book);
                if proceeds >= book {
                    entry = entry.cr(Account::AssetGains, proceeds - book);
                } else {
                    entry = entry.dr(Account::Losses, book - proceeds);
                }
                world.book_external(*owner, Flow::Shipyard, world.fleet_town(*fleet), entry)?;
                Ok(CommandOutcome::ShipSold { proceeds })
            }
            (RefitShip { owner, fleet, ship, refit }, Checked::Cost(cost)) => {
                world.book_external(
                    *owner,
                    Flow::Shipyard,
                    world.fleet_town(*fleet),
                    JournalEntry::new(day, Memo::Refit, CashClass::Investing)
                        .dr(Account::Ships, cost)
                        .cr(Account::Cash, cost),
                )?;
                let r = defs.refits[refit.idx()].clone();
                let s = world
                    .fleet_mut(*fleet)?
                    .ships
                    .get_mut(*ship as usize)
                    .ok_or_else(|| CommandError::Internal("船只下标失效".into()))?;
                s.refits.push(*refit);
                s.capacity += r.capacity;
                s.max_durability += r.durability;
                s.durability += r.durability;
                s.guns += r.guns;
                s.speed_bonus += r.speed;
                s.book_value += cost;
                Ok(CommandOutcome::Paid { cost })
            }
            (_, Checked::Wh(plan)) => {
                warehouse::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Car(plan)) => {
                let formed = matches!(plan, CaravanPlan::Form { .. });
                let id = caravan::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(match (formed, id) {
                    (true, Some(caravan)) => CommandOutcome::CaravanFormed { caravan },
                    _ => CommandOutcome::Done,
                })
            }
            (_, Checked::Con(plan)) => {
                contract::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Agency(plan)) => {
                world.apply_agency(plan)?;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Ind(plan)) => {
                let built = matches!(plan, IndustryPlan::Build { .. });
                let id = industry::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(match (built, id) {
                    (true, Some(industry)) => CommandOutcome::IndustryBuilt { industry },
                    _ => CommandOutcome::Done,
                })
            }
            (_, Checked::Inv(plan)) => {
                let cost = plan.amount;
                invest::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Paid { cost })
            }
            (_, Checked::Bank(plan)) => {
                let borrow = matches!(plan, BankPlan::Borrow { .. });
                let id = bank::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(match (borrow, id) {
                    (true, Some(loan)) => CommandOutcome::LoanTaken { loan },
                    _ => CommandOutcome::Done,
                })
            }
            (_, Checked::Mate(plan)) => {
                mates::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Chart(plan)) => {
                let cost = plan.cost;
                explore::exec_chart(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Paid { cost })
            }
            (_, Checked::Battle(plan)) => {
                battle::exec(world, plan)?;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Story(plan)) => {
                crate::story::exec_answer(world, plan)?;
                // H02：选项留下的“复工 / 许诺靠港 / 哗变”当场兑现（许诺靠港会把领航改到最近的港）
                world.wear_flags()?;
                // 同日交替回应新旧队列时，最近的旧回应优先显示。
                world.state.story2.last = None;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Captain(plan)) => {
                crate::captain::exec_create(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Report(plan)) => {
                let (reward, fame) = (plan.reward, plan.fame);
                explore::exec_report(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::DiscoveryReported { reward, fame })
            }
            (_, Checked::Colony(plan)) => {
                let founded = matches!(plan, ColonyPlan::Found { .. });
                let id = colony::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(match (founded, id) {
                    (true, Some(colony)) => CommandOutcome::ColonyFounded { colony },
                    _ => CommandOutcome::Done,
                })
            }
            (_, Checked::Permit(plan)) => {
                let cost = plan.cost;
                diplomacy::exec_permit(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Paid { cost })
            }
            (_, Checked::Fut(plan)) => {
                let price = futures::exec(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(match price {
                    Some(price) => CommandOutcome::FuturesFilled { price },
                    None => CommandOutcome::Done,
                })
            }
            (ApplyEvent { event, params }, Checked::Nothing) => {
                world.start_event(*event, params.clone())?;
                Ok(CommandOutcome::Done)
            }
            (PublishNews { fact, source, credibility, text, tpl }, Checked::Nothing) => {
                world.publish_news(fact.clone(), text.clone(), *source, *credibility, tpl.clone());
                Ok(CommandOutcome::Done)
            }
            (ApplyBargain { owner, loc, intent, player_text, reply, reply_tpl }, Checked::Nothing) => {
                let out = world.apply_bargain(
                    *owner,
                    *loc,
                    *intent,
                    player_text.clone(),
                    reply.clone(),
                    reply_tpl.clone(),
                )?;
                Ok(CommandOutcome::Bargained { discount: out.discount, bribe: out.bribe })
            }
            (AdjustStrategy { company, risk, preferred }, Checked::Nothing) => {
                let clamped = (*risk).clamp(news::RISK_RANGE.0, news::RISK_RANGE.1);
                let agent = world.agent_mut(OwnerId::Company(*company))?;
                if let Some(s) = agent.strategy.as_mut() {
                    s.risk = clamped;
                    s.preferred = preferred.clone();
                }
                world.state.news.strategy_last.insert(*company, day);
                Ok(CommandOutcome::Done)
            }
            (OfferContract { issuer, good, qty, to, days, reward }, Checked::Nothing) => {
                let rules = defs.rules.contracts.clone();
                world.post_contract(crate::contract::TransportContract {
                    id: ContractId(0),
                    issuer: *issuer,
                    good: *good,
                    qty: *qty,
                    to: *to,
                    deadline: day + *days,
                    reward: *reward,
                    penalty: rules.penalty_share.apply(*reward),
                    status: crate::contract::ContractStatus::Open,
                    source: crate::contract::ContractSource::Ai,
                    small: false,
                    source_port: None,
                    cells: 0,
                    need_days: 0,
                    urgency_bp: 0,
                });
                let month = world.defs.calendar.month_index(day);
                *world.state.news.ai_contracts.entry(month).or_insert(0) += 1;
                world.state.news.ai_contracts.retain(|m, _| *m + 12 > month);
                Ok(CommandOutcome::Done)
            }
            (RecordChronicle { year, text, tpl }, Checked::Nothing) => {
                world.state.news.chronicles.push(crate::news::Chronicle {
                    year: *year,
                    text: text.clone(),
                    tpl: tpl.clone(),
                });
                Ok(CommandOutcome::Done)
            }
            (ApplyComposedEvent { title, text, effects, source }, Checked::Nothing) => {
                world.start_composed(title, text, effects, *source)?;
                Ok(CommandOutcome::Done)
            }
            (SetInfoMode { mode, .. }, Checked::Nothing) => {
                crate::info::exec_mode(world, *mode);
                Ok(CommandOutcome::Done)
            }
            (SetOutlook { company, views, method, memo, tpl }, Checked::Nothing) => {
                crate::commerce::exec_outlook(world, *company, views.clone(), *method, memo.clone(), tpl.clone())?;
                Ok(CommandOutcome::Done)
            }
            (RecordMarketReport { region, month, text, tpl }, Checked::Nothing) => {
                crate::report::exec_report(world, *region, *month, text.clone(), tpl.clone());
                Ok(CommandOutcome::Done)
            }
            (_, Checked::Bulletin(plan)) => {
                let cost = plan.cost;
                crate::info::exec_report(world, owner.unwrap_or(OwnerId::Player), plan)?;
                Ok(CommandOutcome::Paid { cost })
            }
            (PinQuest { id, .. }, Checked::Nothing) => {
                world.state.story2.pinned = id.clone();
                Ok(CommandOutcome::Done)
            }
            _ => Err(CommandError::Internal("命令与校验结果不匹配".into())),
        }
    }
}

/// 现货买卖的校验：地点、许可证、容量、数量、限价与现金。
fn check_trade(
    world: &World,
    owner: OwnerId,
    holder: Holder,
    good: GoodId,
    qty: i64,
    side: Side,
    limit: Option<Money>,
) -> Result<Checked, CommandError> {
    let loc = world.holder_location(owner, holder)?;
    if qty <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    let defs = &world.defs;
    if defs.goods.get(good.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{good:?}")));
    }
    if defs.good(good).license && !world.has_license(owner, world.location_faction(loc)) {
        return Err(Reason::new("trade.license", "买卖该商品需要当地势力的许可证").rule());
    }
    match side {
        Side::Buy => {
            let free = world.holder_free(owner, holder);
            if free < qty {
                return Err(CommandError::InsufficientCapacity { need: qty, free });
            }
            // 势力的出口禁令：不许买走（ECONOMY.md 8.4）
            if world.export_banned(loc, good) {
                return Err(Reason::new("policy.export_ban", "这里的势力禁止运出这种商品").rule());
            }
            let q = quote(world, owner, loc, good, Side::Buy, qty)?;
            if let Some(limit) = limit
                && q.total > limit
            {
                return Err(CommandError::PriceLimit { total: q.total, limit });
            }
            need_cash(world, owner, q.total)?;
            Ok(Checked::Trade(holder, q))
        }
        Side::Sell => {
            let have = world.holder_qty(owner, holder, good);
            if have < qty {
                return Err(CommandError::InsufficientCargo { have });
            }
            let q = quote(world, owner, loc, good, Side::Sell, qty)?;
            if let Some(limit) = limit
                && q.total < limit
            {
                return Err(CommandError::PriceLimit { total: q.total, limit });
            }
            Ok(Checked::Trade(holder, q))
        }
    }
}

/// 大额成交带来少量声望（经由贸易最多积累到 50）。
/// 商馆规则（T01，`[access]`）打开时改为按成交额累计：小本生意也攒得出声望，见 [`crate::access::trade_reputation`]。
fn trade_reputation(world: &mut World, owner: OwnerId, q: &TradeQuote) {
    // 商会跟投（T02）挑港口用的成交额；规则关闭时什么也不做
    crate::house::note_turnover(world, owner, q.loc, q.gross);
    if world.access_on() {
        crate::access::trade_reputation(world, owner, q.loc, q.gross);
        return;
    }
    let faction = world.location_faction(q.loc);
    if q.gross >= 5_000 && world.reputation(owner, faction) < 50 {
        world.adjust_reputation(owner, faction, 1);
    }
}

fn exec_buy(
    world: &mut World,
    owner: OwnerId,
    holder: Holder,
    good: GoodId,
    qty: i64,
    q: &TradeQuote,
) -> Result<(), CommandError> {
    let day = world.state.day;
    world.apply_trade_to_market(q, Some(owner));
    world.book_external(
        owner,
        Flow::Market,
        world.town_sector(q.loc),
        JournalEntry::new(day, Memo::Purchase, CashClass::Operating)
            .dr(Account::Inventory, q.total)
            .cr(Account::Cash, q.total),
    )?;
    // 税款：从付给市场的款项中划出，改记为税收去向（货币流通打开时由当地钱袋转进国库）
    let m = &mut world.state.money;
    *m.sinks.entry(Flow::Market).or_insert(0) -= q.tax;
    *m.sinks.entry(Flow::Tax).or_insert(0) += q.tax;
    world.transfer(world.town_sector(q.loc), world.treasury_of(q.loc), q.tax, Flow::Tax);
    world.agent_mut(owner)?.book.add(good, qty, q.total);
    world.holder_add(owner, holder, good, qty)?;
    trade_reputation(world, owner, q);
    crate::trade_books::note_buy(world, owner, holder, q);
    Ok(())
}

fn exec_sell(
    world: &mut World,
    owner: OwnerId,
    holder: Holder,
    good: GoodId,
    qty: i64,
    q: &TradeQuote,
) -> Result<(), CommandError> {
    let day = world.state.day;
    world.apply_trade_to_market(q, Some(owner));
    let cost = world.agent_mut(owner)?.book.remove(good, qty);
    world.book_external(
        owner,
        Flow::Market,
        world.town_sector(q.loc),
        JournalEntry::new(day, Memo::Sale, CashClass::Operating)
            .dr(Account::Cash, q.total)
            .dr(Account::Taxes, q.tax)
            .cr(Account::Sales, q.gross)
            .dr(Account::CostOfGoods, cost)
            .cr(Account::Inventory, cost),
    )?;
    // 市场实际支付不含税成交额，其中税款作为税收去向（货币流通打开时由当地钱袋付进国库）
    let m = &mut world.state.money;
    *m.sources.entry(Flow::Market).or_insert(0) += q.tax;
    *m.sinks.entry(Flow::Tax).or_insert(0) += q.tax;
    world.transfer(world.town_sector(q.loc), world.treasury_of(q.loc), q.tax, Flow::Tax);
    world.holder_take(owner, holder, good, qty)?;
    trade_reputation(world, owner, q);
    crate::trade_books::note_sell(world, owner, holder, q, cost);
    Ok(())
}

fn book_ship_purchase(world: &mut World, owner: OwnerId, at: Sector, cost: Money) -> Result<(), CommandError> {
    let day = world.state.day;
    world.book_external(
        owner,
        Flow::Shipyard,
        at,
        JournalEntry::new(day, Memo::ShipPurchase, CashClass::Investing)
            .dr(Account::Ships, cost)
            .cr(Account::Cash, cost),
    )?;
    Ok(())
}

/// 在某港组建只有一艘船、尚无船员的新舰队。
fn spawn_fleet(world: &mut World, owner: OwnerId, at: LocId, ship: crate::world::Ship) -> FleetId {
    let day = world.state.day;
    let id = world.alloc_fleet_id();
    world.state.fleets.insert(
        id,
        Fleet {
            id,
            owner,
            ships: vec![ship],
            crew: 0,
            morale: 100,
            food: 0,
            water: 0,
            supply_remainder: Default::default(),
            cargo: BTreeMap::new(),
            location: FleetLocation::Docked(at),
            days_at_sea: 0,
            idle_days: 0,
            plan: None,
            news: None,
        },
    );
    world.push_log(LogEvent { day, kind: LogKind::NewFleet { fleet: id, owner } });
    id
}

/// 殖民点在建立殖民地之前没有市场与设施：不能租买仓库或建设产业（殖民地用自己的建筑）。
fn no_site_facility(world: &World, loc: LocId) -> Result<(), CommandError> {
    if world.defs.locations.get(loc.idx()).is_some_and(|l| l.is_site()) {
        return Err(Reason::new("colony.no_facility", "殖民点没有这项设施").rule());
    }
    Ok(())
}

/// 独有船型不能购买或建造。
fn no_unique_ship(world: &World, kind: ShipTypeId) -> Result<(), CommandError> {
    if world.defs.ship(kind).unique {
        return Err(Reason::new("shipyard.unique", "这种船船厂造不出来").rule());
    }
    Ok(())
}

fn own_fleet(world: &World, owner: OwnerId, id: FleetId) -> Result<&Fleet, CommandError> {
    let f = world.fleet(id)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    Ok(f)
}

fn need_cash(world: &World, owner: OwnerId, need: Money) -> Result<(), CommandError> {
    let have = world.agent(owner)?.cash;
    if have < need {
        return Err(CommandError::InsufficientCash { need, have });
    }
    Ok(())
}
