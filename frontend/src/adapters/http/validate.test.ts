import { describe, expect, it } from 'vitest';
import { isCapabilities, isProjectList, isSession } from './validate';

describe('Studio HTTP DTO guards', () => {
  it('accepts the sample session and rejects missing schema version', () => {
    expect(isSession({ schema_version: 'studio-session-v1', authenticated: true, user: { id: 'u', name: 'Demo' } })).toBe(true);
    expect(isSession({ schema_version: 'future-session', authenticated: true, user: null })).toBe(false);
    expect(isSession({ authenticated: true, user: null })).toBe(false);
    expect(isCapabilities({ schema_version: 'future-capabilities', items: [] })).toBe(false);
  });

  it('keeps an empty project list as a valid state', () => {
    expect(isProjectList({ schema_version: 'studio-project-list-v1', items: [], next_cursor: null })).toBe(true);
    expect(isProjectList({ items: [{}], next_cursor: null })).toBe(false);
  });


});
