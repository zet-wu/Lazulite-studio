import { describe, expect, it } from 'vitest';
import { isCapabilities, isDocumentShell, isProjectList, isSession } from './validate';

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

  it('accepts nullable document timing without accepting fractional microseconds', () => {
    const base = { schema_version: 'studio-document-shell-v1', project_id: 'p', revision: 'r', title: 'x', language: 'ja', lines: [], read_only_reasons: [] };
    expect(isDocumentShell(base)).toBe(true);
    expect(isDocumentShell({ ...base, lines: [{ id: 'l', text: 'x', begin_us: 1.5, end_us: null }] })).toBe(false);
    expect(isDocumentShell({ ...base, read_only_reasons: [3] })).toBe(false);
    expect(isDocumentShell({ ...base, lines: [{ id: 'l', text: 'x', begin_us: 2, end_us: 1 }] })).toBe(false);
  });
});
