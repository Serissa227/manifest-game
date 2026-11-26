//! 应用设置：写入配置目录下的 `settings.json`。API 密钥不在这里，另存于系统凭据管理器。

use crate::{AppError, Msg};
use manifest_ai::{AiMode, AiSettings, JevConfig, ModelTier, ProviderConfig, ProviderKind};
use manifest_data::Locale;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// AI 相关的偏好。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AiPrefs {
    /// off / offline / mock / live
    pub mode: AiMode,
    pub provider: ProviderKind,
    /// 提供商地址（不含 `/v1/...`）
    pub base_url: String,
    /// 快速 / 均衡 / 高质量 三个档位的模型名
    pub models: [String; 3],
    pub tier: ModelTier,
    /// 每游戏月的调用次数上限
    pub monthly_calls: u32,
    /// 每游戏月的 token 上限
    pub monthly_tokens: u64,
    pub timeout_secs: u64,
    /// 结构化输出：Anthropic 用工具调用、OpenAI 兼容接口用 json_schema（服务不支持时关闭，改为文本 + 修复解析）
    pub structured: bool,
    pub jev_enabled: bool,
    pub jev_url: String,
    pub jev_timeout_ms: u64,
    pub jev_min_score: f64,
    /// OpenAI 兼容接口三个档位的推理强度（见 [`ProviderConfig::reasoning`]）；桌面版缺省为空，网页版由服务端决定
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<[String; 3]>,
}

impl Default for AiPrefs {
    fn default() -> Self {
        let p = ProviderConfig::anthropic_default();
        AiPrefs {
            mode: AiMode::Offline,
            provider: p.kind,
            base_url: p.base_url,
            models: p.models,
            tier: ModelTier::Balanced,
            monthly_calls: 60,
            monthly_tokens: 200_000,
            timeout_secs: p.timeout_secs,
            structured: p.structured,
            jev_enabled: false,
            jev_url: "http://127.0.0.1:7700".into(),
            jev_timeout_ms: 1_500,
            jev_min_score: 0.5,
            reasoning: None,
        }
    }
}

impl AiPrefs {
    /// 凭据管理器中保存该提供商密钥的账户名。
    pub fn key_account(&self) -> &'static str {
        key_account(self.provider)
    }

    pub fn provider_config(&self) -> ProviderConfig {
        ProviderConfig {
            kind: self.provider,
            base_url: self.base_url.clone(),
            models: self.models.clone(),
            timeout_secs: self.timeout_secs.max(1),
            structured: self.structured,
            reasoning: self.reasoning.clone(),
        }
    }

    pub fn to_settings(&self) -> AiSettings {
        AiSettings {
            mode: self.mode,
            provider: Some(self.provider_config()),
            tier: self.tier,
            monthly_calls: self.monthly_calls,
            monthly_tokens: self.monthly_tokens,
            jev: self.jev_enabled.then(|| JevConfig {
                base_url: self.jev_url.clone(),
                timeout_ms: self.jev_timeout_ms.max(1),
                min_score: self.jev_min_score,
            }),
        }
    }
}

pub fn key_account(kind: ProviderKind) -> &'static str {
    match kind {
        ProviderKind::Anthropic => "anthropic",
        ProviderKind::OpenAiCompatible => "openai-compatible",
    }
}

/// 舰队抵达目的地（靠港，或抵达殖民点）时自动暂停：关、只看旗舰队（缺省）、任何一支玩家舰队。
/// 抵达了总有事要做（买卖、补给、建殖民地），停下来等玩家；只在游戏运行时起作用。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrivalPause {
    /// 不暂停
    Off,
    /// 旗舰队（主角亲自率领的第一支舰队）抵达时暂停
    #[default]
    Flagship,
    /// 任何一支玩家舰队抵达时暂停
    Any,
}

/// 养成期播放时什么时候停下来（U05）：每周停一下（缺省，沿用 P10）、每月停一下、有事才停。
/// 不论哪一种，常设周课表铺不上、有剧情待答时都会停；“每月停 / 有事才停”时疲劳到 80 也在周末停一下。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpbringingPause {
    /// 每周停一下：按一次“开始第 N 周”
    #[default]
    Week,
    /// 每月停一下
    Month,
    /// 有事才停
    Event,
}

/// 全部设置。
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub ai: AiPrefs,
    /// 默认游戏速度：界面只给三档（慢 2× / 普通 4× / 快 8×，见 [`SPEED_TIERS`]），缺省“普通”。
    /// 旧设置里的 1 / 2 / 4 / 8 / 16 / 32 仍然合法；从文件读入时归到最近的一档（见 [`AppSettings::load`]）
    pub speed: u8,
    /// 自动存档间隔（天），0 表示关闭
    pub autosave_days: u32,
    /// 抵达时自动暂停（旧设置没有这一项时按缺省：旗舰队抵达时暂停）
    pub arrival_pause: ArrivalPause,
    /// 手动航行中的分钟暂停；缺省开启。
    pub navigation_pause: bool,
    /// H10b：远处天气团、普通商船进入视野时，海上降到常档，别处降到 1×；缺省开启。
    pub navigation_slow: bool,
    /// H08：到港时弹出航程总结；缺省开启
    pub voyage_summary: bool,
    /// H08：新系统第一次出现时的一句话提示；缺省开启
    pub voyage_hints: bool,
    /// 养成期播放的停顿方式（U05；旧设置没有这一项时按缺省：每周停）
    pub upbringing_pause: UpbringingPause,
    /// 开发模式：显示调试面板
    pub dev_mode: bool,
    /// 界面与内容的语言（EXPANSION.md §12）："zh-CN" / "en"。未设置时为空：前端首次启动按系统语言写入，后端按中文显示。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<Locale>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            ai: AiPrefs::default(),
            speed: NORMAL_SPEED,
            autosave_days: 30,
            arrival_pause: ArrivalPause::default(),
            navigation_pause: true,
            navigation_slow: true,
            voyage_summary: true,
            voyage_hints: true,
            upbringing_pause: UpbringingPause::default(),
            dev_mode: false,
            language: None,
        }
    }
}

