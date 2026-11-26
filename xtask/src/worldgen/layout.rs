//! 设计骨架 `data/world/layout.toml` 的结构（字段含义见该文件里的中文注释）。

use serde::Deserialize;

fn one() -> f64 {
    1.0
}
fn two() -> u32 {
    2
}

/// 整个骨架。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    pub seed: u64,
    pub width: usize,
    pub height: usize,
    #[serde(default)]
    pub params: Params,
    pub climate: Climate,
    #[serde(default)]
    pub land: Vec<Shape>,
    #[serde(default)]
    pub sea: Vec<Shape>,
    #[serde(default)]
    pub island: Vec<Shape>,
    #[serde(default)]
    pub arc: Vec<Arc>,
    #[serde(default)]
    pub range: Vec<Range>,
    #[serde(default)]
    pub valley: Vec<Valley>,
    #[serde(default)]
    pub volcano: Vec<Volcano>,
    #[serde(default)]
    pub crater: Vec<Crater>,
    #[serde(default)]
    pub atoll: Vec<Atoll>,
    #[serde(default)]
    pub zone: Vec<Zone>,
    #[serde(default)]
    pub channel: Vec<Channel>,
    #[serde(default)]
    pub bank: Vec<Bank>,
    #[serde(default)]
    pub delta: Vec<Delta>,
    #[serde(default)]
    pub river: Vec<RiverSpec>,
    #[serde(default)]
    pub region: Vec<RegionSeed>,
    #[serde(default)]
    pub landmark: Vec<LandmarkSpec>,
    #[serde(default)]
    pub anchor: Vec<Anchor>,
}

/// 全局参数。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct Params {
    /// 海岸线扰动幅度（格）
    pub coast_noise: f64,
    /// 海岸扰动的最低频波长（格）
    pub coast_wavelength: f64,
    /// 海岸扰动的分形层数
    pub coast_octaves: u32,
    /// 每层幅度衰减
    pub coast_gain: f64,
    /// 中尺度（波长 7–14 格）岸线起伏的幅度（格）
    pub coast_mid: f64,
    /// 域扭曲幅度与波长（格）
    pub warp_amount: f64,
    pub warp_wavelength: f64,
    /// 第二层（中尺度）域扭曲的幅度与波长（格），只作用于海岸附近
    pub warp2_amount: f64,
    pub warp2_wavelength: f64,
    /// 内陆台地高度（米）与抬升距离（格）
    pub inland_height: f64,
    pub inland_distance: f64,
    /// 丘陵起伏（米）
    pub hill_height: f64,
    /// 侵蚀迭代次数与系数
    pub erosion_iterations: u32,
    pub erosion_k: f64,
    pub erosion_m: f64,
    /// 侵蚀结果与构造地形的混合比例（1 = 完全取侵蚀结果）
    pub erosion_blend: f64,
    /// 热力侵蚀：坡度上限（米/格）
    pub talus: f64,
    /// 全局的冰后期海面上升：大河口被海水倒灌成小河口湾的长度（约 drown ÷ 10 格）
    pub drown: f64,
    /// 河谷被淹没的汇流门槛（按降水加权的上游格数）：峡湾区、溺谷区、其他海岸的大河口
    pub fjord_area: f64,
    pub ria_area: f64,
    pub drown_area: f64,
    /// 同一段海岸上被淹没的河谷至少相隔多少格（非极大值抑制，实际间距按噪声在 0.8–1.2 倍之间变化）
    pub mouth_spacing: f64,
    /// 岩性硬度：硬岩把海岸往海一侧推成岬角、软岩往陆一侧退成海湾的幅度（格）与波长（格）
    pub hardness: f64,
    pub hardness_wavelength: f64,
    /// 大陆架（浅海带）基础宽度（格）
    pub shelf: f64,
    /// 大陆架外缘的域扭曲幅度（格）与宽度沿岸变化的幅度（比例）：陆架边缘不再与海岸平行、没有长直边
    pub shelf_warp: f64,
    pub shelf_vary: f64,
    /// 支流与次级河流：按降水加权的汇流量门槛（多雨区按降水自动调低、干旱区调高），以及写入的最短长度（格）
    pub tributary_area: f64,
    pub stream_area: f64,
    pub stream_min_len: usize,
    /// 高程分级阈值（米）：陆格高程低于第 i 个值为等级 i，其余为 9
    pub relief_levels: Vec<f64>,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            coast_noise: 6.0,
            coast_wavelength: 44.0,
            coast_octaves: 6,
            coast_gain: 0.55,
            coast_mid: 3.0,
            warp_amount: 14.0,
            warp_wavelength: 70.0,
            warp2_amount: 3.5,
            warp2_wavelength: 18.0,
            inland_height: 420.0,
            inland_distance: 18.0,
            hill_height: 260.0,
            erosion_iterations: 36,
            erosion_k: 0.0009,
            erosion_m: 0.5,
            erosion_blend: 0.7,
            talus: 420.0,
            drown: 15.0,
            fjord_area: 40.0,
            ria_area: 25.0,
            drown_area: 120.0,
            mouth_spacing: 10.0,
            hardness: 3.5,
            hardness_wavelength: 14.0,
            shelf: 2.0,
            shelf_warp: 2.5,
            shelf_vary: 0.45,
            tributary_area: 30.0,
            stream_area: 60.0,
            stream_min_len: 6,
            relief_levels: vec![60.0, 180.0, 350.0, 600.0, 900.0, 1300.0, 1800.0, 2400.0, 3100.0],
        }
    }
}

