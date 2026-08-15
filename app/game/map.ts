export const MAP_HALF_WIDTH = 46;
export const MAP_HALF_LENGTH = 140;
export const PLAYER_GROUND_OFFSET = 0.05;

export const CAMP_POSITION = { x: 0, z: 104 } as const;
export const RUIN_POSITION = { x: 17, z: -2 } as const;
export const CAVITY_POSITION = { x: -20, z: -25 } as const;
export const WOUND_POSITION = { x: 12, z: -47 } as const;

export interface DorsalPlateDefinition {
  readonly x: number;
  readonly z: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly rotation: number;
  readonly crownLift: number;
}

export interface MovementAxes {
  readonly forwardX: number;
  readonly forwardZ: number;
  readonly rightX: number;
  readonly rightZ: number;
}

export interface MineralSeamNode {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface DorsalSpineAnchor {
  readonly side: -1 | 1;
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly radius: number;
}

export function movementAxes(yaw: number): MovementAxes {
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  return {
    forwardX,
    forwardZ,
    rightX: -forwardZ,
    rightZ: forwardX,
  };
}

export function pathCenter(z: number): number {
  return Math.sin(z * 0.036) * 5.8 + Math.sin((z + 28) * 0.017) * 3.2;
}

/** Collectable neural crystal outcrops following both sides of the dorsal seam. */
export const MINERAL_SEAM_NODES: readonly MineralSeamNode[] = Object.freeze(
  Array.from({ length: 22 }, (_, index) => {
    const z = -122 + index * 11.2;
    const side = index % 2 === 0 ? -1 : 1;
    return Object.freeze({
      id: `seam-crystal-${index + 1}`,
      x: pathCenter(z) + side * (24 + Math.sin(index) * 1.8),
      z,
    });
  }),
);

export const DORSAL_SPINE_ANCHORS: readonly DorsalSpineAnchor[] = Object.freeze(
  ([-1, 1] as const).flatMap((side) => Array.from({ length: 12 }, (_, index) => {
    const z = 118 - index * 21;
    return Object.freeze({
      side,
      index,
      x: pathCenter(z) + side * (33 + Math.sin(index * 1.8) * 3.5),
      z,
      height: 7 + (index % 4) * 2.2,
      radius: 1.25 + (index % 3) * 0.28,
    });
  })),
);

/**
 * Dark dorsal plates are shallow, terrain-conforming skin details. Keeping the
 * definitions in the map module lets gameplay audits cover every plate rather
 * than relying on a handful of hand-picked coordinates.
 */
export const DORSAL_PLATES: readonly DorsalPlateDefinition[] = Object.freeze(
  Array.from({ length: 18 }, (_, index) => {
    const z = 118 - index * 14;
    const side = index % 2 === 0 ? -1 : 1;
    const radius = 5.4 + (index % 3) * 0.8;
    return Object.freeze({
      x: pathCenter(z) + side * (17 + (index % 4) * 3.4),
      z,
      radiusX: radius * 1.35,
      radiusZ: radius * 1.9,
      rotation: index * 0.51,
      crownLift: 0.055 + (index % 3) * 0.008,
    });
  }),
);

export function terrainHeight(x: number, z: number): number {
  const pathX = pathCenter(z);
  const transverse = x - pathX * 0.35;
  const spine = Math.exp(-((transverse / 19) ** 2)) * 2.15;
  const plates = Math.sin(z * 0.075) * 0.72 + Math.sin((x + z) * 0.105) * 0.38;
  const smallFacets = Math.sin(x * 0.21) * 0.28 + Math.cos(z * 0.16) * 0.22;
  const shoulderRise = z < -62 ? Math.max(0, Math.abs(x) - 17) * 0.085 : 0;
  const swamp = z > 12 && z < 48
    ? -1.05 * Math.max(0, 1 - Math.hypot((x + 12) / 14, (z - 30) / 22))
    : 0;
  const wound = -0.5 * Math.max(0, 1 - Math.hypot((x - WOUND_POSITION.x) / 9, (z - WOUND_POSITION.z) / 14));
  const edgeRatio = (Math.abs(x) / MAP_HALF_WIDTH) ** 2.65 + (Math.abs(z) / MAP_HALF_LENGTH) ** 5;
  const edgeFall = Math.max(0, edgeRatio - 0.57) * 12.5;
  return 4.7 + spine + plates + smallFacets + shoulderRise + swamp + wound - edgeFall;
}

export function playerGroundHeight(x: number, z: number): number {
  return terrainHeight(x, z) + PLAYER_GROUND_OFFSET;
}

export function isInsideDorso(x: number, z: number, inset = 0): boolean {
  const halfWidth = Math.max(1, MAP_HALF_WIDTH - inset);
  const halfLength = Math.max(1, MAP_HALF_LENGTH - inset * 1.65);
  return (Math.abs(x) / halfWidth) ** 2.8 + (Math.abs(z) / halfLength) ** 5 < 1;
}
