// RunningHub 握手 smoke test(v0.5+ /openapi/v2 版)
//
// 目的:验证 .env 里的 RUNNINGHUB_API_KEY 能打通 RunningHub 新协议,拿到任务 ID 并查一次状态。
// 不在乎产出图片质量 —— 握手成功即可。
//
// 用法(fnm 的 Node 已在 PATH):
//   node --env-file=.env scripts/runninghub-smoke.mjs
//
// 响应语义:
//   code=0   + data.taskId 存在        → 握手 OK
//   code=1   + "webapp not exists"     → apiKey 通过,webappId 找不到(去控制台核对)
//   code=301 + "user not exist"        → apiKey 无效
//   HTTP 401 / 403                     → Authorization header 格式或权限问题
//   网络错误 / DNS 错                   → 国内网络问题
//
// 协议变更(v0.5+,参考 src/executers/common/runninghub-client.ts):
//   POST /openapi/v2/run/ai-app/{webappId}
//   Headers: Authorization: Bearer <RUNNINGHUB_API_KEY>, Content-Type: application/json
//   Body:    { nodeInfoList, instanceType, usePersonalQueue }  (不再放 apiKey)
//
// 用 Midjourney v7 文生图(CHARACTER_MAIN_IMAGE)做握手 —— 最简单的 text-only AI-App,
// webappId / fields 对齐 src/executers/common/runninghub-schemas.ts 里的真值。

const BASE = 'https://www.runninghub.cn';

// Midjourney v7 文生图 —— CHARACTER_MAIN_IMAGE。
// 与 src/executers/common/runninghub-schemas.ts 的 RUNNINGHUB_APP_SCHEMAS.CHARACTER_MAIN_IMAGE 保持一致。
const WEBAPP_ID = '1941094122503749633';
const NODE_INFO_LIST = [
  { nodeId: '4', fieldName: 'model_selected', fieldValue: 'Midjourney V7' },
  { nodeId: '4', fieldName: 'aspect_rate', fieldValue: '3:4' },
  { nodeId: '1', fieldName: 'select', fieldValue: '1' },
  { nodeId: '6', fieldName: 'text', fieldValue: 'a calico cat sitting on a moon, anime style' },
];

const apiKey = process.env.RUNNINGHUB_API_KEY;
if (!apiKey) {
  console.error('❌ RUNNINGHUB_API_KEY 未设置,检查 .env');
  process.exit(1);
}

async function postJson(path, body, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { httpStatus: res.status, raw: text };
  }
  return { httpStatus: res.status, json };
}

const submitPath = `/openapi/v2/run/ai-app/${WEBAPP_ID}`;
console.log('[1/2] 提交任务 →', BASE + submitPath);
const submit = await postJson(
  submitPath,
  {
    nodeInfoList: NODE_INFO_LIST,
    instanceType: 'default',
    usePersonalQueue: 'false',
  },
  { Authorization: `Bearer ${apiKey}` },
);
console.log('HTTP', submit.httpStatus);
console.log(JSON.stringify(submit.json ?? submit.raw, null, 2));

const taskId = submit.json?.data?.taskId;
if (!taskId) {
  console.log('\n⚠️  未拿到 taskId — 握手失败。根据上面的 msg 判断:');
  console.log('    code=1 webapp not exists  → webappId 错,去控制台核对');
  console.log('    code=301 user not exist   → apiKey 无效');
  console.log('    HTTP 401/403              → Authorization header 格式错或权限问题');
  process.exit(0);
}

// 注:/task/openapi/status 和 /task/openapi/outputs 目前仍是旧路径(body.apiKey)。
console.log('\n[2/2] 查任务状态 →', BASE + '/task/openapi/status');
const status = await postJson('/task/openapi/status', { apiKey, taskId });
console.log('HTTP', status.httpStatus);
console.log(JSON.stringify(status.json ?? status.raw, null, 2));

console.log('\n✅ 握手 OK — HTTP 通路、Bearer 认证、任务创建都通。');
console.log('   taskId:', taskId);
console.log('   (轮询到 SUCCESS 后可用 /task/openapi/outputs 取 fileUrl,smoke test 不等)');
