// 第九批 A01（2026-11-11）多写的曲目的管弦版：编号、曲名、调与合成版（../../tracks/more.ts）一一对应。
import type { TrackDef } from "../../score";
import type { MoreTrackId } from "../../tracks/more";
import { BATTLE_BROADSIDE } from "./battleBroadside";
import { BATTLE_EAST } from "./battleEast";
import { PORT_IBERIA_EVE } from "./portIberiaEve";
import { PORT_ESTUARY } from "./portEstuary";
import { PORT_INDIES } from "./portIndies";
import { PORT_JAPAN_EVE } from "./portJapanEve";
import { PORT_LAGOON } from "./portLagoon";
import { PORT_MALAY_NIGHT } from "./portMalayNight";
import { PORT_MING_TEA } from "./portMingTea";
import { PORT_OTTOMAN_CAFE } from "./portOttomanCafe";
import { PORT_TAARAB } from "./portTaarab";
import { PORT_TOWN } from "./portTown";
import { SEA_AEGEAN } from "./seaAegean";
import { SEA_ATLANTIC } from "./seaAtlantic";
import { SEA_BANKS } from "./seaBanks";
import { SEA_BENGAL } from "./seaBengal";
import { SEA_CANARIES } from "./seaCanaries";
import { SEA_CHANNEL } from "./seaChannel";
import { SEA_FOG } from "./seaFog";
import { SEA_GULF } from "./seaGulf";
import { SEA_KUROSHIO } from "./seaKuroshio";
import { SEA_LANTERNS } from "./seaLanterns";
import { SEA_MALACCA } from "./seaMalacca";
import { SEA_NIGHT } from "./seaNight";
import { SEA_SWAHILI } from "./seaSwahili";
import { SEA_SWELL } from "./seaSwell";
import { SEA_TREASURE } from "./seaTreasure";
import { SEA_TYRRHENIAN } from "./seaTyrrhenian";
import { STORM_GALE } from "./stormGale";
import { STORM_TYPHOON } from "./stormTyphoon";
import { UB_AUTUMN } from "./ubAutumn";
import { UB_FINAL } from "./ubFinal";
import { UB_FOOTSTEPS } from "./ubFootsteps";
import { UB_HEART_WALK } from "./ubHeartWalk";
import { UB_LAMP_OUT } from "./ubLampOut";
import { UB_SPRING } from "./ubSpring";
import { UB_SUMMER } from "./ubSummer";
import { UB_WINTER } from "./ubWinter";

export const ORCH_MORE_TRACKS: Readonly<Record<MoreTrackId, TrackDef>> = {
  sea_atlantic: SEA_ATLANTIC,
  sea_swell: SEA_SWELL,
  sea_night: SEA_NIGHT,
  sea_canaries: SEA_CANARIES,
  sea_tyrrhenian: SEA_TYRRHENIAN,
  sea_aegean: SEA_AEGEAN,
  sea_gulf: SEA_GULF,
  sea_swahili: SEA_SWAHILI,
  sea_channel: SEA_CHANNEL,
  sea_banks: SEA_BANKS,
  sea_kuroshio: SEA_KUROSHIO,
  sea_lanterns: SEA_LANTERNS,
  sea_malacca: SEA_MALACCA,
  sea_treasure: SEA_TREASURE,
  sea_bengal: SEA_BENGAL,
  sea_fog: SEA_FOG,
  storm_gale: STORM_GALE,
  storm_typhoon: STORM_TYPHOON,
  battle_broadside: BATTLE_BROADSIDE,
  battle_east: BATTLE_EAST,
  port_iberia_eve: PORT_IBERIA_EVE,
  port_indies: PORT_INDIES,
  port_japan_eve: PORT_JAPAN_EVE,
  port_ming_tea: PORT_MING_TEA,
  port_ottoman_cafe: PORT_OTTOMAN_CAFE,
  port_malay_night: PORT_MALAY_NIGHT,
  port_town: PORT_TOWN,
  port_lagoon: PORT_LAGOON,
  port_estuary: PORT_ESTUARY,
  port_taarab: PORT_TAARAB,
  ub_spring: UB_SPRING,
  ub_summer: UB_SUMMER,
  ub_autumn: UB_AUTUMN,
  ub_winter: UB_WINTER,
  ub_heart_walk: UB_HEART_WALK,
  ub_lamp_out: UB_LAMP_OUT,
  ub_footsteps: UB_FOOTSTEPS,
  ub_final: UB_FINAL,
};
