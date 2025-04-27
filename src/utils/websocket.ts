import { v4 as uuidv4 } from "uuid";

// Types matching the server's types
export interface HLC {
  p: number;    // physical time in ms
  l: number;    // logical counter
  c: string;    // client / session id
}

export interface PlayheadState {
  ts: HLC;
  pos: number;      // seconds
  playing: boolean;
  url?: string;     // YouTube URL
}

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

// WebSocket client class
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private clientId: string;
  private messageHandlers: Map<string, ((message: any) => void)[]> = new Map();
  private connectionPromise: Promise<WebSocket> | null = null;
  private logicalClock = 0;

  constructor() {
    this.clientId = uuidv4();
  }

  // Connect to the WebSocket server
  connect(): Promise<WebSocket> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const wsUrl = `ws://localhost:3001`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        resolve(this.ws!);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.connectionPromise = null;
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as Message;
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
    });

    return this.connectionPromise;
  }

  // Send a message to the server
  async sendMessage(message: Message): Promise<void> {
    const ws = await this.connect();
    ws.send(JSON.stringify(message));
  }

  // Create a new session
  async createSession(sessionId: string, url: string): Promise<void> {
    await this.sendMessage({
      type: 'CREATE_SESSION',
      sessionId,
      url
    });
  }

  // Join an existing session
  async joinSession(sessionId: string): Promise<void> {
    await this.sendMessage({
      type: 'JOIN_SESSION',
      sessionId
    });
  }

  // Update the playhead state
  async updateState(sessionId: string, pos: number, playing: boolean, url?: string): Promise<void> {
    // Increment logical clock for each update
    this.logicalClock++;

    // Create timestamp for this update
    const timestamp = Date.now();

    const state: PlayheadState = {
      ts: {
        p: timestamp, // Physical timestamp in milliseconds
        l: this.logicalClock,
        c: this.clientId
      },
      pos,
      playing,
      url
    };

    console.log(`Sending state update: pos=${pos}, playing=${playing}, timestamp=${timestamp}`);

    await this.sendMessage({
      type: 'CRDT_UPDATE',
      sessionId,
      state
    });
  }

  // Register a handler for a specific message type
  on<T extends Message['type']>(
    type: T,
    handler: (message: Extract<Message, { type: T }>) => void
  ): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler as any);
  }

  // Handle incoming messages
  private handleMessage(message: Message): void {
    const { type } = message;
    const handlers = this.messageHandlers.get(type) || [];

    handlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error(`Error in handler for message type ${type}:`, error);
      }
    });
  }

  // Close the WebSocket connection
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connectionPromise = null;
    }
  }
}

// Create a singleton instance
export const wsClient = new WebSocketClient();
