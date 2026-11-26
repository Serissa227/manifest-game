// 生成文件：由 tools/sfx/build.py 写出，不要手改（改素材的挑选与处理请改那个脚本的配方，再重新运行）。
//
// 游戏音效的素材清单。素材来自 Kenney（www.kenney.nl）的五个音效包，许可均为 CC0 1.0（公有领域，不要求署名，这里照样写明出处）：
//   RPG Audio：https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip
//   Interface Sounds (1.0)：https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip
//   Casino Audio (1.1)：https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip
//   Impact Sounds (1.0)：https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip
//   UI SFX Set：https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip
// 炮声的“咚”用了管弦采样里的大鼓（VS Chamber Orchestra: Community Edition，CC0 1.0，见 tools/orchestra/README.md）；
// 炮声的轰鸣与余响、落水与木屑是程序合成的。
// 文件在 frontend/public/audio/sfx/ 下（单声道 MP3，44.1 kHz）；浏览器解码后按 mark 对齐起音（与管弦采样同一个办法，见 orchestra/bank.ts）。

/** 一个文件（一种素材的一个变体）。 */
export interface SfxFile {
  /** 文件名（相对 public/audio/sfx/） */
  file: string;
  /** 播放时乘的增益：把这个文件校到统一的参考响度（K 计权后最响一段的均方根 −20 dB），各事件的音量都相对它来写 */
  gain: number;
  /** 长度（秒） */
  length: number;
  /** 起音标记：|x| 第一次超过峰值 0.5% 的时刻（秒）。解码后的位置减去它就是解码器多出来的延迟 */
  mark: number;
  /** 文件字节数 */
  bytes: number;
  /** 内容哈希（前 8 位，URL 上带着它，换了素材浏览器不会用旧缓存） */
  hash: string;
}

/** 一种素材：几个变体，播放时随机轮换。 */
export interface SfxSampleSet {
  /** 这是什么声音 */
  note: string;
  files: readonly SfxFile[];
}

