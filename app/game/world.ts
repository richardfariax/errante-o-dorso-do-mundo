import * as THREE from "three";
import type { ItemId, StructureId } from "./data";
import {
  CAMP_POSITION,
  CAVITY_POSITION,
  DORSAL_SPINE_ANCHORS,
  DORSAL_PLATES,
  type DorsalPlateDefinition,
  isInsideDorso,
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  MINERAL_SEAM_NODES,
  pathCenter,
  RUIN_POSITION,
  terrainHeight,
  WOUND_POSITION,
} from "./map";
import type { GameSettings } from "./save";
import { generateTreeSkeleton, type TreePoint, type TreeSegment } from "./vegetation";

export { terrainHeight } from "./map";

export type EnemyKind = "escavador" | "carrapato" | "alado" | "alfa";

export interface ResourceNode {
  readonly id: string;
  readonly item: ItemId;
  readonly amount: number;
  readonly object: THREE.Group;
  readonly label: string;
}

export interface WorldObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

export interface WorldVisuals {
  readonly scene: THREE.Scene;
  readonly world: THREE.Group;
  readonly player: THREE.Group;
  readonly head: THREE.Group;
  readonly headEye: THREE.Mesh;
  readonly secondColossus: THREE.Group;
  readonly rain: THREE.LineSegments;
  readonly birds: THREE.Group;
  readonly hookPoints: readonly THREE.Mesh[];
  readonly resources: ResourceNode[];
  readonly wound: THREE.Group;
  readonly terrain: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly ocean: THREE.Mesh;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly wake: THREE.Group;
  readonly treeWindTime: THREE.IUniform<number>;
  readonly obstacles: readonly WorldObstacle[];
  readonly groundMeshes: THREE.Mesh[];
  dispose(): void;
}

const seededRandom = (seed: number): (() => number) => {
  let value = seed % 2_147_483_647;
  if (value <= 0) value += 2_147_483_646;
  return () => {
    value = (value * 16_807) % 2_147_483_647;
    return (value - 1) / 2_147_483_646;
  };
};

function material(color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.86, flatShading: true, ...options });
}

const TERRAIN_UP = new THREE.Vector3(0, 1, 0);

function terrainNormalAt(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  const sampleDistance = 0.42;
  const left = terrainHeight(x - sampleDistance, z);
  const right = terrainHeight(x + sampleDistance, z);
  const back = terrainHeight(x, z - sampleDistance);
  const front = terrainHeight(x, z + sampleDistance);
  return target.set(left - right, sampleDistance * 2, back - front).normalize();
}

function orientToTerrain(object: THREE.Object3D, x: number, z: number, yaw = 0): void {
  object.quaternion.setFromUnitVectors(TERRAIN_UP, terrainNormalAt(x, z));
  object.rotateY(yaw);
}

function createSurfaceTexture(): THREE.Texture {
  const texture = new THREE.TextureLoader().load("/textures/dorso-organico-v2.webp");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.2, 9.4);
  texture.anisotropy = 8;
  return texture;
}

function createTerrain(surfaceTexture: THREE.Texture): THREE.Mesh {
  const xSegments = 64;
  const zSegments = 156;
  const width = MAP_HALF_WIDTH * 2;
  const depth = MAP_HALF_LENGTH * 2;
  const vertices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
    const z = -depth / 2 + (zIndex / zSegments) * depth;
    for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
      const x = -width / 2 + (xIndex / xSegments) * width;
      const y = terrainHeight(x, z);
      vertices.push(x, y, z);
      uvs.push(xIndex / xSegments, zIndex / zSegments);
      if (z > 58) color.set(x > 9 ? "#e0dfbd" : "#d0dfc4");
      else if (z > 12) color.set(x < -2 ? "#c2d6cf" : "#d9ddbb");
      else if (z > -34) color.set("#d2dbca");
      else if (z > -76) color.set(Math.abs(x) > 19 ? "#ded4c3" : "#c7d7c8");
      else color.set(Math.abs(x) > 16 ? "#e0d7c8" : "#c2d0bd");
      const pathDistance = Math.abs(x - pathCenter(z));
      if (pathDistance < 5.8) color.lerp(new THREE.Color("#e1d5ad"), 0.18 * (1 - pathDistance / 5.8));
      const edgeDistance = Math.abs(x) / MAP_HALF_WIDTH;
      if (edgeDistance > 0.72) color.lerp(new THREE.Color("#9da59f"), (edgeDistance - 0.72) * 1.2);
      const shade = 0.96 + Math.sin(x * 1.7 + z * 0.8) * 0.025 + Math.sin((x - z) * 0.37) * 0.018;
      colors.push(color.r * shade, color.g * shade, color.b * shade);
    }
  }
  for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
      const a = zIndex * (xSegments + 1) + xIndex;
      const b = a + 1;
      const c = a + xSegments + 1;
      const d = c + 1;
      if ((xIndex + zIndex) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const terrainMaterial = material("#ffffff", { map: surfaceTexture, vertexColors: true, roughness: 0.94, metalness: 0.015 });
  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "Dorso orgânico";
  mesh.userData.walkable = true;
  return mesh;
}

function createDorsalPlateGeometry(plate: DorsalPlateDefinition): THREE.BufferGeometry {
  const angularSegments = 18;
  const ringScales = [0, 0.38, 0.7, 1] as const;
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  vertices.push(plate.x, terrainHeight(plate.x, plate.z) + plate.crownLift, plate.z);
  uvs.push(0.5, 0.5);

  for (let ringIndex = 1; ringIndex < ringScales.length; ringIndex += 1) {
    const ringScale = ringScales[ringIndex];
    const lift = THREE.MathUtils.lerp(plate.crownLift, 0.018, ringScale ** 1.5);
    for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
      const angle = angleIndex / angularSegments * Math.PI * 2;
      const boundaryVariation = 1 + Math.sin(angle * 3 + plate.rotation * 2.1) * 0.055 + Math.cos(angle * 5 - plate.rotation) * 0.035;
      const localX = Math.cos(angle) * plate.radiusX * ringScale * boundaryVariation;
      const localZ = Math.sin(angle) * plate.radiusZ * ringScale * boundaryVariation;
      const cos = Math.cos(plate.rotation);
      const sin = Math.sin(plate.rotation);
      const x = plate.x + localX * cos - localZ * sin;
      const z = plate.z + localX * sin + localZ * cos;
      vertices.push(x, terrainHeight(x, z) + lift, z);
      uvs.push(0.5 + localX / (plate.radiusX * 2), 0.5 + localZ / (plate.radiusZ * 2));
    }
  }

  const firstRingStart = 1;
  for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
    const current = firstRingStart + angleIndex;
    const next = firstRingStart + (angleIndex + 1) % angularSegments;
    indices.push(0, next, current);
  }
  for (let ringIndex = 1; ringIndex < ringScales.length - 1; ringIndex += 1) {
    const innerStart = 1 + (ringIndex - 1) * angularSegments;
    const outerStart = innerStart + angularSegments;
    for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
      const nextAngle = (angleIndex + 1) % angularSegments;
      const innerCurrent = innerStart + angleIndex;
      const innerNext = innerStart + nextAngle;
      const outerCurrent = outerStart + angleIndex;
      const outerNext = outerStart + nextAngle;
      indices.push(innerCurrent, innerNext, outerCurrent, innerNext, outerNext, outerCurrent);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createBody(surfaceTexture: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  const skin = material("#51635b", { map: surfaceTexture, roughness: 0.92, metalness: 0.02 });
  const segments: readonly [number, number, number][] = [
    [86, 27, 1.02], [40, 30, 1.1], [-12, 31, 1.13], [-64, 29, 1.08], [-108, 24, 0.9],
  ];
  for (const [z, radius, widthScale] of segments) {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), skin);
    body.scale.set(widthScale * 1.34, 0.6, 1.42);
    body.position.set(pathCenter(z) * 0.18, -14.2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
  }
  const plateMaterials = [
    material("#747c6b", { map: surfaceTexture, roughness: 0.91 }),
    material("#657469", { map: surfaceTexture, roughness: 0.94 }),
    material("#85866f", { map: surfaceTexture, roughness: 0.89 }),
  ];
  for (let index = 0; index < DORSAL_PLATES.length; index += 1) {
    const definition = DORSAL_PLATES[index];
    const plate = new THREE.Mesh(createDorsalPlateGeometry(definition), plateMaterials[index % plateMaterials.length]);
    plate.name = `Placa dorsal caminhável ${index + 1}`;
    plate.castShadow = true;
    plate.receiveShadow = true;
    plate.userData.walkable = true;
    group.add(plate);
  }
  return group;
}

