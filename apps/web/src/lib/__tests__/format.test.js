import { describe, expect, it } from 'vitest';
import { formatBytes, formatDateTime, formatNumber, shorten, timeAgo } from '../format';

describe('formatNumber', () => {
  it('renders an em dash for missing values', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber('not a number')).toBe('—');
  });

  it('compacts large numbers', () => {
    expect(formatNumber(1500000)).toMatch(/1\.5M/);
  });

  it('keeps small numbers literal', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('formatBytes', () => {
  it('scales units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('handles missing sizes', () => {
    expect(formatBytes(0)).toBe('—');
  });
});

describe('timeAgo', () => {
  it('describes recent timestamps', () => {
    const now = new Date();
    expect(timeAgo(new Date(now.getTime() - 30 * 1000).toISOString())).toBe('just now');
    expect(timeAgo(new Date(now.getTime() - 5 * 60 * 1000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(now.getTime() - 3 * 3600 * 1000).toISOString())).toBe('3h ago');
    expect(timeAgo(new Date(now.getTime() - 2 * 86400 * 1000).toISOString())).toBe('2d ago');
  });

  it('handles invalid input', () => {
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo('garbage')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('formats ISO strings', () => {
    expect(formatDateTime('2026-11-19T10:30:00Z')).toMatch(/2026/);
  });

  it('returns a dash for empty input', () => {
    expect(formatDateTime('')).toBe('—');
  });
});

describe('shorten', () => {
  it('truncates with an ellipsis', () => {
    expect(shorten('abcdefghij', 5)).toBe('abcd…');
    expect(shorten('abc', 5)).toBe('abc');
  });
});
