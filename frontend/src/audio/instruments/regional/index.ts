// 地方乐器的索引：每件乐器一个文件（见 types.ts 的说明），这里登记、汇总成乐器表与鼓点表，并能把每件乐器的音色样本写成一份临时的曲谱。
// 新乐器：写好文件后在 REGIONAL 里按地区加一行即可（键、鼓点名不能与已有的重名，测试会查）。
import type { DrumSpec } from "../../dsp";
import type { Instrument } from "../../instruments";
import type { TrackDef, VoiceDef } from "../../score";
import { AGUNG } from "./agung";
import { ATARIGANE } from "./atarigane";
import { AYOTL } from "./ayotl";
import { BABENDIL } from "./babendil";
import { AYOYOTL } from "./ayoyotl";
import { BANGDI } from "./bangdi";
import { BANGU } from "./bangu";
import { BANSURI } from "./bansuri";
import { BELEMBAOTUYAN } from "./belembaotuyan";
import { BENDIR } from "./bendir";
import { BIWA } from "./biwa";
import { BO } from "./bo";
import { BOMBO } from "./bombo";
import { BONANG } from "./bonang";
import { BORU } from "./boru";
import { BUZUQ } from "./buzuq";
import { CEVGEN } from "./cevgen";
import { CHAJCHAS } from "./chajchas";
import { CHARANGO } from "./charango";
import { CHENDA } from "./chenda";
import { BONE_FLUTE } from "./boneFlute";
import { CHICAHUAZTLI } from "./chicahuaztli";
import { CHIRIMIA } from "./chirimia";
import { CONCH } from "./conch";
import { DAF } from "./daf";
import { CHING } from "./ching";
import { DABAKAN } from "./dabakan";
import { DADI } from "./dadi";
import { DALUO } from "./daluo";
import { DAN_BAU } from "./danBau";
import { DAN_NGUYET } from "./danNguyet";
import { DAN_TRANH } from "./danTranh";
import { DARBUKA } from "./darbuka";
import { DAVUL } from "./davul";
import { DOTARA } from "./dotara";
import { EDAKKA } from "./edakka";
import { EHECACHICHTLI } from "./ehecachichtli";
import { ERHU } from "./erhu";
import { GAMBANG } from "./gambang";
import { GANDINGAN } from "./gandingan";
import { GAKUBIWA } from "./gakubiwa";
import { GAKUSO } from "./gakuso";
import { FAATETE } from "./faatete";
import { GARAMUT } from "./garamut";
import { GENDER } from "./gender";
import { GIMBRI } from "./gimbri";
import { GONG_AGENG } from "./gongAgeng";
import { GUQIN } from "./guqin";
import { GUQIN_FAN } from "./guqinFan";
import { GUQIN_ZOU } from "./guqinZou";
import { HICHIRIKI } from "./hichiriki";
import { HNE } from "./hne";
import { GUIRO } from "./guiro";
import { HUEHUETL } from "./huehuetl";
import { HYOSHIGI } from "./hyoshigi";
import { JAHLAH } from "./jahlah";
import { KAKKO } from "./kakko";
import { ILILI } from "./ilili";
import { IPU } from "./ipu";
import { KAEKEEKE } from "./kaekeeke";
import { KALAAU } from "./kalaau";
import { KALIMBA } from "./kalimba";
import { KAMANCHEH } from "./kamancheh";
import { GHATAM } from "./ghatam";
import { JALTARANG } from "./jaltarang";
import { KANJIRA } from "./kanjira";
import { KANUN } from "./kanun";
import { KAYAMBA } from "./kayamba";
import { KEMENCE } from "./kemence";
import { KEMPUL } from "./kempul";
import { KENDANG } from "./kendang";
import { KENONG } from "./kenong";
import { KOS } from "./kos";
import { KOTO } from "./koto";
import { KUDUM } from "./kudum";
import { MIRWAS } from "./mirwas";
import { MIZMAR } from "./mizmar";
import { LAOUTO } from "./laouto";
import { LYRA } from "./lyra";
import { NAKKARE } from "./nakkare";
import { MRIDANGAM } from "./mridangam";
import { NADASWARAM } from "./nadaswaram";
import { NAQQARA } from "./naqqara";
import { KULTRUN } from "./kultrun";
import { MARACAS } from "./maracas";
import { MAYOHUACAN } from "./mayohuacan";
import { MBARAKA } from "./mbaraka";
import { KUNDU } from "./kundu";
import { LALI } from "./lali";
import { NAY } from "./nay";
import { NGOMA } from "./ngoma";
import { NOHKAN } from "./nohkan";
import { OCARINA } from "./ocarina";
import { OTTU } from "./ottu";
import { PAKHAVAJ } from "./pakhavaj";
import { KETHUK } from "./kethuk";
import { KHLUI } from "./khlui";
import { KHONG_WONG } from "./khongWong";
import { KLONG_THAT } from "./klongThat";
import { KUDYAPI } from "./kudyapi";
import { KULINTANG } from "./kulintang";
import { KYI_WAING } from "./kyiWaing";
import { MO } from "./mo";
import { PAT_MA } from "./patMa";
import { PAT_WAING } from "./patWaing";
import { OTSUZUMI } from "./otsuzumi";
import { PAIBAN } from "./paiban";
import { OMICHICAHUAZTLI } from "./omichicahuaztli";
import { OHE_HANO_IHU } from "./oheHanoIhu";
import { PAHU } from "./pahu";
import { PATE } from "./pate";
import { PAX } from "./pax";
import { PHACH } from "./phach";
import { PI_NAI } from "./piNai";
import { PIPA } from "./pipa";
import { QRAQEB } from "./qraqeb";
import { QUDI } from "./qudi";
import { PUTUTU } from "./pututu";
import { PU } from "./pu";
import { PUNIU } from "./puniu";
import { QUENA } from "./quena";
import { RABAB } from "./rabab";
import { RANAT_EK } from "./ranatEk";
import { RANAT_THUM } from "./ranatThum";
import { REBAB } from "./rebab";
import { RIQ } from "./riq";
import { RYUTEKI } from "./ryuteki";
import { SANTOOR } from "./santoor";
import { SANTUR } from "./santur";
import { RUDRA_VEENA } from "./rudraVeena";
import { SARANGI } from "./sarangi";
import { SENI_RABAB } from "./seniRabab";
import { SARASWATI_VEENA } from "./saraswatiVeena";
import { SANXIAN } from "./sanxian";
import { SARON } from "./saron";
import { SETAR } from "./setar";
import { SAO_TRUC } from "./saoTruc";
import { SAUNG_GAUK } from "./saungGauk";
import { SAW_U } from "./sawU";
import { SHAKUHACHI } from "./shakuhachi";
import { SHAMISEN } from "./shamisen";
import { SHEHNAI } from "./shehnai";
import { SHENG } from "./sheng";
import { SHIME } from "./shime";
import { SHINOBUE } from "./shinobue";
import { SHO } from "./sho";
import { SHOKO } from "./shoko";
import { SIKU } from "./siku";
import { SIMSIMIYYA } from "./simsimiyya";
import { SITAR } from "./sitar";
import { SITER } from "./siter";
import { SI_WA } from "./siWa";
import { SLENTHEM } from "./slenthem";
import { SONAJA } from "./sonaja";
import { SULING } from "./suling";
import { SUONA } from "./suona";
import { TABL } from "./tabl";
import { TABLA } from "./tabla";
import { TABLA_E } from "./tablaE";
import { TAIKO } from "./taiko";
import { TALAM } from "./talam";
import { TABOCA } from "./taboca";
import { TAKUAPU } from "./takuapu";
import { TANGGU } from "./tanggu";
import { TANPURA } from "./tanpura";
import { TAR } from "./tar";
import { TARI } from "./tari";
import { TARKA } from "./tarka";
import { TASFIQ } from "./tasfiq";
import { TOMBAK } from "./tombak";
import { THAVIL } from "./thavil";
import { TAPHON } from "./taphon";
import { TERBANG } from "./terbang";
// 第九批 A01（2026-11-11）：四件补的地方音色——古筝、埙、坦布尔、甘布斯
import { GAMBUS } from "./gambus";
import { GUZHENG } from "./guzheng";
import { TANBUR } from "./tanbur";
import { XUN } from "./xun";
import { TRONG_COM } from "./trongCom";
import { TSURIDAIKO } from "./tsuridaiko";
import { TEPONAZTLI } from "./teponaztli";
import { TINYA } from "./tinya";
import { TLAPITZALLI } from "./tlapitzalli";
import { TRUTRUKA } from "./trutruka";
import { TSUZUMI } from "./tsuzumi";
import { TUNKUL } from "./tunkul";
import type { RegionalDef } from "./types";
import { UD } from "./ud";
import { WANKARA } from "./wankara";
import { UKEKE } from "./ukeke";
import { ULIULI } from "./uliuli";
import { XIAO } from "./xiao";
import { XIAOLUO } from "./xiaoluo";
import { YANGQIN } from "./yangqin";
import { ZIL } from "./zil";
import { YUNLUO } from "./yunluo";
import { ZUMARI } from "./zumari";
import { ZURNA } from "./zurna";
// 第二阶段：文艺复兴的伊比利亚与意大利
import { ADUFE } from "./adufe";
import { BAJON } from "./bajon";
import { CASTANETS } from "./castanets";
import { CORNETT } from "./cornett";
import { GAMBA } from "./gamba";
import { LIUTO } from "./liuto";
import { NAKERS } from "./nakers";
import { ORGANETTO } from "./organetto";
import { PIPE_TABOR } from "./pipeTabor";
import { REC_ALTO } from "./recAlto";
import { REC_BASS } from "./recBass";
import { REC_SOPRANO } from "./recSoprano";
import { REC_TENOR } from "./recTenor";
import { REGAL } from "./regal";
import { SACKBUT } from "./sackbut";
import { SHAWM } from "./shawm";
import { TAMBURELLO } from "./tamburello";
import { VIHUELA } from "./vihuela";
// 北欧（第二阶段）
import { BAGPIPE } from "./bagpipe";
import { BANDORA } from "./bandora";
import { BEIAARD } from "./beiaard";
import { BUBEN } from "./buben";
import { BUKKEHORN } from "./bukkehorn";
import { CORNEMUSE } from "./cornemuse";
import { CRUMHORN } from "./crumhorn";
import { GALOUBET } from "./galoubet";
import { GUDOK } from "./gudok";
import { GUSLI } from "./gusli";
import { HURDY_DRONE } from "./hurdyDrone";
import { HURDYGURDY } from "./hurdygurdy";
import { KOLOKOL } from "./kolokol";
import { LANGELEIK } from "./langeleik";
import { LOZHKI } from "./lozhki";
import { NYCKELHARPA } from "./nyckelharpa";
import { PIPE_DRONE } from "./pipeDrone";
import { REBECK } from "./rebeck";
import { ROMMELPOT } from "./rommelpot";
import { TABOR_PIPE } from "./taborPipe";
import { TABORIN } from "./taborin";
import { TAMBOURIN } from "./tambourin";
import { TRESHCHOTKA } from "./treshchotka";
import { TROMMEL } from "./trommel";
import { VIRGINAL } from "./virginal";
import { ZHALEIKA } from "./zhaleika";
// 第二阶段·非洲：埃塞俄比亚高原、刚果与安哥拉、几内亚海岸
import { BALAFON } from "./balafon";
import { BEGENA } from "./begena";
import { CHEBCHEBBA } from "./chebchebba";
import { DJEMBE } from "./djembe";
import { DUNDUN } from "./dundun";
import { GANGAN } from "./gangan";
import { KEBERO } from "./kebero";
import { KORA } from "./kora";
import { KRAR } from "./krar";
import { LIKEMBE } from "./likembe";
import { MADIMBA } from "./madimba";
import { MASENQO } from "./masenqo";
import { MPUNGI } from "./mpungi";
import { NGOMA_KONGO } from "./ngomaKongo";
import { NGONGI } from "./ngongi";
import { NGONI } from "./ngoni";
import { NKONKO } from "./nkonko";
import { NSAKALA } from "./nsakala";
import { NSAMBI } from "./nsambi";
import { SHEKERE } from "./shekere";
import { TAMBIN } from "./tambin";
import { TSENATSIL } from "./tsenatsil";
import { WASHINT } from "./washint";
// 第二阶段·非洲（评审后补）：贝宁湾的埃多与约鲁巴
import { AKPATA } from "./akpata";
import { EGOGO } from "./egogo";
import { GUDUGUDU } from "./gudugudu";
import { IYA_ILU } from "./iyaIlu";
// 第二阶段：朝鲜、琉球、女真与满洲
import { BUK } from "./buk";
import { BUREN } from "./buren";
import { DAEGEUM } from "./daegeum";
import { EISA_DAIKO } from "./eisaDaiko";
import { GAYAGEUM } from "./gayageum";
import { GEOMUNGO } from "./geomungo";
import { HAEGEUM } from "./haegeum";
import { JANGGU } from "./janggu";
import { JING } from "./jing";
import { KKWAENGGWARI } from "./kkwaenggwari";
import { KUCHO } from "./kucho";
import { MUKUN } from "./mukun";
import { PARANKU } from "./paranku";
import { PIRI } from "./piri";
import { SANBA } from "./sanba";
import { SANSHIN } from "./sanshin";
import { SISA } from "./sisa";
import { TAEPYEONGSO } from "./taepyeongso";
import { YEMCEN } from "./yemcen";
import { YUBIBUE } from "./yubibue";

