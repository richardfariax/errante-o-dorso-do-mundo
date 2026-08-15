"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as THREE from "three";
import { formatCost, ITEMS, ITEM_IDS, RECIPES, STRUCTURES, type ItemId, type StructureId } from "./data";
import { GameEngine, type GameSnapshot } from "./engine";
import { DEFAULT_SETTINGS, hasSave, loadGame, loadSettings, saveSettings, type GameSettings } from "./save";
import { createNewGame, hasCost, type GameState, type WeaponId } from "./state";
import { createWorld } from "./world";

type Screen = "title" | "game" | "defeat" | "victory";
type Panel = "inventory" | "crafting" | "building" | "settings" | "pause" | null;

interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: "neutral" | "good" | "danger";
}

interface Banner {
  readonly title: string;
  readonly subtitle: string;
  readonly key: number;
}

function createMenuBackdrop(canvas: HTMLCanvasElement): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const visuals = createWorld(48_271, { ...DEFAULT_SETTINGS, quality: "medium" });
  const { scene } = visuals;
  visuals.player.visible = false;
  visuals.head.position.y = -1;
  visuals.secondColossus.visible = true;
  visuals.secondColossus.position.set(-112, -18, -250);
  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(94, 43, 98);
  camera.lookAt(0, 3, -20);
  let frame = 0;
  const clock = new THREE.Clock();
  const render = (): void => {
    const time = clock.getElapsedTime();
    visuals.world.rotation.x = Math.sin(time * 0.48) * 0.012;
    camera.position.x = 94 + Math.sin(time * 0.075) * 9;
    camera.position.z = 98 + Math.cos(time * 0.055) * 6;
    camera.lookAt(0, 3, -22);
    if (visuals.ocean.material instanceof THREE.ShaderMaterial) {
      const uniforms = visuals.ocean.material.uniforms as Record<string, THREE.IUniform<number>>;
      if (uniforms.uTime) uniforms.uTime.value = time;
    }
    const wakePulse = 1 + Math.sin(time * 0.72) * 0.012;
    visuals.wake.scale.set(wakePulse, 1, wakePulse);
    visuals.wake.rotation.y = Math.sin(time * 0.08) * 0.018;
    renderer.render(scene, camera);
    frame = window.requestAnimationFrame(render);
  };
  render();
  const resize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", resize);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    visuals.dispose();
    renderer.dispose();
  };
}

