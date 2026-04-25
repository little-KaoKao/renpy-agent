// RunningHub AI-App schema registry —— v0.5+ 真值版。
//
// 每条 schema 绑定一个 RunningHub AI-App:19 位数字 `webappId` + 该 AI-App 所有
// (nodeId × fieldName) 的 role/default/枚举。值全部来自 RunningHub 控制台
// 「API 调用」面板的官方 curl。上层 executer 只关心 role(例如 `prompt` /
// `first_frame`),客户端按 schema 把 role 映射到具体 nodeId/fieldName。
//
// 命名约定:
//   - `CHARACTER_MAIN_IMAGE`     —— 角色立绘主图(悠船 Midjourney v7 文生图)
//   - `CHARACTER_EXPRESSION`     —— 表情差分(Nanobanana2 图生图)
//   - `CHARACTER_DYNAMIC_SPRITE` —— 动态立绘(Seedance2.0 图生视频)
//   - `SCENE_BACKGROUND`         —— 背景/道具静态图(Nanobanana2 文生图,复用表情
//                                    差分 webappId,只是 inputs 不带 image node)
//   - `CUTSCENE_IMAGE_TO_VIDEO`  —— 过场 / 剧情 CG(Seedance2.0 图生视频,复用
//                                    动态立绘 webappId)
//   - `VOICE_LINE`               —— 对白配音(Qwen3 TTS 声音设计)
//   - `SFX`                      —— 环境音效(暂复用 Qwen3 TTS,质量差,后续换独立 TTA)
//   - `BGM_TRACK`                —— BGM 配乐(SunoV5,也走 RunningHub,不单封 suno client)
//
// 旧版本里的 `CUTSCENE_REFERENCE_VIDEO`(Seedance2.0 多模态视频)已删除 ——
// 实际场景里我们只用图参考(多角色参考图走 Nanobanana2 产首帧 → 再喂 Seedance 图生视频),
// 不直接用视频参考。

import type { AiAppSchema } from './runninghub-client.js';

export type RunningHubAppKey =
  | 'CHARACTER_MAIN_IMAGE'
  | 'CHARACTER_EXPRESSION'
  | 'CHARACTER_DYNAMIC_SPRITE'
  | 'SCENE_BACKGROUND'
  | 'CUTSCENE_IMAGE_TO_VIDEO'
  | 'VOICE_LINE'
  | 'SFX'
  | 'BGM_TRACK';

/** AI-App 身份标注。`webappId` 是 RunningHub OpenAPI 路径里的 19 位数字。 */
export interface RunningHubAppIdentity {
  readonly webappId: string;
  readonly displayName: string;
}

/** 8 个语义 key → 身份信息。同一 webappId 可被多个 key 共用(见下)。 */
export const RUNNINGHUB_APP_IDENTITIES: Readonly<Record<RunningHubAppKey, RunningHubAppIdentity>> = {
  CHARACTER_MAIN_IMAGE: {
    webappId: '1941094122503749633',
    displayName: '悠船 Midjourney v7 文生图(角色立绘主图)',
  },
  CHARACTER_EXPRESSION: {
    webappId: '2027211316242423809',
    displayName: 'Nanobanana2 全能图片 2.0(表情差分 · 图生图)',
  },
  CHARACTER_DYNAMIC_SPRITE: {
    webappId: '2037048798156951553',
    displayName: 'Seedance2.0 图生视频(动态立绘)',
  },
  SCENE_BACKGROUND: {
    webappId: '2027211316242423809',
    displayName: 'Nanobanana2 全能图片 2.0(背景/道具 · 文生图,复用 Character Expression webappId)',
  },
  CUTSCENE_IMAGE_TO_VIDEO: {
    webappId: '2037048798156951553',
    displayName: 'Seedance2.0 图生视频(过场 / 关键剧情 CG,复用 Dynamic Sprite webappId)',
  },
  VOICE_LINE: {
    webappId: '2014603342701404161',
    displayName: 'Qwen3 TTS 声音设计(对白配音)',
  },
  SFX: {
    webappId: '2014603342701404161',
    displayName: 'Qwen3 TTS 声音设计(环境音效,暂复用 Voice Line webappId)',
  },
  BGM_TRACK: {
    webappId: '1972977443998928898',
    displayName: 'SunoV5(BGM / 主题 / 章节 / 路线)',
  },
};

