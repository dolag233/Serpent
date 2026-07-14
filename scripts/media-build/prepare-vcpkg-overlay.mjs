import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function parseArguments(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    options.set(key.slice(2), value);
  }
  return options;
}

function required(options, key) {
  const value = options.get(key);
  if (!value) throw new Error(`Missing --${key}.`);
  return path.resolve(value);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function gitHead(repository) {
  const result = spawnSync('git', ['-C', repository, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) throw new Error(`Cannot inspect vcpkg checkout: ${result.stderr}`);
  return result.stdout.trim();
}

function replaceExactly(contents, search, replacement, description) {
  const first = contents.indexOf(search);
  if (first < 0 || contents.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Pinned FFmpeg port no longer has the expected ${description} block.`);
  }
  return contents.replace(search, replacement);
}

const options = parseArguments(process.argv.slice(2));
const vcpkgRoot = required(options, 'vcpkg-root');
const outputRoot = required(options, 'output');
const projectRoot = path.resolve(import.meta.dirname, '../..');
const lock = readJson(path.join(projectRoot, 'resources/media-binaries/source-lock.json'));

if (gitHead(vcpkgRoot) !== lock.registry.commit) {
  throw new Error(`vcpkg checkout is not pinned commit ${lock.registry.commit}.`);
}

const ffmpegPort = readJson(path.join(vcpkgRoot, 'ports/ffmpeg/vcpkg.json'));
if (
  ffmpegPort.version !== lock.components.ffmpeg.version ||
  (ffmpegPort['port-version'] ?? 0) !== lock.components.ffmpeg.portVersion
) {
  throw new Error('Pinned vcpkg FFmpeg port version does not match source-lock.json.');
}
const oiioPort = readJson(path.join(vcpkgRoot, 'ports/openimageio/vcpkg.json'));
if (
  oiioPort.version !== lock.components.openimageio.version ||
  (oiioPort['port-version'] ?? 0) !== lock.components.openimageio.portVersion
) {
  throw new Error('Pinned vcpkg OpenImageIO port version does not match source-lock.json.');
}

rmSync(outputRoot, { force: true, recursive: true });
mkdirSync(outputRoot, { recursive: true });
const overlayPort = path.join(outputRoot, 'ffmpeg');
cpSync(path.join(vcpkgRoot, 'ports/ffmpeg'), overlayPort, { recursive: true });

const portfilePath = path.join(overlayPort, 'portfile.cmake');
let portfile = readFileSync(portfilePath, 'utf8');
portfile = replaceExactly(
  portfile,
  `if("nonfree" IN_LIST FEATURES)\n    set(OPTIONS "\${OPTIONS} --enable-nonfree")\nendif()`,
  `if("nonfree" IN_LIST FEATURES)\n    set(OPTIONS "\${OPTIONS} --enable-nonfree")\nelse()\n    set(OPTIONS "\${OPTIONS} --disable-nonfree")\nendif()`,
  'nonfree configuration',
);
portfile = replaceExactly(
  portfile,
  `if("gpl" IN_LIST FEATURES)\n    set(OPTIONS "\${OPTIONS} --enable-gpl")\nendif()`,
  `if("gpl" IN_LIST FEATURES)\n    set(OPTIONS "\${OPTIONS} --enable-gpl")\nelse()\n    set(OPTIONS "\${OPTIONS} --disable-gpl")\nendif()`,
  'GPL configuration',
);
writeFileSync(portfilePath, portfile, 'utf8');

console.log(`Prepared audited FFmpeg overlay port at ${overlayPort}`);
