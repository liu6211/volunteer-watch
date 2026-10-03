/**
 * 项目详情解析 + 报名 测试
 *
 * 样本结构照抄真实页面（报名名单里的真实人名换成化名）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseProject, joinProject, fetchProject } from '../src/core/project.mjs';

/** 真实页面的结构，人名已脱敏 */
const PAGE = `
<html><head><title>20261006万达广场一号门宠物领养志愿服务-志愿贵州</title></head>
<body>
<table class="tb1">
  <tr><td>项目地点：</td><td>都匀三中</td></tr>
  <tr><td>服务类别：</td><td><a href="#">绿化环保</a></td></tr>
  <tr><td>服务对象：</td><td>青少年</td></tr>
  <tr><td>招募日期：</td><td>2026-10-01 &nbsp;至&nbsp; 2026-10-08</td></tr>
  <tr><td>项目日期：</td><td>2026-10-01 &nbsp;至&nbsp; 2026-10-08</td></tr>
  <tr><td>发布日期：</td><td>2026-10-01</td></tr>
  <tr><td>服务时间：</td><td>2026年10月6日</td></tr>
  <tr><td>志愿者保障：</td><td>其他</td></tr>
</table>

<div class="post">
  岗位1：维持秩序 &nbsp;&nbsp;计划招募：6 &nbsp;&nbsp;已招募：9
  <a href="javascript:void(0);" class="but_alert" onclick="opp_join(9713283,11418895,0,'');">我要报名</a>
  <p>岗位ID：</p><p>11418895</p>
  <p>岗位描述：</p><p>捡垃圾</p>
  <p>岗位条件：</p><p>耐心</p>
</div>

<div class="detail">
项目名称：宠物公益领养志愿服务
项目内容：秩序维护，领养流程介绍
招募对象：已经注册了"都匀三中青年志愿者服务队"的少先队员
集合地点：万达广场1号门
联系人：义工18985767776
</div>

<table>
  <tr><th>姓名</th><th>岗位</th><th>报名日期</th></tr>
  <tr><td>张三</td><td>维持秩序</td><td>2026-10-03</td></tr>
  <tr><td>李四</td><td>维持秩序</td><td>2026-10-02</td></tr>
</table>
</body></html>`;

/* ------------------------------------------------------------ 解析 */

test('parseProject: 标题去掉站点后缀', () => {
  const p = parseProject(PAGE);
  assert.equal(p.title, '20261006万达广场一号门宠物领养志愿服务');
});

test('parseProject: 基本信息全部取到（标签和值分在不同单元格里）', () => {
  const p = parseProject(PAGE);
  assert.equal(p.info.place, '都匀三中');
  assert.equal(p.info.category, '绿化环保');
  assert.equal(p.info.target, '青少年');
  assert.equal(p.info.publishedAt, '2026-10-01');
  assert.equal(p.info.serviceTime, '2026年10月6日');
  assert.equal(p.info.guarantee, '其他');
});

test('parseProject: 招募日期拆成起止两段', () => {
  const p = parseProject(PAGE);
  assert.equal(p.info.recruitStart, '2026-10-01');
  assert.equal(p.info.recruitEnd, '2026-10-08');
});

test('parseProject: 岗位信息（含编号、描述、条件）', () => {
  const p = parseProject(PAGE);
  assert.equal(p.posts.length, 1);
  const post = p.posts[0];
  assert.equal(post.index, 1);
  assert.equal(post.title, '维持秩序');
  assert.equal(post.plan, 6);
  assert.equal(post.joined, 9);
  assert.equal(post.jobId, '11418895', '岗位编号要从页面里取到，报名要用');
  assert.equal(post.desc, '捡垃圾');
  assert.equal(post.condition, '耐心');
});

test('parseProject: 项目编号来自 opp_join 调用', () => {
  const p = parseProject(PAGE);
  assert.equal(p.oppId, '9713283');
  assert.match(p.url, /view\.php\?id=9713283$/);
});

test('parseProject: 可报名状态与报名名单', () => {
  const p = parseProject(PAGE);
  assert.equal(p.canJoin, true);
  assert.equal(p.joiners.length, 2);
  assert.equal(p.joiners[0].name, '张三');
  assert.equal(p.joiners[0].post, '维持秩序');
  assert.equal(p.joiners[0].date, '2026-10-03');
});

