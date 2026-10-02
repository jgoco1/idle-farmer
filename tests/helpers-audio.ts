// A fake AudioContext that records what was created, so audio logic can be tested in Node.

export interface FakeParam {
  value: number;
  setValueAtTime(v: number, t: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, c: number): void;
  cancelScheduledValues(t: number): void;
}

function param(): FakeParam {
  const p: FakeParam = {
    value: 0,
    setValueAtTime(v) {
      p.value = v;
    },
    linearRampToValueAtTime(v) {
      p.value = v;
    },
    exponentialRampToValueAtTime(v) {
      p.value = v;
    },
    setTargetAtTime(v) {
      p.value = v;
    },
    cancelScheduledValues() {},
  };
  return p;
}

export class FakeNode {
  connected: FakeNode[] = [];
  gain = param();
  frequency = param();
  detune = param();
  Q = param();
  type = '';
  buffer: unknown = null;
  loop = false;
  started: number[] = [];
  constructor(readonly kind: string) {}
  connect(n: FakeNode): FakeNode {
    this.connected.push(n);
    return n;
  }
  disconnect(): void {
    this.connected = [];
  }
  start(t: number): void {
    this.started.push(t);
  }
  stop(): void {}
  getChannelData(): Float32Array {
    return new Float32Array(64);
  }
}

export class FakeAudioContext {
  static created = 0;
  currentTime = 0;
  sampleRate = 8000;
  state: 'suspended' | 'running' = 'suspended';
  destination = new FakeNode('destination');
  nodes: FakeNode[] = [];
  resumed = 0;
  suspended = 0;
  constructor() {
    FakeAudioContext.created++;
  }
  private make(kind: string): FakeNode {
    const n = new FakeNode(kind);
    this.nodes.push(n);
    return n;
  }
  createOscillator = (): FakeNode => this.make('osc');
  createGain = (): FakeNode => this.make('gain');
  createBufferSource = (): FakeNode => this.make('noise');
  createBiquadFilter = (): FakeNode => this.make('filter');
  createBuffer = (): FakeNode => new FakeNode('buffer');
  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspended++;
    this.state = 'suspended';
    return Promise.resolve();
  }
  count(kind: string): number {
    return this.nodes.filter((n) => n.kind === kind).length;
  }
}

export const asContext = (c: FakeAudioContext): AudioContext => c as unknown as AudioContext;
