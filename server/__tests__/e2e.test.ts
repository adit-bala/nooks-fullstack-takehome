// e2e.test.ts
import http from 'http';
import { server } from '../src/index';
import WebSocket from 'ws';
import { PlayheadState, Message } from '../src/types';

// Helper to create a PlayheadState with a specific timestamp
function createPlayheadState(
  sessionId: string,
  pos: number = 0,
  playing: boolean = false,
  url: string = 'https://example.com',
  timestamp?: { p: number; l: number }
): PlayheadState {
  return {
    ts: {
      p: timestamp?.p ?? Date.now(),
      l: timestamp?.l ?? 0,
      c: sessionId
    },
    pos,
    playing,
    url
  };
}

// Helper to create a WebSocket client and wait for the connection
function createClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// Helper to wait for one message (optionally filtered by type)
function waitForMessage<T extends Message['type']>(
  ws: WebSocket,
  expectedType?: T
): Promise<Extract<Message, { type: T }>> {
  return new Promise((resolve, reject) => {
    function handler(data: WebSocket.Data) {
      try {
        const msg = JSON.parse(data.toString()) as Message;
        if (!expectedType || msg.type === expectedType) {
          ws.off('message', handler);
          resolve(msg as Extract<Message, { type: T }>);
        }
      } catch (err) {
        ws.off('message', handler);
        reject(err);
      }
    }
    ws.on('message', handler);
  });
}

const PORT = process.env.PORT ?? 3001;
const WS_URL = `ws://localhost:${PORT}`;

let httpServer: http.Server;

beforeAll(done => {
  httpServer = server.listen(PORT, () => done());
});

afterAll(done => {
  httpServer.close(done);
});

describe('End-to-End Watch Party', () => {
  test('full session flow with multiple clients', async () => {
    const sessionId = `test-${Date.now()}-${Math.random()}`;
    const videoUrl = 'https://www.youtube.com/watch?v=test';

    // 1. Host creates a session
    const host = await createClient(WS_URL);
    host.send(JSON.stringify({
      type: 'CREATE_SESSION',
      sessionId,
      url: videoUrl
    }));
    const created = await waitForMessage(host, 'SESSION_CREATED');
    expect(created.type).toBe('SESSION_CREATED');
    expect(created.sessionId).toBe(sessionId);

    // 2. Viewer joins the session
    const viewer = await createClient(WS_URL);
    viewer.send(JSON.stringify({ type: 'JOIN_SESSION', sessionId }));
    const snapshot = await waitForMessage(viewer, 'SESSION_SNAPSHOT');
    expect(snapshot.type).toBe('SESSION_SNAPSHOT');
    expect(snapshot.sessionId).toBe(sessionId);
    expect(snapshot.state.pos).toBe(0);
    expect(snapshot.state.playing).toBe(false);

    // 3. Host starts playing
    const playState = createPlayheadState(sessionId, 0, true, videoUrl);
    host.send(JSON.stringify({ type: 'CRDT_UPDATE', sessionId, state: playState }));
    const [hostPlay, viewerPlay] = await Promise.all([
      waitForMessage(host, 'STATE_BROADCAST'),
      waitForMessage(viewer, 'STATE_BROADCAST')
    ]);
    expect(hostPlay.state.playing).toBe(true);
    expect(viewerPlay.state.playing).toBe(true);

    // 4. Host seeks to 30s
    const seekState = createPlayheadState(
      sessionId,
      30,
      true,
      videoUrl,
      { p: Date.now(), l: 1 }
    );
    host.send(JSON.stringify({ type: 'CRDT_UPDATE', sessionId, state: seekState }));
    const [hostSeek, viewerSeek] = await Promise.all([
      waitForMessage(host, 'STATE_BROADCAST'),
      waitForMessage(viewer, 'STATE_BROADCAST')
    ]);
    expect(hostSeek.state.pos).toBe(30);
    expect(viewerSeek.state.pos).toBe(30);

    // 5. Late joiner connects
    const late = await createClient(WS_URL);
    late.send(JSON.stringify({ type: 'JOIN_SESSION', sessionId }));
    const lateSnap = await waitForMessage(late, 'SESSION_SNAPSHOT');
    expect(lateSnap.state.pos).toBe(30);
    expect(lateSnap.state.playing).toBe(true);

    // 6. Viewer pauses at 35s
    const pauseState = createPlayheadState(
      sessionId,
      35,
      false,
      videoUrl,
      { p: Date.now(), l: 2 }
    );
    viewer.send(JSON.stringify({ type: 'CRDT_UPDATE', sessionId, state: pauseState }));
    const [hostPause, viewerPause, latePause] = await Promise.all([
      waitForMessage(host, 'STATE_BROADCAST'),
      waitForMessage(viewer, 'STATE_BROADCAST'),
      waitForMessage(late, 'STATE_BROADCAST')
    ]);
    expect(hostPause.state.playing).toBe(false);
    expect(hostPause.state.pos).toBe(35);
    expect(viewerPause.state.playing).toBe(false);
    expect(latePause.state.playing).toBe(false);

    // Cleanup
    host.close();
    viewer.close();
    late.close();
  });
});