export function GameApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const settingsRef = useRef<GameSettings>(DEFAULT_SETTINGS);
  const toastId = useRef(0);
  const [screen, setScreen] = useState<Screen>("title");
  const [panel, setPanel] = useState<Panel>(null);
  const [settings, setSettings] = useState<GameSettings>(() => typeof window === "undefined" ? DEFAULT_SETTINGS : loadSettings());
  const [startState, setStartState] = useState<GameState | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [savedJourney, setSavedJourney] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [woundPrompt, setWoundPrompt] = useState(false);
  const [ending, setEnding] = useState<"symbiosis" | "survival">("symbiosis");
  const [defeatReason, setDefeatReason] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSavedJourney(hasSave()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const pushToast = useCallback((text: string, tone: "neutral" | "good" | "danger" = "neutral"): void => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3_800);
  }, []);

  const showBanner = useCallback((title: string, subtitle: string): void => {
    const key = Date.now();
    setBanner({ title, subtitle, key });
    window.setTimeout(() => setBanner((current) => current?.key === key ? null : current), 5_400);
  }, []);

  const openPanel = useCallback((next: Exclude<Panel, null>): void => {
    engineRef.current?.setPaused(true);
    setPanel(next);
  }, []);

  useEffect(() => {
    if (screen === "title" && canvasRef.current) return createMenuBackdrop(canvasRef.current);
    return undefined;
  }, [screen]);

  useEffect(() => {
    if (screen !== "game" || !canvasRef.current || !startState) return undefined;
    const engine = new GameEngine(canvasRef.current, startState, settingsRef.current, {
      onSnapshot: setSnapshot,
      onToast: pushToast,
      onBanner: showBanner,
      onWoundPrompt: () => { engine.setPaused(true); setWoundPrompt(true); },
      onDefeat: (reason) => { setDefeatReason(reason); setPanel(null); setScreen("defeat"); },
      onVictory: (result) => { setEnding(result); setPanel(null); setScreen("victory"); },
      onPauseChange: (paused) => {
        if (paused) setPanel((current) => current ?? "pause");
        else { setPanel(null); setWoundPrompt(false); }
      },
      onPanelRequest: openPanel,
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [openPanel, pushToast, screen, showBanner, startState]);

  useEffect(() => {
    saveSettings(settings);
    settingsRef.current = settings;
    engineRef.current?.updateSettings(settings);
    document.documentElement.style.setProperty("--text-scale", String(settings.textScale));
  }, [settings]);

  const begin = (state: GameState): void => {
    setPanel(null);
    setSnapshot(null);
    setStartState(state);
    if (state.completed) {
      setEnding(state.symbiosis >= 58 && state.colossusHealth >= 55 ? "symbiosis" : "survival");
      setScreen("victory");
      return;
    }
    setScreen("game");
  };

  const closePanel = (): void => {
    setPanel(null);
    engineRef.current?.setPaused(false);
  };

  const chooseBuild = (type: StructureId): void => {
    engineRef.current?.setBuildMode(type);
    closePanel();
  };

  const chooseWound = (decision: "healed" | "harvested"): void => {
    engineRef.current?.chooseWound(decision);
    setWoundPrompt(false);
    setPanel(null);
    engineRef.current?.setPaused(false);
  };

  if (screen === "title") {
    return (
      <main className="game-shell title-mode">
        <canvas ref={canvasRef} className="world-canvas" aria-label="Silhueta do colosso migratório no oceano" />
        <div className="cinematic-vignette" />
        <section className="title-screen" aria-labelledby="game-title">
          <p className="eyebrow">uma história de sobrevivência simbiótica</p>
          <h1 id="game-title">ERRANTE</h1>
          <p className="subtitle">O Dorso do Mundo</p>
          <p className="premise">A ilha respira. O horizonte se move. Sobreviva sem destruir aquilo que o mantém vivo.</p>
          <button className="primary-action" type="button" onClick={() => begin(createNewGame())}>Novo jogo</button>
          <button className="secondary-action" type="button" disabled={!savedJourney} onClick={() => { const saved = loadGame(); if (saved) begin(saved); }}>
            Continuar <span>{savedJourney ? "jornada salva" : "sem jornada salva"}</span>
          </button>
          <button className="text-action" type="button" onClick={() => setPanel("settings")}>Configurações</button>
        </section>
        <p className="build-mark">VERTICAL SLICE · DESKTOP</p>
        {panel === "settings" && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setPanel(null)} />}
      </main>
    );
  }

  if (screen === "defeat") {
    return (
      <EndScreen tone="defeat" eyebrow="A maré não espera" title="A JORNADA TERMINOU" copy={defeatReason}>
        <button className="primary-action" type="button" onClick={() => begin(createNewGame())}>Recomeçar</button>
        <button className="secondary-action" type="button" onClick={() => { const saved = loadGame(); if (saved) begin(saved); }}>Carregar último save</button>
        <button className="text-action" type="button" onClick={() => setScreen("title")}>Menu principal</button>
      </EndScreen>
    );
  }

  if (screen === "victory") {
    const symbiotic = ending === "symbiosis";
    return (
      <EndScreen tone="victory" eyebrow="Fim da vertical slice" title={symbiotic ? "DOIS DORSOS, UMA ROTA" : "SOBREVIVER NÃO É PERTENCER"} copy={symbiotic
        ? "O colosso responde ao chamado distante. Seu passo se estabiliza, e uma rota segura se abre entre as ondas. Ele se lembra do seu cuidado."
        : "O outro colosso responde através da névoa. O dorso ferido segue em silêncio — vivo, desconfiado e ainda carregando você."}>
        <p className="ending-stat">Simbiose {Math.round(snapshot?.state.symbiosis ?? startState?.symbiosis ?? 0)}% · Saúde do colosso {Math.round(snapshot?.state.colossusHealth ?? startState?.colossusHealth ?? 0)}%</p>
        <button className="primary-action" type="button" onClick={() => begin(createNewGame())}>Nova jornada</button>
        <button className="text-action" type="button" onClick={() => setScreen("title")}>Menu principal</button>
      </EndScreen>
    );
  }

  return (
    <main className="game-shell gameplay-mode">
      <canvas ref={canvasRef} className="world-canvas" tabIndex={0} aria-label="Mundo 3D jogável de ERRANTE" />
      <div className="game-vignette" />
      {snapshot && <Hud snapshot={snapshot} onOpenPanel={openPanel} onSelectWeapon={(weapon) => engineRef.current?.selectWeapon(weapon)} />}
      {snapshot?.interaction && !panel && <p className="interaction-prompt">{snapshot.interaction}</p>}
      {snapshot?.subtitle && settings.showSubtitles && <p className="sound-subtitle">{snapshot.subtitle}</p>}
      {banner && <div key={banner.key} className="event-banner"><p>{banner.title}</p><span>{banner.subtitle}</span></div>}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <p key={toast.id} className={`toast ${toast.tone}`}>{toast.text}</p>)}
      </div>
      {snapshot && <DebugOverlay snapshot={snapshot} />}
      {panel === "pause" && <PausePanel onResume={closePanel} onSave={() => engineRef.current?.manualSave()} onSettings={() => setPanel("settings")} onTitle={() => { setSavedJourney(hasSave()); setScreen("title"); }} />}
      {panel === "inventory" && snapshot && <InventoryPanel snapshot={snapshot} onUse={(item) => engineRef.current?.useItem(item)} onClose={closePanel} />}
      {panel === "crafting" && snapshot && <CraftingPanel snapshot={snapshot} onCraft={(id) => engineRef.current?.craft(id)} onClose={closePanel} />}
      {panel === "building" && snapshot && <BuildingPanel snapshot={snapshot} onChoose={chooseBuild} onClose={closePanel} />}
      {panel === "settings" && <SettingsPanel settings={settings} onChange={setSettings} onClose={() => panel === "settings" && snapshot ? setPanel("pause") : setPanel(null)} />}
      {woundPrompt && snapshot && <WoundChoice state={snapshot.state} onChoose={chooseWound} onClose={() => { setWoundPrompt(false); closePanel(); }} />}
    </main>
  );
}

