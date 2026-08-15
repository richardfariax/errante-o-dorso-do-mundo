import * as THREE from "three";
import type { EnemyKind } from "./world";

export type EnemyState = "patrol" | "perception" | "investigation" | "chase" | "attack" | "retreat" | "stunned" | "return";

export interface EnemyRuntime {
  readonly id: string;
  readonly kind: EnemyKind;
  readonly mesh: THREE.Group;
  readonly home: THREE.Vector3;
  state: EnemyState;
  health: number;
  maxHealth: number;
  attackCooldown: number;
  stateTime: number;
  hitFlash: number;
  defeated: boolean;
  phase: number;
  trapHits: Set<string>;
}

const MAX_HEALTH: Readonly<Record<EnemyKind, number>> = {
  escavador: 72,
  carrapato: 105,
  alado: 58,
  alfa: 320,
};

export function createEnemyRuntime(id: string, kind: EnemyKind, mesh: THREE.Group, home: THREE.Vector3): EnemyRuntime {
  const maxHealth = MAX_HEALTH[kind];
  return {
    id,
    kind,
    mesh,
    home,
    state: kind === "carrapato" ? "return" : "patrol",
    health: maxHealth,
    maxHealth,
    attackCooldown: 1.2,
    stateTime: 0,
    hitFlash: 0,
    defeated: false,
    phase: 0,
    trapHits: new Set<string>(),
  };
}

export function updateEnemyMaterialFeedback(enemy: EnemyRuntime): void {
  enemy.mesh.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
    object.material.emissiveIntensity = enemy.hitFlash > 0 ? 4 : object.name === "weak-point" ? 1.4 : 0.3;
  });
}
