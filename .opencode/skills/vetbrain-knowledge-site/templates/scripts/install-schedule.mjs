/**
 * 根据根配置 vetbrain.config.json 的 schedule 段，安装/卸载 macOS 定时任务。
 *
 *   pnpm run sync:install          安装（每天按配置时间运行 pnpm run sync）
 *   pnpm run sync:install -- --uninstall 卸载
 *
 * 非 macOS 环境会打印等价的 crontab 写法。
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './ingest.mjs';

const CONFIG_PATH = path.join(ROOT, 'vetbrain.config.json');
const args = process.argv.slice(2);

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function which(command) {
  try {
    const { stdout } = await execFile('which', [command], { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return command;
  }
}

async function run(command, args, ignoreErrors = false) {
  try {
    await execFile(command, args);
  } catch (error) {
    if (!ignoreErrors) throw error;
  }
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const schedule = config.schedule || {};
  const label = schedule.label || 'com.vetbrain.sync';
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const uninstall = args.includes('--uninstall');

  if (uninstall) {
    if (process.platform === 'darwin') {
      await run('launchctl', ['unload', plistPath], true);
      await rm(plistPath, { force: true });
    }
    console.log(`[schedule] 已卸载 ${label}`);
    return;
  }

  if (schedule.enabled === false) {
    console.log('[schedule] 配置中 schedule.enabled 为 false，未安装定时任务。');
    return;
  }

  const hour = Number(schedule.hour ?? 3);
  const minute = Number(schedule.minute ?? 0);
  // launchd Weekday: 0=周日, 1=周一 … 6=周六
  const weekday = schedule.weekday === undefined ? null : Number(schedule.weekday);
  const pnpmPath = await which('pnpm');
  const command = `cd ${shellQuote(ROOT)} && ${shellQuote(pnpmPath)} run sync`;

  if (process.platform !== 'darwin') {
    console.log('非 macOS 系统，可手工添加 crontab：');
    const cronDay = weekday === null ? '*' : weekday;
    console.log(`${minute} ${hour} * * ${cronDay} cd ${ROOT} && ${pnpmPath} run sync`);
    return;
  }

  const logDir = path.join(ROOT, '.cache/logs');
  await mkdir(logDir, { recursive: true });
  await mkdir(path.dirname(plistPath), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
${weekday !== null ? `    <key>Weekday</key>\n    <integer>${weekday}</integer>\n` : ''}    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <${schedule.runAtLoad ? 'true' : 'false'}/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, 'sync.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, 'sync.err.log'))}</string>
</dict>
</plist>
`;

  await writeFile(plistPath, plist, 'utf8');
  await run('launchctl', ['unload', plistPath], true);
  await run('launchctl', ['load', plistPath]);
  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const when = weekday === null ? '每天' : `每${weekdayNames[weekday] || `周${weekday}`}`;
  console.log(`[schedule] 已安装 ${label}，${when} ${hour}:${String(minute).padStart(2, '0')} 运行。`);
  console.log(`[schedule] 日志：${logDir}/sync.log`);
}

main().catch((error) => {
  console.error('[schedule] 失败：', error.message || error);
  process.exitCode = 1;
});
