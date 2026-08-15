import * as THREE from "three";
import { createEnemyRuntime, updateEnemyMaterialFeedback, type EnemyRuntime } from "./ai";
import { AudioDirector } from "./audio";
import { calculateDamage, weaponRange, WEAPON_PROFILES } from "./combat";
import { getStructure, ITEMS, STRUCTURES, type ItemId, type StructureId } from "./data";
import { EVENT_BANNERS, eventVisualState, weatherForEvent } from "./events";
import { characterLateralAxis, footSurfaceAlignment, solveLegIK, supportPelvisDrop } from "./locomotion";
import {
  CAMP_POSITION,
  CAVITY_POSITION,
  DORSAL_PLATES,
  isInsideDorso,
  MINERAL_SEAM_NODES,
  movementAxes,
  PLAYER_GROUND_OFFSET,
  RUIN_POSITION,
  terrainHeight,
  WOUND_POSITION,
} from "./map";
import { saveGame, type GameSettings } from "./save";
import {
  addItem,
  cloneState,
  consume,
  craft,
  decideWound,
  deriveEvent,
  dismantleStructure,
  EVENT_TIMES,
  objectiveFor,
  placeStructure,
  tickSurvival,
  type EventId,
  type GameState,
  type WeaponId,
} from "./state";
import { createEnemyModel, createStructureModel, createWorld, type EnemyKind, type WorldVisuals } from "./world";

export interface GameSnapshot {
  readonly state: GameState;
  readonly objective: string;
  readonly interaction: string | null;
  readonly station: StructureId | null;
  readonly buildMode: StructureId | null;
  readonly buildValid: boolean;
  readonly totalWeight: number;
  readonly weightCapacity: number;
  readonly enemiesActive: number;
  readonly subtitle: string | null;
  readonly fps: number;
  readonly frameTime: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly paused: boolean;
  readonly grounded: boolean;
  readonly groundError: number;
  readonly posture: {
    readonly bodyPitch: number;
    readonly bodyRoll: number;
    readonly leftKnee: number;
    readonly rightKnee: number;
    readonly leftFootOffset: number;
    readonly rightFootOffset: number;
  };
}

export interface EngineCallbacks {
  readonly onSnapshot: (snapshot: GameSnapshot) => void;
  readonly onToast: (message: string, tone?: "neutral" | "good" | "danger") => void;
  readonly onBanner: (title: string, subtitle: string) => void;
  readonly onWoundPrompt: () => void;
  readonly onDefeat: (reason: string) => void;
  readonly onVictory: (ending: "symbiosis" | "survival") => void;
  readonly onPauseChange: (paused: boolean) => void;
  readonly onPanelRequest: (panel: "inventory" | "crafting" | "building") => void;
}

interface ParticleRuntime {
  readonly mesh: THREE.Mesh;
  readonly velocity: THREE.Vector3;
  life: number;
}

const FIXED_STEP = 1 / 60;
const MAX_STEP_HEIGHT = 0.82;
const MAX_ANKLE_SURFACE_ANGLE = 0.62;
const STRUCTURE_COLLISION_RADIUS: Readonly<Record<StructureId, number>> = {
  fogueira: 0.9,
  coletor: 1.8,
  bancada: 1.85,
  bau: 1.2,
  abrigo: 2.65,
  cerca: 2.5,
  armadilha: 1.25,
  balista: 2.1,
};
const DEBUG_GROUND_POINTS = [
  { x: 0, z: 104 },
  { x: -12, z: 30 },
  { x: 17, z: -5 },
  { x: WOUND_POSITION.x, z: WOUND_POSITION.z },
  { x: CAVITY_POSITION.x, z: CAVITY_POSITION.z },
  { x: 0, z: -118 },
  // Outer flank: the steepest continuous walkable cross-slope in the map.
  { x: 39.5, z: 49 },
  ...DORSAL_PLATES.map(({ x, z }) => ({ x, z })),
] as const;

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const distance2D = (a: THREE.Vector3, b: THREE.Vector3): number => Math.hypot(a.x - b.x, a.z - b.z);

