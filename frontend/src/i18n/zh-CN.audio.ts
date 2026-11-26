// 界面字符串（zh-CN）：配乐与环境声——顶栏与开局画面的音乐开关、设置里的“声音”一节。
export const audio = {
  // 音乐开关（按钮的提示与读屏名称）
  musicToggle: "音乐",
  musicOn: "音乐已开，点击静音",
  musicOff: "音乐已关，点击开启",
  musicNow: "正在播放：{title}",
  musicResting: "{title}（间歇中）",
  musicWaiting: "点击画面任意处后开始播放",
  // 正在放的是哪一种编配（跟在曲名后面）
  musicOrchestral: "管弦",
  musicSynth: "复古合成",
  musicStyleTag: "{line} · {style}",
  // 设置：声音
  stSound: "声音",
  stMusicVolume: "音乐音量",
  stAmbienceVolume: "环境声音量（海浪、风雨）",
  stSfxVolume: "音效音量",
  stMute: "静音",
  stBackground: "切到后台时继续播放",
  stStyle: "配乐风格",
  stStyleOrchestral: "管弦（真实乐器）",
  stStyleSynth: "复古合成",
  stStyleLoading: "正在加载管弦乐的采样……加载好之前先放复古合成版。",
  stTrack: "曲目",
  stTrackAuto: "随场景自动选择",
  stSoundHelp:
    "配乐有两种风格：管弦用真实乐器的采样（公有领域的 VSCO 2 管弦乐采样库），按需下载；复古合成由程序实时合成。港口按文化各有一首，海上按海域、暴风雨与海战也各有配乐；环境声都是实时合成的。音效用的是公有领域的录音（Kenney 音效包）。“静音”会连音效一起静掉；只想关音乐时把音乐音量拖到 0。只保存在本机，立即生效。",
} as const;
