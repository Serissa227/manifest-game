//! 可配置的固定年长日历。一个 tick 等于一天；缺省 12×30 天，1–3 月为春，不计算闰年。

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const DAYS_PER_MONTH: u32 = 30;
pub const MONTHS_PER_YEAR: u32 = 12;
pub const DAYS_PER_YEAR: u32 = DAYS_PER_MONTH * MONTHS_PER_YEAR;

/// 季节。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Debug)]
pub enum Season {
    Spring,
    Summer,
    Autumn,
    Winter,
}

impl Season {
    pub const ALL: [Season; 4] = [Season::Spring, Season::Summer, Season::Autumn, Season::Winter];

    pub const fn index(self) -> usize {
        match self {
            Season::Spring => 0,
            Season::Summer => 1,
            Season::Autumn => 2,
            Season::Winter => 3,
        }
    }
}

/// 地点的季节半球；仅用于作物与季节需求，海区气象仍取自己的配置。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hemisphere {
    #[default]
    North,
    South,
}

impl Hemisphere {
    pub fn season(self, season: Season) -> Season {
        Season::ALL[(season.index() + if self == Self::South { 2 } else { 0 }) % 4]
    }
}

/// 某一天的日期。`day` 从 0 开始计。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Date {
    /// 第几年（从 1 开始）
    pub year: u32,
    /// 第几月（从 1 开始）
    pub month: u32,
    /// 本月第几日（从 1 开始）
    pub day: u32,
}

/// 日历的构造与日期计算错误。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CalendarError {
    #[error("months 必须有 1–65535 个月，每月天数必须大于 0，全年至少 2 天")]
    InvalidMonths,
    #[error("seasons 必须与 months 等长，且每项为 0 春、1 夏、2 秋或 3 冬")]
    InvalidSeasons,
    #[error("month_names 必须为空或与 months 等长，月份名称不能为空")]
    InvalidMonthNames,
    #[error("era 不能为空")]
    InvalidEra,
    #[error("日期不存在：{0:?}")]
    InvalidDate(Date),
    #[error("日期或月份运算超出 u32 天数范围")]
    OutOfRange,
}

/// 经过校验的日历；只读访问防止修改月长后破坏偏移表。
/// 序列化仅含 months、seasons、era、month_names，反序列化同样校验。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "CalendarConfig", into = "CalendarConfig")]
pub struct Calendar {
    months: Vec<u16>,
    seasons: Vec<u8>,
    era: String,
    month_names: Vec<String>,
    offsets: Vec<u32>,
    year_days: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct CalendarConfig {
    months: Vec<u16>,
    seasons: Vec<u8>,
    era: String,
    month_names: Vec<String>,
}

impl Default for CalendarConfig {
    fn default() -> Self {
        Self {
            months: vec![30; 12],
            seasons: vec![0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
            era: "航海历".into(),
            month_names: Vec::new(),
        }
    }
}

impl TryFrom<CalendarConfig> for Calendar {
    type Error = CalendarError;

    fn try_from(c: CalendarConfig) -> Result<Self, Self::Error> {
        Self::new(c.months, c.seasons, c.era, c.month_names)
    }
}

impl From<Calendar> for CalendarConfig {
    fn from(c: Calendar) -> Self {
        Self { months: c.months, seasons: c.seasons, era: c.era, month_names: c.month_names }
    }
}

impl Default for Calendar {
    fn default() -> Self {
        let c = CalendarConfig::default();
        Self {
            months: c.months,
            seasons: c.seasons,
            era: c.era,
            month_names: c.month_names,
            offsets: (0..12).map(|m| m * 30).collect(),
            year_days: DAYS_PER_YEAR,
        }
    }
}

impl Calendar {
    pub fn new(
        months: Vec<u16>,
        seasons: Vec<u8>,
        era: String,
        month_names: Vec<String>,
    ) -> Result<Self, CalendarError> {
        // 月数和月长的乘积小于 u32::MAX；全年至少 2 天，确保任意 u32 天数的年序都可表示。
        if months.is_empty() || months.len() > u16::MAX as usize || months.contains(&0) {
            return Err(CalendarError::InvalidMonths);
        }
        let year_days: u32 = months.iter().map(|&d| u32::from(d)).sum();
        if year_days < 2 {
            return Err(CalendarError::InvalidMonths);
        }
        if seasons.len() != months.len() || seasons.iter().any(|&s| s > 3) {
            return Err(CalendarError::InvalidSeasons);
        }
        if !month_names.is_empty()
            && (month_names.len() != months.len() || month_names.iter().any(|n| n.trim().is_empty()))
        {
            return Err(CalendarError::InvalidMonthNames);
        }
        if era.trim().is_empty() {
            return Err(CalendarError::InvalidEra);
        }
        let mut offset = 0;
        let offsets = months
            .iter()
            .map(|&d| {
                let start = offset;
                offset += u32::from(d);
                start
            })
            .collect();
        Ok(Self { months, seasons, era, month_names, offsets, year_days })
    }

    pub fn months(&self) -> &[u16] {
        &self.months
    }
    pub fn seasons(&self) -> &[u8] {
        &self.seasons
    }
    pub fn era(&self) -> &str {
        &self.era
    }
    pub fn month_names(&self) -> &[String] {
        &self.month_names
    }
    pub fn year_days(&self) -> u32 {
        self.year_days
    }

    /// 返回从 0 开始的月下标与从 1 开始的月内日期。
    fn month_day(&self, day: u32) -> (usize, u32) {
        let within = day % self.year_days;
        let month = self.offsets.partition_point(|&offset| offset <= within) - 1;
        (month, within - self.offsets[month] + 1)
    }

