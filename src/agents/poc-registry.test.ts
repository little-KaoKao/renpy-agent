import { describe, expect, it } from 'vitest';
import { POC_ROLES, POC_REGISTRY, getPocDescriptor, isPocRole } from './poc-registry.js';

describe('POC_ROLES', () => {
  it('contains all 11 V0.6 POC roles', () => {
    expect(new Set(POC_ROLES)).toEqual(
      new Set([
        'producer',
        'writer',
        'storyboarder',
        'character_designer',
        'scene_designer',
        'music_director',
        'voice_director',
        'sfx_designer',
        'ui_designer',
        'coder',
        'qa',
      ]),
    );
  });
});

describe('POC_REGISTRY', () => {
  it('has a descriptor for each role', () => {
    for (const role of POC_ROLES) {
      expect(POC_REGISTRY[role]).toBeDefined();
      expect(POC_REGISTRY[role]!.role).toBe(role);
    }
  });

  it('Tier 1 roles declare real tool names', () => {
    expect(POC_REGISTRY.producer.toolNames).toEqual(
      expect.arrayContaining(['create_project', 'create_chapter']),
    );
    expect(POC_REGISTRY.character_designer.toolNames).toEqual(
      expect.arrayContaining(['create_or_update_character', 'generate_character_main_image']),
    );
    expect(POC_REGISTRY.coder.toolNames).toEqual(
      expect.arrayContaining(['write_game_project', 'swap_asset_placeholder']),
    );
    expect(POC_REGISTRY.qa.toolNames).toEqual(expect.arrayContaining(['run_qa']));
  });

  it('Tier 2 roles still have tool names (stubs to be implemented in v0.7)', () => {
    expect(POC_REGISTRY.music_director.toolNames.length).toBeGreaterThan(0);
    expect(POC_REGISTRY.voice_director.toolNames.length).toBeGreaterThan(0);
    expect(POC_REGISTRY.sfx_designer.toolNames.length).toBeGreaterThan(0);
    expect(POC_REGISTRY.ui_designer.toolNames.length).toBeGreaterThan(0);
  });
});

describe('isPocRole', () => {
  it('accepts known roles', () => {
    expect(isPocRole('producer')).toBe(true);
    expect(isPocRole('character_designer')).toBe(true);
  });
  it('rejects unknown strings', () => {
    expect(isPocRole('unknown')).toBe(false);
    expect(isPocRole('')).toBe(false);
  });
});

describe('getPocDescriptor', () => {
  it('returns the descriptor for known roles', () => {
    const d = getPocDescriptor('producer');
    expect(d.role).toBe('producer');
    expect(d.toolNames).toContain('create_project');
  });
  it('throws for unknown roles', () => {
    expect(() => getPocDescriptor('mystery' as unknown as 'producer')).toThrow(/unknown POC role/);
  });
});
