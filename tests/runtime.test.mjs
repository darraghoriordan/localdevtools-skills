/* global process, Buffer, Response, URL */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  copyFile,
  readdir,
} from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  platformKey,
  cacheRoot,
  cachedExecutable,
  resolveExecutable,
  setup,
  downloadVerified,
} from '../runtime/run.mjs'
const contents = Buffer.from('synthetic executable fixture')
function manifest() {
  return {
    repository: 'darraghoriordan/localdevtools-skills',
    version: '0.1.0',
    tag: 'cli-v0.1.0',
    protocolVersion: 1,
    assets: Object.fromEntries(
      [
        'darwin-arm64',
        'darwin-x64',
        'win32-arm64',
        'win32-x64',
        'linux-arm64',
        'linux-x64',
      ].map(key => [
        key,
        {
          name: `localdevtools-${key}${key.startsWith('win32') ? '.exe' : ''}`,
          bytes: contents.length,
          sha256: createHash('sha256').update(contents).digest('hex'),
        },
      ]),
    ),
  }
}
async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ldt-public-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
function options(root, extra = {}) {
  return {
    platform: 'linux',
    arch: 'x64',
    home: root,
    env: { LOCALDEVTOOLS_HOME: root, PATH: '' },
    probe: () => false,
    ...extra,
  }
}
test('maps all six platforms and rejects others', () => {
  for (const platform of ['darwin', 'win32', 'linux'])
    for (const arch of ['x64', 'arm64'])
      assert.equal(platformKey(platform, arch), `${platform}-${arch}`)
  assert.throws(() => platformKey('linux', 'ia32'), {
    code: 'UNSUPPORTED_PLATFORM',
  })
})
test('cache paths are platform-specific and independent of the working directory', () => {
  for (const platform of ['darwin', 'win32', 'linux'])
    assert.ok(
      cacheRoot({ platform, home: os.homedir(), env: {} }).startsWith(
        os.homedir(),
      ),
    )
  assert.throws(() => cacheRoot({ env: { LOCALDEVTOOLS_HOME: 'relative' } }), {
    code: 'INVALID_CONFIGURATION',
  })
})
test('missing CLI never downloads or reads clipboard during resolution', async t => {
  const root = await temporary(t)
  assert.equal(
    await resolveExecutable(
      manifest(),
      options(root, {
        fetchImpl: () => assert.fail('No network outside setup'),
      }),
    ),
    undefined,
  )
})
test('setup verifies the download, caches it, and is idempotent across skills', async t => {
  const root = await temporary(t)
  let downloads = 0
  const opts = options(root, {
    probe: () => true,
    fetchImpl: async () => {
      downloads++
      return new Response(contents)
    },
  })
  // Empty PATH keeps this test independent of installed tools.
  const first = await setup(manifest(), opts)
  assert.equal(first.source, 'downloaded')
  assert.deepEqual(await readFile(first.path), contents)
  const again = await setup(manifest(), opts)
  assert.equal(again.source, 'verified-cache')
  assert.equal(downloads, 1)
})
test('tampered cache is rejected; failed checksum never installs a binary', async t => {
  const root = await temporary(t)
  const opts = options(root, {
    fetchImpl: async () => new Response(Buffer.alloc(contents.length)),
  })
  const dest = cachedExecutable(manifest(), opts)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, Buffer.alloc(contents.length))
  assert.equal(await resolveExecutable(manifest(), opts), undefined)
  await assert.rejects(setup(manifest(), opts), { code: 'CHECKSUM_MISMATCH' })
  assert.deepEqual(await readdir(path.dirname(dest)), ['localdevtools'])
})
test('download rejects oversized content and unsafe redirects', async t => {
  const root = await temporary(t)
  const asset = manifest().assets['linux-x64']
  await assert.rejects(
    downloadVerified(
      'https://github.com/test',
      path.join(root, 'large'),
      asset,
      async () => new Response(Buffer.alloc(asset.bytes + 1)),
    ),
    { code: 'DOWNLOAD_INVALID' },
  )
  await assert.rejects(
    downloadVerified(
      'https://github.com/test',
      path.join(root, 'redirect'),
      asset,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://example.com/binary' },
        }),
    ),
    { code: 'DOWNLOAD_FAILED' },
  )
})
test('follows only allowed HTTPS release redirects', async t => {
  const root = await temporary(t)
  const urls = []
  await downloadVerified(
    'https://github.com/test',
    path.join(root, 'download'),
    manifest().assets['linux-x64'],
    async url => {
      urls.push(url.href)
      return urls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location: 'https://release-assets.githubusercontent.com/test',
            },
          })
        : new Response(contents)
    },
  )
  assert.equal(urls.length, 2)
})
test('explicit installed CLI is used only after compatibility verification', async t => {
  const root = await temporary(t)
  const exe = path.join(root, 'existing')
  const opts = options(root, {
    env: { LOCALDEVTOOLS_BIN: exe },
    probe: (file, m) => file === exe && m.version === '0.1.0',
  })
  assert.deepEqual(await resolveExecutable(manifest(), opts), {
    path: exe,
    source: 'explicit',
  })
  await assert.rejects(
    resolveExecutable(manifest(), { ...opts, probe: () => false }),
    { code: 'INCOMPATIBLE_CLI' },
  )
})
test('incomplete manifests cannot choose arbitrary URLs or paths', async () => {
  const invalid = manifest()
  invalid.assets['linux-x64'].name = '../../bad'
  await assert.rejects(resolveExecutable(invalid), { code: 'INVALID_RELEASE' })
})
test(
  'entrypoint works through a skill-directory symlink',
  { skip: process.platform === 'win32' },
  async t => {
    const root = await temporary(t)
    const real = path.join(root, 'real')
    await mkdir(real)
    await copyFile(
      fileURLToPath(new URL('../runtime/run.mjs', import.meta.url)),
      path.join(real, 'run.mjs'),
    )
    await symlink(real, path.join(root, 'linked'), 'dir')
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'linked', 'run.mjs'), '--help'],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 0)
    assert.equal(JSON.parse(result.stdout).ok, true)
  },
)
test('setup cannot be combined with an operation or sensitive arguments', async t => {
  const root = await temporary(t)
  await copyFile(
    fileURLToPath(new URL('../runtime/run.mjs', import.meta.url)),
    path.join(root, 'run.mjs'),
  )
  await writeFile(path.join(root, 'release.json'), JSON.stringify(manifest()))
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'run.mjs'),
      '--setup',
      'jwt',
      'check',
      '--clipboard',
      'PRIVATE-SYNTHETIC',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 3)
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_ARGUMENTS')
  assert.ok(!result.stdout.includes('PRIVATE-SYNTHETIC'))
  assert.equal(result.stderr, '')
})
