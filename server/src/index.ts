import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { initTRPC } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { z } from 'zod';

import {
  HLC,
  PlayheadState,
  Message
} from './types';
import {
  PlayheadStateSchema,
  MessageSchema,
  SessionSnapshotSchema,
  SessionCreatedSchema,
  StateBroadcastSchema
} from './schemas';

// ---------------------------------------------------------------------------
// util helpers
// ---------------------------------------------------------------------------
function compareHLC(a: HLC, b: HLC): number {
  if (a.p !== b.p) return a.p - b.p;
  if (a.l !== b.l) return a.l - b.l;
  return a.c.localeCompare(b.c);
}

export function mergeState(
  current: PlayheadState | undefined,
  update: PlayheadState
): PlayheadState {
  if (!current) return update;
  return compareHLC(update.ts, current.ts) > 0 ? update : current;
}

type Client = WebSocket;

// ---------------------------------------------------------------------------
// tRPC setup
// ---------------------------------------------------------------------------
const t = initTRPC.create();
const publicProcedure = t.procedure;

export const appRouter = t.router({
  joinSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const { sessionId } = input;
      const state = latestState.get(sessionId);
      if (state) {
        return {
          type: 'SESSION_SNAPSHOT',
          sessionId,
          state,
          url: state.url ?? ''
        } as z.infer<typeof SessionSnapshotSchema>;
      }
      return { success: false, message: 'Session not found' };
    }),

  createSession: publicProcedure
    .input(z.object({ sessionId: z.string(), url: z.string() }))
    .mutation(({ input }) => {
      const { sessionId, url } = input;
      const initialState: PlayheadState = {
        ts: { p: Date.now(), l: 0, c: sessionId },
        pos: 0,
        playing: false,
        url
      };
      latestState.set(sessionId, initialState);
      return {
        type: 'SESSION_CREATED',
        sessionId,
        state: initialState
      } as z.infer<typeof SessionCreatedSchema>;
    }),

  updateState: publicProcedure
    .input(z.object({ sessionId: z.string(), state: PlayheadStateSchema }))
    .mutation(({ input }) => {
      const { sessionId, state } = input;
      const next = mergeState(latestState.get(sessionId), state);
      if (next !== latestState.get(sessionId)) {
        latestState.set(sessionId, next);
        return {
          type: 'STATE_BROADCAST',
          sessionId,
          state: next
        } as z.infer<typeof StateBroadcastSchema>;
      }
      return { success: false, message: 'No update needed' };
    }),

  getSessionInfo: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const state = latestState.get(input.sessionId);
      return state
        ? { exists: true, url: state.url ?? '' }
        : { exists: false };
    })
});

export type AppRouter = typeof appRouter;

// ---------------------------------------------------------------------------
// Express & WebSocket server
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: () => ({})
  })
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// in-memory session maps -----------------------------------------------------
const sessions = new Map<string, Set<Client>>();
const latestState = new Map<string, PlayheadState>();

function broadcast(sessionId: string, message: Message): void {
  const clients = sessions.get(sessionId) ?? new Set<Client>();
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}

// websocket handlers --------------------------------------------------------
wss.on('connection', (ws) => {
  console.log('client connected');

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString());
      const result = MessageSchema.safeParse(parsed);
      if (!result.success) {
        console.error('invalid message', result.error);
        return;
      }

      const { type, sessionId } = result.data;

      switch (type) {
        case 'JOIN_SESSION': {
          if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
          sessions.get(sessionId)!.add(ws);

          const state = latestState.get(sessionId);
          if (state) {
            ws.send(
              JSON.stringify({
                type: 'SESSION_SNAPSHOT',
                sessionId,
                state,
                url: state.url ?? ''
              })
            );
          }
          break;
        }

        case 'CREATE_SESSION': {
          const { url } = result.data;
          if (!sessions.has(sessionId)) sessions.set(sessionId, new Set());
          sessions.get(sessionId)!.add(ws);

          const initialState: PlayheadState = {
            ts: { p: Date.now(), l: 0, c: sessionId },
            pos: 0,
            playing: false,
            url
          };
          latestState.set(sessionId, initialState);
          ws.send(
            JSON.stringify({
              type: 'SESSION_CREATED',
              sessionId,
              state: initialState
            })
          );
          break;
        }

        case 'CRDT_UPDATE': {
          const { state } = result.data;
          const next = mergeState(latestState.get(sessionId), state);
          if (next !== latestState.get(sessionId)) {
            latestState.set(sessionId, next);
            broadcast(sessionId, {
              type: 'STATE_BROADCAST',
              sessionId,
              state: next
            });
          }
          break;
        }
      }
    } catch (err) {
      console.error('ws error', err);
    }
  });

  ws.on('close', () => {
    for (const clients of sessions.values()) clients.delete(ws);
  });
});

// simple REST fallbacks ------------------------------------------------------
app.post('/api/sessions', (req, res) => {
  const { sessionId, url } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const state: PlayheadState = {
    ts: { p: Date.now(), l: 0, c: sessionId },
    pos: 0,
    playing: false,
    url
  };
  latestState.set(sessionId, state);
  sessions.set(sessionId, new Set());

  res.json({ success: true, sessionId });
});

app.get('/api/sessions/:sessionId', (req, res) => {
  const state = latestState.get(req.params.sessionId);
  state
    ? res.json({ exists: true, url: state.url ?? '' })
    : res.status(404).json({ exists: false });
});

// persistence (optional) ----------------------------------------------------
const SAVE_PATH = path.join(process.cwd(), 'sessions.json');
const persistenceInterval = setInterval(() => {
  const obj: Record<string, PlayheadState> = {};
  latestState.forEach((s, id) => (obj[id] = s));
  fs.writeFile(SAVE_PATH, JSON.stringify(obj, null, 2), () => {});
}, 5_000);

// Clear interval if this is running in a test environment
if (process.env.NODE_ENV === 'test') {
  clearInterval(persistenceInterval);
}

if (fs.existsSync(SAVE_PATH)) {
  const raw = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
  for (const [id, s] of Object.entries(raw)) {
    latestState.set(id, s as PlayheadState);
    sessions.set(id, new Set());
  }
  console.log(`restored ${latestState.size} sessions`);
}

const PORT = process.env.PORT ?? 3001;

// Only start the server if this file is run directly, not when imported in tests
if (require.main === module) {
  server.listen(PORT, () => console.log(`server on :${PORT}`));
}
export { server };
