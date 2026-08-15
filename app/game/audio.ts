import type { GameSettings } from "./save";
import type { EventId, WeatherId } from "./state";

export type SoundEffect =
  | "collect"
  | "craft"
  | "build"
  | "hit"
  | "hurt"
  | "parry"
  | "thunder"
  | "pulse"
  | "victory"
  | "footstep"
  | "jump"
  | "land"
  | "swing"
  | "splash"
  | "dodge";

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private ambient: GainNode | null = null;
  private wind: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private sea: AudioBufferSourceNode | null = null;
  private seaGain: GainNode | null = null;
  private seaSwell: OscillatorNode | null = null;
  private rain: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicOscillators: OscillatorNode[] = [];
  private currentEvent: EventId = "despertar";
  private currentWeather: WeatherId = "limpo";
  private settings: GameSettings;

  constructor(settings: GameSettings) {
    this.settings = settings;
  }

  async start(): Promise<void> {
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    try {
      const context = new AudioContext();
      const master = context.createGain();
      const music = context.createGain();
      const effects = context.createGain();
      const ambient = context.createGain();
      music.connect(master);
      effects.connect(master);
      ambient.connect(master);
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      this.music = music;
      this.effects = effects;
      this.ambient = ambient;
      this.noiseBuffer = this.createNoiseBuffer(2);
      this.applySettings(this.settings);
      this.createWind();
      this.createSea();
      this.createRain();
      this.createMusic();
      this.updateWeatherMix(true);
      await context.resume();
    } catch {
      this.dispose();
    }
  }

  applySettings(settings: GameSettings): void {
    this.settings = settings;
    if (!this.context || !this.master || !this.music || !this.effects || !this.ambient) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(settings.masterVolume, now, 0.08);
    this.music.gain.setTargetAtTime(settings.musicVolume * this.eventMusicLevel(), now, 0.8);
    this.effects.gain.setTargetAtTime(settings.effectsVolume, now, 0.08);
    this.ambient.gain.setTargetAtTime(settings.ambientVolume * 0.38, now, 0.8);
  }

  setEvent(event: EventId): void {
    this.currentEvent = event;
    if (this.context && this.music) this.music.gain.setTargetAtTime(this.settings.musicVolume * this.eventMusicLevel(), this.context.currentTime, 1.8);
    this.musicOscillators.forEach((oscillator, index) => {
      const frequency = this.eventFrequencies()[index] ?? 55;
      oscillator.frequency.setTargetAtTime(frequency, this.context?.currentTime ?? 0, 1.2);
    });
  }

  setWeather(weather: WeatherId): void {
    if (weather === this.currentWeather) return;
    this.currentWeather = weather;
    this.updateWeatherMix(false);
  }

  play(effect: SoundEffect): void {
    if (!this.context || !this.effects) return;
    const frequencies: Record<SoundEffect, readonly [number, number, number]> = {
      collect: [520, 730, 0.09], craft: [190, 380, 0.16], build: [110, 155, 0.2], hit: [92, 48, 0.12], hurt: [180, 80, 0.22],
      parry: [880, 1320, 0.13], thunder: [52, 24, 0.8], pulse: [48, 38, 0.5], victory: [220, 440, 1.2],
      footstep: [118, 72, 0.075], jump: [185, 260, 0.12], land: [96, 54, 0.16], swing: [310, 155, 0.1], splash: [230, 115, 0.14], dodge: [260, 145, 0.12],
    };
    const [start, end, duration] = frequencies[effect];
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = effect === "thunder" || effect === "hit" || effect === "land" ? "sawtooth" : effect === "swing" || effect === "dodge" ? "triangle" : "sine";
    oscillator.frequency.setValueAtTime(start, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), this.context.currentTime + duration);
    const effectGain = effect === "thunder" ? 0.42 : effect === "footstep" ? 0.08 : effect === "swing" || effect === "dodge" ? 0.1 : 0.18;
    gain.gain.setValueAtTime(effectGain, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.effects);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
    this.playNoiseLayer(effect, duration);
  }

  private createNoiseBuffer(duration: number): AudioBuffer | null {
    if (!this.context) return null;
    const length = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  private playNoiseLayer(effect: SoundEffect, duration: number): void {
    if (!this.context || !this.effects || !this.noiseBuffer) return;
    const settings: Partial<Record<SoundEffect, readonly [BiquadFilterType, number, number]>> = {
      footstep: ["lowpass", 340, 0.11],
      land: ["lowpass", 260, 0.2],
      hit: ["bandpass", 520, 0.16],
      hurt: ["bandpass", 760, 0.1],
      thunder: ["lowpass", 180, 0.38],
      swing: ["highpass", 1_150, 0.08],
      dodge: ["bandpass", 880, 0.09],
      splash: ["bandpass", 1_250, 0.18],
      build: ["lowpass", 420, 0.13],
      craft: ["bandpass", 980, 0.08],
    };
    const noiseSettings = settings[effect];
    if (!noiseSettings) return;
    const [filterType, frequency, volume] = noiseSettings;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    source.buffer = this.noiseBuffer;
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = effect === "splash" ? 0.42 : 0.72;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effects);
    source.start(now, Math.random() * Math.max(0.01, this.noiseBuffer.duration - duration));
    source.stop(now + duration);
  }

  private eventMusicLevel(): number {
    if (this.currentEvent === "despertar") return 0.14;
    if (this.currentEvent === "chuva") return 0.22;
    if (this.currentEvent === "mergulho") return 0.31;
    if (this.currentEvent === "infestacao") return 0.46;
    if (this.currentEvent === "encontro" || this.currentEvent === "conclusao") return 0.38;
    return 0.18;
  }

  private eventFrequencies(): readonly number[] {
    if (this.currentEvent === "infestacao") return [73.42, 110, 146.83];
    if (this.currentEvent === "encontro" || this.currentEvent === "conclusao") return [55, 82.41, 123.47];
    if (this.currentEvent === "chuva" || this.currentEvent === "mergulho") return [61.74, 92.5, 123.47];
    return [55, 82.41, 110];
  }

  private createMusic(): void {
    if (!this.context || !this.music) return;
    this.eventFrequencies().forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator();
      const gain = this.context!.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.value = index === 0 ? 0.32 : 0.08;
      oscillator.connect(gain);
      gain.connect(this.music!);
      oscillator.start();
      this.musicOscillators.push(oscillator);
    });
  }

  private createWind(): void {
    if (!this.context || !this.ambient) return;
    const length = this.context.sampleRate * 3;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const noise = Math.random() * 2 - 1;
      previous = previous * 0.985 + noise * 0.015;
      data[index] = previous * 3.2;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const windGain = this.context.createGain();
    filter.type = "lowpass";
    filter.frequency.value = 620;
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter);
    filter.connect(windGain);
    windGain.connect(this.ambient);
    source.start();
    this.wind = source;
    this.windGain = windGain;
  }

  private createSea(): void {
    if (!this.context || !this.ambient) return;
    const length = this.context.sampleRate * 4;
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let rolling = 0;
    for (let index = 0; index < length; index += 1) {
      const noise = Math.random() * 2 - 1;
      rolling = rolling * 0.94 + noise * 0.06;
      const surge = 0.52 + Math.sin(index / this.context.sampleRate * Math.PI * 0.45) * 0.34;
      data[index] = rolling * surge * 1.8;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const waveGain = this.context.createGain();
    const swell = this.context.createOscillator();
    const swellDepth = this.context.createGain();
    filter.type = "bandpass";
    filter.frequency.value = 230;
    filter.Q.value = 0.48;
    waveGain.gain.value = 0.34;
    swell.type = "sine";
    swell.frequency.value = 0.105;
    swellDepth.gain.value = 0.16;
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter);
    filter.connect(waveGain);
    waveGain.connect(this.ambient);
    swell.connect(swellDepth);
    swellDepth.connect(waveGain.gain);
    source.start();
    swell.start();
    this.sea = source;
    this.seaGain = waveGain;
    this.seaSwell = swell;
  }

  private createRain(): void {
    if (!this.context || !this.ambient || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const rainGain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    filter.type = "highpass";
    filter.frequency.value = 1_850;
    filter.Q.value = 0.3;
    rainGain.gain.value = 0;
    source.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(this.ambient);
    source.start();
    this.rain = source;
    this.rainGain = rainGain;
  }

  private updateWeatherMix(immediate: boolean): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const smoothing = immediate ? 0.01 : 1.4;
    const windLevel = this.currentWeather === "tempestade" ? 0.62 : this.currentWeather === "chuva" ? 0.46 : 0.3;
    const seaLevel = this.currentWeather === "tempestade" ? 0.7 : this.currentWeather === "chuva" ? 0.52 : 0.38;
    const rainLevel = this.currentWeather === "tempestade" ? 0.52 : this.currentWeather === "chuva" ? 0.28 : 0;
    this.windGain?.gain.setTargetAtTime(windLevel, now, smoothing);
    this.seaGain?.gain.setTargetAtTime(seaLevel, now, smoothing);
    this.rainGain?.gain.setTargetAtTime(rainLevel, now, smoothing);
  }

  dispose(): void {
    this.wind?.stop();
    this.sea?.stop();
    this.seaSwell?.stop();
    this.rain?.stop();
    this.musicOscillators.forEach((oscillator) => oscillator.stop());
    this.musicOscillators = [];
    void this.context?.close();
    this.context = null;
    this.noiseBuffer = null;
  }
}
