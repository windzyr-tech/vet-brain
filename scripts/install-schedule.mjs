/**
 * 根据根配置安装 / 卸载 macOS 每周定时同步任务。
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

function launchList() {
  return new Promise((resolve, reject) => {
    execFile('launchctl', ['list'], { encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout));
    });
  });
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
  const schedule = config.schedule || {};
  const label = schedule.label || 'com.vetbrain.sync';
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  const uninstall = args.includes('--uninstall');

  if (uninstall) {
    await run('launchctl', ['unload', '-w', plistPath], true);
    await rm(plistPath, { force: true });
    console.log(`[schedule] 已卸载 ${label}`);
    return;
  }

  const hour = Number(schedule.hour ?? 3);
  const minute = Number(schedule.minute ?? 0);
  const weekday = schedule.weekday === undefined ? null : Number(schedule.weekday);
  const pnpmPath = await which('pnpm');
  const command = `cd ${shellQuote(ROOT)} && ${shellQuote(pnpmPath)} run sync`;

  if (process.platform !== 'darwin') {
    const cronDay = weekday === null ? '*' : weekday;
    console.log('非 macOS 系统，可手工添加 crontab：');
    console.log(`${minute} ${hour} * * ${cronDay} ${command}`);
    return;
  }

  const logDir = path.join(ROOT, '.cache/logs');
  await mkdir(logDir, { recursive: true });

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
  await run('launchctl', ['unload', '-w', plistPath], true);

  let loaded = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await run('launchctl', ['load', '-w', plistPath], true);
    if ((await launchList()).includes(label)) {
      loaded = true;
      break;
    }
  }
  if (!loaded) throw new Error(`定时任务 ${label} 加载失败，请手动执行：launchctl load -w ${plistPath}`);

  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const when = weekday === null ? '每天' : `每${weekdayNames[weekday] || `周${weekday}`}`;
  console.log(`[schedule] 已安装 ${label}，${when} ${hour}:${String(minute).padStart(2, '0')} 运行。`);
  console.log(`[schedule] 日志：${logDir}/sync.log`);
}

main().catch((error) => {
  console.error('[schedule] 失败：', error.message || error);
  process.exitCode = 1;
});