export type { DemoDrum, Region, RegionalDef, RegionalDemo } from "./types";

/** 全部地方乐器（按地区排）。 */
export const REGIONAL: readonly RegionalDef[] = [
  // 日本
  SHAMISEN, KOTO, BIWA, SHAKUHACHI, SHINOBUE, RYUTEKI, HICHIRIKI, TAIKO, SHIME, TSUZUMI, HYOSHIGI, ATARIGANE,
  // 明
  ERHU, PIPA, YANGQIN, BANGDI, XIAO, SUONA, SHENG, XIAOLUO, DALUO, BO, TANGGU, BANGU,
  // 东亚宫廷（第二阶段）：日本的雅乐与能乐；明的文人与节庆
  SHO, GAKUBIWA, GAKUSO, KAKKO, TSURIDAIKO, SHOKO, NOHKAN, OTSUZUMI, GUQIN, GUQIN_FAN, GUQIN_ZOU, QUDI, DADI, YUNLUO, PAIBAN,
  // 东亚宫廷（复核）：南音的三弦
  SANXIAN,
  // 第九批 A01：茶楼与夜船的古筝、埙
  GUZHENG, XUN,
  // 奥斯曼与阿拉伯
  UD, KANUN, NAY, KEMENCE, ZURNA, DARBUKA, BENDIR, KUDUM, DAVUL,
  // 奥斯曼军乐（梅赫特）与爱琴海、黎凡特（第二阶段）
  KOS, NAKKARE, ZIL, BORU, CEVGEN, LYRA, LAOUTO, BUZUQ,
  // 第九批 A01：奥斯曼古典音乐的坦布尔（咖啡馆的独奏）
  TANBUR,
  // 印度
  SITAR, TANPURA, SANTOOR, BANSURI, SHEHNAI, TABLA,
  // 印度（第二阶段）：莫卧儿宫廷——德鲁帕德（鲁德拉维纳琴、拉巴卜、帕卡瓦吉）、萨朗吉、宫门鼓楼的纳卡拉
  RUDRA_VEENA, SENI_RABAB, SARANGI, PAKHAVAJ, NAQQARA,
  // 印度（第二阶段）：南印度的卡纳提克音乐与马拉巴尔、喀拉拉——维纳琴、大乐队（纳达斯瓦拉姆、奥图、塔维尔、小钹）、音乐会的打击乐、水碗、伊达卡与琴达
  SARASWATI_VEENA, NADASWARAM, OTTU, THAVIL, TALAM, MRIDANGAM, KANJIRA, GHATAM, JALTARANG, EDAKKA, CHENDA,
  // 印度（第二阶段）：孟加拉的船歌；萨 = E 的曲子用的塔布拉（右手鼓调在 E4）
  DOTARA, TABLA_E,
  // 爪哇与马来
  SARON, BONANG, GENDER, KENONG, KEMPUL, GONG_AGENG, SULING, REBAB, KENDANG,
  // 安第斯
  QUENA, SIKU, TARKA, CHARANGO, BOMBO, CHAJCHAS,
  WANKARA, // 第二阶段·美洲：万卡拉大鼓
  TINYA, // 第二阶段·美洲：廷亚小鼓
  PUTUTU, // 第二阶段·美洲：普图图海螺号
  KULTRUN, // 第二阶段·美洲：库尔特伦鼓（马普切）
  TRUTRUKA, // 第二阶段·美洲：特鲁特鲁卡长号（马普切）
  // 玛雅
  OCARINA, CONCH, TUNKUL, AYOTL, PAX, SONAJA,
  CHIRIMIA, // 第二阶段·美洲：奇里米亚木管
  // 斯瓦希里海岸
  KALIMBA, ZUMARI, TARI, NGOMA, KAYAMBA,
  // 文艺复兴的伊比利亚与意大利（第二阶段）
  VIHUELA, LIUTO, SHAWM, BAJON, SACKBUT, CORNETT, REC_SOPRANO, REC_ALTO, REC_TENOR, REC_BASS, GAMBA, PIPE_TABOR, ORGANETTO, REGAL, CASTANETS, ADUFE, TAMBURELLO, NAKERS,
  // 北欧（第二阶段）：低地国家、英格兰、法兰西、汉萨与斯堪的纳维亚、罗斯
  BAGPIPE, PIPE_DRONE, CRUMHORN, BEIAARD, VIRGINAL, ROMMELPOT, TROMMEL,
  TABOR_PIPE, TABORIN, REBECK, BANDORA,
  HURDYGURDY, HURDY_DRONE, CORNEMUSE, GALOUBET, TAMBOURIN,
  NYCKELHARPA, LANGELEIK, BUKKEHORN,
  GUDOK, GUSLI, ZHALEIKA, KOLOKOL, LOZHKI, TRESHCHOTKA, BUBEN,
  // 阿拉伯（埃及与马穆鲁克、红海、海湾）
  RIQ, MIZMAR, TABL, TASFIQ, SIMSIMIYYA, MIRWAS, JAHLAH,
  // 波斯
  SANTUR, TAR, SETAR, KAMANCHEH, TOMBAK, DAF,
  // 马格里布与安达卢斯
  RABAB, GIMBRI, QRAQEB,
  // 埃塞俄比亚高原与非洲之角（第二阶段）
  KRAR, MASENQO, BEGENA, WASHINT, KEBERO, CHEBCHEBBA, TSENATSIL,
  // 刚果与安哥拉（第二阶段）
  MADIMBA, LIKEMBE, NSAMBI, MPUNGI, NGOMA_KONGO, NGONGI, NKONKO, NSAKALA,
  // 几内亚海岸：曼丁的格里奥与贝宁湾（第二阶段）
  KORA, NGONI, BALAFON, TAMBIN, DJEMBE, DUNDUN, GANGAN, SHEKERE,
  // 几内亚海岸：贝宁湾的埃多与约鲁巴（第二阶段，评审后补）
  AKPATA, EGOGO, IYA_ILU, GUDUGUDU,
  // ───── 第二阶段·中南半岛与菲律宾
  // 暹罗（piphat 与 mahori）
  RANAT_EK, RANAT_THUM, KHONG_WONG, PI_NAI, KHLUI, SAW_U, CHING, TAPHON, KLONG_THAT,
  // 缅甸（hsaing waing 与宫廷的弯琴）
  PAT_WAING, KYI_WAING, HNE, SAUNG_GAUK, SI_WA, PAT_MA,
  // 大越（丝竹）
  DAN_TRANH, DAN_BAU, DAN_NGUYET, SAO_TRUC, PHACH, MO, TRONG_COM,
  // 菲律宾南部（库林唐锣乐与船形琴）
  KULINTANG, AGUNG, GANDINGAN, KUDYAPI, BABENDIL, DABAKAN,
  // 爪哇宫廷的软合奏（甘美兰的补充，地区仍记作爪哇与马来）
  GAMBANG, SITER, SLENTHEM, KETHUK, TERBANG,
  // 第九批 A01：马来世界的甘布斯（扎宾舞的领奏）
  GAMBUS,
  // 朝鲜
  GAYAGEUM, GEOMUNGO, HAEGEUM, DAEGEUM, PIRI, TAEPYEONGSO, JANGGU, BUK, KKWAENGGWARI, JING,
  // 琉球
  SANSHIN, KUCHO, SANBA, EISA_DAIKO, PARANKU, YUBIBUE,
  // 女真与满洲（东北的边地）
  YEMCEN, SISA, BUREN, MUKUN,
  // 阿兹特克（墨西加）——第二阶段·美洲
  TEPONAZTLI, // 特波纳兹特利（两音的裂缝木鼓）
  HUEHUETL, // 韦韦特尔立鼓
  AYOYOTL, // 果壳串
  CHICAHUAZTLI, // 响杖
  OMICHICAHUAZTLI, // 骨刮
  TLAPITZALLI, // 陶笛（双气室）
  EHECACHICHTLI, // 风哨
  // 加勒比的泰诺——第二阶段·美洲
  MAYOHUACAN, // 马约瓦坎木鼓
  MARACAS, // 马拉卡沙槌
  GUIRO, // 刮瓜
  BONE_FLUTE, // 骨笛
  // 巴西的图皮——第二阶段·美洲
  MBARAKA, // 姆巴拉卡圣沙铃
  TABOCA, // 塔博卡竹笛
  TAKUAPU, // 塔夸普跺地竹筒
  // 太平洋（波利尼西亚、美拉尼西亚、密克罗尼西亚）
  PAHU, IPU, PUNIU, OHE_HANO_IHU, PATE, FAATETE, LALI, PU, KAEKEEKE, UKEKE, ULIULI, ILILI, KALAAU, KUNDU, GARAMUT, BELEMBAOTUYAN,
];