export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly visuals: WorldVisuals;
  private readonly audio: AudioDirector;
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private readonly enemies: EnemyRuntime[] = [];
  private readonly structureMeshes = new Map<string, THREE.Group>();
  private readonly particles: ParticleRuntime[] = [];
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly moveDirection = new THREE.Vector3();
  private readonly forwardDirection = new THREE.Vector3();
  private readonly rightDirection = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly tempVector = new THREE.Vector3();
  private readonly groundRaycaster = new THREE.Raycaster();
  private readonly groundRayOrigin = new THREE.Vector3();
  private readonly groundRayDirection = new THREE.Vector3();
  private readonly localGroundPoint = new THREE.Vector3();
  private readonly inverseWorldMatrix = new THREE.Matrix4();
  private readonly groundNormal = new THREE.Vector3();
  private readonly leftFootNormal = new THREE.Vector3();
  private readonly rightFootNormal = new THREE.Vector3();
  private readonly upDirection = new THREE.Vector3(0, 1, 0);
  private readonly lightingPosition = new THREE.Vector3();
  private state: GameState;
  private settings: GameSettings;
  private animationFrame = 0;
  private accumulator = 0;
  private paused = false;
  private disposed = false;
  private yaw = Math.PI;
  private pitch = -0.12;
  private verticalVelocity = 0;
  private grounded = true;
  private dodgeTimer = 0;
  private attackCooldown = 0;
  private attackPressStarted = -1;
  private blocking = false;
  private blockStartedAt = -10;
  private hitStop = 0;
  private shake = 0;
  private buildMode: StructureId | null = null;
  private buildRotation = 0;
  private buildGhost: THREE.Group | null = null;
  private buildValid = false;
  private currentInteraction: string | null = null;
  private currentResourceId: string | null = null;
  private currentSpecial: "wound" | "hook" | "lore-ruin" | "lore-cavity" | null = null;
  private hookTarget: THREE.Vector3 | null = null;
  private hookTimer = 0;
  private sprintToggled = false;
  private revealTitleShown = false;
  private pointerLockWarningShown = false;
  private nearbyStructureId: string | null = null;
  private currentStation: StructureId | null = null;
  private eventBannerShown = new Set<EventId>();
  private infestationSpawned = false;
  private alphaSpawned = false;
  private diveLossApplied = false;
  private lastCollectorTick = 0;
  private lastSnapshotAt = 0;
  private lastAutosaveAt = 0;
  private frameCounter = 0;
  private frameWindow = 0;
  private measuredFps = 60;
  private measuredFrameTime = 16.7;
  private locomotionPhase = 0;
  private lastFootstepCycle = -1;
  private lightningFlash = 0;
  private postureDebug = { bodyPitch: 0, bodyRoll: 0, leftKnee: 0, rightKnee: 0, leftFootOffset: 0, rightFootOffset: 0 };
  private debugGroundPointIndex = 0;
  private debugCloseCamera = false;
  private subtitle: string | null = null;
  private subtitleUntil = 0;

  constructor(canvas: HTMLCanvasElement, state: GameState, settings: GameSettings, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    this.state = cloneState(state);
    this.yaw = state.player.rotation;
    this.settings = settings;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === "high" ? 1.75 : settings.quality === "medium" ? 1.3 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = settings.quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.08, 700);
    this.visuals = createWorld(state.seed, settings);
    this.audio = new AudioDirector(settings);
    this.syncCollisionTransforms();
    this.visuals.player.position.set(state.player.x, this.surfaceHeightAt(state.player.x, state.player.z), state.player.z);
    this.visuals.player.rotation.y = state.player.rotation;
    this.createParticlePool(settings.quality === "low" ? 24 : 52);
    this.restoreWorldState();
    this.spawnInitialEnemies();
    this.bindEvents();
    this.resize();
    this.updateCamera(1);
  }

  start(): void {
    void this.audio.start();
    this.clock.start();
    this.loop();
    this.callbacks.onBanner("DESPERTAR", "O sal cobre tudo. A fogueira ainda guarda um sopro de calor.");
  }

  getState(): GameState {
    return cloneState(this.state);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.callbacks.onPauseChange(paused);
    if (!paused) {
      this.clock.getDelta();
      void this.audio.start();
      this.canvas.focus();
    } else {
      saveGame(this.state);
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    this.emitSnapshot(true);
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
    this.audio.applySettings(settings);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.quality === "high" ? 1.75 : settings.quality === "medium" ? 1.3 : 1));
    this.renderer.shadowMap.enabled = settings.quality !== "low";
    this.resize();
  }

  craft(recipeId: string): void {
    const stations = new Set<StructureId>(this.state.structures.map((structure) => structure.type));
    if (distance2D(this.visuals.player.position, new THREE.Vector3(CAMP_POSITION.x, 0, CAMP_POSITION.z)) < 7) stations.add("fogueira");
    const result = craft(this.state, recipeId, stations);
    if (result.ok) this.audio.play("craft");
    this.callbacks.onToast(result.message, result.ok ? "good" : "danger");
    this.emitSnapshot(true);
  }

  useItem(item: ItemId): void {
    const result = consume(this.state, item);
    if (result.ok) this.audio.play("craft");
    this.callbacks.onToast(result.message, result.ok ? "good" : "danger");
    this.emitSnapshot(true);
  }

  selectWeapon(weapon: WeaponId): void {
    if (weapon !== "improvisada" && this.state.inventory[weapon] <= 0) {
      this.callbacks.onToast(`${ITEMS[weapon].name} ainda não foi fabricado.`, "danger");
      return;
    }
    this.state.weapon = weapon;
    this.callbacks.onToast(weapon === "improvisada" ? "Faca improvisada equipada." : `${ITEMS[weapon].name} equipada.`);
    this.emitSnapshot(true);
  }

  setBuildMode(type: StructureId | null): void {
    if (this.buildGhost) {
      this.visuals.world.remove(this.buildGhost);
      disposeGroup(this.buildGhost);
      this.buildGhost = null;
    }
    this.buildMode = type;
    if (type) {
      this.buildGhost = createStructureModel(type, true);
      this.visuals.world.add(this.buildGhost);
      this.callbacks.onToast("Posicione com o mouse · R gira · clique constrói · Esc cancela");
    }
    this.emitSnapshot(true);
  }

  chooseWound(decision: "healed" | "harvested"): void {
    const result = decideWound(this.state, decision);
    this.callbacks.onToast(result.message, result.ok ? (decision === "healed" ? "good" : "neutral") : "danger");
    if (result.ok) {
      this.audio.play("pulse");
      this.visuals.wound.scale.setScalar(decision === "healed" ? 0.72 : 1.18);
      const core = this.visuals.wound.children.find((child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.CircleGeometry);
      if (core instanceof THREE.Mesh && core.material instanceof THREE.MeshStandardMaterial) core.material.color.set(decision === "healed" ? "#244f47" : "#651b26");
    }
    this.emitSnapshot(true);
  }

  manualSave(): void {
    const ok = saveGame(this.state);
    this.callbacks.onToast(ok ? "Jornada salva." : "Não foi possível salvar neste navegador.", ok ? "good" : "danger");
  }

  dismantleNearest(): void {
    if (!this.nearbyStructureId) {
      this.callbacks.onToast("Nenhuma estrutura próxima.", "danger");
      return;
    }
    const id = this.nearbyStructureId;
    const result = dismantleStructure(this.state, id);
    const mesh = this.structureMeshes.get(id);
    if (result.ok && mesh) {
      this.visuals.world.remove(mesh);
      disposeGroup(mesh);
      this.structureMeshes.delete(id);
    }
    this.callbacks.onToast(result.message, result.ok ? "good" : "danger");
    this.emitSnapshot(true);
  }

  debugAdvanceEvent(): void {
    const thresholds: Record<EventId, number> = {
      despertar: EVENT_TIMES.rain + 1,
      chuva: EVENT_TIMES.divePeak,
      mergulho: EVENT_TIMES.alpha + 1,
      infestacao: EVENT_TIMES.encounter + 44,
      encontro: EVENT_TIMES.victory + 1,
      conclusao: EVENT_TIMES.victory + 1,
    };
    this.state.elapsed = thresholds[this.state.event];
    this.callbacks.onToast("Evento avançado para teste.");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.cancelAnimationFrame(this.animationFrame);
    saveGame(this.state);
    this.unbindEvents();
    this.audio.dispose();
    this.visuals.dispose();
    this.renderer.dispose();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape") {
      if (this.buildMode) this.setBuildMode(null);
      else this.setPaused(!this.paused);
      return;
    }
    if (this.paused) return;
    this.keys.add(event.code);
    if (event.code === "KeyE") this.interact();
    if (event.code === "KeyQ") this.tryDodge();
    if (event.code === "KeyR") {
      if (this.buildMode) this.buildRotation += Math.PI / 4;
      else if (this.state.weapon === "lança") this.attack(true, true);
    }
    if (event.code === "KeyG") this.useHook();
    if ((event.code === "ShiftLeft" || event.code === "ShiftRight") && !this.settings.holdToSprint && !event.repeat) this.sprintToggled = !this.sprintToggled;
    if (event.code === "Digit1") this.selectWeapon("lança");
    if (event.code === "Digit2") this.selectWeapon("machado");
    if (event.code === "Digit3") this.selectWeapon("arco");
    if (event.code === "F3") document.body.classList.toggle("show-debug");
    const debugEnabled = new URLSearchParams(window.location.search).has("debug");
    if (event.code === "KeyP" && debugEnabled) this.debugAdvanceEvent();
    if (event.code === "KeyK" && debugEnabled) this.state.stats.health = 0;
    if (event.code === "KeyO" && debugEnabled) {
      const inspectionNode = MINERAL_SEAM_NODES[13] ?? { x: 38, z: 28 };
      this.syncCollisionTransforms();
      this.visuals.player.position.set(inspectionNode.x, this.surfaceHeightAt(inspectionNode.x, inspectionNode.z), inspectionNode.z);
      this.state.player.x = inspectionNode.x;
      this.state.player.z = inspectionNode.z;
    }
    if (event.code === "KeyJ" && debugEnabled) {
      const point = DEBUG_GROUND_POINTS[this.debugGroundPointIndex % DEBUG_GROUND_POINTS.length];
      this.debugGroundPointIndex += 1;
      const { x, z } = point;
      this.syncCollisionTransforms();
      this.visuals.player.position.set(x, this.surfaceHeightAt(x, z), z);
      this.state.player.x = x;
      this.state.player.z = z;
    }
    if (event.code === "KeyF" && debugEnabled) {
      this.visuals.player.rotation.y = 0;
      this.state.player.rotation = 0;
    }
    if (event.code === "KeyH" && debugEnabled && !event.repeat) this.debugCloseCamera = !this.debugCloseCamera;
    if (event.code === "KeyV" && debugEnabled) {
      this.state.completed = false;
      this.state.event = "encontro";
      this.state.elapsed = EVENT_TIMES.victory + 1;
      this.visuals.player.position.z = -116;
      this.state.player.z = -116;
    }
    if (event.code === "Tab" || event.code === "KeyI") {
      event.preventDefault();
      this.callbacks.onPanelRequest("inventory");
    }
    if (event.code === "KeyC") this.callbacks.onPanelRequest("crafting");
    if (event.code === "KeyB") this.callbacks.onPanelRequest("building");
    if (event.code === "Space" && this.grounded) {
      this.verticalVelocity = 6.3;
      this.grounded = false;
      this.audio.play("jump");
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (this.paused || document.pointerLockElement !== this.canvas) return;
    const sensitivity = this.settings.sensitivity * 0.0025;
    this.yaw -= event.movementX * sensitivity;
    this.pitch += event.movementY * sensitivity * (this.settings.invertY ? 1 : -1);
    this.pitch = clamp(this.pitch, -0.86, 0.42);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (this.paused) return;
    void this.audio.start();
    if (event.button === 0 && this.buildMode) {
      this.placeCurrentStructure();
      return;
    }
    if (document.pointerLockElement !== this.canvas) {
      void this.canvas.requestPointerLock().catch(() => {
        if (this.pointerLockWarningShown) return;
        this.pointerLockWarningShown = true;
        this.callbacks.onToast("O navegador bloqueou a captura do mouse. Clique novamente ou use Esc para liberar.");
      });
      return;
    }
    if (event.button === 0) {
      this.attackPressStarted = performance.now();
    }
    if (event.button === 2) {
      this.blocking = true;
      this.blockStartedAt = this.state.elapsed;
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0 && this.attackPressStarted >= 0 && !this.buildMode) {
      const held = performance.now() - this.attackPressStarted;
      this.attackPressStarted = -1;
      this.attack(held >= 420, false);
    }
    if (event.button === 2) this.blocking = false;
  };

  private readonly handleContextMenu = (event: MouseEvent): void => event.preventDefault();
  private readonly handleResize = (): void => this.resize();
  private readonly handleVisibility = (): void => { if (document.hidden && !this.paused) this.setPaused(true); };

  private bindEvents(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("resize", this.handleResize);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("contextmenu", this.handleContextMenu);
  }

  private unbindEvents(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("resize", this.handleResize);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
  }

  private restoreWorldState(): void {
    for (const resource of this.visuals.resources) resource.object.visible = !this.state.collectedResources.includes(resource.id);
    for (const structure of this.state.structures) this.addStructureVisual(structure.id, structure.type, structure.x, structure.z, structure.rotation);
    if (this.state.woundDecision !== "undecided") this.visuals.wound.scale.setScalar(this.state.woundDecision === "healed" ? 0.72 : 1.18);
  }

  private spawnInitialEnemies(): void {
    this.spawnEnemy("burrow-1", "escavador", -14, 34);
    this.spawnEnemy("tick-1", "carrapato", 17, -49);
    this.spawnEnemy("wing-1", "alado", 20, 77);
  }

  private spawnInfestation(): void {
    if (this.infestationSpawned) return;
    this.infestationSpawned = true;
    const wave: readonly [string, EnemyKind, number, number][] = [
      ["wave-burrow-1", "escavador", 4, -39], ["wave-burrow-2", "escavador", -6, -52],
      ["wave-tick-1", "carrapato", 18, -44], ["wave-tick-2", "carrapato", 8, -61],
      ["wave-wing-1", "alado", 1, -67], ["wave-wing-2", "alado", 23, -32],
    ];
    wave.forEach(([id, kind, x, z]) => this.spawnEnemy(id, kind, x, z));
    this.state.finalWaveRemaining = wave.length + 1;
  }

  private spawnAlpha(): void {
    if (this.alphaSpawned) return;
    this.alphaSpawned = true;
    this.spawnEnemy("parasita-alfa", "alfa", 12, -55);
    this.callbacks.onBanner("PARASITA ALFA", "A ferida se abre. O dorso inteiro estremece.");
    this.audio.play("thunder");
  }

  private spawnEnemy(id: string, kind: EnemyKind, x: number, z: number): void {
    if (this.state.defeatedEnemies.includes(id)) return;
    const mesh = createEnemyModel(kind);
    const y = terrainHeight(x, z);
    mesh.position.set(x, y + (kind === "alado" ? 7 : 0), z);
    mesh.visible = true;
    this.visuals.world.add(mesh);
    this.enemies.push(createEnemyRuntime(id, kind, mesh, new THREE.Vector3(x, y, z)));
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.animationFrame = window.requestAnimationFrame(this.loop);
    const rawDelta = Math.min(0.1, this.clock.getDelta());
    this.frameCounter += 1;
    this.frameWindow += rawDelta;
    if (this.frameWindow >= 0.6) {
      this.measuredFps = Math.round(this.frameCounter / this.frameWindow);
      this.measuredFrameTime = Math.round((this.frameWindow / this.frameCounter) * 10_000) / 10;
      this.frameCounter = 0;
      this.frameWindow = 0;
    }
    if (!this.paused) {
      if (this.hitStop > 0) this.hitStop -= rawDelta;
      else {
        this.accumulator += rawDelta;
        while (this.accumulator >= FIXED_STEP) {
          this.fixedUpdate(FIXED_STEP);
          this.accumulator -= FIXED_STEP;
        }
      }
      this.updateVisuals(rawDelta);
    }
    this.renderer.render(this.visuals.scene, this.camera);
  };

  private fixedUpdate(delta: number): void {
    this.updatePlayer(delta);
    this.updateInteraction();
    this.updateEnemies(delta);
    this.updateParticles(delta);
    this.updateEvents(delta);
    const sheltered = this.nearbyStructureId !== null && this.state.structures.some((entry) => entry.id === this.nearbyStructureId && entry.type === "abrigo");
    const nearFire = distance2D(this.visuals.player.position, new THREE.Vector3(CAMP_POSITION.x, 0, CAMP_POSITION.z)) < 6 || this.nearbyStructureId !== null && this.state.structures.some((entry) => entry.id === this.nearbyStructureId && entry.type === "fogueira");
    tickSurvival(this.state, delta, sheltered, nearFire);
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - delta);
    if (this.subtitle && this.state.elapsed > this.subtitleUntil) this.subtitle = null;
    if (this.state.stats.health <= 0) {
      this.setPaused(true);
      this.callbacks.onDefeat(this.state.stats.thirst <= 0 ? "A sede venceu antes do amanhecer." : "O dorso segue viagem sem você.");
      return;
    }
    if (this.state.elapsed - this.lastAutosaveAt >= 30) {
      saveGame(this.state);
      this.lastAutosaveAt = this.state.elapsed;
    }
    this.emitSnapshot(false);
  }

  private syncCollisionTransforms(): void {
    this.visuals.world.updateMatrixWorld(true);
    this.inverseWorldMatrix.copy(this.visuals.world.matrixWorld).invert();
  }

  private surfaceHeightAt(x: number, z: number, clearance = PLAYER_GROUND_OFFSET): number {
    this.groundRayOrigin.set(x, 80, z).applyMatrix4(this.visuals.world.matrixWorld);
    this.groundRayDirection.set(0, -1, 0).transformDirection(this.visuals.world.matrixWorld);
    this.groundRaycaster.set(this.groundRayOrigin, this.groundRayDirection);
    this.groundRaycaster.near = 0;
    this.groundRaycaster.far = 180;
    const hit = this.groundRaycaster.intersectObjects(this.visuals.groundMeshes, false)[0];
    if (!hit) return terrainHeight(x, z) + clearance;
    this.localGroundPoint.copy(hit.point).applyMatrix4(this.inverseWorldMatrix);
    return this.localGroundPoint.y + clearance;
  }

  private surfaceNormalAt(x: number, z: number, target = this.groundNormal): THREE.Vector3 {
    const sampleDistance = 0.42;
    const left = this.surfaceHeightAt(x - sampleDistance, z, 0);
    const right = this.surfaceHeightAt(x + sampleDistance, z, 0);
    const back = this.surfaceHeightAt(x, z - sampleDistance, 0);
    const front = this.surfaceHeightAt(x, z + sampleDistance, 0);
    return target.set(left - right, sampleDistance * 2, back - front).normalize();
  }

  private alignObjectToSurface(object: THREE.Object3D, x: number, z: number, yaw: number): void {
    object.quaternion.setFromUnitVectors(this.upDirection, this.surfaceNormalAt(x, z));
    object.rotateY(yaw);
  }

  private updatePlayer(delta: number): void {
    this.syncCollisionTransforms();
    if (this.hookTarget && this.hookTimer > 0) {
      this.hookTimer -= delta;
      this.tempVector.copy(this.hookTarget).sub(this.visuals.player.position);
      const remaining = this.tempVector.length();
      if (remaining < 1.2 || this.hookTimer <= 0) {
        this.visuals.player.position.copy(this.hookTarget);
        this.hookTarget = null;
        this.hookTimer = 0;
        this.grounded = true;
      } else {
        this.tempVector.normalize();
        this.visuals.player.position.addScaledVector(this.tempVector, Math.min(remaining, delta * 18));
        this.visuals.player.position.y += Math.sin((1 - this.hookTimer / 0.8) * Math.PI) * delta * 3;
      }
      this.state.player.x = this.visuals.player.position.x;
      this.state.player.z = this.visuals.player.position.z;
      this.updatePlayerAnimation(delta, true, true);
      return;
    }
    const axes = movementAxes(this.yaw);
    this.forwardDirection.set(axes.forwardX, 0, axes.forwardZ);
    this.rightDirection.set(axes.rightX, 0, axes.rightZ);
    this.moveDirection.set(0, 0, 0);
    if (this.keys.has("KeyW")) this.moveDirection.add(this.forwardDirection);
    if (this.keys.has("KeyS")) this.moveDirection.sub(this.forwardDirection);
    if (this.keys.has("KeyD")) this.moveDirection.add(this.rightDirection);
    if (this.keys.has("KeyA")) this.moveDirection.sub(this.rightDirection);
    if (this.moveDirection.lengthSq() > 0) this.moveDirection.normalize();
    const wantsSprint = this.settings.holdToSprint ? this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") : this.sprintToggled;
    const canSprint = wantsSprint && this.state.stats.stamina > 4 && this.moveDirection.lengthSq() > 0;
    const thirstyPenalty = this.state.stats.thirst < 12 ? 0.72 : 1;
    const speed = (canSprint ? 8.7 : 5.1) * thirstyPenalty * (this.dodgeTimer > 0 ? 1.9 : 1);
    if (canSprint) this.state.stats.stamina = Math.max(0, this.state.stats.stamina - delta * 18);
    else {
      const hungerFactor = this.state.stats.hunger < 20 ? 0.42 : 1;
      this.state.stats.stamina = Math.min(100, this.state.stats.stamina + delta * 13 * hungerFactor);
    }
    this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, this.moveDirection.x * speed, 9, delta);
    this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, this.moveDirection.z * speed, 9, delta);
    const nextX = this.visuals.player.position.x + this.playerVelocity.x * delta;
    const nextZ = this.visuals.player.position.z + this.playerVelocity.z * delta;
    const groundBeforeMove = this.surfaceHeightAt(this.visuals.player.position.x, this.visuals.player.position.z);
    let traversedGround = groundBeforeMove;
    if (this.canPlayerOccupy(nextX, this.visuals.player.position.z)) {
      const candidateGround = this.surfaceHeightAt(nextX, this.visuals.player.position.z);
      if (candidateGround - traversedGround <= MAX_STEP_HEIGHT || this.visuals.player.position.y >= candidateGround) {
        this.visuals.player.position.x = nextX;
        traversedGround = candidateGround;
      }
    }
    if (this.canPlayerOccupy(this.visuals.player.position.x, nextZ)) {
      const candidateGround = this.surfaceHeightAt(this.visuals.player.position.x, nextZ);
      if (candidateGround - traversedGround <= MAX_STEP_HEIGHT || this.visuals.player.position.y >= candidateGround) {
        this.visuals.player.position.z = nextZ;
      }
    }
    const ground = this.surfaceHeightAt(this.visuals.player.position.x, this.visuals.player.position.z);
    if (this.grounded && groundBeforeMove - ground > 0.72) {
      this.grounded = false;
      this.verticalVelocity = 0;
    }
    if (!this.grounded) {
      this.verticalVelocity -= 16 * delta;
      this.visuals.player.position.y += this.verticalVelocity * delta;
      if (this.visuals.player.position.y <= ground) {
        const fallSpeed = -this.verticalVelocity;
        this.visuals.player.position.y = ground;
        this.verticalVelocity = 0;
        this.grounded = true;
        this.audio.play("land");
        if (fallSpeed > 11) {
          const damage = Math.round((fallSpeed - 10) * 4);
          this.damagePlayer(damage, "queda");
        }
      }
    } else {
      this.visuals.player.position.y = ground;
    }
    if (this.moveDirection.lengthSq() > 0.01) {
      const targetRotation = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      this.visuals.player.rotation.y = angleDamp(this.visuals.player.rotation.y, targetRotation, 12, delta);
    }
    this.updatePlayerAnimation(delta, this.moveDirection.lengthSq() > 0.01, canSprint);
    this.state.player.x = this.visuals.player.position.x;
    this.state.player.z = this.visuals.player.position.z;
    this.state.player.rotation = this.visuals.player.rotation.y;
  }

  private canPlayerOccupy(x: number, z: number): boolean {
    if (!isInsideDorso(x, z, 2.4)) return false;
    return this.visuals.obstacles.every((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) > obstacle.radius + 0.44)
      && this.state.structures.every((structure) => Math.hypot(x - structure.x, z - structure.z) > STRUCTURE_COLLISION_RADIUS[structure.type] + 0.44);
  }

  private updatePlayerAnimation(delta: number, moving: boolean, sprinting: boolean): void {
    const rig = this.visuals.player.getObjectByName("character-rig");
    if (!rig) return;
    const locomotionSpeed = sprinting ? 14.5 : 9.2;
    this.locomotionPhase += delta * (moving ? locomotionSpeed : 2.2);
    const wave = Math.sin(this.locomotionPhase);
    const stride = moving ? (sprinting ? 0.86 : 0.58) : 0;
    const airborne = !this.grounded;
    const bobTarget = moving ? Math.abs(Math.sin(this.locomotionPhase)) * (sprinting ? 0.1 : 0.055) : Math.sin(this.state.elapsed * 2.2) * 0.018;

    const legLeft = rig.getObjectByName("leg-left");
    const legRight = rig.getObjectByName("leg-right");
    const kneeLeft = rig.getObjectByName("knee-left");
    const kneeRight = rig.getObjectByName("knee-right");
    const ankleLeft = rig.getObjectByName("ankle-left");
    const ankleRight = rig.getObjectByName("ankle-right");
    const armLeft = rig.getObjectByName("arm-left");
    const armRight = rig.getObjectByName("arm-right");
    const forearmLeft = rig.getObjectByName("forearm-left");
    const forearmRight = rig.getObjectByName("forearm-right");
    const torso = rig.getObjectByName("torso");
    const pelvis = rig.getObjectByName("pelvis");
    const head = rig.getObjectByName("head-rig");
    const scarf = rig.getObjectByName("scarf-tail");
    const coatFront = rig.getObjectByName("coat-front");
    const coatBack = rig.getObjectByName("coat-back");
    const coatLeft = rig.getObjectByName("coat-left");
    const coatRight = rig.getObjectByName("coat-right");
    const attackSwing = this.attackCooldown > 0 ? Math.sin(clamp(this.attackCooldown * 7.5, 0, Math.PI)) : 0;

    const facing = movementAxes(this.visuals.player.rotation.y);
    const rootGround = this.surfaceHeightAt(this.visuals.player.position.x, this.visuals.player.position.z);
    // Gravity defines the body's vertical axis. Uneven ground is absorbed by
    // independent legs instead of tilting the whole character like a rigid prop.
    rig.rotation.x = THREE.MathUtils.damp(rig.rotation.x, 0, 15, delta);
    rig.rotation.z = THREE.MathUtils.damp(rig.rotation.z, 0, 15, delta);

    const strideProbe = moving ? wave * (sprinting ? 0.2 : 0.13) : 0;
    const rigRight = characterLateralAxis(facing.forwardX, facing.forwardZ);
    const leftFootX = this.visuals.player.position.x - rigRight.x * 0.22 - facing.forwardX * strideProbe;
    const leftFootZ = this.visuals.player.position.z - rigRight.z * 0.22 - facing.forwardZ * strideProbe;
    const rightFootX = this.visuals.player.position.x + rigRight.x * 0.22 + facing.forwardX * strideProbe;
    const rightFootZ = this.visuals.player.position.z + rigRight.z * 0.22 + facing.forwardZ * strideProbe;
    const leftFootHeight = this.surfaceHeightAt(leftFootX, leftFootZ);
    const rightFootHeight = this.surfaceHeightAt(rightFootX, rightFootZ);
    const leftGroundOffset = airborne ? 0 : leftFootHeight - rootGround;
    const rightGroundOffset = airborne ? 0 : rightFootHeight - rootGround;
    const pelvisDrop = airborne ? 0 : supportPelvisDrop(leftGroundOffset, rightGroundOffset);
    rig.position.y = THREE.MathUtils.damp(rig.position.y, bobTarget + pelvisDrop, 16, delta);

    for (const leg of [legLeft, legRight]) {
      if (!leg) continue;
      const baseY = typeof leg.userData.baseY === "number" ? leg.userData.baseY : 1.08;
      leg.position.y = THREE.MathUtils.damp(leg.position.y, baseY, 20, delta);
    }

    const strideReach = moving ? (sprinting ? 0.42 : 0.3) : 0;
    const stepLift = moving ? (sprinting ? 0.16 : 0.1) : 0;
    const leftIK = solveLegIK({
      hipHeight: 1.08 + pelvisDrop,
      groundOffset: leftGroundOffset,
      forwardOffset: -wave * strideReach,
      swingLift: Math.max(0, -wave) * stepLift,
    });
    const rightIK = solveLegIK({
      hipHeight: 1.08 + pelvisDrop,
      groundOffset: rightGroundOffset,
      forwardOffset: wave * strideReach,
      swingLift: Math.max(0, wave) * stepLift,
    });
    const leftHipAngle = airborne ? 0.5 : leftIK.hipAngle;
    const rightHipAngle = airborne ? -0.35 : rightIK.hipAngle;
    const leftKneeBend = airborne ? 0.72 : leftIK.kneeAngle;
    const rightKneeBend = airborne ? 0.48 : rightIK.kneeAngle;
    if (legLeft) legLeft.rotation.x = THREE.MathUtils.damp(legLeft.rotation.x, leftHipAngle, 17, delta);
    if (legRight) legRight.rotation.x = THREE.MathUtils.damp(legRight.rotation.x, rightHipAngle, 17, delta);
    if (kneeLeft) kneeLeft.rotation.x = THREE.MathUtils.damp(kneeLeft.rotation.x, leftKneeBend, 17, delta);
    if (kneeRight) kneeRight.rotation.x = THREE.MathUtils.damp(kneeRight.rotation.x, rightKneeBend, 17, delta);
    this.surfaceNormalAt(leftFootX, leftFootZ, this.leftFootNormal);
    this.surfaceNormalAt(rightFootX, rightFootZ, this.rightFootNormal);
    const leftSurface = footSurfaceAlignment({
      normalX: this.leftFootNormal.x,
      normalY: this.leftFootNormal.y,
      normalZ: this.leftFootNormal.z,
      forwardX: facing.forwardX,
      forwardZ: facing.forwardZ,
    });
    const rightSurface = footSurfaceAlignment({
      normalX: this.rightFootNormal.x,
      normalY: this.rightFootNormal.y,
      normalZ: this.rightFootNormal.z,
      forwardX: facing.forwardX,
      forwardZ: facing.forwardZ,
    });
    if (ankleLeft) {
      const pitchTarget = airborne ? -0.08 : clamp(leftSurface.pitch, -MAX_ANKLE_SURFACE_ANGLE, MAX_ANKLE_SURFACE_ANGLE) + leftIK.ankleCounterAngle;
      const rollTarget = airborne ? 0 : clamp(leftSurface.roll, -MAX_ANKLE_SURFACE_ANGLE, MAX_ANKLE_SURFACE_ANGLE);
      ankleLeft.rotation.x = THREE.MathUtils.damp(ankleLeft.rotation.x, pitchTarget, 18, delta);
      ankleLeft.rotation.y = THREE.MathUtils.damp(ankleLeft.rotation.y, 0, 18, delta);
      ankleLeft.rotation.z = THREE.MathUtils.damp(ankleLeft.rotation.z, rollTarget, 18, delta);
    }
    if (ankleRight) {
      const pitchTarget = airborne ? -0.08 : clamp(rightSurface.pitch, -MAX_ANKLE_SURFACE_ANGLE, MAX_ANKLE_SURFACE_ANGLE) + rightIK.ankleCounterAngle;
      const rollTarget = airborne ? 0 : clamp(rightSurface.roll, -MAX_ANKLE_SURFACE_ANGLE, MAX_ANKLE_SURFACE_ANGLE);
      ankleRight.rotation.x = THREE.MathUtils.damp(ankleRight.rotation.x, pitchTarget, 18, delta);
      ankleRight.rotation.y = THREE.MathUtils.damp(ankleRight.rotation.y, 0, 18, delta);
      ankleRight.rotation.z = THREE.MathUtils.damp(ankleRight.rotation.z, rollTarget, 18, delta);
    }
    this.postureDebug = {
      bodyPitch: rig.rotation.x,
      bodyRoll: rig.rotation.z,
      leftKnee: kneeLeft?.rotation.x ?? 0,
      rightKnee: kneeRight?.rotation.x ?? 0,
      leftFootOffset: leftGroundOffset,
      rightFootOffset: rightGroundOffset,
    };
    if (armLeft) armLeft.rotation.x = THREE.MathUtils.damp(armLeft.rotation.x, airborne ? -0.72 : -wave * stride * 0.72, 13, delta);
    if (armRight) armRight.rotation.x = THREE.MathUtils.damp(armRight.rotation.x, airborne ? -1.05 : wave * stride * 0.72 - attackSwing * 1.65, 16, delta);
    if (armRight) armRight.rotation.z = THREE.MathUtils.damp(armRight.rotation.z, attackSwing * -0.48, 18, delta);
    if (forearmLeft) forearmLeft.rotation.x = THREE.MathUtils.damp(forearmLeft.rotation.x, moving ? -0.16 - Math.max(0, wave) * 0.3 : -0.08, 12, delta);
    if (forearmRight) forearmRight.rotation.x = THREE.MathUtils.damp(forearmRight.rotation.x, -0.12 - attackSwing * 1.18 - Math.max(0, -wave) * stride * 0.25, 15, delta);
    if (torso) {
      torso.rotation.x = THREE.MathUtils.damp(torso.rotation.x, moving ? (sprinting ? 0.2 : 0.08) : Math.sin(this.state.elapsed * 1.1) * 0.018, 9, delta);
      torso.rotation.z = THREE.MathUtils.damp(torso.rotation.z, moving ? -wave * 0.035 : 0, 10, delta);
      torso.rotation.y = THREE.MathUtils.damp(torso.rotation.y, moving ? -wave * (sprinting ? 0.11 : 0.065) : 0, 10, delta);
    }
    if (pelvis) {
      pelvis.rotation.y = THREE.MathUtils.damp(pelvis.rotation.y, moving ? wave * (sprinting ? 0.13 : 0.075) : 0, 12, delta);
      pelvis.rotation.z = THREE.MathUtils.damp(pelvis.rotation.z, moving ? wave * 0.025 : 0, 10, delta);
    }
    if (head) {
      head.rotation.x = THREE.MathUtils.damp(head.rotation.x, moving ? (sprinting ? -0.1 : -0.035) : Math.sin(this.state.elapsed * 0.72) * 0.025, 8, delta);
      head.rotation.y = THREE.MathUtils.damp(head.rotation.y, moving ? -wave * 0.055 : Math.sin(this.state.elapsed * 0.46) * 0.08, 7, delta);
    }
    if (scarf) {
      scarf.rotation.x = THREE.MathUtils.damp(scarf.rotation.x, 1.02 + (moving ? 0.2 : 0.04) + Math.sin(this.locomotionPhase * 0.72) * 0.08, 8, delta);
      scarf.rotation.y = THREE.MathUtils.damp(scarf.rotation.y, -0.18 + wave * (moving ? 0.16 : 0.035), 7, delta);
    }
    const clothFlow = moving ? (sprinting ? 0.25 : 0.12) : 0.025;
    if (coatFront) coatFront.rotation.x = THREE.MathUtils.damp(coatFront.rotation.x, clothFlow + Math.abs(wave) * stride * 0.08, 9, delta);
    if (coatBack) coatBack.rotation.x = THREE.MathUtils.damp(coatBack.rotation.x, clothFlow * 0.72 - Math.abs(wave) * 0.035, 8, delta);
    if (coatLeft) coatLeft.rotation.z = THREE.MathUtils.damp(coatLeft.rotation.z, moving ? -wave * 0.09 : 0, 9, delta);
    if (coatRight) coatRight.rotation.z = THREE.MathUtils.damp(coatRight.rotation.z, moving ? wave * 0.09 : 0, 9, delta);
    const blink = Math.sin(this.state.elapsed * 0.73) > 0.992 ? 0.08 : 1;
    for (const name of ["eye-left", "eye-right"] as const) {
      const eye = rig.getObjectByName(name);
      if (eye) {
        const baseScaleY = typeof eye.userData.baseScaleY === "number" ? eye.userData.baseScaleY : 0.72;
        eye.scale.y = THREE.MathUtils.damp(eye.scale.y, baseScaleY * blink, 28, delta);
      }
    }
    if (moving && !airborne) {
      const footstepCycle = Math.floor(this.locomotionPhase / Math.PI);
      if (footstepCycle !== this.lastFootstepCycle) {
        this.lastFootstepCycle = footstepCycle;
        const inShallowWater = this.visuals.player.position.z > 12
          && this.visuals.player.position.z < 48
          && Math.hypot((this.visuals.player.position.x + 12) / 11, (this.visuals.player.position.z - 30) / 20) < 1;
        this.audio.play(inShallowWater ? "splash" : "footstep");
      }
    }
  }

  private updateInteraction(): void {
    this.currentInteraction = null;
    this.currentResourceId = null;
    this.currentSpecial = null;
    this.nearbyStructureId = null;
    this.currentStation = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const resource of this.visuals.resources) {
      if (!resource.object.visible) continue;
      const distance = distance2D(this.visuals.player.position, resource.object.position);
      if (distance < 3.1 && distance < nearestDistance) {
        nearestDistance = distance;
        this.currentInteraction = `E  Coletar ${resource.label}`;
        this.currentResourceId = resource.id;
      }
    }
    const woundDistance = distance2D(this.visuals.player.position, this.visuals.wound.position);
    if (woundDistance < 5 && woundDistance < nearestDistance && this.state.woundDecision === "undecided") {
      nearestDistance = woundDistance;
      this.currentInteraction = "E  Examinar a Ferida Antiga";
      this.currentSpecial = "wound";
    }
    for (const hookPoint of this.visuals.hookPoints) {
      const distance = distance2D(this.visuals.player.position, hookPoint.position);
      if (distance < 13 && distance < nearestDistance) {
        nearestDistance = distance;
        this.currentInteraction = "G  Usar gancho ósseo";
        this.currentSpecial = "hook";
      }
    }
    const loreNodes: readonly ["lore-ruin" | "lore-cavity", number, number, string][] = [
      ["lore-ruin", RUIN_POSITION.x, RUIN_POSITION.z, "E  Ler inscrição da ruína"],
      ["lore-cavity", CAVITY_POSITION.x, CAVITY_POSITION.z, "E  Escutar a cavidade respiratória"],
    ];
    for (const [id, x, z, prompt] of loreNodes) {
      if (this.state.collectedResources.includes(id)) continue;
      const distance = Math.hypot(this.state.player.x - x, this.state.player.z - z);
      if (distance < 4.5 && distance < nearestDistance) {
        nearestDistance = distance;
        this.currentInteraction = prompt;
        this.currentSpecial = id;
      }
    }
    for (const structure of this.state.structures) {
      const distance = Math.hypot(this.state.player.x - structure.x, this.state.player.z - structure.z);
      if (distance < 4.2 && distance < nearestDistance) {
        nearestDistance = distance;
        this.nearbyStructureId = structure.id;
        this.currentStation = structure.type;
        this.currentInteraction = structure.type === "coletor" ? "E  Recolher água · X desmontar" : structure.type === "abrigo" ? "E  Descansar · X desmontar" : `E  Usar ${getStructure(structure.type).name} · X desmontar`;
      }
    }
    if (this.keys.has("KeyX")) {
      this.keys.delete("KeyX");
      this.dismantleNearest();
    }
  }

  private interact(): void {
    if (this.currentSpecial === "wound") {
      this.callbacks.onWoundPrompt();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      return;
    }
    if (this.currentSpecial === "lore-ruin" || this.currentSpecial === "lore-cavity") {
      const isRuin = this.currentSpecial === "lore-ruin";
      this.state.collectedResources.push(this.currentSpecial);
      this.subtitle = isRuin ? "[placa gravada: 'Não somos passageiros. Somos o rebanho.']" : "[três batimentos — e uma resposta muito distante]";
      this.subtitleUntil = this.state.elapsed + 7;
      this.callbacks.onToast(isRuin ? "Registro: o mapa marca outras sete rotas migratórias." : "Algo dentro do colosso parece reconhecer seu pulso.");
      this.state.symbiosis = Math.min(100, this.state.symbiosis + 2);
      return;
    }
    if (this.currentResourceId) {
      const resource = this.visuals.resources.find((entry) => entry.id === this.currentResourceId);
      if (!resource) return;
      resource.object.visible = false;
      this.state.collectedResources.push(resource.id);
      addItem(this.state, resource.item, resource.amount);
      if (resource.item === "cristal") {
        this.state.symbiosis = Math.max(0, this.state.symbiosis - 3);
        this.state.colossusHealth = Math.max(0, this.state.colossusHealth - 1);
      }
      this.spawnParticles(resource.object.position, resource.item === "cristal" ? "#65d4c6" : "#d2a767", 8);
      this.audio.play("collect");
      this.callbacks.onToast(`+${resource.amount} ${ITEMS[resource.item].name}`, "good");
      this.emitSnapshot(true);
      return;
    }
    if (!this.nearbyStructureId) return;
    const structure = this.state.structures.find((entry) => entry.id === this.nearbyStructureId);
    if (!structure) return;
    if (structure.type === "coletor") {
      if (this.state.weather === "limpo") this.callbacks.onToast("O coletor está seco. A chuva virá do oeste.");
      else {
        addItem(this.state, "agua", 1);
        this.audio.play("collect");
        this.callbacks.onToast("Água de chuva recolhida.", "good");
      }
    } else if (structure.type === "abrigo") {
      this.state.elapsed += 35;
      this.state.stats.stamina = 100;
      this.state.stats.health = Math.min(100, this.state.stats.health + 12);
      this.callbacks.onToast("Você descansa. O colosso avança sob a noite.", "good");
    } else this.callbacks.onToast(`${getStructure(structure.type).name} pronta para uso.`);
    this.emitSnapshot(true);
  }

  private tryDodge(): void {
    if (this.dodgeTimer > 0 || this.state.stats.stamina < 24) return;
    this.dodgeTimer = 0.34;
    this.state.stats.stamina -= 24;
    this.audio.play("dodge");
  }

  private useHook(): void {
    if (this.currentSpecial !== "hook" || this.state.stats.stamina < 20) return;
    let nearest: THREE.Mesh | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const point of this.visuals.hookPoints) {
      const distance = distance2D(this.visuals.player.position, point.position);
      if (distance < 13 && distance < nearestDistance) { nearest = point; nearestDistance = distance; }
    }
    if (!nearest) return;
    const landing = nearest.position.clone();
    landing.z -= 2.2;
    this.syncCollisionTransforms();
    landing.y = this.surfaceHeightAt(landing.x, landing.z);
    this.hookTarget = landing;
    this.hookTimer = 0.8;
    this.grounded = false;
    this.state.stats.stamina -= 20;
    this.callbacks.onToast("Gancho fixado.", "good");
  }

  private attack(charged: boolean, thrown: boolean): void {
    if (this.attackCooldown > 0 || this.state.stats.stamina < 8) return;
    const weapon = this.state.weapon;
    if (weapon === "arco" && this.state.inventory.flecha <= 0) {
      this.callbacks.onToast("Sem flechas.", "danger");
      return;
    }
    const profile = WEAPON_PROFILES[weapon];
    const range = weaponRange(weapon, thrown);
    this.state.stats.stamina -= profile.stamina;
    this.attackCooldown = profile.cooldown;
    this.audio.play("swing");
    if (weapon === "arco") this.state.inventory.flecha -= 1;
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let target: EnemyRuntime | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      if (enemy.defeated) continue;
      this.tempVector.copy(enemy.mesh.position).sub(this.visuals.player.position);
      const distance = this.tempVector.length();
      this.tempVector.y = 0;
      if (this.tempVector.lengthSq() === 0) continue;
      this.tempVector.normalize();
      const dot = forward.dot(this.tempVector);
      const threshold = weapon === "arco" ? 0.88 : 0.48;
      if (distance <= range && dot >= threshold && distance < bestScore) {
        target = enemy;
        bestScore = distance;
      }
    }
    if (!target) return;
    const dealt = calculateDamage({
      weapon,
      target: target.kind,
      charged,
      aerial: !this.grounded,
      targetBelowHalfHealth: target.health < target.maxHealth * 0.5,
    });
    this.hitEnemy(target, dealt);
  }

  private hitEnemy(enemy: EnemyRuntime, damage: number): void {
    enemy.health -= damage;
    enemy.state = "stunned";
    enemy.stateTime = 0;
    enemy.hitFlash = 0.12;
    enemy.mesh.position.add(this.tempVector.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.35));
    this.spawnParticles(enemy.mesh.position, enemy.kind === "alado" ? "#c0c7bd" : "#b65a43", enemy.kind === "alfa" ? 16 : 9);
    this.hitStop = this.settings.reducedShake ? 0.025 : 0.045;
    this.shake = this.settings.reducedShake ? 0.04 : 0.14;
    this.audio.play("hit");
    if (enemy.health <= 0) this.defeatEnemy(enemy);
  }

  private defeatEnemy(enemy: EnemyRuntime): void {
    enemy.defeated = true;
    enemy.mesh.visible = false;
    this.state.defeatedEnemies.push(enemy.id);
    addItem(this.state, "carne-crua", enemy.kind === "alfa" ? 3 : 1);
    if (enemy.kind === "carrapato") {
      this.state.symbiosis = Math.min(100, this.state.symbiosis + 7);
      this.state.colossusHealth = Math.min(100, this.state.colossusHealth + 4);
    }
    if (this.state.event === "infestacao" && this.state.finalWaveRemaining > 0) this.state.finalWaveRemaining -= 1;
    this.callbacks.onToast(enemy.kind === "alfa" ? "Parasita alfa removido." : "Parasita abatido.", "good");
  }

  private updateEnemies(delta: number): void {
    const playerPosition = this.visuals.player.position;
    for (const enemy of this.enemies) {
      if (enemy.defeated) continue;
      enemy.stateTime += delta;
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
      enemy.phase += delta;
      const enemyBody = enemy.mesh.getObjectByName("enemy-body");
      if (enemyBody) enemyBody.position.y = 0.8 + Math.sin(enemy.phase * (enemy.kind === "alfa" ? 2.4 : 5.2)) * 0.055;
      enemy.mesh.children.filter((child) => child.name.startsWith("enemy-leg-")).forEach((leg, index) => {
        leg.rotation.y = Math.sin(enemy.phase * (enemy.kind === "alfa" ? 4.2 : 7.4) + index * 1.7) * 0.28;
      });
      enemy.mesh.children.filter((child) => child.name.startsWith("mandible-")).forEach((mandible, index) => {
        mandible.rotation.z = (index === 0 ? 1 : -1) * (0.28 + Math.sin(enemy.phase * 5.5) * 0.12);
      });
      const distance = distance2D(enemy.mesh.position, playerPosition);
      if (this.state.elapsed < 62) {
        if (enemy.kind === "alado") enemy.mesh.position.y = terrainHeight(enemy.mesh.position.x, enemy.mesh.position.z) + 6 + Math.sin(enemy.phase * 2.5);
        continue;
      }
      if (enemy.state === "stunned") {
        if (enemy.stateTime > 0.42) { enemy.state = "retreat"; enemy.stateTime = 0; }
      } else if (distance < 3.1 && enemy.attackCooldown <= 0) {
        enemy.state = "attack";
        if (enemy.stateTime > 0.42) {
          const baseDamage = enemy.kind === "alfa" ? 24 : enemy.kind === "carrapato" ? 15 : 11;
          if (this.dodgeTimer <= 0) {
            const parry = this.blocking && this.state.elapsed - this.blockStartedAt < 0.28;
            if (parry) {
              enemy.state = "stunned";
              enemy.stateTime = 0;
              this.audio.play("parry");
              this.callbacks.onToast("PARRY", "good");
            } else this.damagePlayer(this.blocking ? baseDamage * 0.3 : baseDamage, this.blocking ? "bloqueio" : "ataque");
          }
          enemy.attackCooldown = enemy.kind === "alfa" ? 1.35 : 1.8;
          enemy.stateTime = 0;
        }
      } else if (distance < (enemy.kind === "alado" ? 22 : 15)) {
        if (enemy.state === "patrol" || enemy.state === "return") { enemy.state = "perception"; enemy.stateTime = 0; }
        else if (enemy.state === "perception" && enemy.stateTime > 0.45) { enemy.state = "investigation"; enemy.stateTime = 0; }
        else if (enemy.state === "investigation" && enemy.stateTime > 0.7) { enemy.state = "chase"; enemy.stateTime = 0; }
      } else if (distance > 27) enemy.state = "return";

      const target = enemy.state === "return" || enemy.state === "patrol" ? enemy.home : playerPosition;
      if (enemy.state === "chase" || enemy.state === "investigation" || enemy.state === "return" || enemy.state === "retreat") {
        this.tempVector.copy(target).sub(enemy.mesh.position).setY(0);
        if (enemy.state === "retreat") this.tempVector.multiplyScalar(-1);
        if (this.tempVector.lengthSq() > 0.01) this.tempVector.normalize();
        const speed = enemy.kind === "alado" ? 5.2 : enemy.kind === "alfa" ? 2.2 : enemy.kind === "carrapato" ? 1.65 : 3.1;
        enemy.mesh.position.addScaledVector(this.tempVector, speed * delta);
        enemy.mesh.rotation.y = Math.atan2(this.tempVector.x, this.tempVector.z);
        if (enemy.state === "retreat" && enemy.stateTime > 0.75) { enemy.state = "chase"; enemy.stateTime = 0; }
      }
      if (enemy.kind === "alado") {
        const ground = terrainHeight(enemy.mesh.position.x, enemy.mesh.position.z);
        enemy.mesh.position.y = ground + 5.5 + Math.sin(enemy.phase * 3) * 1.5;
        enemy.mesh.children.filter((child) => child.name === "wing").forEach((wing, index) => { wing.rotation.y = Math.sin(enemy.phase * 9) * 0.45 * (index ? -1 : 1); });
      } else {
        const burrow = enemy.kind === "escavador" && (enemy.state === "patrol" || enemy.state === "perception");
        enemy.mesh.position.y = terrainHeight(enemy.mesh.position.x, enemy.mesh.position.z) + (burrow ? -0.55 : 0);
      }
      if (enemy.kind === "alfa" && enemy.health < enemy.maxHealth * 0.55 && enemy.phase > 2) {
        enemy.phase = 0;
        this.shake = this.settings.reducedShake ? 0.06 : 0.32;
        this.state.colossusHealth = Math.max(0, this.state.colossusHealth - 1.2);
      }
      this.applyTrapDamage(enemy);
      updateEnemyMaterialFeedback(enemy);
    }
    this.updateBallista(delta);
  }

  private applyTrapDamage(enemy: EnemyRuntime): void {
    for (const structure of this.state.structures) {
      if (structure.type !== "armadilha" || structure.health <= 0 || enemy.trapHits.has(structure.id)) continue;
      if (Math.hypot(enemy.mesh.position.x - structure.x, enemy.mesh.position.z - structure.z) < 2.2) {
        enemy.trapHits.add(structure.id);
        structure.health = 0;
        this.hitEnemy(enemy, 58);
        const mesh = this.structureMeshes.get(structure.id);
        if (mesh) mesh.visible = false;
      }
    }
  }

  private ballistaCooldown = 0;
  private updateBallista(delta: number): void {
    this.ballistaCooldown -= delta;
    if (this.ballistaCooldown > 0 || this.state.event !== "infestacao") return;
    const ballista = this.state.structures.find((entry) => entry.type === "balista" && entry.health > 0);
    const target = this.enemies.find((enemy) => !enemy.defeated && Math.hypot(enemy.mesh.position.x - (ballista?.x ?? 0), enemy.mesh.position.z - (ballista?.z ?? 0)) < 35);
    if (!ballista || !target) return;
    this.ballistaCooldown = 3.8;
    this.hitEnemy(target, 62);
    this.spawnParticles(target.mesh.position, "#e4b469", 14);
  }

  private damagePlayer(amount: number, source: string): void {
    this.state.stats.health = Math.max(0, this.state.stats.health - amount);
    if (source === "ataque" && Math.random() < 0.28) this.state.stats.infection = Math.min(100, this.state.stats.infection + 9);
    this.shake = this.settings.reducedShake ? 0.05 : 0.26;
    this.audio.play("hurt");
    this.callbacks.onToast(`-${Math.round(amount)} vida${source === "bloqueio" ? " · bloqueado" : ""}`, "danger");
  }

  private updateEvents(delta: number): void {
    const nextEvent = deriveEvent(this.state);
    if (nextEvent !== this.state.event) {
      this.state.event = nextEvent;
      this.onEventChanged(nextEvent);
    }
    if (this.state.event === "despertar") {
      const reveal = clamp((this.state.elapsed - 28) / 32, 0, 1);
      this.visuals.head.position.y = THREE.MathUtils.lerp(-28, 0.5, smoothStep(reveal));
      if (reveal > 0.18) {
        this.subtitle = "[revoada inquieta]";
        this.subtitleUntil = Math.max(this.subtitleUntil, 62);
      }
      if (this.state.elapsed > 49 && !this.revealTitleShown) {
        this.revealTitleShown = true;
        this.callbacks.onBanner("ERRANTE", "O DORSO DO MUNDO");
        this.audio.play("pulse");
      }
    }
    const rainActive = this.state.event === "chuva" || this.state.event === "mergulho";
    this.state.weather = weatherForEvent(this.state.event);
    this.audio.setWeather(this.state.weather);
    this.visuals.rain.visible = rainActive;
    if (rainActive && this.state.elapsed - this.lastCollectorTick > 42) {
      const collectors = this.state.structures.filter((structure) => structure.type === "coletor").length;
      if (collectors > 0) {
        addItem(this.state, "agua", collectors);
        this.callbacks.onToast(`Coletores: +${collectors} água`, "good");
      }
      this.lastCollectorTick = this.state.elapsed;
    }
    if (this.state.event === "mergulho" && this.state.elapsed > EVENT_TIMES.diveLoss && !this.diveLossApplied) {
      this.diveLossApplied = true;
      const hasChest = this.state.structures.some((structure) => structure.type === "bau");
      if (!hasChest) {
        const lostWood = Math.min(3, this.state.inventory.madeira);
        const lostFiber = Math.min(2, this.state.inventory.fibra);
        this.state.inventory.madeira -= lostWood;
        this.state.inventory.fibra -= lostFiber;
        this.callbacks.onToast(`A água levou ${lostWood} madeira e ${lostFiber} fibras soltas.`, "danger");
      } else this.callbacks.onToast("O baú protegeu seus recursos durante o mergulho.", "good");
    }
    if (this.state.event === "infestacao") {
      this.spawnInfestation();
      if (this.state.elapsed > EVENT_TIMES.alpha) this.spawnAlpha();
      if (this.state.finalWaveRemaining === 0 && this.alphaSpawned) {
        this.state.elapsed = Math.max(this.state.elapsed, EVENT_TIMES.encounter + 1);
        this.state.symbiosis = Math.min(100, this.state.symbiosis + 8);
      }
    }
    if (this.state.event === "encontro") {
      this.visuals.secondColossus.visible = true;
      if (!this.state.completed && this.state.elapsed > EVENT_TIMES.victory && this.state.player.z < -112) {
        this.state.completed = true;
        this.state.event = "conclusao";
        saveGame(this.state);
        this.audio.play("victory");
        this.setPaused(true);
        this.callbacks.onVictory(this.state.symbiosis >= 58 && this.state.colossusHealth >= 55 ? "symbiosis" : "survival");
      }
    }
    if (Math.floor(this.state.elapsed) % 31 === 0 && this.state.event === "chuva" && Math.random() < delta * 2.2) {
      this.audio.play("thunder");
      this.lightningFlash = 1;
      this.shake = this.settings.reducedShake ? 0.03 : 0.12;
      this.subtitle = "[trovão distante sobre o oceano]";
      this.subtitleUntil = this.state.elapsed + 3;
    }
  }

  private onEventChanged(event: EventId): void {
    this.audio.setEvent(event);
    if (this.eventBannerShown.has(event)) return;
    this.eventBannerShown.add(event);
    this.callbacks.onBanner(...EVENT_BANNERS[event]);
    if (event === "mergulho" || event === "infestacao") this.audio.play("thunder");
  }

  private updateVisuals(delta: number): void {
    const time = this.state.elapsed;
    const eventVisuals = eventVisualState(time, this.state.event);
    const motionScale = this.settings.reducedColossusMotion ? 0.25 : 1;
    const reveal = clamp((time - 26) / 38, 0, 1);
    const breath = Math.sin(time * 0.58) * 0.016 * motionScale * reveal;
    const eventTilt = this.state.event === "mergulho" ? Math.sin((time - 205) * 0.08) * 0.035 : this.state.event === "infestacao" ? Math.sin(time * 1.7) * 0.012 : 0;
    this.visuals.world.rotation.z = THREE.MathUtils.damp(this.visuals.world.rotation.z, (Math.sin(time * 0.075) * 0.025 * reveal + eventTilt) * motionScale, 2, delta);
    this.visuals.world.rotation.x = THREE.MathUtils.damp(this.visuals.world.rotation.x, breath, 2, delta);
    this.visuals.headEye.scale.setScalar(1 + Math.sin(time * 0.9) * 0.05);
    for (const bird of this.visuals.birds.children) {
      const phase = typeof bird.userData.phase === "number" ? bird.userData.phase : 0;
      const radius = typeof bird.userData.radius === "number" ? bird.userData.radius : 28;
      const baseHeight = typeof bird.userData.baseHeight === "number" ? bird.userData.baseHeight : 18;
      const flight = clamp((time - 30) / 22, 0, 1);
      const angle = time * (0.095 + flight * 0.055) + phase;
      const orbitRadius = radius * (0.42 + flight * 0.58);
      bird.position.x = Math.sin(angle) * orbitRadius;
      bird.position.y = baseHeight + flight * 18 + Math.sin(time * 0.9 + phase) * 1.35;
      bird.position.z = 72 + Math.cos(angle) * orbitRadius * 0.65;
      bird.rotation.y = Math.PI - angle;
      const flap = Math.sin(time * (3.4 + flight * 4.8) + phase * 1.7) * (0.18 + flight * 0.34);
      const leftWing = bird.getObjectByName("bird-wing-left");
      const rightWing = bird.getObjectByName("bird-wing-right");
      if (leftWing) leftWing.rotation.z = flap;
      if (rightWing) rightWing.rotation.z = -flap;
    }
    if (this.visuals.rain.visible) {
      const position = this.visuals.rain.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 2) {
        let headY = position.getY(index) - delta * 30;
        let tailY = position.getY(index + 1) - delta * 30;
        let headX = position.getX(index) - delta * 2.4;
        let tailX = position.getX(index + 1) - delta * 2.4;
        if (tailY < -1) {
          headY += 35;
          tailY += 35;
        }
        if (headX < -48) {
          headX += 96;
          tailX += 96;
        }
        position.setY(index, headY);
        position.setY(index + 1, tailY);
        position.setX(index, headX);
        position.setX(index + 1, tailX);
      }
      position.needsUpdate = true;
      this.visuals.rain.position.set(this.state.player.x, 0, this.state.player.z);
    }
    const stormDim = eventVisuals.rainActive ? 0.55 : 1;
    this.lightningFlash = THREE.MathUtils.damp(this.lightningFlash, 0, 7.5, delta);
    this.visuals.sun.intensity = THREE.MathUtils.damp(this.visuals.sun.intensity, 0.6 + eventVisuals.daylight * 3.7 * stormDim + this.lightningFlash * 6.2, 6, delta);
    this.visuals.hemisphere.intensity = 0.6 + eventVisuals.daylight * 2.1 * stormDim + this.lightningFlash * 1.7;
    this.visuals.player.getWorldPosition(this.lightingPosition);
    this.visuals.sun.target.position.copy(this.lightingPosition);
    this.visuals.sun.position.set(
      this.lightingPosition.x - 42,
      this.lightingPosition.y + 68,
      this.lightingPosition.z + 36,
    );
    const sky = new THREE.Color().lerpColors(new THREE.Color("#071a28"), eventVisuals.rainActive ? new THREE.Color("#354d50") : new THREE.Color("#7fa5a5"), eventVisuals.daylight);
    if (this.visuals.scene.background instanceof THREE.Color) this.visuals.scene.background.copy(sky);
    if (this.visuals.scene.fog instanceof THREE.Fog) this.visuals.scene.fog.color.copy(sky);
    this.visuals.ocean.position.y = THREE.MathUtils.damp(this.visuals.ocean.position.y, -7 + eventVisuals.diveProgress * 9, 1.3, delta);
    if (this.visuals.ocean.material instanceof THREE.ShaderMaterial) {
      const uniforms = this.visuals.ocean.material.uniforms as Record<string, THREE.IUniform<number>>;
      if (uniforms.uTime) uniforms.uTime.value = time;
    }
    const skyUniforms = this.visuals.sky.material.uniforms as Record<string, THREE.IUniform<number>>;
    if (skyUniforms.uTime) skyUniforms.uTime.value = time;
    if (skyUniforms.uStorm) skyUniforms.uStorm.value = eventVisuals.rainActive ? 1 : 0;
    this.visuals.treeWindTime.value = time;
    const wakePulse = 1 + Math.sin(time * 0.72) * 0.012;
    this.visuals.wake.scale.set(wakePulse, 1, wakePulse);
    this.visuals.wake.rotation.y = Math.sin(time * 0.08) * 0.018;
    for (const wakePart of this.visuals.wake.children) {
      if (!(wakePart instanceof THREE.Mesh) || !(wakePart.material instanceof THREE.ShaderMaterial)) continue;
      const uniforms = wakePart.material.uniforms as Record<string, THREE.IUniform<number>>;
      if (uniforms.uTime) uniforms.uTime.value = time;
    }
    for (const structure of this.structureMeshes.values()) {
      const flame = structure.getObjectByName("structure-flame");
      if (flame) {
        flame.scale.y = 0.88 + Math.sin(time * 11.4 + structure.position.x) * 0.12;
        flame.rotation.y = time * 1.7;
      }
      const fireLight = structure.getObjectByName("structure-fire-light");
      if (fireLight instanceof THREE.PointLight) fireLight.intensity = 2.45 + Math.sin(time * 13.2 + structure.position.z) * 0.45;
    }
    if (this.visuals.secondColossus.visible) {
      this.visuals.secondColossus.position.y = THREE.MathUtils.lerp(-40, -2, smoothStep(eventVisuals.encounterEmerge));
      this.visuals.secondColossus.position.x = 76 + Math.sin(time * 0.05) * 4;
    }
    this.updateBuildGhost();
    this.updateCamera(delta);
  }

  private updateCamera(delta: number): void {
    this.syncCollisionTransforms();
    const targetHeight = this.debugCloseCamera ? 0.62 : 1.58;
    this.cameraTarget.set(this.visuals.player.position.x, this.visuals.player.position.y + targetHeight, this.visuals.player.position.z);
    const distance = this.debugCloseCamera ? 3.2 : 7.65;
    const cameraLift = this.debugCloseCamera ? 0.48 : 1.28;
    const horizontal = Math.cos(this.pitch) * distance;
    this.desiredCamera.set(
      this.cameraTarget.x - Math.sin(this.yaw) * horizontal,
      this.cameraTarget.y + Math.sin(-this.pitch) * distance + cameraLift,
      this.cameraTarget.z - Math.cos(this.yaw) * horizontal,
    );
    this.constrainCameraAgainstObstacles();
    const minimumCameraY = this.surfaceHeightAt(this.desiredCamera.x, this.desiredCamera.z, 0) + 1.1;
    this.desiredCamera.y = Math.max(this.desiredCamera.y, minimumCameraY);
    const shakeAmount = this.shake;
    this.shake = THREE.MathUtils.damp(this.shake, 0, 9, delta);
    this.desiredCamera.x += (Math.random() - 0.5) * shakeAmount;
    this.desiredCamera.y += (Math.random() - 0.5) * shakeAmount;
    this.camera.position.lerp(this.desiredCamera, 1 - Math.exp(-delta * 10));
    this.camera.lookAt(this.cameraTarget);
  }

  private constrainCameraAgainstObstacles(): void {
    const segmentX = this.desiredCamera.x - this.cameraTarget.x;
    const segmentZ = this.desiredCamera.z - this.cameraTarget.z;
    const segmentLengthSquared = segmentX * segmentX + segmentZ * segmentZ;
    if (segmentLengthSquared < 0.001) return;
    const segmentLength = Math.sqrt(segmentLengthSquared);
    let allowedFraction = 1;
    const constrainForCircle = (x: number, z: number, radius: number): void => {
      const relativeX = x - this.cameraTarget.x;
      const relativeZ = z - this.cameraTarget.z;
      const projection = clamp((relativeX * segmentX + relativeZ * segmentZ) / segmentLengthSquared, 0, 1);
      if (projection <= 0.04) return;
      const closestX = this.cameraTarget.x + segmentX * projection;
      const closestZ = this.cameraTarget.z + segmentZ * projection;
      const distanceSquared = (x - closestX) ** 2 + (z - closestZ) ** 2;
      const paddedRadius = radius + 0.38;
      if (distanceSquared >= paddedRadius * paddedRadius) return;
      const entryOffset = Math.sqrt(Math.max(0, paddedRadius * paddedRadius - distanceSquared)) / segmentLength;
      allowedFraction = Math.min(allowedFraction, Math.max(0.2, projection - entryOffset - 0.035));
    };
    for (const obstacle of this.visuals.obstacles) constrainForCircle(obstacle.x, obstacle.z, obstacle.radius);
    for (const structure of this.state.structures) constrainForCircle(structure.x, structure.z, STRUCTURE_COLLISION_RADIUS[structure.type]);
    if (allowedFraction < 1) this.desiredCamera.lerpVectors(this.cameraTarget, this.desiredCamera, allowedFraction);
  }

  private updateBuildGhost(): void {
    if (!this.buildGhost || !this.buildMode) return;
    const direction = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const position = this.tempVector.copy(this.visuals.player.position).addScaledVector(direction, 5.2);
    if (this.keys.has("ControlLeft")) {
      position.x = Math.round(position.x / 2) * 2;
      position.z = Math.round(position.z / 2) * 2;
    }
    position.y = this.surfaceHeightAt(position.x, position.z, 0);
    this.buildValid = isInsideDorso(position.x, position.z, 6)
      && this.state.structures.every((structure) => Math.hypot(position.x - structure.x, position.z - structure.z) > 3.2)
      && this.visuals.obstacles.every((obstacle) => Math.hypot(position.x - obstacle.x, position.z - obstacle.z) > obstacle.radius + 2.2);
    this.buildGhost.position.copy(position);
    this.alignObjectToSurface(this.buildGhost, position.x, position.z, this.buildRotation);
    this.buildGhost.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshStandardMaterial) object.material.color.set(this.buildValid ? "#76bba5" : "#bd6558");
    });
  }

  private placeCurrentStructure(): void {
    if (!this.buildMode || !this.buildGhost) return;
    if (!this.buildValid) {
      this.callbacks.onToast("Posição inválida ou bloqueada.", "danger");
      return;
    }
    const type = this.buildMode;
    const result = placeStructure(this.state, type, { x: this.buildGhost.position.x, z: this.buildGhost.position.z, rotation: this.buildRotation });
    if (!result.ok) {
      this.callbacks.onToast(result.message, "danger");
      return;
    }
    const saved = this.state.structures[this.state.structures.length - 1];
    this.addStructureVisual(saved.id, saved.type, saved.x, saved.z, saved.rotation);
    this.audio.play("build");
    this.callbacks.onToast(result.message, "good");
    this.setBuildMode(null);
    this.emitSnapshot(true);
  }

  private addStructureVisual(id: string, type: StructureId, x: number, z: number, rotation: number): void {
    const mesh = createStructureModel(type);
    this.syncCollisionTransforms();
    mesh.position.set(x, this.surfaceHeightAt(x, z, 0), z);
    this.alignObjectToSurface(mesh, x, z, rotation);
    mesh.userData.structureId = id;
    this.visuals.world.add(mesh);
    this.structureMeshes.set(id, mesh);
  }

  private createParticlePool(count: number): void {
    const geometry = new THREE.TetrahedronGeometry(0.09, 0);
    const particleMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(geometry, particleMaterial.clone());
      mesh.visible = false;
      this.visuals.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3(), life: 0 });
    }
  }

  private spawnParticles(position: THREE.Vector3, color: THREE.ColorRepresentation, count: number): void {
    let spawned = 0;
    for (const particle of this.particles) {
      if (particle.life > 0) continue;
      particle.life = 0.45 + Math.random() * 0.45;
      particle.mesh.visible = true;
      particle.mesh.position.copy(position);
      particle.mesh.position.y += 1;
      particle.velocity.set((Math.random() - 0.5) * 5, 2 + Math.random() * 5, (Math.random() - 0.5) * 5);
      if (particle.mesh.material instanceof THREE.MeshBasicMaterial) particle.mesh.material.color.set(color);
      spawned += 1;
      if (spawned >= count) break;
    }
  }

  private updateParticles(delta: number): void {
    for (const particle of this.particles) {
      if (particle.life <= 0) continue;
      particle.life -= delta;
      particle.velocity.y -= 9 * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.rotation.x += delta * 5;
      particle.mesh.rotation.y += delta * 6;
      if (particle.life <= 0) particle.mesh.visible = false;
    }
  }

  private emitSnapshot(force: boolean): void {
    if (!force && this.state.elapsed - this.lastSnapshotAt < 0.1) return;
    this.lastSnapshotAt = this.state.elapsed;
    const totalWeight = this.state.structures.reduce((sum, structure) => sum + getStructure(structure.type).weight, 0);
    this.callbacks.onSnapshot({
      state: cloneState(this.state),
      objective: objectiveFor(this.state),
      interaction: this.currentInteraction,
      station: this.currentStation,
      buildMode: this.buildMode,
      buildValid: this.buildValid,
      totalWeight,
      weightCapacity: 36 + Math.round(this.state.symbiosis * 0.24),
      enemiesActive: this.enemies.filter((enemy) => !enemy.defeated).length,
      subtitle: this.subtitle,
      fps: this.measuredFps,
      frameTime: this.measuredFrameTime,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      paused: this.paused,
      grounded: this.grounded,
      groundError: this.visuals.player.position.y - this.surfaceHeightAt(this.visuals.player.position.x, this.visuals.player.position.z),
      posture: { ...this.postureDebug },
    });
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}

function angleDamp(current: number, target: number, lambda: number, delta: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-lambda * delta));
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((entry) => entry.dispose());
    else object.material.dispose();
  });
}

export const BUILDABLE_STRUCTURES = STRUCTURES;