function Hud({ snapshot, onOpenPanel, onSelectWeapon }: {
  readonly snapshot: GameSnapshot;
  readonly onOpenPanel: (panel: "inventory" | "crafting" | "building") => void;
  readonly onSelectWeapon: (weapon: WeaponId) => void;
}) {
  const { state } = snapshot;
  const time = Math.floor(state.elapsed);
  const minutes = String(Math.floor(time / 60)).padStart(2, "0");
  const seconds = String(time % 60).padStart(2, "0");
  const eventNames: Record<GameState["event"], string> = {
    despertar: "Despertar", chuva: "Chuva migratória", mergulho: "Mergulho parcial", infestacao: "Infestação", encontro: "Encontro", conclusao: "Conclusão",
  };
  return (
    <div className="hud">
      <section className="objective-card">
        <p className="hud-label">objetivo atual · {eventNames[state.event]}</p>
        <strong>{snapshot.objective}</strong>
        <span>{minutes}:{seconds} · vento {state.weather}</span>
      </section>
      <section className="status-cluster" aria-label="Estado de sobrevivência">
        <StatusBar label="Vida" value={state.stats.health} icon="✚" critical={state.stats.health < 25} />
        <StatusBar label="Stamina" value={state.stats.stamina} icon="↟" compact />
        <div className="needs-row">
          <MiniNeed label="Fome" value={state.stats.hunger} icon="◒" />
          <MiniNeed label="Sede" value={state.stats.thirst} icon="◌" />
          <MiniNeed label="Exposição" value={100 - state.stats.exposure} icon="△" invert />
          {state.stats.infection > 0 && <MiniNeed label="Infecção" value={100 - state.stats.infection} icon="✣" invert />}
        </div>
      </section>
      <section className="symbiosis-card">
        <p className="hud-label">vínculo vivo</p>
        <div className="symbiosis-ring" style={{ "--value": `${state.symbiosis * 3.6}deg` } as CSSProperties}><span>{Math.round(state.symbiosis)}</span></div>
        <div><strong>Simbiose</strong><small>Colosso {Math.round(state.colossusHealth)}%</small></div>
      </section>
      <nav className="quick-nav" aria-label="Ações do jogo">
        <button type="button" onClick={() => onOpenPanel("inventory")}><kbd>Tab</kbd> Inventário</button>
        <button type="button" onClick={() => onOpenPanel("crafting")}><kbd>C</kbd> Fabricar</button>
        <button type="button" onClick={() => onOpenPanel("building")}><kbd>B</kbd> Construir</button>
      </nav>
      <section className="weapon-bar" aria-label="Armas">
        {(["lança", "machado", "arco"] as const).map((weapon, index) => {
          const available = state.inventory[weapon] > 0;
          return <button type="button" disabled={!available} className={state.weapon === weapon ? "active" : ""} onClick={() => onSelectWeapon(weapon)} key={weapon}><kbd>{index + 1}</kbd><span>{ITEMS[weapon].icon}</span>{ITEMS[weapon].name}{weapon === "arco" && available ? ` · ${state.inventory.flecha}` : ""}</button>;
        })}
      </section>
      <div className="reticle" aria-hidden="true"><i /><i /></div>
    </div>
  );
}

