---
name: localdevtools-jwt
description: Inspect or verify a JWT copied to the clipboard without including the token in chat. Use for token expiration, not-before and HMAC signature checks.
---

# LocalDevTools jwt

Use this skill’s local launcher in the host's shell. Select the operation from the user's request before accessing data. Read the clipboard only through these commands; do not use shell clipboard readers, screenshots, or other tools to bring sensitive input into model context. Do not ask the user to paste secrets into chat.

## Launcher and setup

Use Node.js 20 or newer. Resolve `scripts/run.mjs` relative to this SKILL.md and invoke it by its absolute path, quoted for the host shell. Examples below assume the working directory is this skill's directory.

First run `node scripts/run.mjs --status`. If no compatible CLI is available, explain that `node scripts/run.mjs --setup` downloads the pinned native binary from GitHub Releases and verifies its checksum. Run setup under the user's or host's normal install/network authorization; do not combine setup with a clipboard operation. Setup never reads the clipboard. Compatible existing CLI installations are reused.

Tool commands do not download software. If the CLI is missing, they return CLI_NOT_INSTALLED before clipboard access. Clipboard operations need permitted OS/session access; report failures without using another tool to read the data or disabling sandbox protections.

- Check expiration: `node scripts/run.mjs jwt check --clipboard --checks expiry`
- Decode to a private local report: `node scripts/run.mjs jwt decode --clipboard`
- Verify using a local UTF-8 secret file: `node scripts/run.mjs jwt verify --clipboard --secret-file '/absolute/path/to/key' --algorithm HS256`
- For a token and secret together, use `jwt verify --request-clipboard`; the user prepares clipboard JSON with `jwt`, `secret`, and optional `algorithm`/`checks`. Do not read that JSON into context.
  The default verification algorithm is HS256; HS384 and HS512 are available. Secret-file bytes are exact, including newlines. Public-key verification is not supported. An expiry check alone does not authenticate a token. Report signature and time findings separately.

Run a command with `--help` to get its supported options without reading the clipboard. `--request-clipboard` takes all operation options from one JSON object; do not combine it with operation flags. The clipboard is read once when execution starts.

Private output is saved to a local result file with a receipt. Give that path to the user; do not read, print, or screenshot its contents. Default temporary result files are cleaned up after 24 hours on subsequent private-file commands. `--output '/absolute/path/to/result.txt'` chooses a lasting file (no overwrite without `--overwrite`). `--copy-result` explicitly replaces clipboard text on macOS/Windows; use file output on Linux. Ordinary tools may return results directly; `--stdout` explicitly releases a private tool's raw result only when the user wants it in chat. Requested findings still reach the inference provider.

On a command error, report the structured error without trying to inspect sensitive input. Do not fall back to cloud processing. If the CLI is unavailable, use --status and --setup as described above. Update this skill with npx skills update when its pinned release changes. The skill guides the workflow; it cannot prevent other agent tools or clipboard-sync software from reading data.
