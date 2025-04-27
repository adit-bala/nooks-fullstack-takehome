import { EventEmitter } from 'events';

export interface HLC { p:number; l:number; c:string; }
export interface PlayheadState { ts:HLC; pos:number; playing:boolean; url?:string; }

export type Message =
  | { type:'JOIN_SESSION';    sessionId:string }
  | { type:'CREATE_SESSION';  sessionId:string; url:string }
  | { type:'CRDT_UPDATE';     sessionId:string; state:PlayheadState }
  | { type:'SESSION_SNAPSHOT';sessionId:string; state:PlayheadState; url:string }
  | { type:'STATE_BROADCAST'; sessionId:string; state:PlayheadState }
  | { type:'SESSION_CREATED'; sessionId:string; state:PlayheadState };

class TypedEmitter extends EventEmitter {
  override on<T extends Message['type']>(
    type: T,
    listener: (msg: Extract<Message,{type:T}>) => void
  ) { return super.on(type, listener); }
  emitTyped(msg: Message) { this.emit(msg.type, msg); }
}

class WSClient {
  private ws: WebSocket | null = null;
  private state: 'idle'|'connecting'|'ready'|'closed' = 'idle';
  private queue: string[] = [];
  private emitter = new TypedEmitter();
  private logical = 0;
  private clientId = crypto.randomUUID();

  private connect(): void {
    if (this.state === 'ready' || this.state === 'connecting') return;

    this.state = 'connecting';
    this.ws    = new WebSocket('ws://localhost:3001');

    this.ws.onopen = () => {
      this.state = 'ready';
      this.queue.forEach(frame => this.ws!.send(frame));
      this.queue.length = 0;
    };

    this.ws.onmessage = e => {
      try { this.emitter.emitTyped(JSON.parse(e.data)); }
      catch (err) { console.error('WS parse', err); }
    };

    this.ws.onclose  = () => { this.state = 'closed'; };
    this.ws.onerror  = err => console.error('WS error', err);
  }

  private send(msg: Message) {
    const data = JSON.stringify(msg);
    if (this.state !== 'ready') {
      this.connect();
      this.queue.push(data);
    } else {
      this.ws!.send(data);
    }
  }

  on = this.emitter.on.bind(this.emitter);
  off = this.emitter.off.bind(this.emitter);

  createSession(sessionId: string, url: string): Promise<void> {
    this.send({ type:'CREATE_SESSION', sessionId, url });
    return Promise.resolve();
  }

  joinSession(sessionId: string): Promise<void> {
    this.send({ type:'JOIN_SESSION', sessionId });
    return Promise.resolve();
  }

  private pending: {sessionId:string;state:PlayheadState}|null = null;
  private flushTimer: number | null = null;

  updateState(sessionId: string, pos: number, playing: boolean, url?: string): Promise<void> {
    this.logical += 1;
    const state: PlayheadState = {
      ts:{ p:Date.now(), l:this.logical, c:this.clientId },
      pos, playing, url
    };
    this.pending = { sessionId, state };

    return new Promise<void>((resolve) => {
      if (this.flushTimer === null) {
        this.flushTimer = window.setTimeout(() => {
          this.send({ type:'CRDT_UPDATE', ...this.pending! });
          this.pending = null;
          this.flushTimer = null;
          resolve();
        }, 50);
      } else {
        resolve(); // Resolve immediately if there's already a pending update
      }
    });
  }

  disconnect() {
    this.ws?.close();
    this.ws   = null;
    this.state= 'closed';
    this.queue.length = 0;
  }
}

export const wsClient = new WSClient();