function StatusBar({ label, value, icon, compact = false, critical = false }: { readonly label: string; readonly value: number; readonly icon: string; readonly compact?: boolean; readonly critical?: boolean }) {
  return <div className={`status-bar ${compact ? "compact" : ""} ${critical ? "critical" : ""}`}><span>{icon}</span><div><label>{label} <b>{Math.round(value)}</b></label><i><em style={{ width: `${clampPercent(value)}%` }} /></i></div></div>;
}

function MiniNeed({ label, value, icon, invert = false }: { readonly label: string; readonly value: number; readonly icon: string; readonly invert?: boolean }) {
  const critical = value < 22;
  return <div className={`mini-need ${critical ? "critical" : ""}`} title={`${label}: ${Math.round(invert ? 100 - value : value)}%`}><span>{icon}</span><i style={{ "--need": `${clampPercent(value)}%` } as CSSProperties} /><small>{label}</small></div>;
}

function InventoryPanel({ snapshot, onUse, onClose }: { readonly snapshot: GameSnapshot; readonly onUse: (item: ItemId) => void; readonly onClose: () => void }) {
  const consumables: readonly ItemId[] = ["fruta", "agua", "carne-crua", "carne-cozida", "bandagem", "antidoto"];
  return (
    <GamePanel eyebrow="Mochila de campo" title="Inventário" onClose={onClose} footer="Recursos sem baú podem ser perdidos em um mergulho.">
      <div className="inventory-grid">
        {ITEM_IDS.map((id) => {
          const amount = snapshot.state.inventory[id];
          return <button key={id} type="button" disabled={amount <= 0} onClick={() => consumables.includes(id) && onUse(id)} title={ITEMS[id].description}>
            <span>{ITEMS[id].icon}</span><strong>{ITEMS[id].name}</strong><b>{amount}</b><small>{consumables.includes(id) ? "usar" : ITEMS[id].description}</small>
          </button>;
        })}
      </div>
    </GamePanel>
  );
}

function CraftingPanel({ snapshot, onCraft, onClose }: { readonly snapshot: GameSnapshot; readonly onCraft: (id: string) => void; readonly onClose: () => void }) {
  const stations = new Set<StructureId>(snapshot.state.structures.map((structure) => structure.type));
  if (snapshot.station) stations.add(snapshot.station);
  return (
    <GamePanel eyebrow="Conhecimento improvisado" title="Fabricação" onClose={onClose} footer="Bancadas e fogueiras liberam receitas quando construídas ou próximas.">
      <div className="recipe-list">
        {RECIPES.map((recipe) => {
          const enough = hasCost(snapshot.state.inventory, recipe.cost);
          const stationReady = !recipe.station || stations.has(recipe.station) || recipe.station === "fogueira";
          return <button key={recipe.id} type="button" disabled={!enough || !stationReady} onClick={() => onCraft(recipe.id)}>
            <span>{Object.entries(recipe.output).map(([id]) => ITEMS[id as ItemId].icon).join(" ")}</span>
            <div><strong>{recipe.name}</strong><small>{formatCost(recipe.cost)}</small></div>
            <em>{recipe.station ? (stationReady ? recipe.station : `requer ${recipe.station}`) : "manual"}</em>
          </button>;
        })}
      </div>
    </GamePanel>
  );
}