function createHead(surfaceTexture: THREE.Texture): { group: THREE.Group; eye: THREE.Mesh } {
  const group = new THREE.Group();
  group.position.set(pathCenter(-158), -28, -164);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(20, 3), material("#596962", { map: surfaceTexture, roughness: 0.92 }));
  head.scale.set(1.25, 0.86, 1.52);
  head.rotation.x = -0.14;
  group.add(head);
  const snout = new THREE.Mesh(new THREE.IcosahedronGeometry(13, 2), material("#53655f", { map: surfaceTexture, roughness: 0.94 }));
  snout.scale.set(1.15, 0.58, 1.1);
  snout.position.set(0, -1.6, -14);
  group.add(snout);
  const hornMaterial = material("#777767");
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(createBoneSpineGeometry(23, 2.4, side * 4.8), hornMaterial);
    horn.position.set(side * 12, 1.5, 0);
    horn.rotation.z = side * -0.42;
    horn.rotation.x = -0.08;
    horn.castShadow = true;
    group.add(horn);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 8), material("#72d7c3", { emissive: "#174c4a", emissiveIntensity: 3 }));
  eye.position.set(9.8, 3.1, -13.8);
  group.add(eye);
  const nostrilMaterial = material("#091413");
  for (const side of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 5), nostrilMaterial);
    nostril.position.set(side * 3.8, -0.7, -27.5);
    nostril.scale.set(1.1, 0.45, 0.35);
    group.add(nostril);
  }
  return { group, eye };
}

function createClothPanelGeometry(width: number, height: number, flare: number, foldDepth: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    const rowProgress = row / 2;
    const rowWidth = width * THREE.MathUtils.lerp(1, flare, rowProgress);
    for (let column = 0; column < 3; column += 1) {
      const columnProgress = column / 2 - 0.5;
      const fold = column === 1 ? foldDepth * (0.35 + rowProgress * 0.65) : -foldDepth * 0.28 * rowProgress;
      vertices.push(columnProgress * rowWidth, -rowProgress * height, fold);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const a = row * 3 + column;
      const b = a + 1;
      const c = a + 3;
      const d = c + 1;
      if ((row + column) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createPlayer(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Errante";
  const rig = new THREE.Group();
  rig.name = "character-rig";
  group.add(rig);

  const lowPolyMaterial = (color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial =>
    material(color, { flatShading: true, roughness: 0.94, ...options });
  const coat = lowPolyMaterial("#864528");
  const coatDark = lowPolyMaterial("#5d3023");
  const coatFold = lowPolyMaterial("#6e3825", { side: THREE.DoubleSide });
  const trousers = lowPolyMaterial("#1c292b");
  const bootMaterial = lowPolyMaterial("#11191a", { roughness: 0.84 });
  const skin = lowPolyMaterial("#a9775d", { roughness: 0.82 });
  const hair = lowPolyMaterial("#291c18");
  const leather = lowPolyMaterial("#4e3b2c");

  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.39, 0.3, 7), coatDark);
  pelvis.name = "pelvis";
  pelvis.position.y = 1.08;
  pelvis.castShadow = true;
  rig.add(pelvis);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.36, 0.88, 8), coat);
  torso.name = "torso";
  torso.position.y = 1.55;
  torso.castShadow = true;
  rig.add(torso);
  const chestSeam = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.66, 0.025, 1, 3, 1), coatDark);
  chestSeam.position.set(0, 1.53, 0.39);
  rig.add(chestSeam);
  for (const side of [-1, 1]) {
    const fastening = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 6), lowPolyMaterial("#b69358", { metalness: 0.18, roughness: 0.62 }));
    fastening.rotation.x = Math.PI / 2;
    fastening.position.set(side * 0.11, 1.58, 0.405);
    rig.add(fastening);
  }

  const panelDefinitions: readonly [string, number, number, number, number, number][] = [
    ["coat-front", 0, 1.17, 0.34, 0, 0],
    ["coat-back", 0, 1.17, -0.34, Math.PI, 0],
    ["coat-left", -0.35, 1.17, 0, -Math.PI / 2, 1],
    ["coat-right", 0.35, 1.17, 0, Math.PI / 2, 1],
  ];
  for (const [name, x, y, z, rotationY, isSide] of panelDefinitions) {
    const panel = new THREE.Mesh(
      createClothPanelGeometry(isSide ? 0.5 : 0.78, 0.68, isSide ? 1.08 : 1.22, 0.075),
      coatFold,
    );
    panel.name = name;
    panel.position.set(x, y, z);
    panel.rotation.y = rotationY;
    panel.castShadow = true;
    rig.add(panel);
  }

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.052, 6, 12), lowPolyMaterial("#8a6745", { roughness: 0.72 }));
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 1.15;
  rig.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.055), lowPolyMaterial("#b39458", { metalness: 0.24, roughness: 0.58 }));
  buckle.position.set(0, 1.15, 0.405);
  rig.add(buckle);

  for (const side of [-1, 1] as const) {
    const legPivot = new THREE.Group();
    legPivot.name = side < 0 ? "leg-left" : "leg-right";
    legPivot.position.set(side * 0.22, 1.08, 0);
    legPivot.userData.baseY = 1.08;
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 3, 7), trousers);
    thigh.position.y = -0.28;
    thigh.castShadow = true;
    legPivot.add(thigh);

    const kneePivot = new THREE.Group();
    kneePivot.name = side < 0 ? "knee-left" : "knee-right";
    kneePivot.position.y = -0.54;
    const knee = new THREE.Mesh(new THREE.DodecahedronGeometry(0.145, 0), trousers);
    knee.scale.set(0.92, 0.8, 1.02);
    knee.castShadow = true;
    kneePivot.add(knee);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.25, 3, 7), trousers);
    shin.position.y = -0.25;
    shin.castShadow = true;
    kneePivot.add(shin);
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.28, 3, 7), bootMaterial);
    boot.name = side < 0 ? "boot-left" : "boot-right";
    boot.position.set(0, -0.44, 0.13);
    boot.rotation.x = Math.PI / 2;
    boot.scale.set(0.9, 1.15, 1);
    boot.castShadow = true;
    kneePivot.add(boot);
    legPivot.add(kneePivot);
    rig.add(legPivot);

    const armPivot = new THREE.Group();
    armPivot.name = side < 0 ? "arm-left" : "arm-right";
    armPivot.position.set(side * 0.5, 1.78, 0);
    const shoulder = new THREE.Mesh(new THREE.DodecahedronGeometry(0.19, 0), coat);
    shoulder.scale.set(1.12, 0.92, 1);
    shoulder.castShadow = true;
    armPivot.add(shoulder);
    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.3, 3, 7), coatDark);
    upperArm.position.y = -0.28;
    upperArm.castShadow = true;
    armPivot.add(upperArm);

    const forearmPivot = new THREE.Group();
    forearmPivot.name = side < 0 ? "forearm-left" : "forearm-right";
    forearmPivot.position.y = -0.54;
    const elbow = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), coatDark);
    elbow.scale.set(0.9, 0.82, 1);
    forearmPivot.add(elbow);
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.22, 3, 7), coatDark);
    forearm.position.y = -0.23;
    forearm.castShadow = true;
    forearmPivot.add(forearm);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.025, 5, 8), leather);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.42;
    forearmPivot.add(cuff);
    const hand = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), skin);
    hand.position.y = -0.51;
    hand.scale.set(0.86, 1.08, 0.82);
    hand.castShadow = true;
    forearmPivot.add(hand);
    armPivot.add(forearmPivot);
    rig.add(armPivot);
  }

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 7), skin);
  neck.position.y = 2.06;
  rig.add(neck);
  const headRig = new THREE.Group();
  headRig.name = "head-rig";
  headRig.position.y = 2.31;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 7), skin);
  head.scale.set(0.92, 1.06, 0.95);
  head.castShadow = true;
  headRig.add(head);
  const eyeMaterial = lowPolyMaterial("#d7e4dc", { emissive: "#315b58", emissiveIntensity: 0.18, roughness: 0.38 });
  const pupilMaterial = lowPolyMaterial("#10191a", { roughness: 0.36 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.043, 7, 5), eyeMaterial);
    eye.name = side < 0 ? "eye-left" : "eye-right";
    eye.position.set(side * 0.115, 0.045, 0.29);
    eye.scale.set(1, 0.72, 0.4);
    eye.userData.baseScaleY = 0.72;
    headRig.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.019, 6, 4), pupilMaterial);
    pupil.position.set(side * 0.115, 0.043, 0.325);
    pupil.scale.set(0.82, 1, 0.38);
    headRig.add(pupil);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.022, 0.028), hair);
    brow.position.set(side * 0.115, 0.135, 0.305);
    brow.rotation.z = side * -0.1;
    headRig.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.TetrahedronGeometry(0.065, 0), skin);
  nose.position.set(0, -0.025, 0.345);
  nose.rotation.x = 0.52;
  headRig.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.018, 0.02), lowPolyMaterial("#683b36"));
  mouth.position.set(0, -0.13, 0.31);
  headRig.add(mouth);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.DodecahedronGeometry(0.065, 0), skin);
    ear.position.set(side * 0.31, 0, 0);
    ear.scale.x = 0.6;
    headRig.add(ear);
  }
  const hairCap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.31, 1), hair);
  hairCap.position.set(0, 0.14, -0.065);
  hairCap.scale.set(1.04, 0.69, 0.88);
  headRig.add(hairCap);
  for (let index = 0; index < 8; index += 1) {
    const lock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + (index % 2) * 0.018, 0), hair);
    const angle = index / 7 * Math.PI + Math.PI / 2;
    lock.position.set(Math.cos(angle) * 0.255, 0.055 - (index % 2) * 0.055, Math.sin(angle) * 0.19 - 0.125);
    lock.scale.set(0.78, 1.35 + (index % 3) * 0.14, 0.75);
    lock.rotation.z = Math.cos(angle) * -0.24;
    headRig.add(lock);
  }
  for (let index = 0; index < 3; index += 1) {
    const ponytail = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 - index * 0.014, 0), hair);
    ponytail.position.set(-0.06 + index * 0.035, -0.04 - index * 0.16, -0.27 - index * 0.03);
    ponytail.scale.set(0.84, 1.32, 0.78);
    headRig.add(ponytail);
  }
  rig.add(headRig);

  const scarfMaterial = lowPolyMaterial("#d6a352", { side: THREE.DoubleSide });
  const scarfKnot = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 5, 10), scarfMaterial);
  scarfKnot.name = "scarf-knot";
  scarfKnot.rotation.x = Math.PI / 2;
  scarfKnot.position.y = 2.03;
  rig.add(scarfKnot);
  const scarfTail = new THREE.Mesh(createClothPanelGeometry(0.24, 0.82, 1.22, 0.045), scarfMaterial);
  scarfTail.name = "scarf-tail";
  scarfTail.position.set(-0.16, 2.02, -0.28);
  scarfTail.rotation.set(1.08, -0.16, 0.08);
  scarfTail.castShadow = true;
  rig.add(scarfTail);

  const pack = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4, 1), leather);
  pack.position.set(0, 1.54, -0.42);
  pack.scale.set(0.88, 1.08, 0.5);
  pack.rotation.x = -0.08;
  pack.castShadow = true;
  rig.add(pack);
  const packFlap = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.28, 0.05, 2, 1, 1), coatDark);
  packFlap.position.set(0, 1.67, -0.62);
  packFlap.rotation.x = -0.1;
  rig.add(packFlap);
  return group;
}

