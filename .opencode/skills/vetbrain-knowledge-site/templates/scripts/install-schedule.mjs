/**
 * 根据根配置安装 / 卸载两个 macOS 后台任务：
 *   - watch：持续监听配置里的本地文件夹，发现变化立即同步
 *   - schedule：每周定时全量同步（兜底）
 *
 *   pnpm run sync:install
 *   pnpm run sync:install -- --uninstall
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

function plistFor({ label, command, schedule, watch, logDir }) {
  const calendar = schedule
    ? `<key>StartCalendarInterval</key>\n  <dict>\n${
        schedule.weekday !== null
          ? `    <key>Weekday</key>\n    <integer>${schedule.weekday}</integer>\n`
          : ''
      }    <key>Hour</key>\n    <integer>${schedule.hour}</integer>\n    <key>Minute</key>\n    <integer>${schedule.minute}</integer>\n  </dict>\n`
    : '';
  const keepAlive = watch ? '<key>KeepAlive</key>\n  <true/>\n' : '';
  const runAtLoad = watch || schedule?.runAtLoad ? 'true' : 'false';

  return `<?xml version="1.0" encoding="UTF-8"?>
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
  ${calendar}${keepAlive}  <key>RunAtLoad</key>
  <${runAtLoad}/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, `${watch ? 'watch' : 'sync'}.log`))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, `${watch ? 'watch' : 'sync'}.err.log`))}</string>
</dict>
</plist>
`;
}

function launchList() {
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['list'], { encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

async function installAgent(label, plist) {
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  await writeFile(plistPath, plist, 'utf8');
  await run('launchctl', ['unload', plistPath], true);

  for (let attempt = 0; attempt < 3; attempt++) {
    await run('launchctl', ['load', '-w', plistPath], true);
    const list = await launchList();
    if (list.includes(label)) return plistPath;
  }
  throw new Error(`定时任务 ${label} 加载失败，请手动执行：launchctl load -w ${plistPath}`);
}

async function removeAgent(label) {
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  await run('launchctl', ['unload', plistPath], true);
  await rm(plistPath, { force: true });
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const schedule = config.schedule || {};
  const watch = config.watch || {};
  const syncLabel = schedule.label || 'com.vetbrain.sync';
  const watchLabel = watch.label || 'com.vetbrain.watch';
  const uninstall = args.includes('--uninstall');

  if (uninstall) {
    await removeAgent(syncLabel);
    await removeAgent(watchLabel);
    console.log(`[schedule] 已卸载 ${syncLabel} 与 ${watchLabel}`);
    return;
  }

  const pnpmPath = await which('pnpm');
  const nodePath = await which('node');
  const syncCommand = `cd ${shellQuote(ROOT)} && ${shellQuote(pnpmPath)} run sync`;
  const watchCommand = `cd ${shellQuote(ROOT)} && ${shellQuote(nodePath)} ${shellQuote(path.join(ROOT, 'scripts/watch.mjs'))}`;

  if (process.platform !== 'darwin') {
    console.log('非 macOS 系统，可手工添加 crontab：');
    const weekday = schedule.weekday === undefined ? '*' : schedule.weekday;
    console.log(`${schedule.minute ?? 0} ${schedule.hour ?? 3} * * ${weekday} ${syncCommand}`);
    console.log(`@reboot ${watchCommand}`);
    return;
  }

  const logDir = path.join(ROOT, '.cache/logs');
  await mkdir(logDir, { recursive: true });

  if (schedule.enabled !== false) {
    const plist = plistFor({
      label: syncLabel,
      command: syncCommand,
      schedule: {
        weekday: schedule.weekday === undefined ? null : Number(schedule.weekday),
        hour: Number(schedule.hour ?? 3),
        minute: Number(schedule.minute ?? 0),
        runAtLoad: Boolean(schedule.runAtLoad),
      },
      logDir,
    });
    await installAgent(syncLabel, plist);
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const when = schedule.weekday === undefined ? '每天' : `每${weekdayNames[Number(schedule.weekday)] || `周${schedule.weekday}`}`;
    console.log(`[schedule] 已安装 ${syncLabel}，${when} ${schedule.hour}:${String(schedule.minute ?? 0).padStart(2, '0')} 运行。`);
  }

  if (watch.enabled !== false) {
    const plist = plistFor({ label: watchLabel, command: watchCommand, watch: true, logDir });
    await installAgent(watchLabel, plist);
    console.log(`[schedule] 已安装 ${watchLabel}，持续监听本地文件夹，每 ${watch.intervalSeconds || 60} 秒检查一次。`);
  }

  console.log(`[schedule] 日志目录：${logDir}`);
}

main().catch((error) => {
  console.error('[schedule] 失败：', error.message || error);
  process.exitCode = 1;
});
