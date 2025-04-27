import express from 'express';
import http from 'http';
import cors from 'cors';
import { logger, LOG_LEVEL } from './logging';
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

// Generate a unique ID for each WebSocket connection for logging
let connectionCounter = 0;
const getConnectionId = () => {
  connectionCounter++;
  return `conn_${connectionCounter}`;
};

// Store connection IDs for each WebSocket
const connectionIds = new WeakMap<WebSocket, string>();

// Map to store pending broadcasts for coalescing
const pending = new Map<string, Message>();

// Track coalescing statistics
const coalesceStats = {
  scheduled: 0,
  coalesced: 0,
  executed: 0,
  getCoalescingRatio: function() {
    return this.scheduled > 0 ? (this.coalesced / this.scheduled * 100).toFixed(2) + '%' : '0%';
  }
};

// Schedule a broadcast with coalescing
function scheduleBroadcast(sessionId: string, msg: Message) {
  coalesceStats.scheduled++;
  logger.debug(`Scheduling broadcast for session ${sessionId}, message type ${msg.type}`);

  if (!pending.has(sessionId)) {
    // If no pending broadcast for this session, schedule one
    pending.set(sessionId, msg);
    setTimeout(() => {
      const pendingMsg = pending.get(sessionId)!;
      coalesceStats.executed++;
      logger.debug(`Executing coalesced broadcast for session ${sessionId}, message type ${pendingMsg.type}`);
      logger.debug(`Coalescing stats: ${coalesceStats.scheduled} scheduled, ${coalesceStats.coalesced} coalesced (${coalesceStats.getCoalescingRatio()} ratio)`);
      broadcast(sessionId, pendingMsg);
      pending.delete(sessionId);
    }, 20); // 1 tick ≈60 fps (about 16.7ms)
  } else {
    // If there's already a pending broadcast, just update the message
    coalesceStats.coalesced++;
    logger.debug(`Coalescing broadcast for session ${sessionId}, replacing with newer message`);
    pending.set(sessionId, msg); // overwrite with newest
  }
}

// Actual broadcast function that sends messages to clients
function broadcast(sessionId: string, message: Message) {
  const clients = sessions.get(sessionId);
  if (!clients) {
    logger.warn(`Attempted to broadcast to non-existent session: ${sessionId}`);
    return;
  }

  logger.info(`Broadcasting message type ${message.type} to session ${sessionId} (${clients.size} clients)`);
  const messageStr = JSON.stringify(message);
  let sentCount = 0;
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      const connId = connectionIds.get(ws) || 'unknown';
      try {
        ws.send(messageStr);
        logger.debug(`Sent ${message.type} to client ${connId} (${messageStr.length} bytes)`);
        sentCount++;
      } catch (error) {
        logger.error(`Failed to send message to client ${connId}:`, error);
      }
    }
  }

  logger.info(`Successfully sent message to ${sentCount}/${clients.size} clients in session ${sessionId}`);
}

const app = express();
app.use(cors());

// Add a simple health check endpoint
// curl http://localhost:3001/health
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
    logLevel: LOG_LEVEL,
    coalescing: {
      scheduled: coalesceStats.scheduled,
      coalesced: coalesceStats.coalesced,
      executed: coalesceStats.executed,
      ratio: coalesceStats.getCoalescingRatio()
    }
  });
});

export const server = http.createServer(app);
const wss = new WebSocketServer({ server });

logger.info(`WebSocket server created (LOG_LEVEL: ${LOG_LEVEL})`);

