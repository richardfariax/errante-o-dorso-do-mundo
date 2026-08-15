import { EVENT_TIMES, type EventId, type WeatherId } from "./state";

export const EVENT_BANNERS: Readonly<Record<EventId, readonly [string, string]>> = {
  despertar: ["DESPERTAR", "Há algo sob a terra."],
  chuva: ["CHUVA MIGRATÓRIA", "O vento muda. Coletores começam a encher."],
  mergulho: ["MERGULHO PARCIAL", "A água invade as regiões baixas. Procure terreno alto."],
  infestacao: ["INFESTAÇÃO", "Parasitas emergem da ferida. Defenda o dorso."],
  encontro: ["OUTRO DORSO", "Uma montanha se move através da neblina."],
  conclusao: ["O DORSO DO MUNDO", "A migração apenas começou."],
};

export interface EventVisualState {
  readonly rainActive: boolean;
  readonly diveProgress: number;
  readonly encounterEmerge: number;
  readonly daylight: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

export function weatherForEvent(event: EventId): WeatherId {
  if (event === "mergulho") return "tempestade";
  if (event === "chuva") return "chuva";
  return "limpo";
}

export function eventVisualState(elapsed: number, event: EventId): EventVisualState {
  const rainActive = event === "chuva" || event === "mergulho";
  const diveProgress = event === "mergulho" ? clamp(1 - Math.abs(elapsed - EVENT_TIMES.divePeak) / 60, 0, 1) : 0;
  const encounterEmerge = event === "encontro" || event === "conclusao" ? clamp((elapsed - EVENT_TIMES.encounter) / 44, 0, 1) : 0;
  const dayPhase = (elapsed % 900) / 900;
  const daylight = clamp(Math.sin(dayPhase * Math.PI * 2 - 0.4) * 0.55 + 0.55, 0.08, 1);
  return { rainActive, diveProgress, encounterEmerge, daylight };
}