    pub fn date_of(&self, day: u32) -> Date {
        let (month, date) = self.month_day(day);
        Date { year: day / self.year_days + 1, month: month as u32 + 1, day: date }
    }

    /// 日期转从 0 开始的天数；年序同 Date，纪年文字不参与换算。
    pub fn day_of(&self, date: Date) -> Result<u32, CalendarError> {
        let Some(month) = date.month.checked_sub(1).map(|m| m as usize) else {
            return Err(CalendarError::InvalidDate(date));
        };
        if date.year == 0 || date.day == 0 || self.months.get(month).is_none_or(|&days| date.day > u32::from(days)) {
            return Err(CalendarError::InvalidDate(date));
        }
        let day = u64::from(date.year - 1) * u64::from(self.year_days)
            + u64::from(self.offsets[month])
            + u64::from(date.day - 1);
        u32::try_from(day).map_err(|_| CalendarError::OutOfRange)
    }

    /// 是否为月末（与经典 is_month_end 的布尔含义一致）。
    pub fn month_end(&self, day: u32) -> bool {
        let (month, date) = self.month_day(day);
        date == u32::from(self.months[month])
    }

    /// 从 0 开始的全局月序号。
    pub fn month_index(&self, day: u32) -> u32 {
        let (month, _) = self.month_day(day);
        day / self.year_days * self.months.len() as u32 + month as u32
    }

    pub fn season_of(&self, day: u32) -> Season {
        let (month, _) = self.month_day(day);
        Season::ALL[self.seasons[month] as usize]
    }

    /// 所在月的天数。
    pub fn month_days(&self, day: u32) -> u32 {
        u32::from(self.months[self.month_day(day).0])
    }

    pub fn month_start(&self, day: u32) -> bool {
        self.month_day(day).1 == 1
    }

    pub fn year_end(&self, day: u32) -> bool {
        day % self.year_days == self.year_days - 1
    }

    /// 按从零开始的全局月序取该月末日。
    pub fn month_end_day(&self, index: u32) -> Result<u32, CalendarError> {
        let count = self.months.len() as u32;
        let month = (index % count) as usize;
        self.day_of(Date {
            year: (index / count).checked_add(1).ok_or(CalendarError::OutOfRange)?,
            month: month as u32 + 1,
            day: u32::from(self.months[month]),
        })
    }

    /// 日历期限剩余的整月数（不足一个月向上取整）。
    pub fn months_until(&self, day: u32, end: u32) -> u32 {
        if end <= day {
            return 0;
        }
        self.month_index(end) - self.month_index(day) + u32::from(self.month_day(end).1 > self.month_day(day).1)
    }

    pub fn season_start(&self, day: u32) -> bool {
        day == 0 || self.season_of(day) != self.season_of(day - 1)
    }

    pub fn season_end(&self, day: u32) -> bool {
        let (month, _) = self.month_day(day);
        self.month_end(day) && self.seasons[month] != self.seasons[(month + 1) % self.months.len()]
    }

    /// 本季已经过的天数及上一季；按配置中实际的季节变化查找，最多回看一年。
    pub fn season_elapsed(&self, day: u32) -> (u32, Season) {
        let (mut month, date) = self.month_day(day);
        let season = self.seasons[month];
        let mut elapsed = date - 1;
        for _ in 0..self.months.len() {
            month = (month + self.months.len() - 1) % self.months.len();
            if self.seasons[month] != season {
                return (elapsed, Season::ALL[self.seasons[month] as usize]);
            }
            elapsed = elapsed.saturating_add(u32::from(self.months[month]));
        }
        (elapsed, Season::ALL[season as usize])
    }

    /// 按日历月前后移动；目标月份没有该日时夹到其月末，不保留隐含的“月末”标记。
    pub fn add_months(&self, day: u32, months: i32) -> Result<u32, CalendarError> {
        let index = i64::from(self.month_index(day)) + i64::from(months);
        if index < 0 {
            return Err(CalendarError::OutOfRange);
        }
        let count = self.months.len() as i64;
        let month = (index % count) as usize;
        let year = u32::try_from(index / count + 1).map_err(|_| CalendarError::OutOfRange)?;
        let (_, date) = self.month_day(day);
        self.day_of(Date { year, month: month as u32 + 1, day: date.min(u32::from(self.months[month])) })
    }
}

fn default_calendar() -> &'static Calendar {
    static CALENDAR: OnceLock<Calendar> = OnceLock::new();
    CALENDAR.get_or_init(Calendar::default)
}

pub fn date_of(day: u32) -> Date {
    default_calendar().date_of(day)
}

pub fn season_of(day: u32) -> Season {
    default_calendar().season_of(day)
}

/// 全局月序号（从 0 开始）。
pub fn month_index(day: u32) -> u32 {
    default_calendar().month_index(day)
}

/// `day` 是否为某月最后一天。
pub fn is_month_end(day: u32) -> bool {
    default_calendar().month_end(day)
}

/// `day` 是否为某年最后一天。
pub fn is_year_end(day: u32) -> bool {
    day % default_calendar().year_days() == default_calendar().year_days() - 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_basics() {
        assert_eq!(date_of(0), Date { year: 1, month: 1, day: 1 });
        assert_eq!(date_of(359), Date { year: 1, month: 12, day: 30 });
        assert_eq!(date_of(360), Date { year: 2, month: 1, day: 1 });
        assert_eq!(season_of(0), Season::Spring);
        assert_eq!(season_of(95), Season::Summer);
        assert_eq!(season_of(359), Season::Winter);
        assert!(is_month_end(29));
        assert!(is_year_end(719));
    }
}
