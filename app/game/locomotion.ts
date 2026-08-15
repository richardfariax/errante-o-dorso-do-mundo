export interface LegIKInput {
  readonly hipHeight: number;
  readonly groundOffset: number;
  readonly forwardOffset: number;
  readonly swingLift?: number;
  readonly soleClearance?: number;
  readonly upperLength?: number;
  readonly lowerLength?: number;
}

export interface LegIKSolution {
  readonly hipAngle: number;
  readonly kneeAngle: number;
  readonly ankleCounterAngle: number;
  readonly extension: number;
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

/**
 * Solves a two-bone leg in the character's sagittal plane. The torso remains
 * aligned with gravity; each leg absorbs its own terrain height through the hip
 * and knee, while the ankle counter-rotates so the sole can follow the ground.
 */
export function solveLegIK({
  hipHeight,
  groundOffset,
  forwardOffset,
  swingLift = 0,
  soleClearance = 0.05,
  upperLength = 0.54,
  lowerLength = 0.59,
}: LegIKInput): LegIKSolution {
  const maximumReach = upperLength + lowerLength - 0.002;
  const minimumReach = Math.abs(upperLength - lowerLength) + 0.002;
  const requestedDrop = Math.max(0.05, hipHeight + soleClearance - groundOffset - swingLift);
  const requestedReach = Math.hypot(requestedDrop, forwardOffset);
  const reach = clamp(requestedReach, minimumReach, maximumReach);
  const reachScale = reach / Math.max(requestedReach, 0.0001);
  const targetDrop = requestedDrop * reachScale;
  const targetForward = forwardOffset * reachScale;
  const kneeCosine = clamp(
    (reach * reach - upperLength * upperLength - lowerLength * lowerLength) / (2 * upperLength * lowerLength),
    -1,
    1,
  );
  const kneeAngle = Math.acos(kneeCosine);
  const targetAngle = Math.atan2(-targetForward, targetDrop);
  const chainAngle = Math.atan2(
    lowerLength * Math.sin(kneeAngle),
    upperLength + lowerLength * Math.cos(kneeAngle),
  );
  const hipAngle = targetAngle - chainAngle;
  return {
    hipAngle,
    kneeAngle,
    ankleCounterAngle: -hipAngle - kneeAngle,
    extension: reach / maximumReach,
  };
}

/** Lowers the pelvis vertically when one support foot is below the root. */
export function supportPelvisDrop(leftGroundOffset: number, rightGroundOffset: number): number {
  return clamp(Math.min(leftGroundOffset, rightGroundOffset) + 0.015, -0.12, 0);
}
