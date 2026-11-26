//! 保守的文字来源门禁：专名按完整词匹配，不能证明来源的片段整段回退。
//! 不把玩家输入、整张人物小传或未来剧情加入许可词表。
use super::*;
use std::collections::BTreeSet;

#[derive(Clone, Debug)]
pub struct Guard {
    names: Vec<String>,
    hidden: Vec<String>,
    year: u32,
}
impl Guard {
    pub fn new(world: &World) -> Self {
        let mut names = Vec::new();
        let mut hidden = Vec::new();
        for (i, loc) in world.defs.locations.iter().enumerate() {
            if world.location_visible(LocId::from_idx(i)) {
                names.push(loc.name.clone());
            } else {
                hidden.push(loc.name.clone());
            }
        }
        for person in &world.defs.cast.persons {
            if runtime::person_known(world, &person.key) {
                names.push(person.name.clone());
            } else {
                hidden.push(person.name.clone());
            }
        }
        for (i, discovery) in world.defs.discoveries.iter().enumerate() {
            if world.state.explore.discovered.contains_key(&manifest_core::DiscoveryId::from_idx(i)) {
                names.push(discovery.name.clone());
            } else {
                hidden.push(discovery.name.clone());
            }
        }
        Self { names, hidden, year: world.cast_date()[0] }
    }
    pub fn check(&self, task: &AiTask, proposal: &Proposal) -> Result<(), String> {
        let TaskExtra::F9(ctx) = &task.extra else {
            return Err("ai.context".into());
        };
        if let Some(offline) = &task.offline
            && offline.body_json() == proposal.body_json()
        {
            return Ok(());
        }
        let texts = prose(proposal);
        let mut names = self.names.clone();
        // 术语使用 key=名称 的显式登记；长篇说明不能自动成为任意子串的许可。
        if let Some(terms) = task.vars.get("world_terms") {
            for line in terms.lines() {
                if let Some((key, name)) = line.split_once('=')
                    && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                    && !name.is_empty()
                {
                    names.push(name.trim().into());
                }
            }
        }
        for key in ["person", "loc", "event", "protagonist"] {
            if let Some(v) = ctx.params.get(key) {
                names.push(v.clone());
            }
        }
        if let Some(glossary) = task.vars.get("glossary") {
            for line in glossary.lines() {
                if let Some((source, display)) = line.split_once(" = ")
                    && names.iter().any(|name| name == source)
                {
                    names.push(display.into());
                }
            }
        }
        names.retain(|n| !n.trim().is_empty());
        names.sort_by_key(|n| std::cmp::Reverse(n.len()));
        names.dedup();
        let trusted = task
            .vars
            .iter()
            .filter(|(key, _)| ["summary", "memory", "persona"].contains(&key.as_str()))
            .map(|(_, v)| v.as_str())
            .chain(ctx.params.values().map(String::as_str))
            .collect::<Vec<_>>();
        let numbers: BTreeSet<&str> =
            trusted.iter().flat_map(|s| s.split(|c: char| !c.is_ascii_digit())).filter(|s| !s.is_empty()).collect();
        let mut atoms: Vec<String> = trusted
            .iter()
            .flat_map(|s| s.split(['。', '！', '？', '；', '\n', '"', '{', '}', ':', ',']))
            .map(str::trim)
            .filter(|s| s.chars().count() >= 2)
            .map(str::to_owned)
            .collect();
        if let Some(offline) = &task.offline {
            atoms.extend(prose(offline).into_iter().map(str::to_owned));
        }
        atoms.retain(|a| !self.hidden.iter().any(|name| !name.is_empty() && a.contains(name)));
        atoms.sort_by_key(|a| std::cmp::Reverse(a.len()));
        atoms.dedup();
        for text in texts {
            if self.hidden.iter().any(|name| !name.is_empty() && text.contains(name) && !names.contains(name)) {
                return Err("ai.unknown_name".into());
            }
            let lower = text.to_lowercase();
            if ["给你", "送你", "赠予", "获得", "gain", "give you", "reward"].iter().any(|v| lower.contains(v))
                && ["金币", "金钱", "钱币", "gold", "coins", "cash"].iter().any(|v| lower.contains(v))
            {
                return Err("ai.reward_claim".into());
            }
            if !covered(text, &names, &atoms, &numbers, self.year) {
                return Err("ai.unknown_name".into());
            }
        }
        Ok(())
    }
}

