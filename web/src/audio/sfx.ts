// Every sound is synthesised here with WebAudio: no samples, no licences. Starts after the first tap.
let ac: AudioContext | null = null;
let master: GainNode, sfxBus: GainNode, musicBus: GainNode;
let muted = false;
try { muted = localStorage.getItem('evermore.muted') === '1'; } catch { /* */ }
let noiseBuf: AudioBuffer;

export function unlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain(); master.gain.value = muted ? 0 : 0.8;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.connect(master);
  musicBus = ac.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  music.start();
}
export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m; try { localStorage.setItem('evermore.muted', m ? '1' : '0'); } catch { /* */ }
  if (ac) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05);
}

const vary = (x: number, p = 0.08) => x * (1 + (Math.random() * 2 - 1) * p);

function tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0, bus?: GainNode) {
  if (!ac) return;
  const t = ac.currentTime + at;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus ?? sfxBus); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, at = 0, q = 1) {
  if (!ac) return;
  const t = ac.currentTime + at;
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 1;
  const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

export const sfx = {
  tap() { tone('square', vary(880, 0.03), 660, 0.05, 0.08); },
  soft() { tone('triangle', vary(520, 0.03), 390, 0.07, 0.1); },
  whoosh(heavy = false) { noise(heavy ? 0.22 : 0.14, heavy ? 0.35 : 0.25, 'bandpass', heavy ? 600 : 1400, heavy ? 2600 : 4200, 0, 1.4); },
  hit(big = false) {
    tone('sine', vary(big ? 150 : 190), 40, big ? 0.32 : 0.18, big ? 0.9 : 0.65);
    noise(big ? 0.2 : 0.1, big ? 0.6 : 0.4, 'lowpass', 3500, 300);
    tone('square', vary(big ? 90 : 120), 50, 0.08, 0.15);
    if (big) { noise(0.5, 0.25, 'bandpass', 900, 120, 0.04, 0.8); tone('sawtooth', 220, 55, 0.45, 0.2, 0.02); }
  },
  clang() { [1320, 1980, 2710].forEach((f, i) => tone('triangle', vary(f, 0.02), f * 0.98, 0.35 - i * 0.07, 0.16 - i * 0.03)); noise(0.06, 0.3, 'highpass', 4000, 3000); },
  ward() { tone('sine', 420, 840, 0.18, 0.12); tone('triangle', 630, 1260, 0.14, 0.06, 0.03); },
  charge() { tone('square', 660, 660, 0.05, 0.06); tone('square', 990, 990, 0.08, 0.06, 0.05); },
  specialUp() { tone('sawtooth', 110, 880, 0.5, 0.18); noise(0.5, 0.15, 'bandpass', 300, 5000, 0, 2); },
  bolt() { tone('square', 1200, 300, 0.22, 0.12); noise(0.2, 0.2, 'bandpass', 3000, 800, 0, 3); },
  coin() { tone('square', 988, 988, 0.07, 0.1); tone('square', 1319, 1319, 0.2, 0.1, 0.07); },
  step() { noise(0.04, 0.12, 'lowpass', 900, 300); },
  ko() { tone('sine', 220, 70, 0.5, 0.35); noise(0.35, 0.22, 'lowpass', 1800, 120); },
  /** a bell: three inharmonic partials with a long tail; i walks up a pentatonic scale */
  chime(i = 0) {
    const scale = [659.3, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760, 2093];
    const f = scale[Math.min(scale.length - 1, i)];
    tone('sine', f, f, 1.6, 0.16); tone('sine', f * 2.76, f * 2.76, 0.7, 0.05, 0.004); tone('sine', f * 5.4, f * 5.4, 0.35, 0.025, 0.006);
    tone('triangle', f / 2, f / 2, 1.2, 0.05, 0.01);
  },
  /** the column of light comes down: a swell and a soft high shimmer */
  seal() {
    tone('sine', 110, 220, 1.4, 0.18); tone('sine', 165, 330, 1.4, 0.1, 0.05);
    noise(1.4, 0.08, 'bandpass', 1800, 7000, 0, 4);
    [1318.5, 1760, 2349].forEach((f, i) => tone('sine', f, f, 1.2, 0.035, 0.5 + i * 0.12));
  },
  /** a ghost breaks: glassy ringing fragments falling upward */
  shatter() {
    noise(0.25, 0.4, 'highpass', 5000, 2500);
    for (let i = 0; i < 14; i++) { const f = 1800 + Math.random() * 3600; tone('sine', f, f * 1.02, 0.4 + Math.random() * 0.8, 0.045, i * 0.035 + Math.random() * 0.03); }
    tone('sine', 880, 1760, 1.2, 0.07, 0.1);
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.5, 0.12, i * 0.09)); tone('sine', 1047, 1047, 1.2, 0.12, 0.36); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone('triangle', f, f * 0.97, 0.3, 0.16, i * 0.18)); },
  levelUp() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => { tone('sine', f, f, 0.9, 0.1, i * 0.07); tone('sine', f * 2.76, f * 2.76, 0.3, 0.025, i * 0.07 + 0.01); }); },
  xtick() { tone('square', vary(1500, 0.05), 1500, 0.03, 0.04); },
  reveal() { noise(0.6, 0.2, 'bandpass', 200, 6000, 0, 2); [784, 988, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.5, 0.08, 0.3 + i * 0.06)); },
};

// A quiet loop: low drone and a slow minor arpeggio. The bus ducks during duels' big hits.
const music = {
  timer: 0 as unknown as number, step: 0, next: 0, intensity: 0,
  start() {
    if (!ac) return;
    const drone = (f: number, v: number) => {
      const o = ac!.createOscillator(), g = ac!.createGain(), lp = ac!.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 420; g.gain.value = v;
      o.connect(lp).connect(g).connect(musicBus); o.start();
    };
    drone(55, 0.05); drone(55.4, 0.05); drone(82.4, 0.025);
    this.next = ac.currentTime + 0.1;
    this.timer = window.setInterval(() => this.sched(), 60);
  },
  sched() {
    if (!ac) return;
    const notes = [220, 261.6, 329.6, 392, 329.6, 261.6, 246.9, 293.7, 349.2, 440, 349.2, 293.7];
    while (this.next < ac.currentTime + 0.2) {
      const f = notes[this.step % notes.length] * (this.intensity > 0.5 && this.step % 2 ? 2 : 1);
      const at = this.next - ac.currentTime;
      tone('triangle', f, f, 0.5, 0.05 + this.intensity * 0.04, at, musicBus);
      if (this.step % 4 === 0) tone('sine', f / 4, f / 4, 0.6, 0.12, at, musicBus);
      if (this.intensity > 0.5 && this.step % 2 === 0) noise(0.04, 0.05, 'highpass', 6000, 5000, at);
      this.step++; this.next += this.intensity > 0.5 ? 0.2 : 0.32;
    }
  },
};
export const setIntensity = (x: number) => { music.intensity = x; };
