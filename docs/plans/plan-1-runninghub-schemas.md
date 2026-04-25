# Plan 1 — RunningHub 模型绑定真值化 + 客户端协议修正 + BGM 接入

> Scope:把 `runninghub-schemas.ts` 的所有 `TODO-` 占位换成真值,并按 RunningHub 官方 `/openapi/v2/run/ai-app/{webappId}` 协议修正 HTTP 客户端;把 BGM 从"另封 suno client"改为"同一个 RunningHub 客户端 + SunoV5 AI-App"。
>
> 不涉及 v0.5 四位新 POC(音乐/配音/音效/UI)的 `generate-*` executer 实装 —— 那是 Plan 2。

## 0. 决策摘要(来自本轮对话)

| Key | 模型 | webappId(19位) | 备注 |
| --- | --- | --- | --- |
| `CHARACTER_MAIN_IMAGE` | 悠船 Midjourney v7 文生图 | `1941094122503749633` | 纯文本 prompt,有宽高比/模型下拉 |
| `CHARACTER_EXPRESSION` | Nanobanana2 图生图(全能图片2.0) | `2027211316242423809` | 吃 1~3 张参考图 + 文本;文生图时省略 image node |
| `CHARACTER_DYNAMIC_SPRITE` | Seedance2.0 图生视频 | `2037048798156951553` | 首帧+尾帧(尾帧可选)+ 时长/比例/分辨率 |
| `SCENE_BACKGROUND` | Nanobanana2 文生图 | `2027211316242423809` | 复用上面 webappId,不传 image 走文生图 |
| `CUTSCENE_IMAGE_TO_VIDEO` | Seedance2.0 图生视频 | `2037048798156951553` | 复用同 webappId |
| `CUTSCENE_REFERENCE_VIDEO` | **删除**(用户澄清:只用图参考,不用视频参考) | — | 把"带角色+场景参考"统一改走 Nanobanana2(多图)产首帧 → 再喂 Seedance2.0 图生视频 |
| `VOICE_LINE` | Qwen3 TTS 声音设计 | `2014603342701404161` | 音色 prompt + 台词 prompt,双 text node |
| `SFX` | Qwen3 TTS(暂复用) | `2014603342701404161` | 暂把"音效描述"塞台词 node;后续换独立 TTA |
| `BGM_TRACK`(新增) | SunoV5 | `1972977443998928898` | title / Prompt(风格描述)/ version 下拉 |

关键认知差:之前 schema 里登记的 `apiId` 是 `api-4481832xx` 这种"展示 ID",与 RunningHub OpenAPI 实际路径无关;官方 `curl` 打的是 `/openapi/v2/run/ai-app/{19位数字}`,这个 19 位数字就是 schema 里真正要存的 `webappId`。

## 1. 影响范围

| 文件 | 改动性质 |
| --- | --- |
| `src/executers/common/runninghub-schemas.ts` | 重写(类型、身份表、PLACEHOLDER 全改;新增 `BGM_TRACK`;删 `CUTSCENE_REFERENCE_VIDEO`) |
| `src/executers/common/runninghub-client.ts` | 中改:请求路径 `/task/openapi/ai-app/run` → `/openapi/v2/run/ai-app/{webappId}`;鉴权从 `body.apiKey` → `Authorization: Bearer`;`AiAppSchema` 与 `nodeInfoList` 升级为多 node + 支持 `fieldData` |
| `src/executers/common/runninghub-client.test.ts` | 跟改断言 |
| `src/executers/common/runninghub-schemas.test.ts` | 跟改(验证真值存在 + `isSchemaConfigured` 语义) |
| `src/executers/common/run-image-task.ts` | 小改:`RunningHubSubmitParams` 从"单 prompt + 单 referenceImage"升到"通用 `nodeInputs` 数组";上层 executer 构造 nodeInputs |
| `src/executers/character-designer/generate-main-image.ts` | 跟改 submit 参数 |
| `src/executers/scene-designer/generate-background.ts` | 跟改 |
| `src/executers/storyboarder/generate-cutscene.ts` | 跟改 |
| `src/schema/galgame-workspace.ts` | 确认 `BgmTrack` 文档已存在(v0.5 已加);`assetType` 联合扩 `bgm_track`(若未加) |
| `PLAN.md §3.5` | 同步表格:删 `CUTSCENE_REFERENCE_VIDEO` 行、改列头 "api-xxx" 为 "webappId",加 BGM 走 RunningHub |

## 2. 协议修正细节(客户端层)

### 2.1 新 `AiAppSchema`

一个 AI-App 的 node 布局**不是"一个 prompt node + 一个 reference image node"这么简单**,比如 MJ 有"模型选择"、"宽高比"两个下拉,Seedance 有"时长/比例/分辨率"三个下拉 + "首帧/尾帧"两个 image node + prompt。Schema 必须能描述**任意 nodeId × fieldName**。

