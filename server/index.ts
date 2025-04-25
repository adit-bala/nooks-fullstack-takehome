import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { initTRPC } from '@trpc/server';
import { z } from 'zod';

// Define types
interface HLC {
  p: number;  // physical time
  l: number;  // logical counter
  c: string;  // client ID
}

interface PlayheadState {
  ts: HLC;
  pos: number;
  playing: boolean;
  url?: string;
}

type Client = WebSocket;

// Initialize tRPC
const t = initTRPC.create();
const router = t.router;
const publicProcedure = t.procedure;

// Define Zod schemas for validation
const HLCSchema = z.object({
  p: z.number(),
  l: z.number(),
  c: z.string()
});

const PlayheadStateSchema = z.object({
  ts: HLCSchema,
  pos: z.number(),
  playing: z.boolean(),
  url: z.string().optional()
});

// Define message schemas
const JoinSessionSchema = z.object({
  type: z.literal('JOIN_SESSION'),
  sessionId: z.string()
});

const CreateSessionSchema = z.object({
  type: z.literal('CREATE_SESSION'),
  sessionId: z.string(),
  url: z.string()
});

const CrdtUpdateSchema = z.object({
  type: z.literal('CRDT_UPDATE'),
  sessionId: z.string(),
  state: PlayheadStateSchema
});

// Define response schemas
const SessionSnapshotSchema = z.object({
  type: z.literal('SESSION_SNAPSHOT'),
  sessionId: z.string(),
  state: PlayheadStateSchema,
  url: z.string()
});

const StateBroadcastSchema = z.object({
  type: z.literal('STATE_BROADCAST'),
  sessionId: z.string(),
  state: PlayheadStateSchema
});

const SessionCreatedSchema = z.object({
  type: z.literal('SESSION_CREATED'),
  sessionId: z.string(),
  state: PlayheadStateSchema
});

// Union of all message types
const MessageSchema = z.discriminatedUnion('type', [
  JoinSessionSchema,
  CreateSessionSchema,
  CrdtUpdateSchema,
  SessionSnapshotSchema,
  StateBroadcastSchema,
  SessionCreatedSchema
]);

type Message = z.infer<typeof MessageSchema>;

// Initialize express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// In-memory storage for sessions
const sessions = new Map<string, Set<Client>>();
const latestState = new Map<string, PlayheadState>();

// Utility function to broadcast to all clients in a session
function broadcast(sessionId: string, message: Message): void {
  const clients = sessions.get(sessionId) || new Set<Client>();
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// CRDT merge function (LWW-Register)
function merge(current: PlayheadState | undefined, update: PlayheadState): PlayheadState {
  if (!current) return update;

  // Compare timestamps using HLC ordering
  if (compare(update.ts, current.ts) > 0) {
    return update;
  }
  return current;
}

// HLC timestamp comparison
function compare(a: HLC, b: HLC): number {
  if (a.p !== b.p) return a.p - b.p;
  if (a.l !== b.l) return a.l - b.l;
  return a.c.localeCompare(b.c);
}

// Define tRPC procedures
const appRouter = router({
  joinSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const { sessionId } = input;

      if (latestState.has(sessionId)) {
        return {
          type: 'SESSION_SNAPSHOT' as const,
          sessionId,
          state: latestState.get(sessionId)!,
          url: latestState.get(sessionId)!.url || ''
        };
      }

      return { success: false, message: 'Session not found' };
    }),

  createSession: publicProcedure
    .input(z.object({ sessionId: z.string(), url: z.string() }))
    .mutation(({ input }) => {
      const { sessionId, url } = input;

      // Initialize state with paused video at position 0
      const initialState: PlayheadState = {
        ts: { p: Date.now(), l: 0, c: sessionId },
        pos: 0,
        playing: false,
        url
      };

      latestState.set(sessionId, initialState);

      return {
        type: 'SESSION_CREATED' as const,
        sessionId,
        state: initialState
      };
    }),

  updateState: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      state: PlayheadStateSchema
    }))
    .mutation(({ input }) => {
      const { sessionId, state } = input;
      const current = latestState.get(sessionId);
      const next = merge(current, state);

      if (next !== current) {
        latestState.set(sessionId, next);

        // Return the updated state
        return {
          type: 'STATE_BROADCAST' as const,
          sessionId,
          state: next
        };
      }

      return { success: false, message: 'No update needed' };
    }),

  getSessionInfo: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const { sessionId } = input;

      if (latestState.has(sessionId)) {
        return {
          exists: true,
          url: latestState.get(sessionId)!.url || ''
        };
      }

      return { exists: false };
    })
});

