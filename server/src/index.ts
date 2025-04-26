import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

import {
  HLC,
  PlayheadState,
  Message,
  CreateSessionMessage,
  CrdtUpdateMessage
} from './types';

function compareHLC(a: HLC, b: HLC): number {
  if (a.p !== b.p) return a.p - b.p; // if updated physical time is higher, we set physical time to update
  if (a.l !== b.l) return a.l - b.l; // fall back on logical time as tie-breaker
  return a.c.localeCompare(b.c); // fall back on client id as final tie-breaker
}

function mergeState(
  current: PlayheadState | undefined,
  update: PlayheadState
): PlayheadState {
  if (!current) return update;
  return compareHLC(update.ts, current.ts) > 0 ? update : current;
}

const sessions = new Map<string, Set<WebSocket>>();
const latestState = new Map<string, PlayheadState>();

function broadcast(sessionId: string, message: Message) {
  const clients = sessions.get(sessionId);
  if (!clients) return;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

const app = express();
app.use(cors());

export const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error('WS: invalid JSON');
      return;
    }

    // Minimal runtime check
    if (typeof msg.type !== 'string' || typeof msg.sessionId !== 'string') {
      console.error('WS: malformed message');
      return;
    }

    const { type, sessionId } = msg as Message;

    switch (type) {
      case 'CREATE_SESSION': {
        const { url } = msg as CreateSessionMessage;
        if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
        sessions.get(sessionId)!.add(ws);

        const initial: PlayheadState = {
          ts: { p: Date.now(), l: 0, c: sessionId }, // use sessionId as client id since it's already unique
          pos: 0,
          playing: false,
          url
        };
        latestState.set(sessionId, initial);

        ws.send(JSON.stringify({
          type: 'SESSION_CREATED',
          sessionId,
          state: initial
        } as Message));
        break;
      }

      case 'JOIN_SESSION': {
        if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
        sessions.get(sessionId)!.add(ws);

        const snapshot = latestState.get(sessionId);
        if (snapshot) {
          ws.send(JSON.stringify({
            type: 'SESSION_SNAPSHOT',
            sessionId,
            state: snapshot,
            url: snapshot.url ?? ''
          } as Message));
        }
        break;
      }

      case 'CRDT_UPDATE': {
        const { state } = msg as CrdtUpdateMessage;
        const next = mergeState(latestState.get(sessionId), state);
        if (next !== latestState.get(sessionId)) {
          latestState.set(sessionId, next);
          broadcast(sessionId, {
            type: 'STATE_BROADCAST',
            sessionId,
            state: next
          } as Message);
        }
        break;
      }

      default:
        console.warn('WS: unknown message type', type);
    }
  });

  ws.on('close', () => {
    for (const set of sessions.values()) {
      set.delete(ws);
    }
  });
});

// const SAVE_PATH = path.join(process.cwd(), 'sessions.json');
// const persist = setInterval(() => {
//   fs.writeFileSync(SAVE_PATH, JSON.stringify(Object.fromEntries(latestState)), 'utf8');
// }, 5_000);

// if (fs.existsSync(SAVE_PATH)) {
//   try {
//     const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
//     for (const [id, state] of Object.entries(raw)) {
//       latestState.set(id, state as PlayheadState);
//       sessions.set(id, new Set());
//     }
//     console.log(`Restored ${latestState.size} sessions`);
//   } catch {
//     console.error('Failed to restore sessions from disk');
//   }
// }

const PORT = process.env.PORT ?? 3001;
if (require.main === module) {
  server.listen(PORT, () => console.log(`Listening on :${PORT}`));
}