/// 气候参数。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Climate {
    /// 海平面年均温（°C）随纬度（行号）的控制点 [y, 温度]，行间线性插值
    pub temperature: Vec<[f64; 2]>,
    /// 降水效率随行号的控制点 [y, 系数]（副热带高压带低，赤道与中纬高）
    pub rain_belt: Vec<[f64; 2]>,
    /// 盛行风随行号的控制点 [y, 风向]：风向为风的去向，+1 向东（西风带），−1 向西（信风带）
    pub wind: Vec<[f64; 2]>,
    /// 气温直减率（°C / 1000 米）
    pub lapse: f64,
    /// 地中海式气候（冬雨夏干）的纬度带：[y0, y1, y2, y3]，y1–y2 之间完全在带内，两端渐变
    pub medit: [f64; 4],
    /// 地中海式气候要求上风（西侧）有海：西侧 45° 扇形内到海的距离不超过这么多格（再远渐变到 1.6 倍为零）
    pub medit_fetch: f64,
    /// 气温的低频扰动幅度（°C）与波长（格）：让林线与植被带的边界成锯齿、不沿纬线
    pub temp_noise: f64,
    pub temp_noise_wavelength: f64,
    /// 降水的低频扰动（比例，0.15 = ±15%）
    pub rain_noise: f64,
    /// 河谷比周围暖多少（°C，谷底相对周围每低 150 米加 1°C，最多这么多）
    pub valley_warmth: f64,
}

/// 多边形或轴对齐椭圆。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Shape {
    pub name: String,
    #[serde(default)]
    pub points: Vec<[f64; 2]>,
    #[serde(default)]
    pub center: Option<[f64; 2]>,
    #[serde(default)]
    pub radius: Option<[f64; 2]>,
    /// 内陆抬升系数（陆块与岛屿）
    #[serde(default = "one")]
    pub height: f64,
    /// Chaikin 平滑次数
    #[serde(default = "two")]
    pub smooth: u32,
    /// 岛屿：是否随机切出一个小湾口（半径 ≥ 2.5 格的岛才切）
    #[serde(default = "yes")]
    pub bay: bool,
}

fn yes() -> bool {
    true
}

/// 岛弧。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Arc {
    pub name: String,
    pub points: Vec<[f64; 2]>,
    pub count: u32,
    /// 岛屿半径范围（格）
    pub size: [f64; 2],
    /// 岛屿偏离弧线的最大距离（格）
    #[serde(default)]
    pub jitter: f64,
    #[serde(default = "one")]
    pub height: f64,
    #[serde(default)]
    pub volcanic: bool,
    /// 岛屿沿弧线方向的长短轴比（长轴 = 半径 × 这个范围里的随机数）；缺省 [1.8, 3.0]：岛沿岛弧拉长，而不是一颗颗圆点
    #[serde(default = "default_arc_aspect")]
    pub aspect: [f64; 2],
    /// 岛的朝向偏离弧线切向的最大角度（弧度的 tan，0.45 ≈ ±24°）
    #[serde(default = "default_arc_twist")]
    pub twist: f64,
    /// 每个岛在长轴一端外侧点出几块 1 格的礁岩 / 海蚀柱的概率（0–1）
    #[serde(default = "default_arc_islets")]
    pub islets: f64,
    /// 火山岛弧上有几座火山锥（缺省为岛数的一半）；锥顶的高度（米）
    #[serde(default)]
    pub volcanoes: Option<u32>,
    #[serde(default = "default_cone_height")]
    pub cone_height: f64,
}

