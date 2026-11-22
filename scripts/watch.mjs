/**
 * 自动监听 vetbrain.config.json 里配置的本地文件夹。
 * 发现新增 / 修改 / 删除文件时，自动执行 pnpm run sync:build（含 commit + push）。
 *
 *   pnpm run watch            持续监听
 *   pnpm run watch -- --once  只检查一次（用于测试）
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fg from 'fast-glob';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'vetbrain.config.json');
const STATE_PATH = path.join(ROOT, '.cache/watch-state.json');
const once = process.argv.includes('--once');

function expandPath(input) {
  const value = String(input || '');
  if (value === '~') return os.homedir();
  if (value.startsWith('~')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(ROOT, value);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
}

function patternsFor(source) {
  const include = source.include?.length ? source.include : ['**/*.pdf', '**/*.docx', '**/*.pptx'];
  const exclude = source.exclude?.length ? source.exclude : ['**/~$*'];
  if (source.recursive === false) {
    return {
      include: include.map((p) => p.replace(/^\*\*\//, '')),
      exclude: exclude.map((p) => p.replace(/^\*\*\//, '')),
    };
  }
  return { include, exclude };
}

async function snapshot(config) {
  const result = new Map();
  for (const source of config.sources) {
    if (source.enabled === false) continue;
    const dir = expandPath(source.path);
    const { include, exclude } = patternsFor(source);
    let files = [];
    try {
      files = await fg(include, { cwd: dir, absolute: true, onlyFiles: true, ignore: exclude });
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const hash = await hashFile(file);
        result.set(`${source.name}/${path.relative(dir, file)}`, hash);
      } catch {}
    }
  }
  return result;
}

function hasChanged(previous, current) {
  for (const [key, hash] of current) {
    if (previous.get(key) !== hash) return true;
  }
  for (const key of previous.keys()) {
    if (!current.has(key)) return true;
  }
  return false;
}

function saveSnapshot(map) {
  return writeFile(STATE_PATH, JSON.stringify(Object.fromEntries(map), null, 2), 'utf8');
}

async function loadSnapshot() {
  try {
    return new Map(Object.entries(JSON.parse(await readFile(STATE_PATH, 'utf8'))));
  } catch {
    return new Map();
  }
}

async function runSync() {
  console.log(`[watch] ${new Date().toLocaleString('zh-CN')} 检测到内容变化，开始同步……`);
  await execFile('pnpm', ['run', 'sync:build'], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
  console.log('[watch] 同步完成。');
}

async function main() {
  const config = await loadConfig();
  const intervalMs = (config.watch?.intervalSeconds || 60) * 1000;
  let previous = await loadSnapshot();

  // 启动时先核对一次，补上关机期间的变化。
  let current = await snapshot(config);
  if (hasChanged(previous, current)) {
    await runSync();
    await saveSnapshot(current);
    previous = current;
  }
  if (once) {
    console.log('[watch] 单次检查完成。');
    return;
  }

  console.log(`[watch] 开始监听，每 ${intervalMs / 1000} 秒检查一次。`);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await snapshot(config);
    if (!hasChanged(previous, current)) continue;
    try {
      await runSync();
      await saveSnapshot(current);
      previous = current;
    } catch (error) {
      console.error('[watch] 同步失败，下次继续重试：', error.message || error);
    }
  }
}

main().catch((error) => {
  console.error('[watch] 失败：', error.message || error);
  process.exitCode = 1;
});