wss.on('connection', (ws, req) => {
  const connId = getConnectionId();
  connectionIds.set(ws, connId);

  const ip = req.socket.remoteAddress || 'unknown';
  logger.info(`New WebSocket connection: ${connId} from ${ip}`);

  ws.on('message', (raw) => {
    logger.debug(`Received message from ${connId}: ${raw.toString().substring(0, 100)}${raw.toString().length > 100 ? '...' : ''}`);

    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch (error) {
      logger.error(`Invalid JSON from ${connId}:`, error);
      return;
    }

    // Minimal runtime check
    if (typeof msg.type !== 'string' || typeof msg.sessionId !== 'string') {
      logger.error(`Malformed message from ${connId}, missing type or sessionId:`, msg);
      return;
    }

    const { type, sessionId } = msg as Message;
    logger.info(`Processing ${type} message for session ${sessionId} from ${connId}`);

    switch (type) {
      case 'CREATE_SESSION': {
        const { url } = msg as CreateSessionMessage;
        logger.info(`Creating new session ${sessionId} with URL ${url} by ${connId}`);

        if (!sessions.has(sessionId)) {
          logger.debug(`Initializing new session container for ${sessionId}`);
          sessions.set(sessionId, new Set());
        }

        sessions.get(sessionId)!.add(ws);
        logger.debug(`Added client ${connId} to session ${sessionId}, now has ${sessions.get(sessionId)!.size} clients`);

        const initial: PlayheadState = {
          ts: { p: Date.now(), l: 0, c: sessionId }, // use sessionId as client id since it's already unique
          pos: 0,
          playing: false,
          url
        };
        latestState.set(sessionId, initial);
        logger.debug(`Set initial state for session ${sessionId}:`, initial);

        const response = {
          type: 'SESSION_CREATED',
          sessionId,
          state: initial
        } as Message;

        try {
          const responseStr = JSON.stringify(response);
          ws.send(responseStr);
          logger.info(`Sent SESSION_CREATED confirmation to ${connId} for session ${sessionId} (${responseStr.length} bytes)`);
        } catch (error) {
          logger.error(`Failed to send SESSION_CREATED to ${connId}:`, error);
        }
        break;
      }

      case 'JOIN_SESSION': {
        logger.info(`Client ${connId} joining session ${sessionId}`);

        if (!sessions.has(sessionId)) {
          logger.debug(`Session ${sessionId} doesn't exist yet, creating it`);
          sessions.set(sessionId, new Set());
        }

        sessions.get(sessionId)!.add(ws);
        logger.debug(`Added client ${connId} to session ${sessionId}, now has ${sessions.get(sessionId)!.size} clients`);

        const snapshot = latestState.get(sessionId);
        if (snapshot) {
          logger.debug(`Found existing state for session ${sessionId}:`, snapshot);

          const response = {
            type: 'SESSION_SNAPSHOT',
            sessionId,
            state: snapshot,
            url: snapshot.url ?? ''
          } as Message;

          try {
            const responseStr = JSON.stringify(response);
            ws.send(responseStr);
            logger.info(`Sent SESSION_SNAPSHOT to ${connId} for session ${sessionId} (${responseStr.length} bytes)`);
          } catch (error) {
            logger.error(`Failed to send SESSION_SNAPSHOT to ${connId}:`, error);
          }
        } else {
          logger.warn(`No state found for session ${sessionId}, client ${connId} joined an empty session`);
        }
        break;
      }

      case 'CRDT_UPDATE': {
        const { state } = msg as CrdtUpdateMessage;
        logger.debug(`Received state update for session ${sessionId} from ${connId}:`, state);

        const currentState = latestState.get(sessionId);
        logger.debug(`Current state for session ${sessionId}:`, currentState);

        const next = mergeState(currentState, state);

        if (next !== currentState) {
          logger.info(`State updated for session ${sessionId}, pos: ${next.pos}, playing: ${next.playing}`);
          latestState.set(sessionId, next);

          // Use scheduleBroadcast instead of broadcast to coalesce rapid updates
          // This helps reduce the number of messages sent to clients by combining
          // multiple updates that occur within a short time window (20ms)
          // For example, if a client sends 10 updates in 15ms, only the last one will be broadcast
          scheduleBroadcast(sessionId, {
            type: 'STATE_BROADCAST',
            sessionId,
            state: next
          } as Message);
        } else {
          logger.debug(`No state change for session ${sessionId} after merge`);
        }
        break;
      }

      default:
        logger.warn(`Unknown message type ${type} from ${connId}`);
    }
  });

  ws.on('close', (code, reason) => {
    logger.info(`WebSocket ${connId} closed with code ${code}, reason: ${reason || 'none'}`);

    // Remove from all sessions
    let sessionsRemoved = 0;
    for (const [sessionId, clients] of sessions.entries()) {
      if (clients.delete(ws)) {
        sessionsRemoved++;
        logger.debug(`Removed client ${connId} from session ${sessionId}, now has ${clients.size} clients`);

        // Clean up empty sessions
        if (clients.size === 0) {
          logger.info(`Session ${sessionId} is now empty, cleaning up`);
          sessions.delete(sessionId);
          latestState.delete(sessionId);
        }
      }
    }

    logger.info(`Client ${connId} removed from ${sessionsRemoved} sessions`);
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket ${connId} error:`, error);
  });
});

// TODO(adit): persistence
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
  server.listen(PORT, () => {
    logger.info(`WebSocket server listening on port ${PORT}`);
    logger.info(`Health check available at http://localhost:${PORT}/health`);
    logger.info(`Server process ID: ${process.pid}`);
    logger.info(`Node.js version: ${process.version}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Log level: ${LOG_LEVEL} (change with --log=debug or LOG_LEVEL=debug environment variable)`);
    logger.debug('Debug logging is enabled');
    logger.info('Ready to accept connections');
  });

  // Handle process termination gracefully
  process.on('SIGINT', () => {
    logger.info('Received SIGINT signal, shutting down gracefully');
    server.close(() => {
      logger.info('Server closed, exiting process');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal, shutting down gracefully');
    server.close(() => {
      logger.info('Server closed, exiting process');
      process.exit(0);
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    // Keep the server running despite uncaught exceptions
  });
}