import { describe, it, expect } from 'vitest';
import { today, offsetDate, summarize } from '../src/lib/dates';
describe('Bogotá delivery days', () => {
  it('keeps the previous date before 05:00 UTC', () => {
    expect(today(new Date('2026-10-21T04:59:59Z'))).toBe('2026-10-20');
    expect(today(new Date('2026-10-21T05:00:00Z'))).toBe('2026-10-21');
  });
  it('handles month/year boundaries', () => {
    expect(offsetDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(offsetDate('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('returns empty and mixed day counts', () => {
    expect(summarize([])).toEqual({ total: 0, pending: 0, delivered: 0, failed: 0 });
    expect(summarize([{status:'pending'},{status:'delivered'},{status:'failed'}])).toEqual({total:3,pending:1,delivered:1,failed:1});
  });
});
