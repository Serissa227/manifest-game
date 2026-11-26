//! 传说船的封闭数值规则；普通船不读取这些倍率。
use serde::Deserialize;
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Rules {
    pub ghost_day_pct: i64,
    pub ghost_night_pct: i64,
    pub ghost_fog_pct: i64,
    pub ghost_port_price_pct: i64,
    pub ghost_affinity_penalty: i64,
    pub fog_speed_pct: i64,
    pub fog_hide_pct: i64,
    pub storm_speed_pct: i64,
    pub armor_pct: i64,
    pub ram_pct: i64,
    pub paddle_speed: i64,
    pub giant_multiplier: i64,
    pub giant_maintenance: i64,
    pub clipper_speed_pct: i64,
    pub clipper_capacity_pct: i64,
    pub clipper_sail_limit: i64,
    pub sacred_avoid_pct: i64,
    pub fair_wind_speed: i64,
    pub bridge_boarding_pct: i64,
    pub bridge_storm_pct: i64,
    pub salvage_chance_bp: i64,
    pub salvage_value_cap: i64,
    pub maintenance_damage_pct: i64,
    pub sacred_ports: Vec<String>,
    pub shallow_ports: Vec<String>,
    pub s02_enabled: bool,
    pub dread_bp: i64,
    pub dread_truce_days: u32,
    pub dread_min_hull_pct: i64,
    pub night_hide_pct: i64,
    pub storm_ward_pct: i64,
    pub calm_wind_max: i64,
    pub calm_floor_pct: i64,
    pub lookout_cells: i64,
    /// 不断鲜：每隔多少个航海日增加一天断鲜，不新增存档计数器。
    pub fresh_keep_every: u32,
}
impl Default for Rules {
    fn default() -> Self {
        Self {
            ghost_day_pct: 50,
            ghost_night_pct: 125,
            ghost_fog_pct: 125,
            ghost_port_price_pct: 5,
            ghost_affinity_penalty: 1,
            fog_speed_pct: 125,
            fog_hide_pct: 20,
            storm_speed_pct: 125,
            armor_pct: 25,
            ram_pct: 10,
            paddle_speed: 12,
            giant_multiplier: 3,
            giant_maintenance: 20,
            clipper_speed_pct: 150,
            clipper_capacity_pct: 80,
            clipper_sail_limit: 20,
            sacred_avoid_pct: 50,
            fair_wind_speed: 20,
            bridge_boarding_pct: 25,
            bridge_storm_pct: 80,
            salvage_chance_bp: 2500,
            salvage_value_cap: 20000,
            maintenance_damage_pct: 1,
            sacred_ports: vec![],
            shallow_ports: vec![],
            s02_enabled: false,
            dread_bp: 3500,
            dread_truce_days: 3,
            dread_min_hull_pct: 50,
            night_hide_pct: 25,
            storm_ward_pct: 50,
            calm_wind_max: 1,
            calm_floor_pct: 80,
            lookout_cells: 1,
            fresh_keep_every: 3,
        }
    }
}
impl Rules {
    pub fn valid(&self) -> bool {
        self.ghost_day_pct == 50
            && (100..=150).contains(&self.ghost_night_pct)
            && (100..=150).contains(&self.ghost_fog_pct)
            && (0..=10).contains(&self.ghost_port_price_pct)
            && (0..=2).contains(&self.ghost_affinity_penalty)
            && (100..=150).contains(&self.fog_speed_pct)
            && (0..=30).contains(&self.fog_hide_pct)
            && (100..=150).contains(&self.storm_speed_pct)
            && (0..=50).contains(&self.armor_pct)
            && (0..=20).contains(&self.ram_pct)
            && (1..=20).contains(&self.paddle_speed)
            && (2..=4).contains(&self.giant_multiplier)
            && (1..=1000).contains(&self.giant_maintenance)
            && (100..=175).contains(&self.clipper_speed_pct)
            && (50..=90).contains(&self.clipper_capacity_pct)
            && (15..=35).contains(&self.clipper_sail_limit)
            && (0..=75).contains(&self.sacred_avoid_pct)
            && (1..=30).contains(&self.fair_wind_speed)
            && (0..=50).contains(&self.bridge_boarding_pct)
            && (50..=100).contains(&self.bridge_storm_pct)
            && (0..=5000).contains(&self.salvage_chance_bp)
            && (1..=20000).contains(&self.salvage_value_cap)
            && (1..=5).contains(&self.maintenance_damage_pct)
            && (0..=6000).contains(&self.dread_bp)
            && (1..=10).contains(&self.dread_truce_days)
            && (0..=100).contains(&self.dread_min_hull_pct)
            && (0..=30).contains(&self.night_hide_pct)
            && (0..=75).contains(&self.storm_ward_pct)
            && (0..=2).contains(&self.calm_wind_max)
            && (50..=100).contains(&self.calm_floor_pct)
            && (0..=3).contains(&self.lookout_cells)
            && (1..=30).contains(&self.fresh_keep_every)
    }
}
