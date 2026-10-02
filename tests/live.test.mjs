/**
 * 真实网络端到端测试
 *
 * 与 parser.test.mjs 的区别：那个用本地 HTML 样本测「解析」，
 * 这个真的去请求志愿云站点，验证「抓取 + 编码识别 + 解析 + 去重」整条链路。
 *
 * 这里是最重要的验证：
 *   站点每次请求都会换 PHPSESSID，导致项目链接里的 id 完全不同。
 *   本测试通过「真的连抓两次」来确认不会误报新项目。
 *
 * 需要联网。若网络不可用会跳过。
 * 运行：npm run test:live
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchOrgSnapshot, findNewProjects, buildNotificationText } from '../src/core/parser.mjs';
import { normalizeOrgInput } from '../src/core/url.mjs';

const TEAM_URL = 'https://gz.zhiyuanyun.com/app/org/view.php?id=Vl6t7DSgAHI3O';

/** 先探一下网络是否可用 */
async function canReach() {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(TEAM_URL, { signal: ac.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

const online = await canReach();
const skip = online ? false : '网络不可用，跳过';

test('真实请求：能抓到团体页并解析出项目', { skip }, async () => {
  const snap = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });

  console.log(`   团体名: ${snap.orgName}`);
  console.log(`   团体编号: ${snap.orgId}`);
  console.log(`   项目数: ${snap.projects.length}`);
  if (snap.projects[0]) {
    console.log(`   最新项目: ${snap.projects[0].name} (${snap.projects[0].date})`);
  }

  assert.ok(snap.orgName.includes('都匀三中'), `团体名应包含「都匀三中」，实际：${snap.orgName}`);
  assert.ok(snap.projects.length > 0, '应该至少解析到 1 个项目');
  assert.ok(snap.projects.every((p) => p.name), '每个项目都应有名称');
  assert.ok(Object.keys(snap.counts).length > 0, '应生成指纹计数表');
});

test('真实请求：连抓两次（项目 id 每次都变）不会误报新项目', { skip }, async () => {
  const first = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });
  const second = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });

  const changed = first.projectIds.filter((id, i) => second.projectIds[i] !== id).length;
  console.log(`   ${first.projectIds.length} 个项目中，有 ${changed} 个链接 id 发生了变化`);
  console.log(`   第一次前 2 个 id: ${first.projectIds.slice(0, 2).join(', ')}`);
  console.log(`   第二次前 2 个 id: ${second.projectIds.slice(0, 2).join(', ')}`);

  // 这正是这个坑的核心：id 变了，但项目没变
  assert.ok(changed > 0, '本次实测 id 应当发生变化（若为 0 说明站点行为变了，可放宽）');

  const detected = findNewProjects(second.projects, first.counts);
  assert.equal(detected.length, 0, 'id 变了但项目没变，绝不能识别为新项目');

  // 顺带确认名称序列一致
  const namesA = first.projects.map((p) => p.name).join('|');
  const namesB = second.projects.map((p) => p.name).join('|');
  assert.equal(namesA, namesB, '两次抓取的项目名称序列应一致');
});

test('真实请求：模拟新增一个项目能正确识别并生成通知', { skip }, async () => {
  const snap = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });

  const fakeNew = {
    id: 'FAKE_NEW_PROJECT_1',
    name: '【测试】全新的志愿服务项目',
    date: new Date().toISOString().slice(0, 10),
    status: '运行中',
    url: 'https://gz.zhiyuanyun.com/app/opp/view.php?id=FAKE_NEW_PROJECT_1',
  };

  const detected = findNewProjects([fakeNew, ...snap.projects], snap.counts);
  assert.equal(detected.length, 1);
  const text = buildNotificationText(snap.orgName, detected.map((d) => d.item));
  console.log(`   通知标题: ${text.title}`);
  console.log(`   通知正文: ${text.body}`);
  assert.match(text.title, /全新的志愿服务项目/);
});

test('真实请求：错误的团体 id 会被识别为无效（站点返回登录页）', { skip }, async () => {
  await assert.rejects(
    () => fetchOrgSnapshot('https://gz.zhiyuanyun.com/app/org/view.php?id=ZZZZnotexist123', {
      host: 'gz.zhiyuanyun.com',
    }),
    (e) => {
      console.log(`   错误信息: ${e.message}`);
      return /登录|无效|不存在|没有团体信息/.test(e.message);
    }
  );
});

test('真实请求：normalizeOrgInput 产出的链接可直接抓取', { skip }, async () => {
  const target = normalizeOrgInput(TEAM_URL);
  const snap = await fetchOrgSnapshot(target.url, { host: target.host });
  assert.ok(snap.projects.length > 0);
});

test('真实请求：同一批数据重复比对多次仍不误报', { skip }, async () => {
  const a = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });
  const b = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });
  const c = await fetchOrgSnapshot(TEAM_URL, { host: 'gz.zhiyuanyun.com' });

  assert.equal(findNewProjects(b.projects, a.counts).length, 0, '第 2 次比对不应误报');
  assert.equal(findNewProjects(c.projects, b.counts).length, 0, '第 3 次比对不应误报');
});