fn default_arc_aspect() -> [f64; 2] {
    [1.8, 3.0]
}
fn default_arc_twist() -> f64 {
    0.45
}
fn default_arc_islets() -> f64 {
    0.5
}
fn default_cone_height() -> f64 {
    1900.0
}

/// 山脉。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub name: String,
    pub points: Vec<[f64; 2]>,
    /// 主脊半宽（格）
    pub width: f64,
    /// 主峰高度（米）
    pub height: f64,
    /// 两端收尖比例（0–0.5）
    #[serde(default)]
    pub taper: f64,
    /// 逐点的主脊半宽（格），与 points 一一对应，沿线插值；缺省处处为 width
    #[serde(default)]
    pub widths: Vec<f64>,
    /// 逐点的主峰高度（米），与 points 一一对应，沿线插值；缺省处处为 height
    #[serde(default)]
    pub heights: Vec<f64>,
    /// 脊线左右摆动的幅度（格）
    #[serde(default = "default_wander")]
    pub wander: f64,
    /// 鞍部与山口：脊线高度按 20–40 格波长的噪声最多压低这么多（0–1）
    #[serde(default = "default_saddle")]
    pub saddle: f64,
}

fn default_wander() -> f64 {
    4.0
}
fn default_saddle() -> f64 {
    0.45
}

impl Range {
    /// 沿线位置 t（0–1）处的半宽与高度：按控制点之间的弧长比例插值。
    pub fn profile(&self, t: f64) -> (f64, f64) {
        let n = self.points.len();
        let pick = |v: &Vec<f64>, d: f64| -> Vec<f64> { if v.len() == n { v.clone() } else { vec![d; n] } };
        let ws = pick(&self.widths, self.width);
        let hs = pick(&self.heights, self.height);
        if n < 2 {
            return (self.width, self.height);
        }
        let mut acc = vec![0.0];
        for w in self.points.windows(2) {
            let d = ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt();
            let last = acc[acc.len() - 1];
            acc.push(last + d);
        }
        let total = acc[n - 1].max(1e-9);
        let s = t.clamp(0.0, 1.0) * total;
        for i in 0..n - 1 {
            if s <= acc[i + 1] {
                let f = (s - acc[i]) / (acc[i + 1] - acc[i]).max(1e-9);
                return (ws[i] + f * (ws[i + 1] - ws[i]), hs[i] + f * (hs[i + 1] - hs[i]));
            }
        }
        (ws[n - 1], hs[n - 1])
    }
}

/// 河谷引导：沿折线压低地形，让大河按设定的路线流（例如穿过沙漠的萨菲拉河）。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Valley {
    pub name: String,
    pub points: Vec<[f64; 2]>,
    /// 河谷半宽（格）
    pub width: f64,
    /// 压低比例（0–1）
    pub depth: f64,
}

/// 火山（可带破火山口）。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Volcano {
    pub name: String,
    pub center: [f64; 2],
    pub radius: f64,
    pub height: f64,
    /// 破火山口半径（格）：中心塌陷成海，留下一圈环形岛
    #[serde(default)]
    pub caldera: f64,
    /// 破火山口朝哪个方向开口（与外海相通），[dx, dy]
    #[serde(default)]
    pub breach: Option<[f64; 2]>,
    /// 锥顶偏离中心的方向与距离（格）[dx, dy]：一侧陡、一侧缓
    #[serde(default)]
    pub offset: Option<[f64; 2]>,
}

/// 陨石坑：正圆的坑缘高出四周，坑心是湖（map.txt 里算陆地，植被画成湿地）或经缺口与海相通的潟湖。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Crater {
    pub name: String,
    pub center: [f64; 2],
    /// 坑心水面半径（格）
    pub radius: f64,
    /// 坑缘高出四周多少（米）
    pub rim: f64,
    /// 坑缘缺口朝哪个方向（与海相通成潟湖），[dx, dy]；缺省为封闭的湖
    #[serde(default)]
    pub breach: Option<[f64; 2]>,
}

/// 环礁：一圈断续的礁岛围着浅海潟湖，不参与海岸噪声。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Atoll {
    pub name: String,
    pub center: [f64; 2],
    /// 礁环半径（格）
    pub radius: f64,
    /// 礁环缺口（潮汐通道）的方向列表 [dx, dy]
    #[serde(default)]
    pub gaps: Vec<[f64; 2]>,
}