function createCamp(world: THREE.Group): WorldObstacle[] {
  const camp = new THREE.Group();
  camp.position.set(CAMP_POSITION.x, terrainHeight(CAMP_POSITION.x, CAMP_POSITION.z), CAMP_POSITION.z);
  orientToTerrain(camp, CAMP_POSITION.x, CAMP_POSITION.z);
  const stoneMaterial = material("#6b6d61", { roughness: 0.98 });
  for (let index = 0; index < 10; index += 1) {
    const stone = new THREE.Mesh(createOrganicRockGeometry(0.34, 1), stoneMaterial);
    const angle = index / 10 * Math.PI * 2;
    stone.position.set(Math.sin(angle) * 1.25, 0.2, Math.cos(angle) * 1.25);
    camp.add(stone);
  }
  for (const rotation of [-0.7, 0.7]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 2.0, 6), material("#493827"));
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rotation;
    log.position.y = 0.25;
    camp.add(log);
  }
  const ember = new THREE.PointLight("#ff8b3d", 1.2, 7, 2);
  ember.position.y = 0.6;
  camp.add(ember);
  const shelter = new THREE.Group();
  shelter.position.set(4.2, 0, 1.1);
  const clothGeometry = new THREE.BufferGeometry();
  clothGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -2.05, 0.12, -1.8,
    -2.05, 0.12, 1.8,
    0, 2.72, 1.8,
    0, 2.72, -1.8,
    2.05, 0.12, -1.8,
    2.05, 0.12, 1.8,
  ], 3));
  clothGeometry.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4]);
  clothGeometry.computeVertexNormals();
  const cloth = new THREE.Mesh(clothGeometry, material("#53604d", { side: THREE.DoubleSide, roughness: 1, emissive: "#182019", emissiveIntensity: 0.28 }));
  cloth.castShadow = true;
  shelter.add(cloth);
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.25, 5), material("#4a3526"));
    frame.position.set(side * 0.75, 1.25, 0);
    frame.rotation.z = side * -0.56;
    shelter.add(frame);
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.9, 8), material("#4a3526"));
  ridge.position.y = 2.75;
  ridge.rotation.x = Math.PI / 2;
  shelter.add(ridge);
  camp.add(shelter);
  world.add(camp);
  return [
    { x: CAMP_POSITION.x, z: CAMP_POSITION.z, radius: 1.08 },
    { x: CAMP_POSITION.x + 4.2, z: CAMP_POSITION.z + 1.1, radius: 1.95 },
  ];
}

function createGrassTuftGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const bladeAngles = [0, Math.PI / 3, Math.PI * 2 / 3];
  bladeAngles.forEach((angle, bladeIndex) => {
    const sideX = Math.cos(angle) * 0.16;
    const sideZ = Math.sin(angle) * 0.16;
    const forwardX = Math.sin(angle) * 0.12;
    const forwardZ = -Math.cos(angle) * 0.12;
    const base = bladeIndex * 4;
    vertices.push(
      -sideX, 0, -sideZ,
      sideX, 0, sideZ,
      sideX * 0.35 + forwardX, 0.68, sideZ * 0.35 + forwardZ,
      forwardX * 1.35, 1.05, forwardZ * 1.35,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createBoneSpineGeometry(height: number, radius: number, bend: number): THREE.BufferGeometry {
  const radialSegments = 12;
  const heightSegments = 9;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let heightIndex = 0; heightIndex <= heightSegments; heightIndex += 1) {
    const t = heightIndex / heightSegments;
    const ringRadius = Math.max(0.025, radius * (1 - t) ** 0.72);
    const centerX = bend * t * t;
    for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
      const angle = radialIndex / radialSegments * Math.PI * 2;
      vertices.push(centerX + Math.cos(angle) * ringRadius, t * height, Math.sin(angle) * ringRadius);
    }
  }
  for (let heightIndex = 0; heightIndex < heightSegments; heightIndex += 1) {
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      const a = heightIndex * (radialSegments + 1) + radialIndex;
      const b = a + 1;
      const c = a + radialSegments + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const baseCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  const tipCenter = vertices.length / 3;
  vertices.push(bend, height, 0);
  const tipRingStart = heightSegments * (radialSegments + 1);
  for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
    indices.push(baseCenter, radialIndex + 1, radialIndex);
    indices.push(tipCenter, tipRingStart + radialIndex, tipRingStart + radialIndex + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createAnchoredBoneSpine(
  x: number,
  z: number,
  height: number,
  radius: number,
  side: number,
  index: number,
  boneMaterial: THREE.MeshStandardMaterial,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `Espinho dorsal enraizado ${index + 1}`;
  root.position.set(x, terrainHeight(x, z) - radius * 0.35, z);
  orientToTerrain(root, x, z, index * 0.61 + side * 0.08);

  const socket = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 1.12, 1), boneMaterial);
  socket.name = "Encaixe ósseo parcialmente enterrado";
  socket.scale.set(1.08, 0.44, 0.92);
  socket.rotation.y = index * 0.73;
  socket.castShadow = true;
  socket.receiveShadow = true;
  root.add(socket);

  const spine = new THREE.Mesh(createBoneSpineGeometry(height, radius, side * height * 0.14), boneMaterial);
  spine.name = "Espinho dorsal fechado na base";
  spine.position.y = radius * 0.08;
  spine.rotation.z = side * (0.28 + (index % 3) * 0.07);
  spine.rotation.x = (index % 2 ? -1 : 1) * 0.12;
  spine.castShadow = true;
  spine.receiveShadow = true;
  root.add(spine);
  return root;
}

function createOrganicRockGeometry(radius: number, detail: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const positions = geometry.getAttribute("position");
  for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
    const x = positions.getX(vertexIndex);
    const y = positions.getY(vertexIndex);
    const z = positions.getZ(vertexIndex);
    const noise = 1 + Math.sin(x * 2.7 + z * 1.9) * 0.07 + Math.cos(y * 3.2 - z * 1.4) * 0.045;
    positions.setXYZ(vertexIndex, x * noise, y * noise, z * noise);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createLeafRosetteGeometry(): THREE.BufferGeometry {
  const random = seededRandom(8_731);
  const vertices: number[] = [];
  const indices: number[] = [];
  const flex: number[] = [];
  const leafCount = 16;
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const basePoint = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const tip = new THREE.Vector3();
  for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
    const azimuth = leafIndex * Math.PI * (3 - Math.sqrt(5)) + (random() - 0.5) * 0.35;
    const elevation = -0.18 + random() * 0.95;
    direction.set(Math.cos(azimuth), elevation, Math.sin(azimuth)).normalize();
    right.crossVectors(direction, up);
    if (right.lengthSq() < 0.01) right.set(1, 0, 0);
    else right.normalize();
    const leafLength = 0.55 + random() * 0.38;
    const leafWidth = 0.11 + random() * 0.09;
    basePoint.set(Math.cos(azimuth) * 0.035, (random() - 0.5) * 0.08, Math.sin(azimuth) * 0.035);
    midpoint.copy(direction).multiplyScalar(leafLength * 0.53).add(basePoint);
    tip.copy(direction).multiplyScalar(leafLength).add(basePoint);
    tip.y += (random() - 0.45) * 0.09;
    const base = leafIndex * 4;
    vertices.push(
      basePoint.x, basePoint.y, basePoint.z,
      midpoint.x + right.x * leafWidth, midpoint.y + right.y * leafWidth, midpoint.z + right.z * leafWidth,
      tip.x, tip.y, tip.z,
      midpoint.x - right.x * leafWidth, midpoint.y - right.y * leafWidth, midpoint.z - right.z * leafWidth,
    );
    flex.push(0, 0.62, 1, 0.62);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("leafFlex", new THREE.Float32BufferAttribute(flex, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function setSegmentTransform(dummy: THREE.Object3D, start: THREE.Vector3, end: THREE.Vector3, radiusScale: number): void {
  const direction = new THREE.Vector3().subVectors(end, start);
  const segmentLength = Math.max(0.001, direction.length());
  dummy.position.copy(start).add(end).multiplyScalar(0.5);
  dummy.quaternion.setFromUnitVectors(TERRAIN_UP, direction.normalize());
  dummy.scale.set(radiusScale, segmentLength, radiusScale);
  dummy.updateMatrix();
}

function toWorldPoint(point: TreePoint, x: number, ground: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(x + point.x, ground + point.y, z + point.z);
}

function createWindFoliageMaterial(): { material: THREE.MeshStandardMaterial; windTime: THREE.IUniform<number> } {
  const windTime: THREE.IUniform<number> = { value: 0 };
  const foliageMaterial = material("#ffffff", { side: THREE.DoubleSide, roughness: 0.96 });
  foliageMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTreeTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float leafFlex;\nuniform float uTreeTime;`)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        float treePhase = position.x * 2.7 + position.z * 1.9;
        #ifdef USE_INSTANCING
          treePhase += instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.11;
        #endif
        float leafFlutter = sin(uTreeTime * 2.35 + treePhase) * 0.045 * leafFlex;
        float crossFlutter = cos(uTreeTime * 1.73 + treePhase * 1.31) * 0.028 * leafFlex;
        transformed.x += leafFlutter;
        transformed.z += crossFlutter;
      `);
  };
  foliageMaterial.customProgramCacheKey = () => "errante-attached-leaf-wind-v1";
  return { material: foliageMaterial, windTime };
}

function createEnvironment(world: THREE.Group, seed: number, settings: GameSettings): { obstacles: WorldObstacle[]; treeWindTime: THREE.IUniform<number> } {
  const random = seededRandom(seed);
  const obstacles: WorldObstacle[] = [];
  const treeCount = settings.quality === "low" ? 42 : settings.quality === "medium" ? 64 : 88;
  const barkMaterial = material("#ffffff", { roughness: 1 });
  const trunkGeometries = [
    new THREE.CylinderGeometry(0.37, 0.49, 1, 8),
    new THREE.CylinderGeometry(0.26, 0.37, 1, 8),
    new THREE.CylinderGeometry(0.11, 0.26, 1, 7),
  ];
  const trunkMeshes = trunkGeometries.map((geometry) => new THREE.InstancedMesh(geometry, barkMaterial, treeCount));
  const twigCount = 14;
  const foliageCount = 21;
  const primaryBranchBase = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.105, 0.19, 1, 7), barkMaterial, treeCount * 7);
  const primaryBranchTip = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.105, 1, 7), barkMaterial, treeCount * 7);
  const twigs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.018, 0.06, 1, 6), barkMaterial, treeCount * twigCount);
  const roots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.2, 1, 7), barkMaterial, treeCount * 8);
  const { material: foliageMaterial, windTime: treeWindTime } = createWindFoliageMaterial();
  const foliage = new THREE.InstancedMesh(createLeafRosetteGeometry(), foliageMaterial, treeCount * foliageCount);
  const dummy = new THREE.Object3D();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const placedTrees: Array<{ x: number; z: number; size: number }> = [];
  for (let index = 0; index < treeCount; index += 1) {
    let x = 0;
    let z = 0;
    let size = 1;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      x = (random() - 0.5) * 74;
      z = 54 + random() * 74;
      size = 0.72 + random() * 0.7;
      const pathDistance = Math.abs(x - pathCenter(z));
      const spaced = placedTrees.every((tree) => Math.hypot(x - tree.x, z - tree.z) > 1.65 + (size + tree.size) * 0.72);
      const resourceClear = MINERAL_SEAM_NODES.every((node) => Math.hypot(x - node.x, z - node.z) > 2.5 + size);
      if (pathDistance >= 9.5 && isInsideDorso(x, z, 5) && spaced && resourceClear) break;
    }
    placedTrees.push({ x, z, size });
    const ground = terrainHeight(x, z);
    const skeleton = generateTreeSkeleton(Math.floor(random() * 2_000_000_000) + index * 97, size);
    const barkColor = new THREE.Color().lerpColors(new THREE.Color("#2d211b"), new THREE.Color("#62472f"), random());
    for (let trunkIndex = 0; trunkIndex < skeleton.trunk.length; trunkIndex += 1) {
      const segment = skeleton.trunk[trunkIndex];
      setSegmentTransform(dummy, toWorldPoint(segment.start, x, ground, z, start), toWorldPoint(segment.end, x, ground, z, end), 1);
      trunkMeshes[trunkIndex].setMatrixAt(index, dummy.matrix);
      trunkMeshes[trunkIndex].setColorAt(index, barkColor);
    }
    for (let branchIndex = 0; branchIndex < skeleton.branches.length; branchIndex += 1) {
      const branch = skeleton.branches[branchIndex];
      for (let segmentIndex = 0; segmentIndex < branch.segments.length; segmentIndex += 1) {
        const segment = branch.segments[segmentIndex];
        setSegmentTransform(dummy, toWorldPoint(segment.start, x, ground, z, start), toWorldPoint(segment.end, x, ground, z, end), 1);
        const mesh = segmentIndex === 0 ? primaryBranchBase : primaryBranchTip;
        const instanceIndex = index * 7 + branchIndex;
        mesh.setMatrixAt(instanceIndex, dummy.matrix);
        mesh.setColorAt(instanceIndex, barkColor);
      }
      for (let twigIndex = 0; twigIndex < branch.twigs.length; twigIndex += 1) {
        const twig = branch.twigs[twigIndex];
        setSegmentTransform(dummy, toWorldPoint(twig.start, x, ground, z, start), toWorldPoint(twig.end, x, ground, z, end), 1);
        const instanceIndex = index * twigCount + branchIndex * 2 + twigIndex;
        twigs.setMatrixAt(instanceIndex, dummy.matrix);
        twigs.setColorAt(instanceIndex, barkColor);
      }
      for (let foliageIndex = 0; foliageIndex < branch.foliage.length; foliageIndex += 1) {
        const anchor = branch.foliage[foliageIndex];
        dummy.position.copy(toWorldPoint(anchor.position, x, ground, z, start));
        dummy.quaternion.setFromUnitVectors(TERRAIN_UP, end.set(anchor.direction.x, anchor.direction.y, anchor.direction.z).normalize());
        const widthVariation = 0.8 + random() * 0.38;
        dummy.scale.set(anchor.scale * widthVariation, anchor.scale * (0.82 + random() * 0.36), anchor.scale * (0.78 + random() * 0.4));
        dummy.rotateY(random() * Math.PI * 2);
        dummy.updateMatrix();
        const instanceIndex = index * foliageCount + branchIndex * 3 + foliageIndex;
        foliage.setMatrixAt(instanceIndex, dummy.matrix);
        foliage.setColorAt(instanceIndex, new THREE.Color().lerpColors(new THREE.Color("#294b32"), new THREE.Color("#7e8d58"), random()));
      }
    }
    for (let rootIndex = 0; rootIndex < skeleton.roots.length; rootIndex += 1) {
      const root = skeleton.roots[rootIndex];
      const midpoint: TreePoint = {
        x: (root.start.x + root.end.x) * 0.5,
        y: 0,
        z: (root.start.z + root.end.z) * 0.5,
      };
      const rootSegments: readonly TreeSegment[] = [{ start: root.start, end: midpoint }, { start: midpoint, end: root.end }];
      for (let rootSegmentIndex = 0; rootSegmentIndex < rootSegments.length; rootSegmentIndex += 1) {
        const segment = rootSegments[rootSegmentIndex];
        start.set(x + segment.start.x, terrainHeight(x + segment.start.x, z + segment.start.z) + 0.055, z + segment.start.z);
        end.set(x + segment.end.x, terrainHeight(x + segment.end.x, z + segment.end.z) + 0.035, z + segment.end.z);
        setSegmentTransform(dummy, start, end, rootSegmentIndex === 0 ? 1 : 0.72);
        const instanceIndex = index * 8 + rootIndex * 2 + rootSegmentIndex;
        roots.setMatrixAt(instanceIndex, dummy.matrix);
        roots.setColorAt(instanceIndex, barkColor);
      }
    }
    obstacles.push({ x, z, radius: 0.44 + size * 0.34 });
  }
  for (const trunkMesh of trunkMeshes) {
    trunkMesh.name = "Troncos orgânicos conectados";
    trunkMesh.castShadow = settings.quality !== "low";
    trunkMesh.receiveShadow = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
  }
  for (const woodyMesh of [primaryBranchBase, primaryBranchTip, twigs, roots]) {
    woodyMesh.name = "Galhos conectados";
    woodyMesh.castShadow = settings.quality === "high";
    woodyMesh.receiveShadow = true;
    if (woodyMesh.instanceColor) woodyMesh.instanceColor.needsUpdate = true;
  }
  foliage.name = "Folhas presas às pontas dos galhos";
  foliage.castShadow = settings.quality === "high";
  foliage.receiveShadow = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  world.add(...trunkMeshes, primaryBranchBase, primaryBranchTip, twigs, roots, foliage);

  const grassCount = settings.quality === "low" ? 220 : settings.quality === "medium" ? 440 : 720;
  const grass = new THREE.InstancedMesh(createGrassTuftGeometry(), material("#ffffff", { side: THREE.DoubleSide, roughness: 1 }), grassCount);
  for (let index = 0; index < grassCount; index += 1) {
    let x = (random() - 0.5) * 82;
    const z = -116 + random() * 246;
    if (!isInsideDorso(x, z, 4)) x *= 0.7;
    const scale = 0.22 + random() * 0.48;
    dummy.position.set(x, terrainHeight(x, z) + 0.035, z);
    dummy.rotation.set((random() - 0.5) * 0.16, random() * Math.PI, (random() - 0.5) * 0.16);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    grass.setMatrixAt(index, dummy.matrix);
    grass.setColorAt(index, new THREE.Color().lerpColors(new THREE.Color("#3f5935"), new THREE.Color("#87945d"), random()));
  }
  grass.receiveShadow = true;
  grass.castShadow = settings.quality === "high";
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  world.add(grass);

  const rockGeometry = createOrganicRockGeometry(1, 1);
  const rocks = new THREE.InstancedMesh(rockGeometry, material("#ffffff", { roughness: 0.96 }), settings.quality === "low" ? 70 : 125);
  for (let index = 0; index < rocks.count; index += 1) {
    let x = 0;
    let z = 0;
    let scale = 1;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      x = (random() - 0.5) * 86;
      z = -126 + random() * 258;
      if (!isInsideDorso(x, z, 3)) x *= 0.72;
      scale = 0.25 + random() * 1.35;
      const resourceClear = MINERAL_SEAM_NODES.every((node) => Math.hypot(x - node.x, z - node.z) > 2.2 + scale * 0.85);
      if (resourceClear) break;
    }
    const verticalScale = scale * (0.45 + random() * 0.4);
    dummy.position.set(x, terrainHeight(x, z) + verticalScale * 0.91, z);
    dummy.rotation.set((random() - 0.5) * 0.24, random() * Math.PI, (random() - 0.5) * 0.24);
    dummy.scale.set(scale, verticalScale, scale);
    dummy.updateMatrix();
    rocks.setMatrixAt(index, dummy.matrix);
    rocks.setColorAt(index, new THREE.Color().lerpColors(new THREE.Color("#3e4742"), new THREE.Color("#77766a"), random()));
    if (scale > 0.86) obstacles.push({ x, z, radius: scale * 0.62 });
  }
  rocks.receiveShadow = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  world.add(rocks);

  const swampWater = new THREE.Mesh(new THREE.CircleGeometry(11.5, 28), material("#1f5753", { transparent: true, opacity: 0.72, metalness: 0.22, roughness: 0.28 }));
  swampWater.rotation.x = -Math.PI / 2;
  swampWater.scale.set(0.85, 1.75, 1);
  swampWater.position.set(-12, terrainHeight(-12, 30) + 0.18, 30);
  world.add(swampWater);

  const boneMaterial = material("#a99f87", { roughness: 0.88 });
  for (const anchor of DORSAL_SPINE_ANCHORS) {
    world.add(createAnchoredBoneSpine(anchor.x, anchor.z, anchor.height, anchor.radius, anchor.side, anchor.index, boneMaterial));
    obstacles.push({ x: anchor.x, z: anchor.z, radius: 1.2 + (anchor.index % 3) * 0.25 });
  }

  const ruin = new THREE.Group();
  ruin.position.set(RUIN_POSITION.x, terrainHeight(RUIN_POSITION.x, RUIN_POSITION.z), RUIN_POSITION.z);
  orientToTerrain(ruin, RUIN_POSITION.x, RUIN_POSITION.z);
  const ruinMaterial = material("#777266");
  const floor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 8), ruinMaterial);
  floor.rotation.y = -0.24;
  floor.userData.walkable = true;
  ruin.add(floor);
  for (const [x, z, height] of [[-4, -2, 6], [4, -2, 4.2], [-3, 2, 3.1], [4, 2, 7]] as const) {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, height, 6), ruinMaterial);
    column.position.set(x, height / 2, z);
    column.rotation.z = (random() - 0.5) * 0.18;
    ruin.add(column);
    obstacles.push({ x: RUIN_POSITION.x + x, z: RUIN_POSITION.z + z, radius: 1.05 });
  }
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), material("#51c9c0", { emissive: "#126d6b", emissiveIntensity: 3 }));
  const beaconPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.92, 1.15, 7), ruinMaterial);
  beaconPedestal.position.y = 0.58;
  beaconPedestal.castShadow = true;
  ruin.add(beaconPedestal);
  beacon.position.set(0, 1.8, 0);
  beacon.castShadow = true;
  ruin.add(beacon);
  obstacles.push({ x: RUIN_POSITION.x, z: RUIN_POSITION.z, radius: 0.86 });
  world.add(ruin);

  const cavity = new THREE.Group();
  cavity.position.set(CAVITY_POSITION.x, terrainHeight(CAVITY_POSITION.x, CAVITY_POSITION.z) + 0.3, CAVITY_POSITION.z);
  orientToTerrain(cavity, CAVITY_POSITION.x, CAVITY_POSITION.z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 1.0, 8, 18), material("#315c58", { emissive: "#0b3939", emissiveIntensity: 1.5 }));
  ring.rotation.x = Math.PI / 2;
  cavity.add(ring);
  const vapor = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 9, 1, true), material("#7ad0c2", { transparent: true, opacity: 0.09, side: THREE.DoubleSide }));
  vapor.position.y = 2.8;
  cavity.add(vapor);
  world.add(cavity);
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2;
    obstacles.push({
      x: CAVITY_POSITION.x + Math.sin(angle) * 3.5,
      z: CAVITY_POSITION.z + Math.cos(angle) * 3.5,
      radius: 0.68,
    });
  }
  return { obstacles, treeWindTime };
}

