import { expect, it } from 'vitest';
import { estimateBpm } from '../src/domain/bpm';

it('finds the beat interval from timed peaks and rejects silence', () => {
  const maximum = Array.from({ length: 2000 }, (_, index) => index % 50 === 0 ? 1 : 0);
  const minimum = maximum.map((value) => -value);
  expect(estimateBpm(minimum, maximum, 10_000)).toBe(120);
  expect(estimateBpm(maximum.map(() => 0), maximum.map(() => 0), 10_000)).toBeNull();
});