/// 海岸与气候分区。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Zone {
    /// fjord 峡湾 | ria 溺谷 | sandy 沙岸（平直、沙嘴与潟湖）| reef 珊瑚礁 | skerry 岩礁群 | mangrove 红树林
    /// | lowland 低地 | plateau 台地 | mesa 桌山（平顶陡崖）| humid 湿润 | arid 干旱 | cold 寒流 | warm 暖流
    /// | calm 平缓海岸 | rough 破碎海岸 | shelf 浅滩（大陆架更宽）| steep 陡岸（深海紧贴岸边）| erg 沙海
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub points: Vec<[f64; 2]>,
    #[serde(default)]
    pub center: Option<[f64; 2]>,
    #[serde(default)]
    pub radius: Option<[f64; 2]>,
    /// 边缘羽化宽度（格）
    #[serde(default = "default_feather")]
    pub feather: f64,
    #[serde(default = "one")]
    pub strength: f64,
    /// 是否套用与海岸相同的域扭曲（缺省：多边形扭曲、椭圆不扭曲）
    #[serde(default)]
    pub warp: Option<bool>,
    /// 边界按噪声起伏的幅度（格）与波长（格）：植被带、干湿区的边界成锯齿，不是尺子画的线
    #[serde(default)]
    pub edge_noise: f64,
    #[serde(default = "default_edge_wavelength")]
    pub edge_wavelength: f64,
}

fn default_edge_wavelength() -> f64 {
    16.0
}

fn default_feather() -> f64 {
    6.0
}

/// 强制开通的水道。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Channel {
    pub name: String,
    pub points: Vec<[f64; 2]>,
    /// 最小宽度（格）
    pub width: f64,
}

/// 远海浅滩。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bank {
    pub name: String,
    pub center: [f64; 2],
    pub radius: [f64; 2],
}

/// 三角洲：在某条已命名河流的入海口推出扇形低地。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Delta {
    pub name: String,
    /// 河流 key（见 [[river]]）
    pub river: String,
    /// 扇面伸出基线（大致是原来的海岸）的长度（格）
    pub length: f64,
    /// 张角：基线处的半宽约为 0.55 × spread × length（格）
    #[serde(default = "one")]
    pub spread: f64,
    /// 扇顶离基线多少格（扇根在内陆的一段；缺省为 length 的一半）；没写扇顶时也是扇顶离河口沿河上溯的格数
    #[serde(default)]
    pub inset: Option<f64>,
    /// 朝海方向 [dx, dy]；缺省取河流最后一段的方向
    #[serde(default)]
    pub direction: Option<[f64; 2]>,
    /// 扇顶位置（格）；缺省为河口上游 inset 格处
    #[serde(default)]
    pub apex: Option<[f64; 2]>,
    /// 分汊河道（写进 rivers.toml 的支流）：[key, name] 列表
    #[serde(default)]
    pub branches: Vec<[String; 2]>,
}

/// 主要河流的命名：在入海口附近找流量最大的河口，向上游追溯。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiverSpec {
    pub key: String,
    pub name: String,
    /// 大致的入海口（格）
    pub mouth: [f64; 2],
    /// 搜索半径（格）
    #[serde(default = "default_river_search")]
    pub search: f64,
    /// 强制宽度（1–3）；缺省按流量
    #[serde(default)]
    pub width: Option<u8>,
    /// 上游方向提示：追溯时优先朝这个点走
    #[serde(default)]
    pub source: Option<[f64; 2]>,
    /// 强制河道：从源头经过这些点到入海口（按顺序）。写了 via 时，生成器沿地势最低的路线把河道“刻”进地形
    /// （沿程单调下降、两侧压低成河谷），河流必定流经这些点（例如设定里河边的城市）
    #[serde(default)]
    pub via: Vec<[f64; 2]>,
}

fn default_river_search() -> f64 {
    6.0
}

/// 海区种子点：海格归到沿水路最近的种子所属的海区。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionSeed {
    pub key: String,
    pub seeds: Vec<[f64; 2]>,
}

