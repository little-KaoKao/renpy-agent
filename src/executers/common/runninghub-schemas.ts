// RunningHub AI-App schema registry —— v0.5 刷新版。
//
// 目的:把 PLAN.md §3.5 的 AI-App 绑到 RunningHub 后端的 webappId + 节点布局。
// 这一版的 apiId 列是 RunningHub 2026 新一轮(api-448183xxx)替换原来的 api-42xxxx /
// api-43xxxx 清单(旧 ID 全作废)。每一项里的 webappId / promptNodeId /
// promptFieldName / referenceImageNodeId / referenceImageFieldName 仍是 `'TODO-…'`
// 占位 —— **真实 pipeline 跑通前必须登录 RunningHub 控制台 → 打开对应 AI-App →
// "API 调用"面板,把真值填进来**。
//
// 命名约定(仓内上层代码都用这些常量,不再到处写裸字符串):
//   - `CHARACTER_MAIN_IMAGE`     —— 角色立绘主图(悠船文生图-niji7)
//   - `CHARACTER_EXPRESSION`     —— 表情差分(全能图片V2-图生图,以主图为参考改差分)
//   - `CHARACTER_DYNAMIC_SPRITE` —— 动态立绘(seedance2.0/多模态视频,复用 reference-to-video)
//   - `SCENE_BACKGROUND`         —— 背景/道具静态图(全能图片V2-文生图)
//   - `CUTSCENE_IMAGE_TO_VIDEO`  —— 过场 CG(seedance2.0/图生视频)
//   - `CUTSCENE_REFERENCE_VIDEO` —— 关键剧情 CG(seedance2.0/多模态视频,需角色+场景参考图)
//   - `VOICE_LINE`               —— 对白配音(minimax/speech-2.8-hd,text-to-audio)
//   - `SFX`                      —— 环境音效(复用 minimax/speech-2.8-hd 或后续换独立 TTA)
//
// BGM(suno)暂不在这里登记 —— suno 不走 RunningHub OpenAPI,等接入文档到位后单独封。

import type { AiAppSchema } from './runninghub-client.js';

export type RunningHubAppKey =
  | 'CHARACTER_MAIN_IMAGE'
  | 'CHARACTER_EXPRESSION'
  | 'CHARACTER_DYNAMIC_SPRITE'
  | 'SCENE_BACKGROUND'
  | 'CUTSCENE_IMAGE_TO_VIDEO'
  | 'CUTSCENE_REFERENCE_VIDEO'
  | 'VOICE_LINE'
  | 'SFX';

/** AI-App 身份标注。`apiId` 对齐 PLAN.md §3.5 的 "api-xxxxx" 列。 */
export interface RunningHubAppIdentity {
  readonly apiId: string;
  readonly displayName: string;
}

export const RUNNINGHUB_APP_IDENTITIES: Readonly<Record<RunningHubAppKey, RunningHubAppIdentity>> = {
  CHARACTER_MAIN_IMAGE: { apiId: 'api-448183249', displayName: '悠船文生图-niji7(角色立绘主图)' },
  CHARACTER_EXPRESSION: {
    apiId: 'api-448183224',
    displayName: '全能图片V2-图生图-官方稳定版(表情差分:吃主图改情绪)',
  },
  CHARACTER_DYNAMIC_SPRITE: {
    apiId: 'api-448183127',
    displayName: 'seedance2.0/多模态视频(动态立绘,复用 reference-to-video)',
  },
  SCENE_BACKGROUND: {
    apiId: 'api-448183260',
    displayName: '全能图片V2-文生图-官方稳定版(背景/道具)',
  },
  CUTSCENE_IMAGE_TO_VIDEO: {
    apiId: 'api-448183116',
    displayName: 'seedance2.0/图生视频(过场 CG,首帧驱动)',
  },
  CUTSCENE_REFERENCE_VIDEO: {
    apiId: 'api-448183127',
    displayName: 'seedance2.0/多模态视频(关键剧情 CG,带角色/场景参考)',
  },
  VOICE_LINE: { apiId: 'api-448183268', displayName: 'minimax/speech-2.8-hd(对白配音)' },
  SFX: { apiId: 'api-448183268', displayName: 'minimax/speech-2.8-hd(环境音效;暂复用 TTS)' },
};

/**
 * 默认 schema 表:所有字段都是占位。真正跑图/视频/音频前必须改成控制台里的真值。
 * 留着 `TODO-` 前缀是为了让任何真调用第一时间在 submitTask 里炸掉,而不是静默发一个走不通的请求。
 *
 * 注意:`CHARACTER_DYNAMIC_SPRITE` 和 `CUTSCENE_REFERENCE_VIDEO` 共用同一个 apiId
 * (api-448183127 / seedance2.0 多模态视频),因此它们共享同一个 schema 条目;
 * 同样 `VOICE_LINE` 和 `SFX` 共用 api-448183268。上层通过 RunningHubAppKey 语义区分。
 */
export const PLACEHOLDER_APP_SCHEMAS: Readonly<Record<string, AiAppSchema>> = {
  [RUNNINGHUB_APP_IDENTITIES.CHARACTER_MAIN_IMAGE.apiId]: {
    webappId: 'TODO-CHARACTER_MAIN_IMAGE-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
  },
  [RUNNINGHUB_APP_IDENTITIES.CHARACTER_EXPRESSION.apiId]: {
    webappId: 'TODO-CHARACTER_EXPRESSION-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
    referenceImageNodeId: 'TODO-nodeId',
    referenceImageFieldName: 'TODO-fieldName',
  },
  [RUNNINGHUB_APP_IDENTITIES.SCENE_BACKGROUND.apiId]: {
    webappId: 'TODO-SCENE_BACKGROUND-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
  },
  [RUNNINGHUB_APP_IDENTITIES.CUTSCENE_IMAGE_TO_VIDEO.apiId]: {
    webappId: 'TODO-CUTSCENE_IMAGE_TO_VIDEO-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
    referenceImageNodeId: 'TODO-nodeId',
    referenceImageFieldName: 'TODO-fieldName',
  },
  // CHARACTER_DYNAMIC_SPRITE & CUTSCENE_REFERENCE_VIDEO 共用 api-448183127:
  [RUNNINGHUB_APP_IDENTITIES.CUTSCENE_REFERENCE_VIDEO.apiId]: {
    webappId: 'TODO-SEEDANCE_REFERENCE_VIDEO-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
    referenceImageNodeId: 'TODO-nodeId',
    referenceImageFieldName: 'TODO-fieldName',
  },
  // VOICE_LINE & SFX 共用 api-448183268:
  [RUNNINGHUB_APP_IDENTITIES.VOICE_LINE.apiId]: {
    webappId: 'TODO-VOICE_LINE-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
  },
};

/** 方便上层按枚举 key 拿 apiId。 */
export function getAppApiId(key: RunningHubAppKey): string {
  return RUNNINGHUB_APP_IDENTITIES[key].apiId;
}

/**
 * 校验 schema 是否"看起来真的填了"。用于在真跑之前做一次 assert。
 * 仍然是占位(任意字段含 "TODO-")返回 `false`。
 */
export function isSchemaConfigured(schema: AiAppSchema): boolean {
  const fields = [
    schema.webappId,
    schema.promptNodeId,
    schema.promptFieldName,
    schema.referenceImageNodeId,
    schema.referenceImageFieldName,
  ];
  return fields.every((v) => v === undefined || !v.startsWith('TODO-'));
}
