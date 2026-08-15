import type { WeaponId } from "./state";
import type { EnemyKind } from "./world";

export interface WeaponProfile {
  readonly damage: number;
  readonly range: number;
  readonly stamina: number;
  readonly cooldown: number;
}

export const WEAPON_PROFILES: Readonly<Record<WeaponId, WeaponProfile>> = {
  improvisada: { damage: 13, range: 2.4, stamina: 8, cooldown: 0.46 },
  lança: { damage: 28, range: 4.1, stamina: 11, cooldown: 0.46 },
  machado: { damage: 38, range: 2.8, stamina: 18, cooldown: 0.78 },
  arco: { damage: 34, range: 34, stamina: 10, cooldown: 0.65 },
};

export function weaponRange(weapon: WeaponId, thrown: boolean): number {
  return weapon === "lança" && thrown ? 24 : WEAPON_PROFILES[weapon].range;
}

export function calculateDamage(options: {
  readonly weapon: WeaponId;
  readonly target: EnemyKind;
  readonly charged: boolean;
  readonly aerial: boolean;
  readonly targetBelowHalfHealth: boolean;
}): number {
  const { weapon, target, charged, aerial, targetBelowHalfHealth } = options;
  let damage = WEAPON_PROFILES[weapon].damage;
  if (charged) damage *= 1.55;
  if (aerial && weapon !== "arco") damage *= 1.3;
  if (target === "carrapato" && weapon !== "lança" && weapon !== "arco") damage *= 0.55;
  if (target === "alfa" && targetBelowHalfHealth) damage *= 0.82;
  return damage;
}
