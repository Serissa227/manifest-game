// 界面字符串（zh-CN）：AI 肖像接入后新增的人物位——酒馆情报贩子、殖民地总管、各国君主、商会会长、海图上别家船队的船长。
// 这些人物的名字是程序生成的中英成对人名（art/portraitCast.ts），这里只有头衔与分节标题。
// 键名一律以 `cast.` 开头（见 i18n.test.ts）；英文表见 en.cast.ts（键与占位符一一对应）。
export const cast = {
  // 酒馆
  "cast.informant": "情报贩子",
  // 殖民地
  "cast.steward": "殖民地总管",
  // 君主（按势力 key；数据里新加的势力用 other）
  "cast.ruler.cuilan": "国王",
  "cast.ruler.jinsui": "首席执政",
  "cast.ruler.chisha": "苏丹",
  "cast.ruler.bichao": "议会大酋长",
  "cast.ruler.shuangling": "女公爵",
  "cast.ruler.yaohua": "皇帝",
  "cast.ruler.other": "君主",
  // 商会
  "cast.companyHead": "会长",
  // 情报窗口里的人物志
  "cast.roster": "列国君主与商会会长",
  "cast.rosterRulers": "列国君主",
  "cast.rosterCompanies": "商会会长",
  // 海图：悬停别家船队时的信息卡
  "cast.fleetOf": "{company}的船队",
  "cast.fleetMaster": "船长",
} as const;