// Export type definition of API
export type AppRouter = typeof appRouter;

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      // Validate message with Zod
      const result = MessageSchema.safeParse(data);
      if (!result.success) {
        console.error('Invalid message format:', result.error);
        return;
      }

      const validatedData = result.data;
      const { type, sessionId } = validatedData;

      switch (type) {
        case 'JOIN_SESSION':
          // Add client to session
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, new Set());
          }
          sessions.get(sessionId)!.add(ws);

          // Send current state to client
          if (latestState.has(sessionId)) {
            const state = latestState.get(sessionId)!;
            ws.send(JSON.stringify({
              type: 'SESSION_SNAPSHOT',
              sessionId,
              state,
              url: state.url || ''
            }));
          }
          break;

        case 'CREATE_SESSION':
          // Create a new session with initial state
          const { url } = validatedData;
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, new Set());
          }
          sessions.get(sessionId)!.add(ws);

          // Initialize state with paused video at position 0
          const initialState: PlayheadState = {
            ts: { p: Date.now(), l: 0, c: sessionId },
            pos: 0,
            playing: false,
            url
          };

          latestState.set(sessionId, initialState);

          // Confirm session creation
          ws.send(JSON.stringify({
            type: 'SESSION_CREATED',
            sessionId,
            state: initialState
          }));
          break;

        case 'CRDT_UPDATE':
          // Update state using CRDT merge
          const { state } = validatedData;
          const current = latestState.get(sessionId);
          const next = merge(current, state);

          if (next !== current) {
            latestState.set(sessionId, next);

            // Broadcast to all clients including sender
            broadcast(sessionId, {
              type: 'STATE_BROADCAST',
              sessionId,
              state: next
            });
          }
          break;

        default:
          console.log('Unknown message type:', type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // Remove client from all sessions
    for (const [_sessionId, clients] of sessions.entries()) {
      clients.delete(ws);
      if (clients.size === 0) {
        // Optional: Keep session state for some time before cleanup
        // For now, we'll keep it in memory indefinitely
      }
    }
  });
});

// API endpoint to create a session
app.post('/api/sessions', (req, res) => {
  const { sessionId, url } = req.body;

  // Initialize session state
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Set());
  }

  const initialState: PlayheadState = {
    ts: { p: Date.now(), l: 0, c: sessionId },
    pos: 0,
    playing: false,
    url
  };

  latestState.set(sessionId, initialState);

  res.json({ sessionId, success: true });
});

// API endpoint to get session info
app.get('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (latestState.has(sessionId)) {
    res.json({
      exists: true,
      url: latestState.get(sessionId)!.url || ''
    });
  } else {
    res.status(404).json({ exists: false });
  }
});

// Periodically save session state to disk (every 5 seconds)
// This is optional for the takehome but good for persistence
const SAVE_INTERVAL = 5000; // 5 seconds
const SAVE_PATH = path.join(__dirname, 'sessions.json');

function saveStateToDisk(): void {
  const data: Record<string, PlayheadState> = {};
  for (const [sessionId, state] of latestState.entries()) {
    data[sessionId] = state;
  }

  fs.writeFile(SAVE_PATH, JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error('Error saving sessions to disk:', err);
    }
  });
}

// Try to load saved sessions on startup
try {
  if (fs.existsSync(SAVE_PATH)) {
    const data = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    for (const [sessionId, state] of Object.entries(data)) {
      latestState.set(sessionId, state as PlayheadState);
      sessions.set(sessionId, new Set());
    }
    console.log(`Loaded ${Object.keys(data).length} sessions from disk`);
  }
} catch (error) {
  console.error('Error loading sessions from disk:', error);
}

// Start periodic saving
setInterval(saveStateToDisk, SAVE_INTERVAL);

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});