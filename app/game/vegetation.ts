export interface TreePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface TreeSegment {
  readonly start: TreePoint;
  readonly end: TreePoint;
}

export interface FoliageAnchor {
  readonly position: TreePoint;
  readonly direction: TreePoint;
  readonly scale: number;
}

export interface TreeBranch {
  readonly segments: readonly [TreeSegment, TreeSegment];
  readonly twigs: readonly [TreeSegment, TreeSegment];
  readonly foliage: readonly [FoliageAnchor, FoliageAnchor, FoliageAnchor];
}

export interface TreeSkeleton {
  readonly trunk: readonly [TreeSegment, TreeSegment, TreeSegment];
  readonly branches: readonly TreeBranch[];
  readonly roots: readonly TreeSegment[];
  readonly height: number;
}

const add = (a: TreePoint, b: TreePoint): TreePoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: TreePoint, b: TreePoint): TreePoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scalePoint = (point: TreePoint, scale: number): TreePoint => ({ x: point.x * scale, y: point.y * scale, z: point.z * scale });
const lerpPoint = (a: TreePoint, b: TreePoint, t: number): TreePoint => add(a, scalePoint(subtract(b, a), t));
const length = (point: TreePoint): number => Math.hypot(point.x, point.y, point.z);
const normalize = (point: TreePoint): TreePoint => {
  const magnitude = Math.max(0.0001, length(point));
  return scalePoint(point, 1 / magnitude);
};

const seededRandom = (seed: number): (() => number) => {
  let value = Math.abs(Math.floor(seed)) % 2_147_483_647;
  if (value === 0) value = 1;
  return () => {
    value = (value * 16_807) % 2_147_483_647;
    return (value - 1) / 2_147_483_646;
  };
};

function pointAlongTrunk(trunk: readonly TreeSegment[], t: number): TreePoint {
  const scaled = Math.min(0.9999, Math.max(0, t)) * trunk.length;
  const index = Math.min(trunk.length - 1, Math.floor(scaled));
  return lerpPoint(trunk[index].start, trunk[index].end, scaled - index);
}

/** Builds one deterministic, connected low-poly tree skeleton. */
export function generateTreeSkeleton(seed: number, size: number): TreeSkeleton {
  const random = seededRandom(seed);
  const height = (4.4 + random() * 1.25) * size;
  const leanAngle = random() * Math.PI * 2;
  const leanDistance = (0.28 + random() * 0.62) * size;
  const leanX = Math.cos(leanAngle) * leanDistance;
  const leanZ = Math.sin(leanAngle) * leanDistance;
  const trunkPoints: TreePoint[] = [
    { x: 0, y: 0, z: 0 },
    { x: leanX * 0.16 + (random() - 0.5) * 0.12 * size, y: height * 0.34, z: leanZ * 0.16 + (random() - 0.5) * 0.12 * size },
    { x: leanX * 0.5 + (random() - 0.5) * 0.16 * size, y: height * 0.69, z: leanZ * 0.5 + (random() - 0.5) * 0.16 * size },
    { x: leanX + (random() - 0.5) * 0.2 * size, y: height, z: leanZ + (random() - 0.5) * 0.2 * size },
  ];
  const trunk = [
    { start: trunkPoints[0], end: trunkPoints[1] },
    { start: trunkPoints[1], end: trunkPoints[2] },
    { start: trunkPoints[2], end: trunkPoints[3] },
  ] as const;

  const branchCount = 7;
  const crownRotation = random() * Math.PI * 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const branches: TreeBranch[] = [];
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    const heightT = 0.39 + branchIndex / (branchCount - 1) * 0.48 + (random() - 0.5) * 0.035;
    const start = pointAlongTrunk(trunk, heightT);
    const azimuth = crownRotation + branchIndex * goldenAngle + (random() - 0.5) * 0.48;
    const branchLength = size * (1.3 + random() * 1.05) * (1.08 - heightT * 0.28);
    const elbow = add(start, {
      x: Math.cos(azimuth) * branchLength * 0.53,
      y: branchLength * (0.1 + random() * 0.16),
      z: Math.sin(azimuth) * branchLength * 0.53,
    });
    const tipAngle = azimuth + (random() - 0.5) * 0.68;
    const tip = add(elbow, {
      x: Math.cos(tipAngle) * branchLength * 0.47,
      y: branchLength * (0.12 + random() * 0.2) - (branchIndex < 2 ? branchLength * 0.08 : 0),
      z: Math.sin(tipAngle) * branchLength * 0.47,
    });
    const primarySegments = [{ start, end: elbow }, { start: elbow, end: tip }] as const;
    const twigs: TreeSegment[] = [];
    for (let twigIndex = 0; twigIndex < 2; twigIndex += 1) {
      const twigStart = lerpPoint(elbow, tip, 0.38 + twigIndex * 0.3 + random() * 0.08);
      const spread = (twigIndex === 0 ? -1 : 1) * (0.42 + random() * 0.5);
      const twigAngle = tipAngle + spread + (random() - 0.5) * 0.22;
      const twigLength = branchLength * (0.28 + random() * 0.17);
      twigs.push({
        start: twigStart,
        end: add(twigStart, {
          x: Math.cos(twigAngle) * twigLength,
          y: twigLength * (0.25 + random() * 0.38),
          z: Math.sin(twigAngle) * twigLength,
        }),
      });
    }
    const branchDirection = normalize(subtract(tip, elbow));
    const foliageScale = size * (0.5 + random() * 0.2);
    branches.push({
      segments: primarySegments,
      twigs: twigs as [TreeSegment, TreeSegment],
      foliage: [
        { position: tip, direction: branchDirection, scale: foliageScale },
        { position: twigs[0].end, direction: normalize(subtract(twigs[0].end, twigs[0].start)), scale: foliageScale * (0.72 + random() * 0.18) },
        { position: twigs[1].end, direction: normalize(subtract(twigs[1].end, twigs[1].start)), scale: foliageScale * (0.72 + random() * 0.18) },
      ],
    });
  }

  const roots: TreeSegment[] = [];
  const rootRotation = random() * Math.PI * 2;
  for (let rootIndex = 0; rootIndex < 4; rootIndex += 1) {
    const angle = rootRotation + rootIndex * Math.PI / 2 + (random() - 0.5) * 0.34;
    const rootLength = size * (0.72 + random() * 0.48);
    roots.push({
      start: { x: Math.cos(angle) * 0.04, y: 0.09 * size, z: Math.sin(angle) * 0.04 },
      end: { x: Math.cos(angle) * rootLength, y: -0.035 * size, z: Math.sin(angle) * rootLength },
    });
  }

  return { trunk, branches, roots, height };
}