function createWound(world: THREE.Group): THREE.Group {
  const wound = new THREE.Group();
  wound.position.set(WOUND_POSITION.x, terrainHeight(WOUND_POSITION.x, WOUND_POSITION.z) + 0.03, WOUND_POSITION.z);
  orientToTerrain(wound, WOUND_POSITION.x, WOUND_POSITION.z);
  const outer = new THREE.Mesh(new THREE.TorusGeometry(4.2, 1.1, 7, 18), material("#6d3a35", { emissive: "#3b1111", emissiveIntensity: 0.7 }));
  outer.rotation.x = -Math.PI / 2;
  outer.scale.set(1, 1.6, 1);
  wound.add(outer);
  const core = new THREE.Mesh(new THREE.CircleGeometry(3.5, 18), material("#481a22", { emissive: "#4f101e", emissiveIntensity: 1.4 }));
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.04;
  core.scale.set(1, 1.6, 1);
  core.userData.walkable = true;
  wound.add(core);
  const crystalMaterial = material("#65d4c6", { emissive: "#15776f", emissiveIntensity: 1.45, roughness: 0.38 });
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const neuralCrust = new THREE.Mesh(new THREE.TetrahedronGeometry(0.72 + (index % 2) * 0.16), crystalMaterial);
    neuralCrust.name = "Crosta neural integrada à ferida";
    neuralCrust.position.set(Math.sin(angle) * 2.5, 0.09, Math.cos(angle) * 3.5);
    neuralCrust.scale.set(1.2, 0.2, 1.65);
    neuralCrust.rotation.set((index % 2 ? -1 : 1) * 0.08, angle + 0.34, 0);
    wound.add(neuralCrust);
  }
  world.add(wound);
  return wound;
}

