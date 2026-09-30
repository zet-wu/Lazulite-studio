import { expect, it } from 'vitest';
import { packIntervals } from '../src/domain/pack-intervals';

it('packs exact, partial and triple overlap, reuses touching endpoints deterministically', () => {
  const input = [{ key: 'b', beginUs: 0, endUs: 10 }, { key: 'a', beginUs: 0, endUs: 10 }, { key: 'c', beginUs: 5, endUs: 15 }, { key: 'd', beginUs: 10, endUs: 20 }];
  const original = structuredClone(input);
  const result = packIntervals(input);
  expect([...result.lanes]).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 0]]);
  expect(result.laneCount).toBe(3);
  expect(input).toEqual(original);
  expect(packIntervals(input.reverse())).toEqual(result);
  expect(packIntervals([]).laneCount).toBe(0);
  expect(packIntervals([{ key: 'a', beginUs: 0, endUs: 1 }, { key: 'b', beginUs: 1, endUs: 2 }]).laneCount).toBe(1);
});

it('returns later touching intervals to lane zero after an earlier overlap', () => {
  const result = packIntervals([[0, 2], [1, 3], [5, 6], [6, 7], [7, 8]].map(([beginUs, endUs], i) => ({ key: String(i), beginUs, endUs })));
  expect([...result.lanes.values()]).toEqual([0, 1, 0, 0, 0]);
});