function BuildingPanel({ snapshot, onChoose, onClose }: { readonly snapshot: GameSnapshot; readonly onChoose: (id: StructureId) => void; readonly onClose: () => void }) {
  return (
    <GamePanel eyebrow={`${snapshot.totalWeight}/${snapshot.weightCapacity} de carga dorsal`} title="Construção" onClose={onClose} footer="Estruturas pesadas reduzem ligeiramente a simbiose. Ctrl ativa encaixe em grade.">
      <div className="structure-grid">
        {STRUCTURES.map((structure) => {
          const enough = hasCost(snapshot.state.inventory, structure.cost);
          const fits = snapshot.totalWeight + structure.weight <= snapshot.weightCapacity;
          return <button key={structure.id} type="button" disabled={!enough || !fits} onClick={() => onChoose(structure.id)}>
            <span className="structure-glyph">⌂</span><div><strong>{structure.name}</strong><small>{structure.description}</small><em>{formatCost(structure.cost)}</em></div><b>{structure.weight}<small> kg dorsal</small></b>
          </button>;
        })}
      </div>
    </GamePanel>
  );
}

function WoundChoice({ state, onChoose, onClose }: { readonly state: GameState; readonly onChoose: (decision: "healed" | "harvested") => void; readonly onClose: () => void }) {
  const canHeal = state.inventory.erva >= 2 && state.inventory.bandagem >= 1;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="wound-title">
      <section className="choice-panel">
        <p className="panel-eyebrow">A terra se contrai sob sua mão</p>
        <h2 id="wound-title">A Ferida Antiga</h2>
        <p>Farpas minerais cresceram ao redor de um arpão perdido. A seiva cristalizada resolveria sua escassez — ou suas ervas poderiam aliviar a criatura.</p>
        <div className="choice-grid">
          <button type="button" disabled={!canHeal} onClick={() => onChoose("healed")}><span>✦</span><strong>Tratar o colosso</strong><small>Custa 2 ervas + 1 bandagem. Aumenta vínculo e estabiliza o terreno.</small>{!canHeal && <em>Materiais insuficientes</em>}</button>
          <button type="button" onClick={() => onChoose("harvested")}><span>♦</span><strong>Extrair cristais</strong><small>Recebe 5 cristais + alimento. Fere o colosso e endurece o final.</small><em>Recurso imediato</em></button>
        </div>
        <button className="panel-close text-action" type="button" onClick={onClose}>Decidir depois</button>
      </section>
    </div>
  );
}

function PausePanel({ onResume, onSave, onSettings, onTitle }: { readonly onResume: () => void; readonly onSave: () => void; readonly onSettings: () => void; readonly onTitle: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <section className="pause-panel">
        <p className="panel-eyebrow">O tempo está suspenso</p><h2 id="pause-title">Pausa</h2>
        <button className="primary-action" type="button" onClick={onResume}>Retomar</button>
        <button className="secondary-action" type="button" onClick={onSave}>Salvar jornada</button>
        <button className="secondary-action" type="button" onClick={onSettings}>Configurações</button>
        <button className="text-action" type="button" onClick={onTitle}>Menu principal</button>
        <p className="control-legend"><b>WASD</b> mover · <b>Mouse</b> olhar / segurar para ataque carregado · <b>Shift</b> correr · <b>Espaço</b> saltar · <b>Q</b> esquivar · <b>Direito</b> bloquear/parry · <b>R</b> arremessar lança · <b>G</b> gancho · <b>E</b> interagir</p>
      </section>
    </div>
  );
}