/** 地方乐器的乐器表（键 → 参数），合进 instruments.ts 的 INSTRUMENTS。 */
export const REGIONAL_INSTRUMENTS: Readonly<Record<string, Instrument>> = Object.fromEntries(
  REGIONAL.filter((d) => d.key && d.instrument).map((d) => [d.key as string, d.instrument as Instrument]),
);

/** 地方乐器的鼓点表（名字 → 参数），合进 instruments.ts 的 DRUMS。 */
export const REGIONAL_DRUMS: Readonly<Record<string, DrumSpec>> = Object.fromEntries(REGIONAL.flatMap((d) => Object.entries(d.drums ?? {})));

/** 乐器的标识：有键用键，只有鼓点的用第一个鼓点名（试听台与报告用）。 */
export function regionalId(def: RegionalDef): string {
  return def.key ?? Object.keys(def.drums ?? {})[0] ?? def.name.en;
}

/**
 * 音色样本写成一份临时的曲谱（4/4 拍，一段，奏一遍）：旋律给乐器自己的声部，打击乐每层一个声部（inst: "perc"）。
 * 声部音量 0.5、力度 0.8、混响 0.2——与校准音量时同一把尺子，样本之间可以直接比响度。
 */
export function demoTrack(def: RegionalDef): TrackDef {
  const id = regionalId(def);
  const voices: Record<string, VoiceDef> = {};
  const lines: Record<string, string> = {};
  const play: string[] = [];
  if (def.key && def.demo.abc) {
    voices.v = { inst: def.key, gain: 0.5, pan: 0, reverb: 0.2 };
    lines.m = def.demo.abc;
    play.push("m:v");
  }
  (def.demo.drum ?? []).forEach((d, i) => {
    voices[`d${i}`] = { inst: "perc", gain: 0.5, pan: 0, reverb: 0.2, pattern: { kind: "drum", steps: d.steps, hits: d.hits, ...(d.grid ? { grid: d.grid } : {}) } };
    play.push(`d${i}`);
  });
  return {
    id: `demo-${id}`,
    title: { zh: def.name.zh, en: def.name.en },
    qpm: def.demo.qpm,
    meter: [4, 4],
    key: def.demo.key,
    voices,
    sections: { A: { bars: def.demo.bars, lines } },
    forms: [[{ s: "A", play: play.join(" "), dyn: 0.8 }]],
    rest: [0, 0],
  };
}
