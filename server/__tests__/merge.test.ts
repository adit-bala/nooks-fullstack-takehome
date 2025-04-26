import { HLC, PlayheadState } from '../src/types';

// Copy/paste from server.ts
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

function mkState(p: number, l = 0): PlayheadState {
  return {
    ts: { p, l, c: 'x' },
    pos: p,
    playing: false
  };
}

describe('mergeState (LWW-CRDT)', () => {
  it('takes newer physical time', () => {
    const a = mkState(100);
    const b = mkState(200);
    expect(mergeState(a, b)).toBe(b);
  });

  it('keeps current when update older', () => {
    const a = mkState(200);
    const b = mkState(100);
    expect(mergeState(a, b)).toBe(a);
  });

  it('ties physical → compare logical', () => {
    const a = mkState(100, 0);
    const b = mkState(100, 1);
    expect(mergeState(a, b)).toBe(b);
  });
});