function SettingsPanel({ settings, onChange, onClose }: { readonly settings: GameSettings; readonly onChange: (settings: GameSettings) => void; readonly onClose: () => void }) {
  const update = <Key extends keyof GameSettings>(key: Key, value: GameSettings[Key]): void => onChange({ ...settings, [key]: value });
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <section className="settings-panel">
        <p className="panel-eyebrow">Acessibilidade e desempenho</p><h2 id="settings-title">Configurações</h2>
        <div className="settings-grid">
          <RangeSetting label="Volume geral" value={settings.masterVolume} onChange={(value) => update("masterVolume", value)} />
          <RangeSetting label="Música" value={settings.musicVolume} onChange={(value) => update("musicVolume", value)} />
          <RangeSetting label="Efeitos" value={settings.effectsVolume} onChange={(value) => update("effectsVolume", value)} />
          <RangeSetting label="Ambiente" value={settings.ambientVolume} onChange={(value) => update("ambientVolume", value)} />
          <RangeSetting label="Sensibilidade" value={settings.sensitivity} maximum={1.5} onChange={(value) => update("sensitivity", value)} />
          <RangeSetting label="Tamanho do texto" value={settings.textScale} minimum={0.85} maximum={1.4} onChange={(value) => update("textScale", value)} />
          <label className="select-setting"><span>Qualidade</span><select value={settings.quality} onChange={(event) => update("quality", event.target.value as GameSettings["quality"])}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select></label>
          <ToggleSetting label="Inverter eixo vertical" checked={settings.invertY} onChange={(value) => update("invertY", value)} />
          <ToggleSetting label="Reduzir tremor da câmera" checked={settings.reducedShake} onChange={(value) => update("reducedShake", value)} />
          <ToggleSetting label="Reduzir movimento do colosso" checked={settings.reducedColossusMotion} onChange={(value) => update("reducedColossusMotion", value)} />
          <ToggleSetting label="Segurar para correr" checked={settings.holdToSprint} onChange={(value) => update("holdToSprint", value)} />
          <ToggleSetting label="Legendas de sons" checked={settings.showSubtitles} onChange={(value) => update("showSubtitles", value)} />
        </div>
        <button className="primary-action panel-close" type="button" onClick={onClose}>Concluir</button>
      </section>
    </div>
  );
}

function RangeSetting({ label, value, onChange, minimum = 0, maximum = 1 }: { readonly label: string; readonly value: number; readonly onChange: (value: number) => void; readonly minimum?: number; readonly maximum?: number }) {
  return <label className="range-setting"><span>{label}<b>{Math.round(value * 100)}</b></span><input type="range" min={minimum} max={maximum} step="0.05" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function ToggleSetting({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (value: boolean) => void }) {
  return <label className="toggle-setting"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function GamePanel({ eyebrow, title, footer, onClose, children }: { readonly eyebrow: string; readonly title: string; readonly footer: string; readonly onClose: () => void; readonly children: ReactNode }) {
  return (
    <div className="panel-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="game-panel"><header><div><p className="panel-eyebrow">{eyebrow}</p><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label={`Fechar ${title}`}>×</button></header><div className="panel-content">{children}</div><footer>{footer}<kbd>Esc</kbd></footer></section>
    </div>
  );
}

function EndScreen({ tone, eyebrow, title, copy, children }: { readonly tone: "victory" | "defeat"; readonly eyebrow: string; readonly title: string; readonly copy: string; readonly children: ReactNode }) {
  return <main className={`end-screen ${tone}`}><div className="end-horizon" /><section><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p>{children}</section></main>;
}

function DebugOverlay({ snapshot }: { readonly snapshot: GameSnapshot }) {
  return <aside className="debug-overlay"><strong>ERRANTE // PERF</strong><span>FPS {snapshot.fps}</span><span>Frame {snapshot.frameTime} ms</span><span>Draws {snapshot.drawCalls}</span><span>Tris {snapshot.triangles.toLocaleString("pt-BR")}</span><span>Entidades {snapshot.enemiesActive + snapshot.state.structures.length + 1}</span><span>Corpos {snapshot.enemiesActive + 1}</span><span>Solo {snapshot.grounded ? "apoiado" : "no ar"} · Δ {snapshot.groundError.toFixed(3)}</span><span>Pos {snapshot.state.player.x.toFixed(1)} / {snapshot.state.player.z.toFixed(1)}</span><span>Seed {snapshot.state.seed}</span><span>Evento {snapshot.state.event}</span></aside>;
}

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
