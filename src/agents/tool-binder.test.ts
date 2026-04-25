import { describe, expect, it } from 'vitest';
import { POC_ROLES } from './poc-registry.js';
import { TOOL_SET_BY_ROLE, getToolSetForRole } from './tool-binder.js';

describe('TOOL_SET_BY_ROLE', () => {
  it('binds every POC role to a tool-set', () => {
    for (const role of POC_ROLES) {
      const set = TOOL_SET_BY_ROLE[role];
      expect(set).toBeDefined();
      expect(set.schemas.length).toBeGreaterThan(0);
      // Every schema has an executor of the same name.
      for (const schema of set.schemas) {
        expect(set.executors[schema.name]).toBeTypeOf('function');
      }
    }
  });

  it('getToolSetForRole returns the expected set', () => {
    expect(getToolSetForRole('producer').schemas.map((s) => s.name)).toEqual(
      expect.arrayContaining(['create_project', 'create_chapter']),
    );
    expect(getToolSetForRole('coder').schemas.map((s) => s.name)).toContain(
      'write_game_project',
    );
  });
});
