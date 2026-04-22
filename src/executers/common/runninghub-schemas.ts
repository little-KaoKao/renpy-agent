// RunningHub AI-App schema registry —— v0.3a/b 占位版。
//
// 目的:把 PLAN.md §3.5 的 6 个 API 绑到 RunningHub 后端的 webappId + 节点布局。
// 现在每一项里的 webappId / promptNodeId / promptFieldName / referenceImageNodeId /
// referenceImageFieldName 都是 TODO 占位(`'TODO-…'`),**真实 pipeline 跑通前必须登录
// RunningHub 控制台 → 打开对应 AI-App → "API 调用"面板,把真值填进来**。
//
// 命名约定(仓内上层代码都用这些常量,不再到处写裸字符串):
//   - `CHARACTER_MAIN_IMAGE`      —— 角色立绘主图(悠船文生图-v7)
//   - `CHARACTER_EXPRESSION`      —— 表情差分(style 兜底用 全能图片V2)
//   - `CHARACTER_DYNAMIC_SPRITE`  —— 动态立绘(seedance2.0/多模态视频)
//   - `SCENE_BACKGROUND`          —— 背景/道具静态图(seedream-v5-lite)
//   - `CUTSCENE_IMAGE_TO_VIDEO`   —— 过场 CG(Vidu-图生视频-q3-pro)
//   - `CUTSCENE_REFERENCE_VIDEO`  —— 关键剧情 CG(Vidu-参考生视频-q3)

import type { AiAppSchema } from './runninghub-client.js';

export type RunningHubAppKey =
  | 'CHARACTER_MAIN_IMAGE'
  | 'CHARACTER_EXPRESSION'
  | 'CHARACTER_DYNAMIC_SPRITE'
  | 'SCENE_BACKGROUND'
  | 'CUTSCENE_IMAGE_TO_VIDEO'
  | 'CUTSCENE_REFERENCE_VIDEO';

/** AI-App 身份标注。`apiId` 对齐 PLAN.md §3.5 的 "api-xxxxx" 列。 */
export interface RunningHubAppIdentity {
  readonly apiId: string;
  readonly displayName: string;
}

export const RUNNINGHUB_APP_IDENTITIES: Readonly<Record<RunningHubAppKey, RunningHubAppIdentity>> = {
  CHARACTER_MAIN_IMAGE: { apiId: 'api-425766740', displayName: '悠船文生图-v7(角色立绘主图)' },
  CHARACTER_EXPRESSION: { apiId: 'api-425766745', displayName: '全能图片V2-文生图(表情差分 / 风格兜底)' },
  CHARACTER_DYNAMIC_SPRITE: { apiId: 'api-438555139', displayName: 'seedance2.0/多模态视频(动态立绘)' },
  SCENE_BACKGROUND: { apiId: 'api-425766751', displayName: 'seedream-v5-lite-文生图(背景/道具)' },
  CUTSCENE_IMAGE_TO_VIDEO: { apiId: 'api-425766645', displayName: 'Vidu-图生视频-q3-pro(过场 CG)' },
  CUTSCENE_REFERENCE_VIDEO: { apiId: 'api-437377723', displayName: 'Vidu-参考生视频-q3(关键剧情 CG)' },
};

/**
 * 默认 schema 表:所有字段都是占位。真正跑图前必须改成控制台里的真值。
 * 留着 `TODO-` 前缀是为了让任何真调用第一时间在 submitTask 里炸掉,而不是静默发一个走不通的请求。
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
  [RUNNINGHUB_APP_IDENTITIES.CHARACTER_DYNAMIC_SPRITE.apiId]: {
    webappId: 'TODO-CHARACTER_DYNAMIC_SPRITE-webappId',
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
  [RUNNINGHUB_APP_IDENTITIES.CUTSCENE_REFERENCE_VIDEO.apiId]: {
    webappId: 'TODO-CUTSCENE_REFERENCE_VIDEO-webappId',
    promptNodeId: 'TODO-nodeId',
    promptFieldName: 'TODO-fieldName',
    referenceImageNodeId: 'TODO-nodeId',
    referenceImageFieldName: 'TODO-fieldName',
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
