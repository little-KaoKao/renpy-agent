import { describe, expect, it } from 'vitest';
import {
  RUNNINGHUB_APP_IDENTITIES,
  RUNNINGHUB_APP_SCHEMAS,
  getAppWebappId,
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
        'VOICE_LINE',
        'SFX',
        'BGM_TRACK',
      ].sort(),
    );
  });

  it('binds CHARACTER_MAIN_IMAGE to the real Midjourney v7 webappId', () => {
    expect(getAppWebappId('CHARACTER_MAIN_IMAGE')).toBe('1941094122503749633');
  });

  it('binds voice line and bgm to their real webappIds', () => {
    expect(getAppWebappId('VOICE_LINE')).toBe('2014603342701404161');
    expect(getAppWebappId('BGM_TRACK')).toBe('1972977443998928898');
  });

  it('every app has a schema entry, and every schema has at least one field', () => {
    for (const key of Object.keys(RUNNINGHUB_APP_IDENTITIES)) {
      const schema = RUNNINGHUB_APP_SCHEMAS[key as keyof typeof RUNNINGHUB_APP_SCHEMAS];
      expect(schema).toBeDefined();
      expect(schema!.fields.length).toBeGreaterThan(0);
    }
  });

  it('schema webappId matches identity webappId', () => {
    for (const key of Object.keys(RUNNINGHUB_APP_IDENTITIES) as Array<
      keyof typeof RUNNINGHUB_APP_IDENTITIES
    >) {
      expect(RUNNINGHUB_APP_SCHEMAS[key].webappId).toBe(
        RUNNINGHUB_APP_IDENTITIES[key].webappId,
      );
    }
  });

  it('Nanobanana2 character-expression and scene-background share one webappId', () => {
    expect(getAppWebappId('CHARACTER_EXPRESSION')).toBe(getAppWebappId('SCENE_BACKGROUND'));
  });

  it('Seedance2.0 dynamic-sprite and cutscene-image-to-video share one webappId', () => {
    expect(getAppWebappId('CHARACTER_DYNAMIC_SPRITE')).toBe(
      getAppWebappId('CUTSCENE_IMAGE_TO_VIDEO'),
    );
  });

  it('Qwen3 TTS voice-line and sfx share one webappId', () => {
    expect(getAppWebappId('VOICE_LINE')).toBe(getAppWebappId('SFX'));
  });

  it('isSchemaConfigured accepts all real registered schemas', () => {
    for (const schema of Object.values(RUNNINGHUB_APP_SCHEMAS)) {
      expect(isSchemaConfigured(schema)).toBe(true);
    }
  });

  it('isSchemaConfigured rejects TODO-prefixed webappId', () => {
    expect(
      isSchemaConfigured({
        webappId: 'TODO-xxx',
        displayName: 'x',
        fields: [{ nodeId: '1', fieldName: 'text', role: 'prompt' }],
      }),
    ).toBe(false);
  });

  it('isSchemaConfigured rejects non-numeric webappId', () => {
    expect(
      isSchemaConfigured({
        webappId: 'api-12345',
        displayName: 'x',
        fields: [{ nodeId: '1', fieldName: 'text', role: 'prompt' }],
      }),
    ).toBe(false);
  });

  it('isSchemaConfigured rejects TODO in field ids', () => {
    expect(
      isSchemaConfigured({
        webappId: '1234567890123456789',
        displayName: 'x',
        fields: [{ nodeId: 'TODO-nodeId', fieldName: 'text', role: 'prompt' }],
      }),
    ).toBe(false);
  });
});