test('parseProject: 详情正文能读出来', () => {
  const p = parseProject(PAGE);
  assert.match(p.detail, /宠物公益领养志愿服务/);
  assert.match(p.detail, /万达广场1号门/);
});

test('parseProject: 没有岗位时不崩', () => {
  const p = parseProject('<html><title>x</title><body>空</body></html>');
  assert.deepEqual(p.posts, []);
  assert.equal(p.oppId, '');
  assert.equal(p.canJoin, false);
});

/* ------------------------------------------------------------ 报名 */

/** 造一个假的报名响应 */
function fakeJoin(responseText, status = 200) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    return {
      ok: status === 200,
      status,
      headers: { get: () => null, getSetCookie: () => [] },
      text: async () => responseText,
    };
  };
  return { fn, calls };
}

const SESSION = { cookie: 'PHPSESSID=abc', seid: 's', cookieMode: 'manual' };

test('joinProject: 成功时解析 msg', async () => {
  const { fn, calls } = fakeJoin('{"msg":"报名成功，请等待审核"}');
  const r = await joinProject(SESSION, 'gz.zhiyuanyun.com', '9713283', '11418895', { fetchImpl: fn });
  assert.equal(r.ok, true);
  assert.match(r.message, /报名成功/);

  const { url, opts } = calls[0];
  assert.match(url, /\/app\/api\/view\.php\?m=opp_join$/);
  assert.equal(opts.method, 'POST');
  const body = new URLSearchParams(opts.body);
  assert.equal(body.get('opp_id'), '9713283');
  assert.equal(body.get('job_id'), '11418895');
  // 必须带上登录会话，否则服务器不认
  assert.equal(opts.headers.Cookie, 'PHPSESSID=abc');
});

test('joinProject: 服务器说失败时 ok=false 并带上原话', async () => {
  const { fn } = fakeJoin('{"msg":"您已报名该项目，不能重复报名"}');
  const r = await joinProject(SESSION, 'gz.zhiyuanyun.com', '1', '2', { fetchImpl: fn });
  assert.equal(r.ok, false);
  assert.match(r.message, /重复报名/);
});

test('joinProject: 没登录时直接拒绝，不发请求', async () => {
  const { fn, calls } = fakeJoin('{}');
  const r = await joinProject({ cookie: '', seid: '' }, 'gz.zhiyuanyun.com', '1', '2', { fetchImpl: fn });
  assert.equal(r.ok, false);
  assert.match(r.message, /先登录/);
  assert.equal(calls.length, 0, '不该发请求');
});

test('joinProject: 缺岗位编号时拒绝', async () => {
  const { fn, calls } = fakeJoin('{}');
  const r = await joinProject(SESSION, 'gz.zhiyuanyun.com', '1', '', { fetchImpl: fn });
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test('joinProject: 返回登录页时提示重新登录', async () => {
  const { fn } = fakeJoin('<html>亲，请登录</html>');
  const r = await joinProject(SESSION, 'gz.zhiyuanyun.com', '1', '2', { fetchImpl: fn });
  assert.equal(r.ok, false);
  assert.match(r.message, /登录/);
});

test('joinProject: 需要免审密码/回答问题时能带上', async () => {
  const { fn, calls } = fakeJoin('{"msg":"报名成功"}');
  await joinProject(SESSION, 'gz.zhiyuanyun.com', '1', '2', {
    fetchImpl: fn, oppPwd: 'secret', answer: '我的回答',
  });
  const body = new URLSearchParams(calls[0].opts.body);
  assert.equal(body.get('opp_pwd'), 'secret');
  assert.equal(body.get('answer'), '我的回答');
});

test('joinProject: 超时给出可读提示', async () => {
  const hang = async () => { const e = new Error('Aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(
    () => joinProject(SESSION, 'gz.zhiyuanyun.com', '1', '2', { fetchImpl: hang }),
    /超时/
  );
});

/* ------------------------------------------------------------ 抓取 */

test('fetchProject: 拼接正确的公开地址', async () => {
  let seen = '';
  const fn = async (url) => {
    seen = url;
    return { ok: true, status: 200, text: async () => PAGE };
  };
  const p = await fetchProject('gz.zhiyuanyun.com', '9713283', { fetchImpl: fn });
  assert.match(seen, /^https:\/\/gz\.zhiyuanyun\.com\/app\/opp\/view\.php\?id=9713283$/);
  assert.equal(p.posts[0].jobId, '11418895');
});