function createResource(id: string, item: ItemId, amount: number, x: number, z: number, label: string): ResourceNode {
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z), z);
  orientToTerrain(group, x, z);
  let visual: THREE.Object3D;
  if (item === "madeira") {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.25, 2.3, 10), material("#6e5034", { roughness: 1 }));
    branch.rotation.z = Math.PI / 2;
    branch.position.y = 0.25;
    visual = branch;
  } else if (item === "fibra" || item === "erva") {
    const plant = new THREE.Group();
    const plantMaterial = material(item === "erva" ? "#5bb9a1" : "#668451", {
      side: THREE.DoubleSide,
      roughness: 0.94,
      ...(item === "erva" ? { emissive: "#164c43", emissiveIntensity: 0.85 } : {}),
    });
    for (let clumpIndex = 0; clumpIndex < 5; clumpIndex += 1) {
      const clump = new THREE.Mesh(createGrassTuftGeometry(), plantMaterial);
      const angle = clumpIndex / 5 * Math.PI * 2;
      clump.position.set(Math.sin(angle) * 0.24, 0.02, Math.cos(angle) * 0.24);
      clump.rotation.y = angle + clumpIndex * 0.37;
      clump.rotation.z = Math.sin(angle) * 0.14;
      const clumpWidth = 0.48 + (clumpIndex % 2) * 0.14;
      clump.scale.set(clumpWidth, 0.78 + (clumpIndex % 3) * 0.12, clumpWidth);
      plant.add(clump);
    }
    if (item === "erva") {
      for (const side of [-1, 1]) {
        const bud = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 7), material("#8be1ce", { emissive: "#2b8c7f", emissiveIntensity: 1.8, roughness: 0.45 }));
        bud.position.set(side * 0.22, 0.66 + (side + 1) * 0.06, side * -0.12);
        plant.add(bud);
      }
    }
    visual = plant;
  } else if (item === "fruta") {
    const fruit = new THREE.Group();
    const flesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), material("#b96b3f", { roughness: 0.82 }));
    flesh.scale.set(1, 0.88, 0.94);
    flesh.position.y = 0.37;
    fruit.add(flesh);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.32, 7), material("#45512f"));
    stem.position.set(0.04, 0.79, 0);
    stem.rotation.z = -0.22;
    fruit.add(stem);
    visual = fruit;
  } else if (item === "cristal") {
    const crystalCluster = new THREE.Group();
    crystalCluster.name = "Afloramento de cristal neural coletável";
    const crystalMaterial = material("#54c4b8", { emissive: "#126b65", emissiveIntensity: 2, roughness: 0.3 });
    const stoneBase = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 1), material("#45514d", { roughness: 1 }));
    stoneBase.name = "Base mineral apoiada no solo";
    stoneBase.position.y = 0.08;
    stoneBase.scale.set(1.15, 0.32, 0.92);
    crystalCluster.add(stoneBase);
    const shards: readonly [number, number, number, number, number][] = [
      [0, 0, 0.56, 1.9, -0.08],
      [-0.38, 0.1, 0.34, 1.25, 0.32],
      [0.4, -0.08, 0.29, 1.08, -0.38],
    ];
    for (const [shardX, shardZ, radius, scaleY, tilt] of shards) {
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(radius), crystalMaterial);
      shard.position.set(shardX, radius * scaleY * 0.76, shardZ);
      shard.rotation.z = tilt;
      shard.scale.y = scaleY;
      crystalCluster.add(shard);
    }
    visual = crystalCluster;
  } else {
    const organicResource = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 1), material("#7a4a38"));
    organicResource.position.y = 0.55;
    visual = organicResource;
  }
  visual.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  group.add(visual);
  group.userData.resourceId = id;
  return { id, item, amount, object: group, label };
}

function createResources(world: THREE.Group): ResourceNode[] {
  const authoredDefinitions: readonly [string, ItemId, number, number, number, string][] = [
    ["camp-wood", "madeira", 7, -2, 105, "Gravetos salgados"],
    ["camp-fiber", "fibra", 6, 2.4, 104, "Fibras de abrigo"],
    ["forest-wood-a", "madeira", 4, -18, 116, "Galho retorcido"],
    ["forest-wood-b", "madeira", 4, 18, 88, "Madeira caída"],
    ["forest-fruit-a", "fruta", 3, -22, 78, "Frutas de sal"],
    ["forest-fruit-b", "fruta", 2, 15, 66, "Frutas de sal"],
    ["forest-fiber", "fibra", 4, 23, 96, "Musgo fibroso"],
    ["swamp-herb-a", "erva", 2, -17, 34, "Erva-lúmen"],
    ["swamp-herb-b", "erva", 2, -7, 19, "Erva-lúmen"],
    ["swamp-fiber", "fibra", 4, -24, 26, "Juncos dorsais"],
    ["ruin-crystal", "cristal", 2, 18, -4, "Fragmento neural"],
    ["ridge-crystal", "cristal", 2, -23, -82, "Cristal exposto"],
    ["cavity-herb", "erva", 3, -21, -26, "Secreção medicinal"],
    ["ridge-wood", "madeira", 5, 13, -104, "Destroços presos"],
    ["ruin-fiber", "fibra", 3, 23, 4, "Cordame antigo"],
  ];
  const seamDefinitions: readonly [string, ItemId, number, number, number, string][] = MINERAL_SEAM_NODES.map((node) => [
    node.id,
    "cristal",
    1,
    node.x,
    node.z,
    "Afloramento de cristal neural",
  ]);
  const definitions = [...authoredDefinitions, ...seamDefinitions];
  return definitions.map(([id, item, amount, x, z, label]) => {
    const resource = createResource(id, item, amount, x, z, label);
    world.add(resource.object);
    return resource;
  });
}

function createBirds(): THREE.Group {
  const birds = new THREE.Group();
  const featherMaterial = material("#c8ccc4", { side: THREE.DoubleSide, roughness: 0.92 });
  const darkFeatherMaterial = material("#606866", { side: THREE.DoubleSide, roughness: 0.96 });
  const bodyGeometry = new THREE.CapsuleGeometry(0.12, 0.34, 6, 10);
  const headGeometry = new THREE.SphereGeometry(0.13, 12, 8);
  const beakGeometry = new THREE.ConeGeometry(0.045, 0.2, 8);
  for (let index = 0; index < 12; index += 1) {
    const bird = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, featherMaterial);
    body.rotation.x = Math.PI / 2;
    body.scale.set(1, 1, 1.35);
    bird.add(body);
    const head = new THREE.Mesh(headGeometry, featherMaterial);
    head.position.set(0, 0.045, 0.35);
    bird.add(head);
    const beak = new THREE.Mesh(beakGeometry, material("#b69455", { roughness: 0.86 }));
    beak.position.set(0, 0.02, 0.52);
    beak.rotation.x = Math.PI / 2;
    bird.add(beak);
    const eyeMaterial = material("#111719", { roughness: 0.42 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 5), eyeMaterial);
      eye.position.set(side * 0.1, 0.085, 0.425);
      bird.add(eye);
    }
    for (const side of [-1, 1]) {
      const wingGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0.18),
        new THREE.Vector3(side * 0.48, 0.02, 0.12),
        new THREE.Vector3(side * 0.95, 0.04, -0.12),
        new THREE.Vector3(side * 0.72, 0.015, -0.36),
        new THREE.Vector3(side * 0.22, 0, -0.28),
      ]);
      wingGeometry.setIndex([0, 1, 4, 1, 2, 3, 1, 3, 4]);
      wingGeometry.computeVertexNormals();
      const wing = new THREE.Mesh(wingGeometry, featherMaterial);
      wing.name = side < 0 ? "bird-wing-left" : "bird-wing-right";
      bird.add(wing);
    }
    for (const side of [-1, 1]) {
      const tailGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, -0.22),
        new THREE.Vector3(side * 0.14, 0, -0.62),
        new THREE.Vector3(0, 0.015, -0.5),
      ]);
      tailGeometry.setIndex([0, 1, 2]);
      tailGeometry.computeVertexNormals();
      bird.add(new THREE.Mesh(tailGeometry, darkFeatherMaterial));
    }
    const radius = 22 + (index % 5) * 5.5;
    bird.position.set((index % 6 - 3) * 4.1, 17 + (index % 4) * 1.8, 78 + Math.floor(index / 6) * 8);
    bird.userData.phase = index * 0.7;
    bird.userData.radius = radius;
    bird.userData.baseHeight = 17 + (index % 4) * 1.8;
    bird.scale.setScalar(0.72 + (index % 3) * 0.12);
    birds.add(bird);
  }
  return birds;
}

function createSecondColossus(): THREE.Group {
  const group = new THREE.Group();
  group.visible = false;
  group.position.set(80, -3, -220);
  const silhouetteMaterial = material("#1a3438");
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(32, 2), silhouetteMaterial);
  body.scale.set(1.1, 0.5, 2.4);
  group.add(body);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(7, 14, 54, 8), silhouetteMaterial);
  neck.position.set(0, 24, -48);
  neck.rotation.x = -0.3;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(14, 1), silhouetteMaterial);
  head.position.set(0, 48, -61);
  head.scale.set(1.2, 0.8, 1.6);
  group.add(head);
  return group;
}

function createRain(count: number): THREE.LineSegments {
  const positions = new Float32Array(count * 6);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 6;
    const x = (Math.random() - 0.5) * 92;
    const y = Math.random() * 35;
    const z = (Math.random() - 0.5) * 120;
    const length = 0.48 + Math.random() * 0.86;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    positions[offset + 3] = x - length * 0.16;
    positions[offset + 4] = y - length;
    positions[offset + 5] = z + length * 0.04;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const rain = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#c4dddd", transparent: true, opacity: 0.42, depthWrite: false }));
  rain.visible = false;
  return rain;
}

function createHookPoints(world: THREE.Group): THREE.Mesh[] {
  const points: readonly [number, number][] = [[-27, -68], [-20, -98], [27, -82]];
  return points.map(([x, z], index) => {
    const ground = terrainHeight(x, z);
    const anchorHeight = 4.7 + index * 0.5;
    const anchor = new THREE.Mesh(
      createBoneSpineGeometry(anchorHeight, 0.48, (index % 2 === 0 ? -1 : 1) * 0.38),
      material("#948b77", { roughness: 0.94, flatShading: true }),
    );
    anchor.position.set(x, ground - 0.06, z);
    anchor.rotation.z = (index % 2 === 0 ? -1 : 1) * 0.08;
    anchor.castShadow = true;
    world.add(anchor);
    const point = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.14, 6, 12),
      material("#c8af70", { emissive: "#4b3715", emissiveIntensity: 0.85, flatShading: true }),
    );
    point.position.set(x, ground + anchorHeight, z);
    point.rotation.y = index * 0.7;
    point.castShadow = true;
    point.name = `gancho-${index + 1}`;
    world.add(point);
    return point;
  });
}

function createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.SphereGeometry(420, 48, 24);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uStorm: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(-0.45, 0.62, 0.4).normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uStorm;
      uniform vec3 uSunDirection;
      varying vec3 vDirection;

      float hash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        return mix(
          mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x),
          local.y
        );
      }

      float fbm(vec2 point) {
        float value = 0.0;
        float amplitude = 0.55;
        for (int octave = 0; octave < 3; octave++) {
          value += noise(point) * amplitude;
          point = point * 2.03 + vec2(17.1, 9.2);
          amplitude *= 0.49;
        }
        return value;
      }

      void main() {
        vec3 direction = normalize(vDirection);
        float height = clamp(direction.y * 0.78 + 0.3, 0.0, 1.0);
        vec3 horizonColor = mix(vec3(0.48, 0.63, 0.65), vec3(0.25, 0.34, 0.37), uStorm);
        vec3 zenithColor = mix(vec3(0.10, 0.23, 0.31), vec3(0.035, 0.07, 0.09), uStorm);
        vec3 skyColor = mix(horizonColor, zenithColor, pow(height, 0.72));

        vec2 skyUv = vec2(atan(direction.z, direction.x) / 6.2831853 + 0.5, asin(direction.y) / 3.1415926 + 0.5);
        vec2 drift = vec2(uTime * 0.0022, uTime * 0.00045);
        float cloudNoise = fbm(skyUv * vec2(7.0, 4.2) + drift);
        float cloudRange = smoothstep(-0.08, 0.16, direction.y) * (1.0 - smoothstep(0.82, 1.0, direction.y));
        float clouds = smoothstep(0.46 - uStorm * 0.07, 0.63 - uStorm * 0.11, cloudNoise) * cloudRange;
        vec3 cloudLight = mix(vec3(0.84, 0.87, 0.82), vec3(0.22, 0.28, 0.3), uStorm);
        float sunAmount = pow(max(dot(direction, uSunDirection), 0.0), 96.0);
        float sunHalo = pow(max(dot(direction, uSunDirection), 0.0), 12.0);
        skyColor = mix(skyColor, cloudLight, clouds * (0.68 + uStorm * 0.25));
        skyColor += vec3(1.0, 0.62, 0.32) * sunHalo * (0.24 - uStorm * 0.18);
        skyColor += vec3(1.0, 0.84, 0.58) * sunAmount * (0.8 - uStorm * 0.7);
        gl_FragColor = vec4(skyColor, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, skyMaterial);
  sky.name = "Atmosfera dinâmica";
  sky.renderOrder = -10;
  return sky;
}

function createOcean(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.PlaneGeometry(900, 900, 184, 184);
  const oceanMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeepColor: { value: new THREE.Color("#052e42") },
      uShallowColor: { value: new THREE.Color("#1b7080") },
      uSkyColor: { value: new THREE.Color("#9ec7c3") },
    },
    vertexShader: `
      uniform float uTime;
      varying float vWave;
      varying vec3 vWorldPosition;
      void main() {
        vec3 transformed = position;
        float broad = sin(position.x * 0.024 + uTime * 0.68) * 0.82;
        float crossWave = cos(position.y * 0.034 - uTime * 0.51) * 0.56;
        float diagonal = sin((position.x * 0.72 + position.y) * 0.064 + uTime * 1.14) * 0.3;
        float chop = cos((position.x - position.y * 0.58) * 0.12 - uTime * 1.72) * 0.14;
        vWave = broad + crossWave + diagonal + chop;
        transformed.z += vWave;
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uSkyColor;
      uniform float uTime;
      varying float vWave;
      varying vec3 vWorldPosition;
      void main() {
        vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
        if (normal.y < 0.0) normal *= -1.0;
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 sunDirection = normalize(vec3(-0.45, 0.78, 0.34));
        vec3 halfVector = normalize(viewDirection + sunDirection);
        float fresnel = pow(1.0 - clamp(dot(viewDirection, normal), 0.0, 1.0), 3.4);
        float diffuse = max(dot(normal, sunDirection), 0.0);
        float specular = pow(max(dot(normal, halfVector), 0.0), 92.0);
        float micro = sin(vWorldPosition.x * 0.24 + uTime * 2.1) * cos(vWorldPosition.z * 0.19 - uTime * 1.7);
        float crest = smoothstep(0.72, 1.45, vWave + micro * 0.09);
        float lowPolyLight = floor(clamp(vWave * 0.16 + diffuse * 0.4 + 0.42, 0.0, 1.0) * 6.0) / 6.0;
        vec3 water = mix(uDeepColor, uShallowColor, lowPolyLight);
        water = mix(water, uSkyColor, fresnel * 0.64);
        water += specular * vec3(1.0, 0.82, 0.59) * 1.25;
        water = mix(water, vec3(0.78, 0.91, 0.88), crest * 0.58);
        float fogAmount = smoothstep(170.0, 620.0, length(cameraPosition - vWorldPosition));
        water = mix(water, uSkyColor * 0.82, fogAmount);
        gl_FragColor = vec4(water, 0.985);
      }
    `,
    transparent: true,
  });
  const ocean = new THREE.Mesh(geometry, oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -7;
  ocean.receiveShadow = true;
  ocean.name = "Oceano vivo";
  return ocean;
}

function createWakeBandGeometry(innerRadius: number, outerRadius: number, zScale: number, phase: number): THREE.BufferGeometry {
  const segments = 180;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const irregularity = Math.sin(angle * 7 + phase) * 0.9 + Math.sin(angle * 17 - phase * 0.7) * 0.35;
    const inner = innerRadius + irregularity;
    const outer = outerRadius + irregularity + Math.sin(angle * 11 + phase) * 0.28;
    vertices.push(
      Math.cos(angle) * inner, Math.sin(angle) * inner * zScale, 0,
      Math.cos(angle) * outer, Math.sin(angle) * outer * zScale, 0,
    );
    if (index < segments) {
      const current = index * 2;
      indices.push(current, current + 1, current + 2, current + 1, current + 3, current + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWake(): THREE.Group {
  const wake = new THREE.Group();
  wake.name = "Esteira do colosso";
  const wakeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.42 },
    },
    vertexShader: `
      varying vec2 vFoamPosition;
      void main() {
        vFoamPosition = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vFoamPosition;
      void main() {
        float broad = sin(vFoamPosition.x * 0.31 + uTime * 1.2) * cos(vFoamPosition.y * 0.13 - uTime * 0.82);
        float bubbles = sin((vFoamPosition.x + vFoamPosition.y) * 0.88 - uTime * 2.4) * 0.34;
        float streaks = sin(vFoamPosition.x * 0.73 - vFoamPosition.y * 0.39 + uTime * 1.7) * 0.3;
        float breakup = smoothstep(0.2, 0.72, broad + bubbles + streaks);
        float alpha = uOpacity * breakup;
        if (alpha < 0.045) discard;
        vec3 foamColor = mix(vec3(0.58, 0.78, 0.8), vec3(0.9, 0.96, 0.92), breakup);
        gl_FragColor = vec4(foamColor, alpha);
      }
    `,
  });
  const foamBands = [
    [42.2, 42.72, 3.08, 0.11, -1.2, 0.4, -5.02],
    [44.1, 44.7, 3.0, 0.14, 0.5, 1.1, -4.98],
    [46.0, 46.66, 2.9, 0.13, 1.5, 2.4, -4.94],
    [48.0, 49.25, 2.72, 0.3, 0, 0.3, -4.88],
    [51.0, 52.05, 2.66, 0.18, 2.2, 1.7, -4.84],
  ] as const;
  for (const [inner, outer, zScale, opacity, offset, phase, height] of foamBands) {
    const foam = new THREE.Mesh(createWakeBandGeometry(inner, outer, zScale, phase), wakeMaterial.clone());
    if (foam.material instanceof THREE.ShaderMaterial) foam.material.uniforms.uOpacity.value = opacity;
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, height, offset);
    foam.name = "Espuma da travessia";
    wake.add(foam);
  }
  const sprayPositions: number[] = [];
  for (let index = 0; index < 220; index += 1) {
    const angle = index / 220 * Math.PI * 2;
    const jitter = Math.sin(index * 13.7) * 2.2;
    sprayPositions.push(Math.sin(angle) * (53 + jitter), -4.72 + Math.sin(index * 3.1) * 0.42, Math.cos(angle) * (145 + jitter * 2.2));
  }
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute("position", new THREE.Float32BufferAttribute(sprayPositions, 3));
  const spray = new THREE.Points(sprayGeometry, new THREE.PointsMaterial({ color: "#e3f1ed", size: 0.48, transparent: true, opacity: 0.52, depthWrite: false }));
  spray.name = "Bruma da esteira";
  wake.add(spray);
  return wake;
}

