import { mergeState } from '../src/index'; // export if you want, or copy func
import { PlayheadState } from '../src/types';

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