// Hybrid Logical Clock
export interface HLC {
    p: number;            // physical time (ms)
    l: number;            // logical counter
    c: string;            // client / session id
  }
  
  export interface PlayheadState {
    ts: HLC;
    pos: number;
    playing: boolean;
    url?: string;
  }
  
  // client -> server
  export interface JoinSessionMessage {
    type: 'JOIN_SESSION';
    sessionId: string;
  }
  
  export interface CreateSessionMessage {
    type: 'CREATE_SESSION';
    sessionId: string;
    url: string;
  }
  
  export interface CrdtUpdateMessage {
    type: 'CRDT_UPDATE';
    sessionId: string;
    state: PlayheadState;
  }
  
  // server -> client
  export interface SessionSnapshotMessage {
    type: 'SESSION_SNAPSHOT';
    sessionId: string;
    state: PlayheadState;
    url: string;
  }
  
  export interface StateBroadcastMessage {
    type: 'STATE_BROADCAST';
    sessionId: string;
    state: PlayheadState;
  }
  
  export interface SessionCreatedMessage {
    type: 'SESSION_CREATED';
    sessionId: string;
    state: PlayheadState;
  }
  
  export type Message =
    | JoinSessionMessage
    | CreateSessionMessage
    | CrdtUpdateMessage
    | SessionSnapshotMessage
    | StateBroadcastMessage
    | SessionCreatedMessage;