// 在 CI 和本地都能跑的最基本校验：manifest 合法 + JS 语法正确
// 用法: node scripts/validate.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'Extension', 'Resources');
let failed = 0;

function ok(msg) { console.log('  PASS ' + msg); }
function bad(msg) { console.error('  FAIL ' + msg); failed++; }

console.log('检查 manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(res, 'manifest.json'), 'utf8'));
  ok('JSON 可解析');
} catch (e) {
  bad('JSON 解析失败: ' + e.message);
  process.exit(1);
}

if (manifest.manifest_version === 2 || manifest.manifest_version === 3) ok('manifest_version = ' + manifest.manifest_version);
else bad('manifest_version 必须是 2 或 3');

if (manifest.name && manifest.version) ok(`name=${manifest.name} version=${manifest.version}`);
else bad('缺少 name 或 version');

// 声明的每个资源文件都必须真的存在
const declared = [
  ...(manifest.background && manifest.background.scripts ? manifest.background.scripts : []),
  ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ...(manifest.browser_action && manifest.browser_action.default_popup ? [manifest.browser_action.default_popup] : [])
];

const onDisk = new Set(readdirSync(res).filter((f) => statSync(join(res, f)).isFile()));
console.log('检查声明引用的资源文件');
for (const f of declared) {
  if (onDisk.has(f)) ok('存在 ' + f);
  else bad('manifest 引用了不存在的文件: ' + f);
}

console.log('检查 JS 语法');
for (const f of onDisk) {
  if (extname(f) !== '.js') continue;
  try {
    execFileSync(process.execPath, ['--check', join(res, f)], { stdio: 'pipe' });
    ok('语法正确 ' + f);
  } catch (e) {
    bad('语法错误 ' + f + '\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

console.log('检查关键文件的必备内容');
const mustHave = [
  ['background.js', ['parsePlaylist', 'vsd-found']],
  ['content.js', ['vsd-found', 'PerformanceObserver']]
];
for (const [file, needles] of mustHave) {
  const src = readFileSync(join(res, file), 'utf8');
  for (const n of needles) {
    if (src.includes(n)) ok(`${file} 含 ${n}`);
    else bad(`${file} 缺少 ${n}`);
  }
}

console.log('');
if (failed) {
  console.error(`=== ${failed} 项失败 ===`);
  process.exit(1);
}
console.log('=== 全部通过 ===');