export const SFX_SAMPLES = {
  "ui.click": {
    note: "按钮：黏土筹码落在呢面上的一下“嗒”，削掉高频（筹码的脆响）与低频，只剩轻轻的、偏木头的一点",
    files: [
      { file: "ui-click-1.mp3", gain: 0.7585, length: 0.048, mark: 0.0016, bytes: 1427, hash: "d34333e6" },
      { file: "ui-click-2.mp3", gain: 0.8668, length: 0.048, mark: 0.0019, bytes: 1427, hash: "cc5b2b87" },
      { file: "ui-click-3.mp3", gain: 1.0972, length: 0.043, mark: 0.0029, bytes: 1375, hash: "1ebe8fea" },
      { file: "ui-click-4.mp3", gain: 0.9, length: 0.043, mark: 0.0024, bytes: 1375, hash: "89b67b71" },
    ],
  },
  "ui.tab": {
    note: "切换页签：翻一页纸",
    files: [
      { file: "ui-tab-1.mp3", gain: 0.8797, length: 0.196, mark: 0.0027, bytes: 3356, hash: "371b8479" },
      { file: "ui-tab-2.mp3", gain: 0.9438, length: 0.223, mark: 0.0022, bytes: 4034, hash: "d6dba7bc" },
      { file: "ui-tab-3.mp3", gain: 0.7059, length: 0.212, mark: 0.0016, bytes: 3330, hash: "ae437e8d" },
    ],
  },
  "ui.open": {
    note: "打开窗口：一张纸滑出来",
    files: [
      { file: "ui-open-1.mp3", gain: 0.8458, length: 0.25, mark: 0.0019, bytes: 3354, hash: "f5144582" },
      { file: "ui-open-2.mp3", gain: 1.0395, length: 0.249, mark: 0.0016, bytes: 3773, hash: "d201ec4c" },
      { file: "ui-open-3.mp3", gain: 0.8702, length: 0.282, mark: 0.0017, bytes: 4087, hash: "97939ba0" },
    ],
  },
  "ui.close": {
    note: "关上窗口：一本薄册子轻轻放下",
    files: [
      { file: "ui-close-1.mp3", gain: 0.3962, length: 0.168, mark: 0.0022, bytes: 2650, hash: "10511b93" },
      { file: "ui-close-2.mp3", gain: 0.4013, length: 0.172, mark: 0.0027, bytes: 2625, hash: "b6bcf2bb" },
      { file: "ui-close-3.mp3", gain: 0.4118, length: 0.169, mark: 0.0024, bytes: 2650, hash: "d5c0de42" },
    ],
  },
  "ui.toggle": {
    note: "开关：黄铜小搭扣“咔哒”一下",
    files: [
      { file: "ui-toggle-1.mp3", gain: 0.4552, length: 0.123, mark: 0.0021, bytes: 2469, hash: "3c865406" },
      { file: "ui-toggle-2.mp3", gain: 0.4677, length: 0.094, mark: 0.0019, bytes: 2209, hash: "840e6492" },
      { file: "ui-toggle-3.mp3", gain: 0.4527, length: 0.083, mark: 0.0004, bytes: 2105, hash: "ad684b7d" },
    ],
  },
  "ui.tick": {
    note: "滑条的档位：极短的一下",
    files: [
      { file: "ui-tick-1.mp3", gain: 1.1527, length: 0.025, mark: 0.0028, bytes: 1270, hash: "356a2583" },
      { file: "ui-tick-2.mp3", gain: 1.0159, length: 0.025, mark: 0.0022, bytes: 1270, hash: "2055735c" },
      { file: "ui-tick-3.mp3", gain: 0.7916, length: 0.025, mark: 0.0015, bytes: 1270, hash: "a39188f8" },
    ],
  },
  "ui.error": {
    note: "操作被拒：两下闷闷的“咚咚”，第二下低一点",
    files: [
      { file: "ui-error-1.mp3", gain: 0.3739, length: 0.306, mark: 0.0024, bytes: 4005, hash: "2435c6be" },
      { file: "ui-error-2.mp3", gain: 0.3755, length: 0.308, mark: 0.003, bytes: 3953, hash: "27a0426b" },
    ],
  },
  "ui.notify": {
    note: "提示：一张纸条放在桌上",
    files: [
      { file: "ui-notify-1.mp3", gain: 1.1956, length: 0.253, mark: 0.0005, bytes: 3565, hash: "d6f61491" },
      { file: "ui-notify-2.mp3", gain: 1.0926, length: 0.241, mark: 0.0015, bytes: 3669, hash: "bdb90423" },
    ],
  },
  "coin.pay": {
    note: "付钱（买入）：几枚金币放上柜台",
    files: [
      { file: "coin-pay-1.mp3", gain: 0.7864, length: 0.301, mark: 0.0016, bytes: 5180, hash: "77cd0018" },
      { file: "coin-pay-2.mp3", gain: 0.6385, length: 0.326, mark: 0.0014, bytes: 5704, hash: "4157aa74" },
      { file: "coin-pay-3.mp3", gain: 0.6532, length: 0.304, mark: 0.0026, bytes: 6254, hash: "df80d644" },
      { file: "coin-pay-4.mp3", gain: 0.7417, length: 0.214, mark: 0.0013, bytes: 4165, hash: "0f06a947" },
    ],
  },
  "coin.take": {
    note: "收钱（卖出）：金币叮当落进钱袋",
    files: [
      { file: "coin-take-1.mp3", gain: 0.6454, length: 0.349, mark: 0.0026, bytes: 6538, hash: "e38def7f" },
      { file: "coin-take-2.mp3", gain: 0.7864, length: 0.369, mark: 0.0013, bytes: 5859, hash: "4eff6fd6" },
      { file: "coin-take-3.mp3", gain: 0.6385, length: 0.329, mark: 0.0014, bytes: 5000, hash: "16dc8278" },
    ],
  },
  "coin.pour": {
    note: "全部卖出：一大把金币哗啦啦倒进钱箱",
    files: [
      { file: "coin-pour-1.mp3", gain: 1.0233, length: 1.069, mark: 0.0016, bytes: 14568, hash: "a5de8810" },
      { file: "coin-pour-2.mp3", gain: 0.9338, length: 1.108, mark: 0.0013, bytes: 15794, hash: "a6540ebb" },
    ],
  },
  "coin.purse": {
    note: "钱不够：空钱袋软软地一拍，没有钱币声",
    files: [
      { file: "coin-purse-1.mp3", gain: 0.6531, length: 0.383, mark: 0.0016, bytes: 4111, hash: "8658ebc0" },
      { file: "coin-purse-2.mp3", gain: 0.7369, length: 0.39, mark: 0.0022, bytes: 4136, hash: "4ed27248" },
    ],
  },
  "sea.chain": {
    note: "起锚：铁链一环环卡过锚链孔，绞盘吱呀",
    files: [
      { file: "sea-chain-1.mp3", gain: 0.4524, length: 1.161, mark: 0.0251, bytes: 13914, hash: "f157f3ec" },
      { file: "sea-chain-2.mp3", gain: 0.4634, length: 1.104, mark: 0.0249, bytes: 13314, hash: "a4a10d28" },
    ],
  },
  "sea.sail": {
    note: "升帆：厚帆布抖开、吃满了风",
    files: [
      { file: "sea-sail-1.mp3", gain: 0.632, length: 1.057, mark: 0.0022, bytes: 9943, hash: "8c448abc" },
      { file: "sea-sail-2.mp3", gain: 0.543, length: 1.162, mark: 0.0021, bytes: 10959, hash: "17d0b4e7" },
    ],
  },
  "sea.rope": {
    note: "抛缆：缆绳甩出去、落在码头上",
    files: [
      { file: "sea-rope-1.mp3", gain: 0.7373, length: 0.564, mark: 0.0015, bytes: 5833, hash: "3ea3606a" },
      { file: "sea-rope-2.mp3", gain: 0.7148, length: 0.659, mark: 0.0035, bytes: 7159, hash: "f1f3d563" },
    ],
  },
  "sea.dock": {
    note: "靠岸：船舷碰上码头的木桩，船板吱呀一声",
    files: [
      { file: "sea-dock-1.mp3", gain: 0.5429, length: 0.587, mark: 0.0004, bytes: 4650, hash: "ed27885e" },
      { file: "sea-dock-2.mp3", gain: 0.4042, length: 0.66, mark: 0.0003, bytes: 5352, hash: "eabf83a8" },
      { file: "sea-dock-3.mp3", gain: 0.43, length: 0.66, mark: 0.0007, bytes: 5719, hash: "3e672956" },
    ],
  },
  "sea.hammer": {
    note: "修船、造船厂：锤子敲在木头上（有的带一点钉子的金属声）",
    files: [
      { file: "sea-hammer-1.mp3", gain: 0.3781, length: 0.224, mark: 0.0004, bytes: 2963, hash: "8e6b3b92" },
      { file: "sea-hammer-2.mp3", gain: 0.3908, length: 0.206, mark: 0.0004, bytes: 2833, hash: "7c8cb801" },
      { file: "sea-hammer-3.mp3", gain: 0.3756, length: 0.246, mark: 0.0004, bytes: 3119, hash: "8eb85a59" },
      { file: "sea-hammer-4.mp3", gain: 0.3913, length: 0.218, mark: 0.0004, bytes: 2571, hash: "a2042a6a" },
    ],
  },
  "sea.step": {
    note: "脚步：踩在甲板上（雇船员时几个人走上船）",
    files: [
      { file: "sea-step-1.mp3", gain: 0.5571, length: 0.187, mark: 0.0007, bytes: 2546, hash: "8abd9ce9" },
      { file: "sea-step-2.mp3", gain: 0.5331, length: 0.194, mark: 0.0008, bytes: 2651, hash: "30354f10" },
      { file: "sea-step-3.mp3", gain: 0.5374, length: 0.198, mark: 0.0028, bytes: 3095, hash: "5d804844" },
      { file: "sea-step-4.mp3", gain: 0.5632, length: 0.182, mark: 0.0021, bytes: 2416, hash: "48f7d2b7" },
    ],
  },
  "sea.crate": {
    note: "补给：粮袋落地、水桶磕一下",
    files: [
      { file: "sea-crate-1.mp3", gain: 0.5131, length: 0.341, mark: 0.0014, bytes: 3615, hash: "d0e06beb" },
      { file: "sea-crate-2.mp3", gain: 0.3677, length: 0.506, mark: 0.0001, bytes: 4133, hash: "a41c5fdf" },
    ],
  },
  "log.close": {
    note: "存档：合上航海日志",
    files: [
      { file: "log-close-1.mp3", gain: 0.5055, length: 0.178, mark: 0.002, bytes: 2678, hash: "78a5fc41" },
      { file: "log-close-2.mp3", gain: 0.4929, length: 0.188, mark: 0.0022, bytes: 2807, hash: "afb94081" },
    ],
  },
  "log.open": {
    note: "读档：翻开航海日志、翻一页",
    files: [
      { file: "log-open-1.mp3", gain: 0.7426, length: 0.315, mark: 0.0015, bytes: 4687, hash: "070909c1" },
      { file: "log-open-2.mp3", gain: 0.7144, length: 0.353, mark: 0.0016, bytes: 5313, hash: "20ea44b5" },
    ],
  },
  "time.stop": {
    note: "暂停：闷闷地扣上搭扣",
    files: [
      { file: "time-stop-1.mp3", gain: 0.4851, length: 0.265, mark: 0.0025, bytes: 3797, hash: "ea5b8026" },
      { file: "time-stop-2.mp3", gain: 0.472, length: 0.289, mark: 0.0027, bytes: 3850, hash: "b4e0bfc7" },
    ],
  },
  "time.go": {
    note: "继续：拨开搭扣",
    files: [
      { file: "time-go-1.mp3", gain: 0.6248, length: 0.123, mark: 0.0007, bytes: 2444, hash: "86658985" },
      { file: "time-go-2.mp3", gain: 0.5138, length: 0.098, mark: 0.002, bytes: 2288, hash: "f3e5641b" },
    ],
  },
  "war.cannon": {
    note: "开炮（近处）",
    files: [
      { file: "war-cannon-1.mp3", gain: 0.6107, length: 2.243, mark: 0.0002, bytes: 12114, hash: "5a6f0558" },
      { file: "war-cannon-2.mp3", gain: 0.518, length: 2.375, mark: 0.0003, bytes: 12659, hash: "bf4a9727" },
      { file: "war-cannon-3.mp3", gain: 0.5159, length: 2.228, mark: 0.0003, bytes: 11775, hash: "c2cecf44" },
    ],
  },
  "war.cannonFar": {
    note: "远处的炮声（自动结算的海战）",
    files: [
      { file: "war-cannonFar-1.mp3", gain: 0.4902, length: 2.407, mark: 0.0002, bytes: 12476, hash: "f219cdd4" },
      { file: "war-cannonFar-2.mp3", gain: 0.4418, length: 2.581, mark: 0.0003, bytes: 13334, hash: "44d05e56" },
    ],
  },
  "war.hit": {
    note: "命中：炮弹打穿船板、木屑飞溅",
    files: [
      { file: "war-hit-1.mp3", gain: 0.4228, length: 0.675, mark: 0.0004, bytes: 5774, hash: "d7f57574" },
      { file: "war-hit-2.mp3", gain: 0.3541, length: 0.704, mark: 0.0003, bytes: 6063, hash: "1eaf1c13" },
      { file: "war-hit-3.mp3", gain: 0.4191, length: 0.573, mark: 0.0004, bytes: 5619, hash: "0b9b1cc0" },
    ],
  },
  "war.splash": {
    note: "落水：炮弹没打中、落进海里（沉船时也用）",
    files: [
      { file: "war-splash-1.mp3", gain: 0.397, length: 0.859, mark: 0.0004, bytes: 8935, hash: "fe935c8b" },
      { file: "war-splash-2.mp3", gain: 0.3983, length: 0.848, mark: 0.0004, bytes: 8909, hash: "2a3ffcdc" },
    ],
  },
  "war.clash": {
    note: "接舷：刀剑相碰",
    files: [
      { file: "war-clash-1.mp3", gain: 0.4833, length: 0.449, mark: 0.002, bytes: 7086, hash: "b051e338" },
      { file: "war-clash-2.mp3", gain: 0.375, length: 0.475, mark: 0.0024, bytes: 7607, hash: "8670aaaf" },
      { file: "war-clash-3.mp3", gain: 0.3021, length: 0.426, mark: 0.0023, bytes: 7580, hash: "d9361d9e" },
    ],
  },
} as const satisfies Readonly<Record<string, SfxSampleSet>>;

/** 素材的键。 */
export type SfxSampleId = keyof typeof SFX_SAMPLES;
