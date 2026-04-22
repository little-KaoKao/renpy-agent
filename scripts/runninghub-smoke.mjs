// RunningHub 握手 smoke test(v0.1 收尾用)
//
// 目的:验证 .env 里的 RUNNINGHUB_API_KEY 能打通 RunningHub,拿到任务 ID 并查一次状态。
// 不在乎产出图片质量 —— 握手成功即可。
//
// 用法(fnm 的 Node 已在 PATH):
//   node --env-file=.env scripts/runninghub-smoke.mjs
//
// 响应语义(2026-04-22 实测):
//   code=0   + data.taskId 存在        → 握手 OK
//   code=1   + "webapp not exists"     → apiKey 通过,webappId 找不到(需去控制台核对真实 ID)
//   code=301 + "user not exist"        → apiKey 无效
//   网络错误 / DNS 错                   → 国内网络问题

const BASE = 'https://www.runninghub.cn';
// 悠船文生图-v7 的 apiId 是 "api-425766740";RunningHub AI-App API 用 webappId = 去掉前缀
// 若服务端返回 "webapp not found",需要登录控制台确认这个 AI-App 在 OpenAPI 下的真实 ID
const WEBAPP_ID = '425766740';
const PROMPT_NODE_ID = '6';    // TODO: 登录 RunningHub 打开该 AI-App "API 调用"面板确认
const PROMPT_FIELD = 'text';   // TODO: 同上

const apiKey = process.env.RUNNINGHUB_API_KEY;
if (!apiKey) {
  console.error('❌ RUNNINGHUB_API_KEY 未设置,检查 .env');
  process.exit(1);
}

async function postJson(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

console.log('[1/2] 提交任务 →', BASE + '/task/openapi/ai-app/run');
const submit = await postJson('/task/openapi/ai-app/run', {
  apiKey,
  webappId: WEBAPP_ID,
  nodeInfoList: [
    { nodeId: PROMPT_NODE_ID, fieldName: PROMPT_FIELD, fieldValue: 'a calico cat sitting on a moon, anime style' },
  ],
});
console.log('HTTP', submit.httpStatus);
console.log(JSON.stringify(submit.json ?? submit.raw, null, 2));

const taskId = submit.json?.data?.taskId;
if (!taskId) {
  console.log('\n⚠️  未拿到 taskId — 握手失败。根据上面的 msg 判断是 key / schema / nodeId 哪个出错。');
  process.exit(0);
}

console.log('\n[2/2] 查任务状态 →', BASE + '/task/openapi/status');
const status = await postJson('/task/openapi/status', { apiKey, taskId });
console.log('HTTP', status.httpStatus);
console.log(JSON.stringify(status.json ?? status.raw, null, 2));

console.log('\n✅ 握手 OK — HTTP 通路、认证、任务创建都通。');
console.log('   taskId:', taskId);
console.log('   (轮询到 SUCCESS 后可用 /task/openapi/outputs 取 fileUrl,smoke test 不等)');