/// 后端接受的倍速（EXPANSION.md §9.2）：1× 每天 4 秒，2× 2 秒，4× 1 秒，8× 0.5 秒，16× 0.25 秒，32× 0.125 秒。
/// 与前端 `time/daylight.ts` 的 SPEEDS 一致。界面只给 [`SPEED_TIERS`] 三档；其余几档留给旧存档、旧设置与旧界面。
pub const SPEEDS: [u8; 6] = [1, 2, 4, 8, 16, 32];

/// 界面上的三档速度：
/// 慢 2×（每天 2 秒）、普通 4×（每天 1 秒）、快 8×（每天 0.5 秒）。快不超过 8×：网页版每位玩家的推进开销随倍速变大。
/// 与前端 `time/daylight.ts` 的 SPEED_TIERS 一致。
pub const SPEED_TIERS: [u8; 3] = [SLOW_SPEED, NORMAL_SPEED, FAST_SPEED];
/// 慢：每天 2 秒
pub const SLOW_SPEED: u8 = 2;
/// 普通（缺省）：每天 1 秒
pub const NORMAL_SPEED: u8 = 4;
/// 快：每天 0.5 秒
pub const FAST_SPEED: u8 = 8;

/// 把任意倍速归到最近的一档（1× → 慢，16× / 32× → 快；0 与离两档一样近时取较慢的一档，0 归“普通”）。
pub fn nearest_tier(speed: u8) -> u8 {
    if speed == 0 {
        return NORMAL_SPEED;
    }
    SPEED_TIERS.into_iter().min_by_key(|t| (t.abs_diff(speed), *t)).unwrap_or(NORMAL_SPEED)
}

/// 倍速列表的文字：“1 / 2 / 4 / 8 / 16 / 32”（错误信息用）。
pub fn speeds_text() -> String {
    SPEEDS.iter().map(u8::to_string).collect::<Vec<_>>().join(" / ")
}

impl AppSettings {
    /// 当前语言（未设置时按中文）。
    pub fn locale(&self) -> Locale {
        self.language.unwrap_or_default()
    }

    /// 校验并规整设置。
    pub fn normalized(mut self) -> Result<Self, AppError> {
        if !SPEEDS.contains(&self.speed) {
            return Err(AppError::Invalid(
                Msg::new("app.default_speed", format!("默认速度只能是 {} 倍速之一", speeds_text()))
                    .arg("speeds", speeds_text()),
            ));
        }
        if self.autosave_days > 360 {
            return Err(AppError::Invalid(Msg::new("app.autosave", "自动存档间隔不能超过 360 天")));
        }
        let ai = &mut self.ai;
        if ai.monthly_calls > 10_000 || ai.monthly_tokens > 100_000_000 {
            return Err(AppError::Invalid(Msg::new("app.budget", "预算过大")));
        }
        if !(0.0..=1.0).contains(&ai.jev_min_score) {
            return Err(AppError::Invalid(Msg::new("app.jev_score", "Jev 分数阈值必须在 0 到 1 之间")));
        }
        ai.base_url = ai.base_url.trim().to_string();
        ai.jev_url = ai.jev_url.trim().to_string();
        for m in &mut ai.models {
            *m = m.trim().to_string();
        }
        Ok(self)
    }

    /// 读入设置文件；坏掉或不合法时用缺省设置。旧设置里的默认速度（1 / 16 / 32 倍速等）归到最近的一档。
    pub fn load(path: &Path) -> AppSettings {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<AppSettings>(&text).ok())
            .and_then(|s| s.normalized().ok())
            .map(|mut s| {
                s.speed = nearest_tier(s.speed);
                s
            })
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), AppError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| AppError::Io(e.to_string()))?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| AppError::Io(e.to_string()))?;
        std::fs::write(path, text).map_err(|e| AppError::Io(e.to_string()))
    }
}

/// H10b：海上四档，设置文件的旧三档归档规则保持原样。
pub const SEA_TIERS: [u8; 4] = [2, 4, 8, 16];
pub const VERY_FAST_SPEED: u8 = 16;
pub const SEA_DAY_MS: [u64; 4] = [6_000, 3_000, 1_000, 500];
pub fn nearest_sea_tier(speed: u8) -> u8 {
    if speed == 0 {
        return NORMAL_SPEED;
    }
    SEA_TIERS.into_iter().min_by_key(|t| (t.abs_diff(speed), *t)).unwrap_or(NORMAL_SPEED)
}
