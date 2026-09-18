#!/usr/bin/env node
/* global process, fetch, AbortSignal, URL */
// Generated into each skill so selecting a single skill remains self-contained.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  readFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  chmod,
} from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'darraghoriordan/localdevtools-skills'
const MAX_BINARY = 64 * 1024 * 1024
const RELEASE_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
])
export class LauncherError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
function failure(code, message) {
  throw new LauncherError(code, message)
}
export function platformKey(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`
  if (
    ![
      'darwin-arm64',
      'darwin-x64',
      'win32-arm64',
      'win32-x64',
      'linux-arm64',
      'linux-x64',
    ].includes(key)
  )
    failure(
      'UNSUPPORTED_PLATFORM',
      'This release supports macOS, Windows and Linux on ARM64 or x64.',
    )
  return key
}
export function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.repository !== REPOSITORY ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
    manifest.tag !== `cli-v${manifest.version}` ||
    manifest.protocolVersion !== 1
  )
    failure(
      'INVALID_RELEASE',
      'The skill release manifest is invalid. Reinstall the skill.',
    )
  for (const key of [
    'darwin-arm64',
    'darwin-x64',
    'win32-arm64',
    'win32-x64',
    'linux-arm64',
    'linux-x64',
  ]) {
    const asset = manifest.assets?.[key]
    if (
      !asset ||
      asset.name !==
        `localdevtools-${key}${key.startsWith('win32') ? '.exe' : ''}` ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > MAX_BINARY
    )
      failure(
        'INVALID_RELEASE',
        'The skill release manifest is incomplete. Reinstall the skill.',
      )
  }
  return manifest
}
export function cacheRoot({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  if (env.LOCALDEVTOOLS_HOME) {
    if (!path.isAbsolute(env.LOCALDEVTOOLS_HOME))
      failure(
        'INVALID_CONFIGURATION',
        'LOCALDEVTOOLS_HOME must be an absolute path.',
      )
    return env.LOCALDEVTOOLS_HOME
  }
  if (platform === 'darwin')
    return path.join(home, 'Library', 'Caches', 'LocalDevTools', 'cli')
  if (platform === 'win32')
    return path.join(
      env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      'LocalDevTools',
      'cli',
    )
  const cache =
    env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME)
      ? env.XDG_CACHE_HOME
      : path.join(home, '.cache')
  return path.join(cache, 'localdevtools', 'cli')
}
export function cachedExecutable(manifest, options = {}) {
  const key = platformKey(options.platform, options.arch)
  return path.join(
    cacheRoot(options),
    manifest.tag,
    key,
    key.startsWith('win32') ? 'localdevtools.exe' : 'localdevtools',
  )
}
export async function verifiedFile(file, asset) {
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.bytes)
      return false
    return (
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex') === asset.sha256
    )
  } catch {
    return false
  }
}
export function probeExecutable(file, manifest) {
  const child = spawnSync(file, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: 3000,
    maxBuffer: 64 * 1024,
  })
  if (child.error || child.status !== 0) return false
  try {
    const response = JSON.parse(child.stdout)
    return (
      response.ok === true &&
      response.version === manifest.version &&
      response.protocolVersion === manifest.protocolVersion
    )
  } catch {
    return false
  }
}
function installedCandidates(options) {
  const {
    platform = process.platform,
    env = process.env,
    home = os.homedir(),
  } = options
  const name = platform === 'win32' ? 'localdevtools.exe' : 'localdevtools'
  const candidates = (env.PATH || '')
    .split(path.delimiter)
    .filter(p => p && path.isAbsolute(p))
    .map(p => path.join(p, name))
  if (platform === 'darwin')
    for (const dir of ['/Applications', path.join(home, 'Applications')])
      candidates.push(
        path.join(
          dir,
          'LocalDevTools.app',
          'Contents',
          'Resources',
          'bin',
          name,
        ),
      )
  if (platform === 'win32' && env.LOCALAPPDATA)
    for (const app of ['LocalDevTools', 'local-dev-tools'])
      candidates.push(
        path.join(env.LOCALAPPDATA, 'Programs', app, 'resources', 'bin', name),
      )
  return [...new Set(candidates)]
}
export async function resolveExecutable(manifest, options = {}) {
  validateManifest(manifest)
  const key = platformKey(options.platform, options.arch)
  const env = options.env ?? process.env
  const probe = options.probe ?? probeExecutable
  if (env.LOCALDEVTOOLS_BIN) {
    if (
      !path.isAbsolute(env.LOCALDEVTOOLS_BIN) ||
      !probe(env.LOCALDEVTOOLS_BIN, manifest)
    )
      failure(
        'INCOMPATIBLE_CLI',
        'LOCALDEVTOOLS_BIN must point to a compatible native CLI. Run --setup without this override or update the selected CLI.',
      )
    return { path: env.LOCALDEVTOOLS_BIN, source: 'explicit' }
  }
  const cached = cachedExecutable(manifest, options)
  if (await verifiedFile(cached, manifest.assets[key]))
    return { path: cached, source: 'verified-cache' }
  for (const candidate of installedCandidates(options)) {
    if (probe(candidate, manifest))
      return { path: candidate, source: 'installed' }
  }
  return undefined
}
function releaseUrl(manifest, key) {
  return `https://github.com/${REPOSITORY}/releases/download/${manifest.tag}/${manifest.assets[key].name}`
}
export async function downloadVerified(
  url,
  destination,
  asset,
  fetchImpl = fetch,
) {
  const signal = AbortSignal.timeout(60000)
  let response
  for (let redirect = 0; redirect <= 5; redirect++) {
    const current = new URL(url)
    if (
      current.protocol !== 'https:' ||
      !RELEASE_HOSTS.has(current.hostname) ||
      current.username ||
      current.password ||
      current.port
    )
      failure(
        'DOWNLOAD_FAILED',
        'The release download redirected to an unsupported destination.',
      )
    response = await fetchImpl(current, { redirect: 'manual', signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location)
        failure(
          'DOWNLOAD_FAILED',
          'The release download returned an invalid redirect.',
        )
      url = new URL(location, current).href
      continue
    }
    break
  }
  if (!response?.ok || !response.body)
    failure(
      'DOWNLOAD_FAILED',
      'The pinned release could not be downloaded. Check network access and retry --setup.',
    )
  const file = await open(destination, 'wx', 0o700)
  let bytes = 0
  const hash = createHash('sha256')
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > asset.bytes || bytes > MAX_BINARY)
        failure(
          'DOWNLOAD_INVALID',
          'The downloaded binary has an unexpected size.',
        )
      hash.update(chunk)
      // FileHandle.write may be partial; writeFile consumes the complete chunk.
      await file.writeFile(chunk)
    }
    if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256)
      failure(
        'CHECKSUM_MISMATCH',
        'The downloaded CLI did not match this skill’s pinned checksum. Nothing was installed.',
      )
  } finally {
    await file.close()
  }
}
export async function setup(manifest, options = {}) {
  const existing = await resolveExecutable(manifest, options)
  if (existing) return existing
  const key = platformKey(options.platform, options.arch)
  const destination = cachedExecutable(manifest, options)
  const directory = path.dirname(destination)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (
    !(await lstat(directory)).isDirectory() ||
    (await lstat(directory)).isSymbolicLink()
  )
    failure(
      'INSTALL_FAILED',
      'The CLI cache directory must be a regular directory.',
    )
  const temporary = await mkdtemp(path.join(directory, '.download-'))
  const file = path.join(
    temporary,
    key.startsWith('win32') ? 'localdevtools.exe' : 'localdevtools',
  )
  try {
    await downloadVerified(
      releaseUrl(manifest, key),
      file,
      manifest.assets[key],
      options.fetchImpl,
    )
    if (!(options.probe ?? probeExecutable)(file, manifest))
      failure(
        'INCOMPATIBLE_CLI',
        'The downloaded CLI could not run on this system. Check the documented OS requirements.',
      )
    if (await verifiedFile(destination, manifest.assets[key]))
      return { path: destination, source: 'verified-cache' }
    await rename(file, destination)
    if ((options.platform ?? process.platform) !== 'win32')
      await chmod(destination, 0o700)
    return { path: destination, source: 'downloaded' }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        usage: [
          'node scripts/run.mjs --setup',
          'node scripts/run.mjs --status',
          'node scripts/run.mjs <tool> <operation> --clipboard [options]',
        ],
        privacy:
          'Setup downloads only the pinned executable. Tool invocations never download or read clipboard data in JavaScript.',
      }) + '\n',
    )
    return 0
  }
  try {
    const manifest = validateManifest(
      JSON.parse(
        await readFile(new URL('./release.json', import.meta.url), 'utf8'),
      ),
    )
    if (args.includes('--setup')) {
      if (args.length !== 1)
        failure(
          'INVALID_ARGUMENTS',
          'Run --setup separately, without operation arguments.',
        )
      const installed = await setup(manifest)
      process.stdout.write(
        JSON.stringify({ ok: true, version: manifest.version, ...installed }) +
          '\n',
      )
      return 0
    }
    const executable = await resolveExecutable(manifest)
    if (args.length === 1 && args[0] === '--status') {
      process.stdout.write(
        JSON.stringify({
          ok: true,
          ready: !!executable,
          version: manifest.version,
          ...executable,
        }) + '\n',
      )
      return 0
    }
    if (!executable)
      failure(
        'CLI_NOT_INSTALLED',
        'Run this skill’s scripts/run.mjs --setup once to download the pinned CLI, or install a compatible LocalDevTools app. No clipboard was read.',
      )
    const child = spawnSync(executable.path, args, {
      stdio: ['inherit', 'inherit', 'ignore'],
      windowsHide: true,
      shell: false,
      timeout: 15000,
    })
    if (
      child.error ||
      child.signal ||
      child.status === null ||
      child.status < 0 ||
      child.status > 4
    )
      failure(
        'CLI_FAILED',
        'The local CLI could not complete. Check local execution permissions; no raw diagnostic output is exposed.',
      )
    return child.status
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: {
          code:
            error instanceof LauncherError
              ? error.code
              : 'SETUP_OR_EXECUTION_FAILED',
          message:
            error instanceof LauncherError
              ? error.message
              : 'The local CLI could not be prepared or started. Check local permissions and network access for setup, then retry.',
        },
      }) + '\n',
    )
    return 3
  }
}
let isMain = false
try {
  isMain =
    !!process.argv[1] &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
} catch {
  /* Imported module. */
}
if (isMain) process.exitCode = await main()