```ts
// 新 AiAppSchema
export interface AiAppNodeFieldSchema {
  readonly nodeId: string;
  readonly fieldName: string;
  /** 有下拉时,RunningHub 要求把合法枚举以 fieldData 字符串传回(见官方 curl)。 */
  readonly fieldData?: string;
  /** 默认值;caller 不覆盖时用。 */
  readonly defaultValue?: string;
  /** 人类可读用途标签,方便 log。 */
  readonly role:
    | 'prompt'
    | 'negative_prompt'
    | 'reference_image_1' | 'reference_image_2' | 'reference_image_3'
    | 'first_frame' | 'last_frame' | 'reference_video'
    | 'voice_text' | 'line_text'
    | 'aspect' | 'resolution' | 'duration' | 'ratio' | 'model_select'
    | 'title' | 'style' | 'version'
    | 'option';
}

export interface AiAppSchema {
  readonly webappId: string;           // 19 位数字
  readonly displayName: string;
  readonly fields: ReadonlyArray<AiAppNodeFieldSchema>;
}
```

### 2.2 新 `submitTask` 参数

```ts
export interface AiAppNodeInput {
  readonly role: AiAppNodeFieldSchema['role'];
  readonly value: string;
}

export interface RunningHubSubmitParams {
  readonly appKey: RunningHubAppKey;   // 语义 key,不再裸 webappId
  readonly inputs: ReadonlyArray<AiAppNodeInput>;
  readonly instanceType?: 'default' | 'plus';
  readonly usePersonalQueue?: boolean;
}
```

客户端内部做 role → (nodeId, fieldName, fieldData) 的解析;schema 里没登记的 role 直接报错(早炸优于静默降级)。

### 2.3 HTTP 调用更正

```diff
- POST /task/openapi/ai-app/run
- Content-Type: application/json
- body: { apiKey, webappId, nodeInfoList }
+ POST /openapi/v2/run/ai-app/{webappId}
+ Content-Type: application/json
+ Authorization: Bearer ${RUNNINGHUB_API_KEY}
+ body: { nodeInfoList, instanceType: "default", usePersonalQueue: "false" }
```

`pollTask` / outputs 端点暂按现有 `/task/openapi/status` 和 `/task/openapi/outputs` 保持,直到验证或找到新路径;如错误码提示路径不对再改(挂一个 TODO 注释带错误码文档链接)。

## 3. Schemas 真值清单

以下每条都来自你发的官方 curl,原样对齐。

### 3.1 `CHARACTER_MAIN_IMAGE`(Midjourney v7 / `1941094122503749633`)

| role | nodeId | fieldName | fieldData(下拉) / 默认 |
| --- | --- | --- | --- |
| `model_select` | 4 | `model_selected` | 选项见 curl,默认 `Midjourney V7` |
| `aspect` | 4 | `aspect_rate` | 选项见 curl,默认 `auto`,角色立绘建议 `3:4` |
| `option` | 1 | `select` | 固定 `"1"`(切到"文本输入") |
| `prompt` | 6 | `text` | caller 塞角色 visual description |

### 3.2 `CHARACTER_EXPRESSION` & `SCENE_BACKGROUND`(Nanobanana2 / `2027211316242423809`)

共用 webappId,**差异在 inputs**:Scene 不传 image node(文生图),Character Expression 至少传 1 张参考(图生图)。

| role | nodeId | fieldName | fieldData/默认 |
| --- | --- | --- | --- |
| `reference_image_1` | 2 | `image` | 可选 |
| `reference_image_2` | 3 | `image` | 可选 |
| `reference_image_3` | 4 | `image` | 可选(表情差分常用 "主图+情绪参考") |
| `aspect` | 1 | `aspectRatio` | 选项见 curl,角色 `3:4`、场景 `16:9` |
| `resolution` | 1 | `resolution` | `1k/2k/4k`,默认 `2k` |
| `option` | 1 | `channel` | `Third-party` / `Official`,默认 `Third-party` |
| `prompt` | 9 | `text` | caller 塞描述 |

**注意**:nodeId=1 上有多个 fieldName(aspectRatio / resolution / channel)—— schema 必须支持"同 nodeId 多 field",所以 `fields` 数组用 `(nodeId, fieldName)` 联合作 key。

### 3.3 `CHARACTER_DYNAMIC_SPRITE` & `CUTSCENE_IMAGE_TO_VIDEO`(Seedance2.0 图生视频 / `2037048798156951553`)

| role | nodeId | fieldName | fieldData/默认 |
| --- | --- | --- | --- |
| `first_frame` | 2 | `image` | 必填 |
| `last_frame` | 3 | `image` | 可选(仅 `CUTSCENE_IMAGE_TO_VIDEO` 用) |
| `option` | 1 | `real_person_mode` | `"true"` / `"false"`(galgame 二次元常 `false`,真人 `true`) |
| `duration` | 1 | `duration` | `4..15`,默认 `5` |
| `ratio` | 1 | `ratio` | 选项见 curl,默认 `16:9` |
| `resolution` | 1 | `resolution` | `480p..4k`,默认 `720p` |
| `prompt` | 1 | `prompt` | caller 塞镜头运镜描述 |

