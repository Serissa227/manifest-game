//! 航海过程改造（`docs/VOYAGE-PLAN.md`，H 系列）的内核部分。
//!
//! - [`posts`]：H01 岗位与装备在海上的效果（`rules.toml [voyage_posts]`）。
//! - [`wear`]：H02 船况、口粮与船员状态（`rules.toml [voyage_wear]`）。
//! - [`shore`]：H05 岸与锚地（`rules.toml [shore_tasks]`）。
//!
//! 每个包一张独立的规则表，缺省关闭；关闭时与改动前逐字节一致。只对玩家（含模拟器 bot）的舰队生效，
//! NPC 舰队与航线表不动。

pub mod posts;
pub mod shore;
pub mod wear;

pub use posts::{PostsRules, VoyageMods};
pub use shore::{ShoreBlock, ShoreOption, ShoreOrder, ShoreRules, ShoreState, ShoreTask};
pub use wear::{FleetWear, Pace, Rations, StandingOrders, VoyageOrder, WearEvent, WearRules};