/**
 * 8 个语义 key → 真实 schema。所有值对齐 RunningHub 控制台「API 调用」面板的官方 curl。
 *
 * 节点布局里:
 *   - `role` 是客户端对 caller 暴露的语义 key,上层按 role 提供 inputs。
 *   - `defaultValue` 是 caller 不传时客户端自动填的值。
 *   - `optional: true` 表示 caller 不传也合法(例如 reference_image_2 / last_frame)。
 *   - `fieldData` 是下拉枚举的合法值 JSON 字符串(目前大部分留空 —— smoke test
 *     跑通后如果 RunningHub 报「fieldData is required」再把枚举 JSON 贴进来)。
 *
 * 注意:同一 webappId 被多个 key 共用时,schema 条目**按 key 各存一份**(而不是按
 * webappId 去重),因为 Scene Background 和 Character Expression 的 inputs 期望不同
 * (Scene 不传 image node,Character 要传),schema 本身一样但调用语义分离。
 */
export const RUNNINGHUB_APP_SCHEMAS: Readonly<Record<RunningHubAppKey, AiAppSchema>> = {
  // §3.1 Midjourney v7 —— 4 个 node/field。nodeId=1.select 固定 "1"(切到"文本输入")。
  CHARACTER_MAIN_IMAGE: {
    webappId: RUNNINGHUB_APP_IDENTITIES.CHARACTER_MAIN_IMAGE.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.CHARACTER_MAIN_IMAGE.displayName,
    fields: [
      { nodeId: '4', fieldName: 'model_selected', role: 'model_select', defaultValue: 'Midjourney V7' },
      { nodeId: '4', fieldName: 'aspect_rate', role: 'aspect', defaultValue: '3:4' },
      { nodeId: '1', fieldName: 'select', role: 'option', defaultValue: '1' },
      { nodeId: '6', fieldName: 'text', role: 'prompt' },
    ],
  },

  // §3.2 Nanobanana2 图生图(表情差分):吃 1~3 张参考图。
  CHARACTER_EXPRESSION: {
    webappId: RUNNINGHUB_APP_IDENTITIES.CHARACTER_EXPRESSION.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.CHARACTER_EXPRESSION.displayName,
    fields: [
      { nodeId: '2', fieldName: 'image', role: 'reference_image_1' },
      { nodeId: '3', fieldName: 'image', role: 'reference_image_2', optional: true },
      { nodeId: '4', fieldName: 'image', role: 'reference_image_3', optional: true },
      { nodeId: '1', fieldName: 'aspectRatio', role: 'aspect', defaultValue: '3:4' },
      { nodeId: '1', fieldName: 'resolution', role: 'resolution', defaultValue: '2k' },
      { nodeId: '1', fieldName: 'channel', role: 'option', defaultValue: 'Third-party' },
      { nodeId: '9', fieldName: 'text', role: 'prompt' },
    ],
  },

  // §3.2 Nanobanana2 文生图(背景):复用 webappId,只是 caller 不传 image node。
  SCENE_BACKGROUND: {
    webappId: RUNNINGHUB_APP_IDENTITIES.SCENE_BACKGROUND.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.SCENE_BACKGROUND.displayName,
    fields: [
      { nodeId: '2', fieldName: 'image', role: 'reference_image_1', optional: true },
      { nodeId: '3', fieldName: 'image', role: 'reference_image_2', optional: true },
      { nodeId: '4', fieldName: 'image', role: 'reference_image_3', optional: true },
      { nodeId: '1', fieldName: 'aspectRatio', role: 'aspect', defaultValue: '16:9' },
      { nodeId: '1', fieldName: 'resolution', role: 'resolution', defaultValue: '2k' },
      { nodeId: '1', fieldName: 'channel', role: 'option', defaultValue: 'Third-party' },
      { nodeId: '9', fieldName: 'text', role: 'prompt' },
    ],
  },

  // §3.3 Seedance2.0 图生视频(动态立绘):只有首帧。
  CHARACTER_DYNAMIC_SPRITE: {
    webappId: RUNNINGHUB_APP_IDENTITIES.CHARACTER_DYNAMIC_SPRITE.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.CHARACTER_DYNAMIC_SPRITE.displayName,
    fields: [
      { nodeId: '2', fieldName: 'image', role: 'first_frame' },
      { nodeId: '3', fieldName: 'image', role: 'last_frame', optional: true },
      { nodeId: '1', fieldName: 'real_person_mode', role: 'option', defaultValue: 'false' },
      { nodeId: '1', fieldName: 'duration', role: 'duration', defaultValue: '5' },
      { nodeId: '1', fieldName: 'ratio', role: 'ratio', defaultValue: '9:16' },
      { nodeId: '1', fieldName: 'resolution', role: 'resolution', defaultValue: '720p' },
      { nodeId: '1', fieldName: 'prompt', role: 'prompt' },
    ],
  },

  // §3.3 Seedance2.0 图生视频(过场 CG):支持可选尾帧。
  CUTSCENE_IMAGE_TO_VIDEO: {
    webappId: RUNNINGHUB_APP_IDENTITIES.CUTSCENE_IMAGE_TO_VIDEO.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.CUTSCENE_IMAGE_TO_VIDEO.displayName,
    fields: [
      { nodeId: '2', fieldName: 'image', role: 'first_frame' },
      { nodeId: '3', fieldName: 'image', role: 'last_frame', optional: true },
      { nodeId: '1', fieldName: 'real_person_mode', role: 'option', defaultValue: 'false' },
      { nodeId: '1', fieldName: 'duration', role: 'duration', defaultValue: '5' },
      { nodeId: '1', fieldName: 'ratio', role: 'ratio', defaultValue: '16:9' },
      { nodeId: '1', fieldName: 'resolution', role: 'resolution', defaultValue: '720p' },
      { nodeId: '1', fieldName: 'prompt', role: 'prompt' },
    ],
  },

  // §3.4 Qwen3 TTS(对白配音):两条 select 都固定 "1"(手写 prompt 模式)。
  VOICE_LINE: {
    webappId: RUNNINGHUB_APP_IDENTITIES.VOICE_LINE.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.VOICE_LINE.displayName,
    fields: [
      { nodeId: '7', fieldName: 'select', role: 'option', defaultValue: '1' },
      { nodeId: '2', fieldName: 'text', role: 'voice_text' },
      { nodeId: '6', fieldName: 'select', role: 'option', defaultValue: '1' },
      { nodeId: '1', fieldName: 'text', role: 'line_text' },
    ],
  },

  // §3.4 SFX 暂借 Qwen3 TTS:音效描述塞 line_text,「朗读者」塞 voice_text。
  // TODO: swap to dedicated TTA (text-to-audio) when available.
  SFX: {
    webappId: RUNNINGHUB_APP_IDENTITIES.SFX.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.SFX.displayName,
    fields: [
      { nodeId: '7', fieldName: 'select', role: 'option', defaultValue: '1' },
      { nodeId: '2', fieldName: 'text', role: 'voice_text' },
      { nodeId: '6', fieldName: 'select', role: 'option', defaultValue: '1' },
      { nodeId: '1', fieldName: 'text', role: 'line_text' },
    ],
  },

  // §3.5 SunoV5:title 可空,prompt 是风格/主题/语言/情绪,version 默认 v4.5。
  BGM_TRACK: {
    webappId: RUNNINGHUB_APP_IDENTITIES.BGM_TRACK.webappId,
    displayName: RUNNINGHUB_APP_IDENTITIES.BGM_TRACK.displayName,
    fields: [
      { nodeId: '13', fieldName: 'text', role: 'title', defaultValue: '' },
      { nodeId: '14', fieldName: 'text', role: 'prompt' },
      { nodeId: '1', fieldName: 'version', role: 'version', defaultValue: 'v4.5' },
    ],
  },
};

/** 取某 AppKey 对应的 webappId。方便调试 / 日志。 */
export function getAppWebappId(key: RunningHubAppKey): string {
  return RUNNINGHUB_APP_IDENTITIES[key].webappId;
}

/**
 * 校验 schema 是否"真的填了真值"。v0.5 之前所有字段带 `TODO-` 前缀用来早炸;
 * 这一版全部是真值,这个函数只剩对"别不小心又填了 TODO"的兜底。
 */
export function isSchemaConfigured(schema: AiAppSchema): boolean {
  if (!schema.webappId || schema.webappId.startsWith('TODO-')) return false;
  if (!/^\d{15,20}$/.test(schema.webappId)) return false;
  for (const field of schema.fields) {
    if (field.nodeId.startsWith('TODO-') || field.fieldName.startsWith('TODO-')) return false;
    if (field.defaultValue?.startsWith('TODO-')) return false;
  }
  return true;
}
