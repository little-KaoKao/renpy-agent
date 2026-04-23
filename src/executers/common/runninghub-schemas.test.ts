import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_APP_SCHEMAS,
  RUNNINGHUB_APP_IDENTITIES,
  getAppApiId,
  isSchemaConfigured,
} from './runninghub-schemas.js';

describe('runninghub-schemas registry', () => {
  it('covers all eight AI-App keys from PLAN §3.5', () => {
    const keys = Object.keys(RUNNINGHUB_APP_IDENTITIES).sort();
    expect(keys).toEqual(
      [
        'CHARACTER_MAIN_IMAGE',
        'CHARACTER_EXPRESSION',
        'CHARACTER_DYNAMIC_SPRITE',
        'SCENE_BACKGROUND',
        'CUTSCENE_IMAGE_TO_VIDEO',
        'CUTSCENE_REFERENCE_VIDEO',
        'VOICE_LINE',
        'SFX',
      ].sort(),
    );
  });

  it('getAppApiId returns the apiId from identity registry', () => {
    expect(getAppApiId('CHARACTER_MAIN_IMAGE')).toBe('api-448183249');
    expect(getAppApiId('VOICE_LINE')).toBe('api-448183268');
  });

  it('every app has a placeholder schema entry (direct or shared)', () => {
    for (const identity of Object.values(RUNNINGHUB_APP_IDENTITIES)) {
      expect(PLACEHOLDER_APP_SCHEMAS[identity.apiId]).toBeDefined();
    }
  });

  it('dynamic-sprite and reference-video share a single schema entry', () => {
    expect(getAppApiId('CHARACTER_DYNAMIC_SPRITE')).toBe(
      getAppApiId('CUTSCENE_REFERENCE_VIDEO'),
    );
  });

  it('voice-line and sfx share a single schema entry', () => {
    expect(getAppApiId('VOICE_LINE')).toBe(getAppApiId('SFX'));
  });

  it('all placeholder schemas are flagged unconfigured', () => {
    for (const schema of Object.values(PLACEHOLDER_APP_SCHEMAS)) {
      expect(isSchemaConfigured(schema)).toBe(false);
    }
  });

  it('isSchemaConfigured returns true once all TODO strings are replaced', () => {
    expect(
      isSchemaConfigured({
        webappId: '123',
        promptNodeId: '6',
        promptFieldName: 'text',
      }),
    ).toBe(true);
  });

  it('isSchemaConfigured catches leftover TODO in optional fields', () => {
    expect(
      isSchemaConfigured({
        webappId: '123',
        promptNodeId: '6',
        promptFieldName: 'text',
        referenceImageNodeId: 'TODO-nodeId',
        referenceImageFieldName: 'image',
      }),
    ).toBe(false);
  });
});