export function createWorld(seed: number, settings: GameSettings): WorldVisuals {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#73999d");
  scene.fog = new THREE.Fog("#78999b", 62, settings.quality === "low" ? 205 : 310);
  const world = new THREE.Group();
  scene.add(world);
  const ambient = new THREE.AmbientLight("#afc1ba", 0.34);
  scene.add(ambient);
  const hemisphere = new THREE.HemisphereLight("#c8e1dc", "#29372f", 2.15);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#ffd3a0", 4.25);
  sun.position.set(-62, 88, 64);
  scene.add(sun.target);
  sun.castShadow = settings.quality !== "low";
  if (sun.castShadow) {
    sun.shadow.mapSize.set(settings.quality === "high" ? 2048 : 1024, settings.quality === "high" ? 2048 : 1024);
    sun.shadow.camera.left = -34;
    sun.shadow.camera.right = 34;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 150;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.026;
  }
  scene.add(sun);
  const fillLight = new THREE.DirectionalLight("#78b5c4", 1.08);
  fillLight.position.set(64, 38, -76);
  scene.add(fillLight);

  const surfaceTexture = createSurfaceTexture();
  const body = createBody(surfaceTexture);
  world.add(body);
  const terrain = createTerrain(surfaceTexture);
  world.add(terrain);
  const environment = createEnvironment(world, seed, settings);
  const obstacles = environment.obstacles;
  obstacles.push(...createCamp(world));
  const wound = createWound(world);
  for (let index = 0; index < 12; index += 1) {
    const angle = index / 12 * Math.PI * 2;
    obstacles.push({
      x: WOUND_POSITION.x + Math.sin(angle) * 4.2,
      z: WOUND_POSITION.z + Math.cos(angle) * 6.65,
      radius: 0.72,
    });
  }
  const resources = createResources(world);
  const groundMeshes: THREE.Mesh[] = [];
  world.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.walkable === true) groundMeshes.push(object);
  });
  const player = createPlayer();
  world.add(player);
  const { group: head, eye: headEye } = createHead(surfaceTexture);
  world.add(head);
  const birds = createBirds();
  world.add(birds);
  const hookPoints = createHookPoints(world);
  obstacles.push(...hookPoints.map((point) => ({ x: point.position.x, z: point.position.z, radius: 0.62 })));
  const secondColossus = createSecondColossus();
  scene.add(secondColossus);

  const sky = createSky();
  scene.add(sky);
  const ocean = createOcean();
  scene.add(ocean);
  const wake = createWake();
  scene.add(wake);
  const rain = createRain(settings.quality === "low" ? 900 : settings.quality === "medium" ? 1_800 : 3_200);
  scene.add(rain);

  return {
    scene, world, player, head, headEye, secondColossus, rain, birds, hookPoints, resources, wound, terrain, sun, hemisphere, sky, ocean, wake, treeWindTime: environment.treeWindTime, obstacles, groundMeshes,
    dispose: () => {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments || object instanceof THREE.InstancedMesh)) return;
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((entry) => entry.dispose());
        else object.material.dispose();
      });
      surfaceTexture.dispose();
    },
  };
}

export function createStructureModel(type: StructureId, ghost = false): THREE.Group {
  const group = new THREE.Group();
  const wood = material(ghost ? "#76bba5" : "#694b32", ghost ? { transparent: true, opacity: 0.48 } : {});
  const cloth = material(ghost ? "#76bba5" : "#77735b", ghost ? { transparent: true, opacity: 0.35 } : { side: THREE.DoubleSide });
  const stone = material(ghost ? "#76bba5" : "#696b60", ghost ? { transparent: true, opacity: 0.4 } : {});
  const addPost = (x: number, z: number, height: number): void => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, height, 6), wood);
    post.position.set(x, height / 2, z);
    post.castShadow = !ghost;
    group.add(post);
  };
  if (type === "fogueira") {
    for (let index = 0; index < 8; index += 1) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25, 0), stone);
      const angle = index / 8 * Math.PI * 2;
      rock.position.set(Math.sin(angle), 0.2, Math.cos(angle));
      group.add(rock);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 7), material(ghost ? "#76bba5" : "#e78038", { emissive: ghost ? "#22554b" : "#a83b16", emissiveIntensity: 2, transparent: true, opacity: 0.82 }));
    flame.name = "structure-flame";
    flame.position.y = 0.85;
    group.add(flame);
    if (!ghost) {
      const fireLight = new THREE.PointLight("#ff9a4d", 2.8, 10, 2);
      fireLight.name = "structure-fire-light";
      fireLight.position.y = 1.2;
      group.add(fireLight);
    }
  } else if (type === "coletor") {
    for (const x of [-1.4, 1.4]) for (const z of [-1, 1]) addPost(x, z, 1.4);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.2, 0.55, 8), cloth);
    basin.position.y = 1.35;
    group.add(basin);
  } else if (type === "bancada" || type === "bau") {
    const box = new THREE.Mesh(new THREE.BoxGeometry(type === "bancada" ? 3.4 : 2.2, type === "bancada" ? 0.3 : 1.35, 1.5), wood);
    box.position.y = type === "bancada" ? 1.25 : 0.72;
    group.add(box);
    if (type === "bancada") for (const x of [-1.25, 1.25]) for (const z of [-0.5, 0.5]) addPost(x, z, 1.25);
  } else if (type === "abrigo") {
    addPost(-2.2, 0, 3.4);
    addPost(2.2, 0, 3.4);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 4.2, 4, 1, true), cloth);
    roof.position.y = 2.05;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
  } else if (type === "cerca") {
    for (const x of [-2, -1, 0, 1, 2]) addPost(x, 0, 2);
    for (const y of [0.7, 1.4]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 4.5, 6), wood);
      rail.rotation.z = Math.PI / 2;
      rail.position.y = y;
      group.add(rail);
    }
  } else if (type === "armadilha") {
    for (let index = 0; index < 8; index += 1) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.4, 5), wood);
      const angle = index / 8 * Math.PI * 2;
      spike.position.set(Math.sin(angle) * 1.1, 0.55, Math.cos(angle) * 1.1);
      spike.rotation.z = Math.sin(angle) * 0.5;
      spike.rotation.x = Math.cos(angle) * -0.5;
      group.add(spike);
    }
  } else {
    for (const x of [-1.6, 1.6]) addPost(x, 0, 3.2);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.18, 6, 14, Math.PI), wood);
    bow.position.y = 2.7;
    bow.rotation.z = Math.PI / 2;
    group.add(bow);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.8, 6), stone);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(0, 2.5, -1.5);
    group.add(bolt);
  }
  group.userData.structureType = type;
  return group;
}

export function createEnemyModel(kind: EnemyKind): THREE.Group {
  const group = new THREE.Group();
  const shell = material(kind === "alfa" ? "#632d2b" : kind === "alado" ? "#4f5250" : "#593b32");
  const flesh = material("#9b5444", { emissive: "#351313", emissiveIntensity: 0.6 });
  const eyeMaterial = material(kind === "alado" ? "#d7ebe6" : "#e5a34e", { emissive: kind === "alado" ? "#85d8cf" : "#a43b1f", emissiveIntensity: 2.2, roughness: 0.3 });
  const scale = kind === "alfa" ? 2.1 : kind === "carrapato" ? 1.25 : 0.82;
  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), shell);
  body.name = "enemy-body";
  body.scale.set(1.25, 0.65, 1.6);
  body.position.y = 0.8;
  body.castShadow = true;
  group.add(body);
  const weakPoint = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), flesh);
  weakPoint.position.set(0, 1.05, -0.8);
  weakPoint.name = "weak-point";
  group.add(weakPoint);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(kind === "alfa" ? 0.16 : 0.11, 7, 5), eyeMaterial);
    eye.position.set(side * 0.36, 1.02, 1.14);
    eye.scale.z = 0.55;
    group.add(eye);
    const feeler = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 1.05, 5), shell);
    feeler.position.set(side * 0.42, 1.38, 0.82);
    feeler.rotation.set(0.72, 0, side * 0.42);
    group.add(feeler);
  }
  if (kind === "alado") {
    for (const side of [-1, 1]) {
      const wingGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(side * 3.4, 0.15, -0.55),
        new THREE.Vector3(side * 1.65, 0.08, 1.6),
        new THREE.Vector3(side * 0.6, 0, 1.0),
      ]);
      wingGeometry.setIndex([0, 1, 2, 0, 2, 3]);
      wingGeometry.computeVertexNormals();
      const wing = new THREE.Mesh(wingGeometry, material("#687471", { side: THREE.DoubleSide, transparent: true, opacity: 0.88 }));
      wing.position.set(side * 0.62, 1.08, 0);
      wing.name = "wing";
      group.add(wing);
    }
  } else {
    const legCount = kind === "escavador" ? 6 : 8;
    for (let index = 0; index < legCount; index += 1) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 1.5, 5), shell);
      const side = index % 2 ? -1 : 1;
      const row = Math.floor(index / 2);
      leg.position.set(side * 0.8, 0.38, (row - (legCount / 2 - 1) / 2) * 0.52);
      leg.rotation.z = side * 1.0;
      leg.name = `enemy-leg-${index}`;
      group.add(leg);
    }
    if (kind === "escavador") {
      for (const side of [-1, 1]) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.25, 5), material("#8b745d"));
        claw.position.set(side * 0.62, 0.55, 1.48);
        claw.rotation.set(Math.PI / 2, 0, side * -0.28);
        claw.name = `mandible-${side}`;
        group.add(claw);
      }
    }
  }
  if (kind === "alfa") {
    for (let index = 0; index < 5; index += 1) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9 + index * 0.1, 5), material("#8c765e"));
      spike.position.set(0, 1.35, -0.75 + index * 0.36);
      spike.rotation.x = (index - 2) * 0.1;
      group.add(spike);
    }
  }
  group.scale.setScalar(scale);
  return group;
}
