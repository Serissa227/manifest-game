//! Manifest 模拟内核。
//!
//! 本 crate 只做确定性的同步计算：不做 IO、不用异步、不读系统时间、不用浮点。
//! 状态只能被 [`Command`] 改变；每日 [`World::end_day`] 按固定顺序推进各子系统。

pub mod access;
pub mod agency;
pub mod arcana;
pub mod auction;
pub mod bank;
pub mod banter;
pub mod battle;
pub mod calendar;
pub mod captain;
pub mod caravan;
pub mod cast;
pub mod circulation;
pub mod colony;
pub mod command;
pub mod commerce;
pub mod composed;
pub mod contests;
pub mod contract;
pub mod creatures;
pub mod defs;
pub mod diplomacy;
pub mod error;
pub mod events;
pub mod explore;
pub mod fixed;
pub mod fleet;
pub mod futures;
pub mod geo;
pub mod goals;
pub mod hail;
pub mod history;
pub mod house;
pub mod ideas;
pub mod ids;
pub mod industry;
pub mod info;
pub mod invest;
pub mod items;
pub mod keyed;
pub mod ledger;
pub mod legend_ships;
pub mod lineages;
pub mod log;
pub mod market;
pub mod mates;
pub mod merchants;
pub mod nav;
pub mod navigation;
pub mod news;
pub mod npc;
pub mod open_market;
pub mod pacing;
pub mod people;
pub mod policy;
pub mod realms;
pub mod replay;
pub mod report;
pub mod rng;
pub mod save;
pub mod scenario;
pub mod seafaring;
pub mod shared;
pub mod sightings;
pub mod skills;
pub mod societies;
pub mod story;
pub mod story2;
pub mod summary;
#[doc(hidden)]
pub mod testkit;
pub mod text;
pub mod tick;
pub mod treasury;
pub mod upbringing;
pub mod voyage_log;
pub mod warehouse;
pub mod weather;
pub mod weather_cells;
pub mod workshop;
pub mod world;

pub use command::{Command, CommandOutcome};
pub use defs::StaticData;
pub use error::{CommandError, CoreError, Reason};
pub use fixed::{Fx, Money};
pub use ids::*;
pub use pacing::{Beat, BeatSource, BeatWeight, PacingState};
pub use replay::{LogEntry, Source, StartParams};
pub use save::SaveFile;
pub use text::{TextArg, TextRef};
pub use tick::DayReport;
pub use weather::{Climate, DayWeather, Sky};
pub use world::{World, WorldState};

/// 内核版本号，写入存档用于兼容性判断。
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod development;
pub mod trade_books;

pub mod stages;
