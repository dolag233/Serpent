/**
 * Per-session diagnostic logs (Serpent-wgmy).
 *
 * 每次启动写入 `serpent-<本地时间戳>.log`（如 serpent-20260816T221412.log），
 * 不再向单一 serpent.log 无限追加；磁盘上最多保留最近 MAX_SESSION_LOGS 份，
 * 启动时按 mtime 清理最旧。清理/命名失败不得阻断启动（调用方 catch）。
 */

import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const SESSION_LOG_PREFIX = 'serpent-';
export const MAX_SESSION_LOGS = 100;
export const SESSION_LOG_SUFFIX = '.log';

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, '0');

/** 本地时间「精确到秒」文件名时间戳，如 20260816T221412。 */
export function formatSessionTimestamp(now: Date): string {
  return [
    String(now.getFullYear()).padStart(4, '0'),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    'T',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

/** 无冲突时的目标路径（纯拼接，供测试与命名规则校验）。 */
export function sessionLogPathFor(logsDir: string, now: Date): string {
  return path.join(
    logsDir,
    `${SESSION_LOG_PREFIX}${formatSessionTimestamp(now)}${SESSION_LOG_SUFFIX}`,
  );
}

/**
 * 选择本次会话日志路径：秒级时间戳；同秒多实例（start:multi）撞名时
 * 回退到毫秒级；仍撞名再加 pid。exists 可注入以便单测。
 */
export function chooseUniqueSessionLogPath(
  logsDir: string,
  now: Date,
  exists: (filePath: string) => boolean = existsSync,
  pid = process.pid,
): string {
  const base = sessionLogPathFor(logsDir, now);
  if (!exists(base)) return base;
  const msName = `${SESSION_LOG_PREFIX}${formatSessionTimestamp(now)}${pad(now.getMilliseconds(), 3)}${SESSION_LOG_SUFFIX}`;
  const msPath = path.join(logsDir, msName);
  if (!exists(msPath)) return msPath;
  return path.join(
    logsDir,
    `${SESSION_LOG_PREFIX}${formatSessionTimestamp(now)}-${pid}${SESSION_LOG_SUFFIX}`,
  );
}

/**
 * 清理会话日志，保留最近 maxFiles 份（按 mtime，越新越优先保留）。
 * 旧档案 serpent.log 不在命名空间内，本函数不触碰。
 */
export function pruneSessionLogs(
  logsDir: string,
  maxFiles = MAX_SESSION_LOGS,
  now = Date.now(),
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(logsDir);
  } catch {
    return [];
  }
  const sessionFiles = entries
    .filter((name) => name.startsWith(SESSION_LOG_PREFIX) && name.endsWith(SESSION_LOG_SUFFIX))
    .map((name) => path.join(logsDir, name))
    .filter((filePath) => {
      try {
        statSync(filePath);
        return true;
      } catch {
        return false;
      }
    })
    // 最近的排在前面（mtime 降序）。
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (sessionFiles.length <= maxFiles) return [];
  const removed: string[] = [];
  for (const filePath of sessionFiles.slice(maxFiles)) {
    try {
      unlinkSync(filePath);
      removed.push(filePath);
    } catch {
      // 单个清理失败不阻断：保留被占用/只读的文件。
    }
  }
  return removed;
}