pub fn prose(p: &Proposal) -> Vec<&str> {
    match p {
        Proposal::Persona(p) => vec![&p.reply],
        Proposal::Narration(p) | Proposal::AltChronicle(p) | Proposal::Diary(p) => vec![&p.text],
        Proposal::Letter(p) => vec![&p.text],
        Proposal::Ripple(p) => std::iter::once(p.summary.as_str())
            .chain(p.events.iter().flat_map(|e| [e.title.as_str(), e.narrative.as_str()]))
            .collect(),
        _ => Vec::new(),
    }
}

// 这里只许可通用语法与日常用语；角色、地名、团体、作品等必须整词来自本次已知目录或事实短句。
const WORDS: &str = "占位 你好 您好 谢谢 多谢 感谢 不客气 请问 请说 继续 可以 不行 同意 拒绝 知道 明白 记得 听说 见过 见面 谈谈 说过 说话 告诉 帮忙 帮助 需要 愿意 感到 相信 希望 担心 高兴 认真 小心 谨慎 安全 平安 准备 学习 练习 读书 休息 等待 出发 到达 回来 离开 走过 看到 发生 结束 开始 完成 约定 记下 想起 想到 忘记 保重 原来 现在 今天 昨天 明天 当时 后来 终于 仍然 已经 尚未 暂时 可能 也许 因为 所以 但是 不过 然后 如果 虽然 一起 还是 只是 还有 没有 不要 不必 不能 不会 应当 这里 那里 这次 那次 此事 那件事 事情 结果 消息 来信 书信 日记 往事 朋友 同学 老师 家人 船员 商人 学院 家里 港口 船上 路上 海上 天气 风雨 课程 任务 请托 月份 一年 一月 一天 一些 许多 一点 大家 我们 你们 他们 她们 自己 对方 彼此 我 你 您 他 她 它 这 那 的 地 得 了 着 过 是 在 和 与 或 也 都 就 又 再 很 更 最 还 才 先 后 但 而 为 从 向 到 把 被 让 给 要 会 能 可 不 没 有 无 上 下 中 内 外 前 后 年 月 日 啊 呢 吧 吗 好 嗯 i you we they he she it the a an this that our your their my his her is are was were be been have has had can could will would should may might not no yes and or but so because if then here there now today yesterday tomorrow before after again still already know understand remember think thought hear heard see saw say said tell told ask asked thank thanks please hello welcome friend friends help need want wait study learn read write wrote letter diary news event result finished began together carefully perhaps maybe";

// 带重音的拉丁字母也属于同一单词，名称与普通词不能在无分隔符时拼接。
fn latin_letter(c: char) -> bool {
    c.is_alphabetic() && ((c as u32) <= 0x024f || (0x1e00..=0x1eff).contains(&(c as u32)))
}

fn covered(text: &str, names: &[String], atoms: &[String], numbers: &BTreeSet<&str>, year: u32) -> bool {
    let mut positions = BTreeSet::from([0]);
    let words: Vec<_> = WORDS.split_whitespace().collect();
    for (at, c) in text.char_indices() {
        if !positions.contains(&at) {
            continue;
        }
        let rest = &text[at..];
        if c.is_whitespace() || "，。！？；：、,.!?;:'\"()（）[]【】—-…/".contains(c) {
            positions.insert(at + c.len_utf8());
        }
        if c.is_ascii_digit() {
            let len = rest.bytes().take_while(u8::is_ascii_digit).count();
            let token = &rest[..len];
            let future = token.len() == 4 && token.parse::<u32>().is_ok_and(|n| n > year && n < 3000);
            if !future && numbers.contains(token) {
                positions.insert(at + len);
            }
        }
        for token in names.iter().chain(atoms).map(String::as_str).chain(words.iter().copied()) {
            if rest.starts_with(token) {
                let latin = token.chars().last().is_some_and(latin_letter);
                if !latin || rest.get(token.len()..).and_then(|s| s.chars().next()).is_none_or(|c| !latin_letter(c)) {
                    positions.insert(at + token.len());
                }
            }
        }
        // 英文句首大小写不改变许可词；不把未知的大写词当作普通词吞掉。
        if c.is_ascii_alphabetic() {
            let len = rest.bytes().take_while(u8::is_ascii_alphabetic).count();
            if words.contains(&rest[..len].to_lowercase().as_str())
                && rest.get(len..).and_then(|s| s.chars().next()).is_none_or(|next| !latin_letter(next))
            {
                positions.insert(at + len);
            }
        }
    }
    positions.contains(&text.len())
}
