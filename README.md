# LocalDevTools skills

Developer tools for AI agents that process clipboard data locally. JWTs, credentials
and private payloads do not need to be pasted into a chat or sent to a model.
Eight Agent Skills cover 16 tools, powered by a standalone Rust CLI. Electron is
optional. Regex testing is available in the desktop app, not this standalone set.

[Explore LocalDevTools](https://usemiller.dev/local-dev-tools) for the desktop app,
downloads and more ways to keep developer tasks local.

## Install

```sh
npx skills add darraghoriordan/localdevtools-skills -g
```

Choose your agents and skills in the installer, or select one:

```sh
npx skills add darraghoriordan/localdevtools-skills -g --skill localdevtools-jwt
```

Requires Node.js 20 or newer for the launcher. The native CLI supports macOS,
Windows and Linux on ARM64 and x64. Linux builds target glibc 2.35 or newer;
Alpine/musl is not supported. A desktop session is needed for clipboard access.
Windows and macOS have native clipboard output; use file output on Linux.

## First use

Ask your agent to set up the LocalDevTools CLI using the installed skill's
`scripts/run.mjs --setup`. It can also be run manually:

```sh
node "/absolute/path/to/installed/localdevtools-jwt/scripts/run.mjs" --setup
```

Setup reuses a compatible CLI from `LOCALDEVTOOLS_BIN`, PATH or a standard desktop
app location. Otherwise it downloads the pinned binary from this repository's
GitHub Releases, verifies its size and SHA-256 against the manifest shipped in the
skill, and saves it to a per-user cache. All skills share that cache. No Rust
compiler, Electron installation, package manager change or admin access is needed.

Setup and tool execution are separate. **Ordinary tool commands never download
anything.** Setup sends a normal release download request to GitHub, without
clipboard input. Runtime processing is local and does not contact a model provider.
The launcher does not read or print the clipboard; the native executable reads it.

Copy a JWT, then ask: “Check whether the JWT on my clipboard has expired.” The skill
selects the local command and returns the requested findings. Agent selection is
controlled by your chat app/harness; explicitly selecting the skill also works.

## Tools

| Skill                    | Operations                                                      |
| ------------------------ | --------------------------------------------------------------- |
| `localdevtools-jwt`      | Decode, expiry/not-before checks, HMAC verification             |
| `localdevtools-json`     | Validate, format, minify JSON                                   |
| `localdevtools-encoding` | Base64, URL components, HTML entities, JSON escaping, form data |
| `localdevtools-text`     | Case conversion, sorting/deduplication and line edits           |
| `localdevtools-time`     | Timestamps, cron, timezone comparisons                          |
| `localdevtools-color`    | Color conversion, harmonies, nearest Tailwind color             |
| `localdevtools-http`     | URL parsing, cURL generation (never request execution)          |
| `localdevtools-git`      | SSH/HTTPS Git URLs and explicitly selected SSH alias files      |

## Privacy and output

Sensitive tools default to a private local file or limited findings. Skills tell
agents to return file receipts without reading those files. Other tools return
ordinary results; use `--private` for confidential JSON or text. `--stdout`
explicitly releases a raw result to the calling agent and should be used only
when the user wants that result in chat.

Private temporary results expire after 24 hours, cleaned when the CLI next writes
a default private result. `--output PATH` selects a lasting file; overwriting
requires `--overwrite`. `--copy-result` explicitly replaces clipboard text on
macOS/Windows, with a best-effort check for clipboard changes during processing.
Inputs are limited to 1 MiB and serialized results to 8 MiB.

Skills guide agents; they cannot prevent an agent from using another tool to read
files, or prevent OS clipboard history/sync. Requested findings and any explicitly
released results still enter the agent's context. An expiry check is not token
verification, and HMAC signature verification does not establish issuer/audience
policy. HS256, HS384 and HS512 are supported; public-key verification is not.

## Configuration and updates

- `LOCALDEVTOOLS_BIN`: an absolute path to a compatible existing native executable.
  This is an explicit trust override; installed executables are version/protocol
  checked, while downloaded cache entries are checked against pinned hashes.
- `LOCALDEVTOOLS_HOME`: an absolute override for the shared CLI cache directory.
- `node scripts/run.mjs --status`: report whether a compatible CLI is available.
- `npx skills update`: update installed skill instructions and their pinned release
  manifest. Run `--setup` again if the updated skill requires a new CLI version.

Default cache locations are `~/Library/Caches/LocalDevTools/cli` on macOS,
`%LOCALAPPDATA%/LocalDevTools/cli` on Windows and
`${XDG_CACHE_HOME:-~/.cache}/localdevtools/cli` on Linux. Removing skills does not
remove the shared CLI cache or private results. Delete the cache directory to
remove downloaded binaries once no other skill needs it.

The public launcher does not automatically read desktop app settings. Pass
`--ssh-config PATH` for Git aliases, or an explicit `--app-data PATH` to the native
CLI if you intentionally want to share desktop settings/results.

The desktop installer and `npx skills` can target the same skill names. Choose one
manager per install location; the desktop app intentionally refuses to overwrite
skills it does not own. Removing a desktop-managed copy before switching avoids
ownership conflicts.

## Releases and maintenance

This repository is generated from LocalDevTools' canonical skill templates. Each
skill includes its own launcher, manifest and notices so it works when installed
alone, copied instead of symlinked, or used by a different supported harness.
Native sources remain in the private app repository. Release assets are compiled
on native OS runners and pass Rust tests plus 554 compatibility fixtures before
publication. `release.json` records their source commit, version, sizes and hashes.
Checksums detect changed downloads; they are not a substitute for trusting the
publisher. These initial standalone binaries are not Developer ID/Authenticode
signed; OS restrictions may require the normal local execution permission.

Run `npm test` to exercise the launcher and validate generated skills. Report bugs
through this repository's issues. To maintain the generated source, use the app's
`buildTools/exportPublicSkills.mjs`; do not hand-edit eight launcher copies.

Licensing follows the included `LICENSE` and `CLI-LICENSE.txt`. Third-party notices
are included in the repository, each installed skill, and native release assets.