/// 地标与奇观（原样写进 landmarks.toml，位置会吸附到合适的格）。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandmarkSpec {
    pub key: String,
    pub name: String,
    pub category: String,
    pub kind: String,
    pub pos: [i64; 2],
    #[serde(default)]
    pub size: Option<[i64; 2]>,
    #[serde(default)]
    pub lore: String,
    #[serde(default)]
    pub discovery: Option<String>,
    /// 吸附：land 陆格 | sea 海格 | coast 海岸陆格 | any 不吸附
    #[serde(default = "default_any")]
    pub place: String,
    /// 在植被图上把占地涂成奥术地貌 X
    #[serde(default)]
    pub arcane_ground: bool,
    /// 奥术地貌的圆盘半径（格，以占地中心为圆心）；缺省为占地的内切圆
    #[serde(default)]
    pub ground_radius: Option<f64>,
    /// 放在这条河（[[river]] 的 key）的入海口（例如瀑布）；找不到这条河时按 place 吸附
    #[serde(default)]
    pub river: Option<String>,
}

fn default_any() -> String {
    "any".into()
}

/// 地点锚点：生成后把港口、城市、殖民点、发现物吸附到锚点附近最合适的格。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Anchor {
    pub key: String,
    pub pos: [f64; 2],
    /// 搜索半径（格）
    #[serde(default = "default_anchor_radius")]
    pub radius: f64,
}

fn default_anchor_radius() -> f64 {
    6.0
}

impl Shape {
    /// 骨架多边形（椭圆按 48 边近似）。
    pub fn polygon(&self) -> Vec<(f64, f64)> {
        if let (Some(c), Some(r)) = (self.center, self.radius) {
            ellipse(c, r)
        } else {
            self.points.iter().map(|p| (p[0], p[1])).collect()
        }
    }
}

impl Zone {
    pub fn polygon(&self) -> Vec<(f64, f64)> {
        if let (Some(c), Some(r)) = (self.center, self.radius) {
            ellipse(c, r)
        } else {
            self.points.iter().map(|p| (p[0], p[1])).collect()
        }
    }
}

/// 轴对齐椭圆的多边形近似（用预先算好的单位圆点，避免三角函数）。
pub fn ellipse(c: [f64; 2], r: [f64; 2]) -> Vec<(f64, f64)> {
    const S2: f64 = std::f64::consts::FRAC_1_SQRT_2;
    // 单位圆上 32 个点（22.5° / 2 步长）
    const U: [(f64, f64); 32] = [
        (1.0, 0.0),
        (0.9808, 0.1951),
        (0.9239, 0.3827),
        (0.8315, 0.5556),
        (S2, S2),
        (0.5556, 0.8315),
        (0.3827, 0.9239),
        (0.1951, 0.9808),
        (0.0, 1.0),
        (-0.1951, 0.9808),
        (-0.3827, 0.9239),
        (-0.5556, 0.8315),
        (-S2, S2),
        (-0.8315, 0.5556),
        (-0.9239, 0.3827),
        (-0.9808, 0.1951),
        (-1.0, 0.0),
        (-0.9808, -0.1951),
        (-0.9239, -0.3827),
        (-0.8315, -0.5556),
        (-S2, -S2),
        (-0.5556, -0.8315),
        (-0.3827, -0.9239),
        (-0.1951, -0.9808),
        (0.0, -1.0),
        (0.1951, -0.9808),
        (0.3827, -0.9239),
        (0.5556, -0.8315),
        (S2, -S2),
        (0.8315, -0.5556),
        (0.9239, -0.3827),
        (0.9808, -0.1951),
    ];
    U.iter().map(|&(ux, uy)| (c[0] + ux * r[0], c[1] + uy * r[1])).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_profile_interpolates_by_arc_length() {
        let r = Range {
            name: String::new(),
            points: vec![[0.0, 0.0], [10.0, 0.0], [30.0, 0.0]],
            width: 3.0,
            height: 1000.0,
            taper: 0.0,
            widths: vec![2.0, 4.0, 6.0],
            heights: vec![500.0, 1500.0, 1100.0],
            wander: 0.0,
            saddle: 0.0,
        };
        // 第一个控制点到第二个占总长的 1/3
        let (w, h) = r.profile(1.0 / 6.0);
        assert!((w - 3.0).abs() < 1e-9 && (h - 1000.0).abs() < 1e-9);
        let (w, h) = r.profile(1.0);
        assert!((w - 6.0).abs() < 1e-9 && (h - 1100.0).abs() < 1e-9);
        // 逐点数组长度不对时退回统一的 width / height
        let r2 = Range { widths: vec![1.0], heights: vec![], ..r };
        assert_eq!(r2.profile(0.5), (3.0, 1000.0));
    }
}