### 3.4 `VOICE_LINE` & `SFX`(Qwen3 TTS / `2014603342701404161`)

| role | nodeId | fieldName | 说明 |
| --- | --- | --- | --- |
| `option` | 7 | `select` | 固定 `"1"`(音色走手写) |
| `voice_text` | 2 | `text` | Character.voiceTag 里的音色描述 |
| `option` | 6 | `select` | 固定 `"1"`(台词走手写) |
| `line_text` | 1 | `text` | Script 单句对白 |

**SFX 暂复用策略**:把"环境音描述"塞进 `line_text`,音色塞"环境音朗读者"—— 音质会很差,先占位让 pipeline 通;后续换独立 TTA 模型。

### 3.5 `BGM_TRACK`(SunoV5 / `1972977443998928898`,新增)

| role | nodeId | fieldName | fieldData/默认 |
| --- | --- | --- | --- |
| `title` | 13 | `text` | 歌曲标题,可空 |
| `prompt` | 14 | `text` | 风格/主题/语言/情绪 |
| `version` | 1 | `version` | 选项 `v3.0..v5`,默认 `v4.5` |

## 4. 执行步骤

1. **改 `runninghub-client.ts`**:升级 `AiAppSchema` 为 `fields[]`;换 HTTP 路径 / 鉴权;`submitTask` 改吃 `appKey + inputs[]`,内部按 schema `fields` 拼 `nodeInfoList`(含 `fieldData` 字段);更新所有测试。
2. **改 `runninghub-schemas.ts`**:删旧 `RUNNINGHUB_APP_IDENTITIES` 的 `apiId` 字段,换成 `webappId` 为真值;按 §3.1-3.5 写出 8 个 `AiAppSchema`(`CHARACTER_MAIN_IMAGE` / `CHARACTER_EXPRESSION` / `CHARACTER_DYNAMIC_SPRITE` / `SCENE_BACKGROUND` / `CUTSCENE_IMAGE_TO_VIDEO` / `VOICE_LINE` / `SFX` / `BGM_TRACK`);删掉 `CUTSCENE_REFERENCE_VIDEO`(类型联合也删)。`isSchemaConfigured` 改为"所有 `fields` 的 `nodeId`/`fieldName` 非 `TODO-*`";新配置全是真值,测试应当全绿。
3. **改 `run-image-task.ts`**:`RunningHubSubmitParams` 跟客户端新接口走,onProgress / timeout / error 保持。
4. **改三个已有 executer**(`character-designer/generate-main-image.ts`、`scene-designer/generate-background.ts`、`storyboarder/generate-cutscene.ts`):按新 inputs[] 接口重新组参;把以前裸 prompt 的地方拆成 `(role, value)` 数组。
5. **跑测试**:`pnpm vitest run`。重点看 `runninghub-client.test.ts` 和 `runninghub-schemas.test.ts`。
6. **smoke(可选,需要真 key)**:跑 `scripts/runninghub-smoke.mjs`(若已有),或写一个最小脚本:submit 一次 MJ v7 文生图 → poll → 拿到 URL。**只在本地跑,别 commit key。**
7. **更新 `PLAN.md §3.5`**:把表格 `api-xxxxxxxxx` 列换成 `webappId` 列;删 `CUTSCENE_REFERENCE_VIDEO` 行;加 `BGM_TRACK` 到 RunningHub 行(去掉"另封 suno client"那段)。
8. **提交 commit**:`feat(v0.5+): bind real RunningHub webappIds + migrate to /openapi/v2 + add BGM via SunoV5`。

## 5. 验收点

- [ ] `pnpm build` 通过
- [ ] `pnpm vitest run` 全绿,且 `runninghub-schemas.test.ts` 包含对真值的断言(至少一个用例检查 `CHARACTER_MAIN_IMAGE.webappId === '1941094122503749633'`)
- [ ] `isSchemaConfigured` 对所有 8 个 schema 返回 `true`
- [ ] `runninghub-client.test.ts` 的 HTTP mock 期望 `/openapi/v2/run/ai-app/{webappId}` 路径 + `Authorization: Bearer` header(不再在 body 里带 apiKey)
- [ ] `PLAN.md §3.5` 表格与代码一致(webappId 列,无 CUTSCENE_REFERENCE_VIDEO,BGM 走 RunningHub)

## 6. 风险 / 已知坑

- `pollTask` / outputs 的路径**可能也改到 v2**(官方文档还没确认),如果 smoke 失败看错误码,再参考[错误码说明](https://www.runninghub.cn/runninghub-api-doc-cn/doc-8435517.md)补一次。
- `real_person_mode` 默认值:galgame 二次元建议 `false`,但 Seedance 默认 `true`;先跟官方 default,让 caller 显式传。
- SFX 暂借 Qwen3 TTS 是临时方案,要在代码里加 `// TODO: swap to dedicated TTA when available`,别忘。
- Nanobanana2 同一 nodeId=1 上挂多 fieldName,客户端组 `nodeInfoList` 时**每条 field 单独一项**(而不是 merge),与官方 curl 一致。
