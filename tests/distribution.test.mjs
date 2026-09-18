/* global process, URL */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdtemp, cp, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../runtime/run.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const names = [
  'color',
  'encoding',
  'git',
  'http',
  'json',
  'jwt',
  'text',
  'time',
].map(name => `localdevtools-${name}`)

test('all eight independently installable skills carry the same pinned runtime and notices', async () => {
  assert.deepEqual((await readdir(path.join(root, 'skills'))).sort(), names)
  const manifestText = await readFile(path.join(root, 'release.json'), 'utf8')
  validateManifest(JSON.parse(manifestText))
  const runtime = await readFile(path.join(root, 'runtime/run.mjs'), 'utf8')
  const notices = await readFile(
    path.join(root, 'THIRD-PARTY-NOTICES.txt'),
    'utf8',
  )
  const license = await readFile(path.join(root, 'CLI-LICENSE.txt'), 'utf8')
  for (const name of names) {
    const skill = path.join(root, 'skills', name)
    const instructions = await readFile(path.join(skill, 'SKILL.md'), 'utf8')
    assert.match(
      instructions,
      new RegExp(`^---\nname: ${name}\ndescription: .+\n---\n`),
    )
    assert.doesNotMatch(
      instructions,
      /\{\{|regex test|REGEX_COMMAND|desktop-only|\/Users\//,
    )
    assert.equal(
      await readFile(path.join(skill, 'scripts/run.mjs'), 'utf8'),
      runtime,
    )
    assert.equal(
      await readFile(path.join(skill, 'scripts/release.json'), 'utf8'),
      manifestText,
    )
    assert.equal(
      await readFile(path.join(skill, 'references/CLI-LICENSE.txt'), 'utf8'),
      license,
    )
    assert.equal(
      await readFile(
        path.join(skill, 'references/THIRD-PARTY-NOTICES.txt'),
        'utf8',
      ),
      notices,
    )
  }
})

test('a single copied skill runs independently of the repository and working directory', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ldt-skill-copy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const installed = path.join(directory, 'installed skill with spaces')
  await cp(path.join(root, 'skills/localdevtools-jwt'), installed, {
    recursive: true,
  })
  const launcher = path.join(installed, 'scripts/run.mjs')
  const help = spawnSync(process.execPath, [launcher, '--help'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
  })
  assert.equal(help.status, 0)
  assert.equal(JSON.parse(help.stdout).ok, true)
  // A nonexistent explicit binary makes this independent of machine installations.
  // Failure must happen before any requested clipboard operation, without leaking arguments.
  const missing = spawnSync(
    process.execPath,
    [launcher, 'jwt', 'check', '--clipboard', 'SYNTHETIC-PRIVATE'],
    {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: {
        ...process.env,
        LOCALDEVTOOLS_BIN: path.join(directory, 'missing'),
      },
    },
  )
  assert.equal(missing.status, 3)
  assert.equal(JSON.parse(missing.stdout).error.code, 'INCOMPATIBLE_CLI')
  assert.ok(!missing.stdout.includes('SYNTHETIC-PRIVATE'))
  assert.equal(missing.stderr, '')
})
