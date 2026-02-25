# Security Model

This document describes the threat model, audit findings, and hardening measures applied to the Obsidian MCP Server — from the original unprotected code through two rounds of security auditing.

## Threat Model

This server exposes an Obsidian vault to AI assistants via the Model Context Protocol (MCP). The primary threat actor is **the connected AI itself** — whether through prompt injection, jailbreaking, or a compromised model, the AI could attempt to abuse the tools it has access to.

The AI can call four tools:

| Tool | Capability |
|------|-----------|
| `getAllFilenames` | List every file in the vault |
| `readMultipleFiles` | Read file contents by name (exact, partial, or case-insensitive) |
| `getOpenTodos` | Read all markdown files scanning for TODO items |
| `updateFileContent` | Create or overwrite files in the vault |

The server must ensure these tools cannot be used to **read or write outside the vault**, **execute code**, **exhaust system resources**, or **leak system information**.

## Starting Point: What the Original Code Looked Like

Before any security work, the server had no protections. Understanding what was missing explains why each fix was necessary.

### Write path: completely open

The original `updateFileContent` handler did this:

```typescript
const fullPath = path.join(vaultPath, filePath);
fs.writeFileSync(fullPath, content, "utf8");
```

No path validation. No symlink checks. No size limits. An AI could pass `filePath: "../../etc/crontab"` and write directly to the filesystem outside the vault. The `path.join` call would happily resolve `../` traversals.

### Read path: followed symlinks, no limits

The original `getAllFilenames` used glob without `follow: false` and without filtering symlinks:

```typescript
const files = glob.sync("**/*", { cwd: dirPath, nodir: true, dot: false });
```

This meant a symlink inside the vault pointing to `/etc/` or `$HOME` would cause the server to index and serve files from those directories. The `readFilesByName` function read files with no size check — a multi-gigabyte file would crash the process.

The `findOpenTodos` scanner had the same issues: it followed symlinks and read files of any size.

### Vault path: no real validation

The original `validateVaultPath` only checked `existsSync`:

```typescript
if (!existsSync(path)) { throw ... }
return path;
```

It didn't verify the path was a directory (not a file), didn't resolve it to an absolute path, and didn't resolve symlinks. A symlinked vault path would leave all downstream path comparisons working against the wrong base directory.

### No input limits

- `filenames` array accepted unlimited entries
- `content` string had no size limit
- `filePath` had no length or depth restrictions
- No rate limiting or fan-out caps on partial matching

### Dependencies

`npm audit` reported 6 known vulnerabilities (5 high, 1 low) in the `@modelcontextprotocol/sdk` dependency tree.

---

## Audit Findings and Fixes

### Round 0: Initial Hardening

These fixes addressed the fundamental gaps in the original code.

#### 1. No path traversal protection on writes

**Finding:** `updateFileContent` joined the user-supplied `filePath` directly onto the vault path with `path.join(vaultPath, filePath)` and wrote to the result. An AI could pass `../../etc/passwd` or an absolute path like `/etc/shadow` to write anywhere on the filesystem.

**Why it matters:** This is the most basic filesystem security vulnerability. Without it, the vault boundary is purely cosmetic — the AI has unrestricted write access to the entire machine.

**Fix:** Added `path.resolve()` to normalize the path, then validated the result starts with the resolved vault path plus a path separator. Absolute paths are rejected because `path.resolve(vault, "/etc/passwd")` yields `/etc/passwd`, which doesn't start with the vault prefix.

**Files:** `src/write.ts`

---

#### 2. Glob followed symlinks into external directories

**Finding:** `glob.sync("**/*")` was called without `follow: false`. If the vault contained a symlinked directory (e.g., `vault/notes -> /home/user/documents/`), glob would traverse into it and index every file as if it were part of the vault. Those files would then be readable via `readMultipleFiles`.

**Why it matters:** A single symlink inside the vault — placed there intentionally by the user for Obsidian convenience, or by an attacker — would silently expose an entire directory tree to the AI.

**Fix:** Added `follow: false` to all glob calls and filtered results through `lstatSync` to exclude any remaining symlinks. This was applied to both `getAllFilenames` and `findOpenTodos`.

**Files:** `src/read.ts`

---

#### 3. Writes to symlinks could escape the vault

**Finding:** The write path used `fs.writeFileSync` with no symlink check. If a file inside the vault was a symlink pointing outside (e.g., `vault/notes.md -> /etc/crontab`), writing to it would follow the symlink and modify the external target.

**Why it matters:** Even with path traversal protection, an attacker who could place a symlink inside the vault could redirect writes to any file the process has permission to modify.

**Fix:** Added a `lstatSync` check before writing to reject symlink targets.

**Files:** `src/write.ts`

---

#### 4. No input size limits — unbounded resource consumption

**Finding:** The `filenames` array in `readMultipleFiles` accepted unlimited entries. The `content` string in `updateFileContent` had no size limit. An AI could send a request with thousands of filenames or megabytes of content in a single call.

**Why it matters:** Without limits, a single tool call could exhaust memory (reading thousands of files into one response) or fill disk (writing an arbitrarily large file).

**Fix:** Added `z.array(z.string()).max(50)` to cap the filenames array and `z.string().max(1_000_000)` to cap write content at 1MB.

**Files:** `src/read.ts`, `src/write.ts`

---

#### 5. Vault path not fully validated at startup

**Finding:** `validateVaultPath` only checked that the path existed. It didn't verify it was a directory, didn't resolve to an absolute path, and didn't resolve symlinks. A relative path or symlinked vault path would cause all downstream `startsWith` checks to compare against the wrong base.

**Why it matters:** If the vault path is `/tmp/link -> /home/user/vault` and path checks compare against `/tmp/link`, an attacker who knows the real path could bypass containment. The `realpathSync` resolution ensures all comparisons use the canonical filesystem path.

**Fix:** Added `statSync` to verify it's a directory, `path.resolve` for absolute path normalization, and `realpathSync` to resolve symlinks.

**Files:** `src/utils.ts`

---

#### 6. Vulnerable dependencies

**Finding:** `npm audit` flagged 6 vulnerabilities (5 high, 1 low) in the `@modelcontextprotocol/sdk` dependency tree (version 1.6.1).

**Fix:** Upgraded `@modelcontextprotocol/sdk` from 1.6.1 to 1.27.0, resolving all known vulnerabilities.

**Files:** `package-lock.json`

---

### Round 1: Defense-in-Depth Hardening

With the basics in place, this round looked for gaps where the existing protections could be bypassed or where secondary failures could lead to exploitation.

#### 7. No file size limit on reads — memory exhaustion DoS

**Finding:** `readFilesByName` and `findOpenTodos` read entire files into memory with `fs.readFileSync` and no size check. A multi-gigabyte file in the vault would crash the server process. Writes were capped at 1MB but reads had no limit.

**Why it matters:** The write limit prevents the AI from *creating* huge files, but a vault may already contain large files (images, PDFs, database exports). The AI could read them all and crash the server.

**Fix:** Added a 10MB cap. Files exceeding the limit return an error message instead of their contents. The `findOpenTodos` scanner silently skips oversized files.

**Files:** `src/read.ts`, `src/utils.ts`

---

#### 8. TOCTOU race condition on symlink check during writes

**Finding:** The write path did a `lstatSync` check for symlinks, then called `writeFileSync` separately. Between those two calls, an attacker with filesystem access could swap a regular file for a symlink, causing the write to land outside the vault.

**Why it matters:** The time-of-check-to-time-of-use window is small but real. In a shared environment or on a system with malicious processes, this is exploitable.

**Fix:** Replaced the two-step check-then-write with a single `fs.openSync` call using the `O_NOFOLLOW` flag. The kernel atomically rejects the open if the target is a symlink — no race window. The `ELOOP` error is caught and returned as a clean "Cannot write to a symbolic link" message.

**Files:** `src/write.ts`

---

#### 9. Error messages leaked system details

**Finding:** The catch block returned raw `error.message` strings from Node.js filesystem operations. These can contain full filesystem paths, permission details, mount point information, and other OS-level details.

**Why it matters:** Error messages flow back to the AI through the MCP protocol. A malicious AI could intentionally trigger errors to learn about the filesystem layout, discover usernames from home directory paths, or identify the operating system.

**Fix:** Only known validation errors (null bytes, path escape, etc.) are surfaced to the client with their specific messages. All unexpected errors log full details to stderr for debugging but return a generic "Failed to write file" message to the client.

**Files:** `src/write.ts`

---

#### 10. Write path allowed targeting the vault root itself

**Finding:** The path containment check allowed `fullPath === resolvedVault` — writing to the vault directory as if it were a file. While `writeFileSync` to a directory would fail at the OS level, this should be rejected explicitly.

**Fix:** Changed the check from `startsWith(vault + sep) || === vault` to strictly `startsWith(vault + sep)` via a shared `assertInsideVault()` helper.

**Files:** `src/utils.ts`, `src/write.ts`

---

#### 11. Startup log wrote to stdout — corrupted MCP protocol

**Finding:** `console.log` fired after `StdioServerTransport` was connected. Since MCP uses stdout for JSON-RPC messages, this injected non-protocol data into the communication stream.

**Why it matters:** Corrupted protocol output could cause client disconnects, parsing errors, or in adversarial scenarios, be crafted to inject messages into the protocol stream.

**Fix:** Changed to `console.error` so the startup message goes to stderr.

**Files:** `src/index.ts`

---

#### 12. Mutable `vaultPath` export

**Finding:** `vaultPath` was exported as a mutable `let`. Any module importing it could reassign it, potentially redirecting all file operations to an arbitrary directory.

**Why it matters:** While the MCP protocol shouldn't allow external code to modify module exports, defense-in-depth means not relying on a single layer. If any part of the dependency chain were compromised, a mutable vault path would be an easy escalation vector.

**Fix:** Replaced with a `getVaultPath()` function backed by a `const`. The function also throws if the path is somehow empty, as a defense-in-depth guard behind the startup validation.

**Files:** `src/index.ts`, `src/read.ts`, `src/write.ts`

---

#### 13. No null byte validation in file paths

**Finding:** Null bytes (`\0`) in file paths can cause path truncation in some Node.js/OS combinations. For example, `"safe.md\0../../etc/passwd"` might be interpreted as just `"safe.md"` by some operations but as the full string by others.

**Why it matters:** Path truncation attacks exploit disagreements between how different layers interpret the same string. If the validation layer sees the full string but the filesystem truncates at `\0`, the validated path and the actual write target differ.

**Fix:** Added `assertNoNullBytes()` validation in both read and write handlers, rejecting any path containing `\0`.

**Files:** `src/utils.ts`, `src/read.ts`, `src/write.ts`

---

#### 14. No read-side path containment check

**Finding:** Read operations trusted that `getAllFilenames` (via glob) would only return paths inside the vault. If glob had a bug or the filesystem changed between listing and reading, a path could escape.

**Why it matters:** The principle of defense-in-depth: never trust one layer to be the sole enforcement point. If glob returned a path containing `../` due to a bug or edge case, the read would silently follow it outside the vault.

**Fix:** Added `assertInsideVault()` checks before every `readFileSync` call — both in `safeReadFile()` for the read tool and in `findOpenTodos()` for the TODO scanner.

**Files:** `src/read.ts`

---

### Round 2: AI-Adversarial Hardening

The final audit shifted the threat model: instead of asking "what are the technical vulnerabilities?", it asked **"what can a malicious AI do with just these four MCP tools?"** This uncovered attack vectors that were technically within the vault boundary but still dangerous.

#### 15. Writes to dotfiles/directories enabled code execution

**Finding:** Read operations filter out dotfiles (`dot: false` in glob), but writes had **zero dotfile protection**. A malicious AI could:

- Write to `.obsidian/plugins/evil/main.js` — Obsidian auto-loads plugins on startup, giving the AI **arbitrary code execution** in the Obsidian process.
- Write to `.git/hooks/pre-commit` — the next `git commit` in the vault would execute attacker-controlled shell commands.
- Write to `.obsidian/workspace.json` — corrupt Obsidian's state, causing crashes or data loss.

**Why it matters:** This is the most severe finding. The AI doesn't need to escape the vault — it can achieve code execution by writing to directories that other programs trust and auto-execute from. The read/write asymmetry around dotfiles also meant the AI could create hidden files that would never appear in `getAllFilenames` results.

**Fix:** Added `assertNoDotPaths()` which rejects any `filePath` where any path segment starts with `.`. This blocks `.obsidian/`, `.git/`, `.hidden.md`, `notes/.secret/file.md`, etc.

**Files:** `src/utils.ts`, `src/write.ts`

---

#### 16. Symlinked parent directories bypassed vault containment

**Finding:** `O_NOFOLLOW` only prevents the **final path component** from being a symlink. If a subdirectory inside the vault is a symlink pointing outside (e.g., `vault/notes/ -> /tmp/outside/`), the path check passes (`vault/notes/file.md` starts with `vault/`) but the write physically lands outside the vault, following the intermediate symlink.

**Why it matters:** This is a subtle gap between logical path validation (string-based) and physical filesystem behavior. The path looks correct, passes all string checks, but the write goes somewhere else entirely.

**Fix:** Added `assertNoSymlinkedParents()` which walks up from the target file to the vault root, checking each existing directory with `lstatSync` for symlinks. This runs after `mkdirSync` so newly created directories are also checked.

**Files:** `src/utils.ts`, `src/write.ts`

---

#### 17. No file extension restrictions allowed executable file creation

**Finding:** The `updateFileContent` tool description says "markdown content" but accepted any file extension. An AI could write `.js`, `.sh`, `.py`, `.html` files into the vault.

**Why it matters:** Combined with finding #15 (now fixed), this was how plugin injection worked. Even without dotfile access, executable files in the vault are dangerous if the vault is a git repo (files could end up in CI/CD), on shared storage, or processed by other tools that auto-execute scripts.

**Fix:** Added an extension allowlist: `.md`, `.txt`, `.csv`, `.json`, `.yaml`, `.yml`, `.canvas`. All other extensions are rejected with a message listing the allowed types.

**Files:** `src/utils.ts`, `src/write.ts`

---

#### 18. Read amplification via partial filename matching

**Finding:** `readMultipleFiles` supports partial name matching. A query like `["a"]` would match **every file** with "a" in its basename and read all of them. With 50 input slots, an AI could use single-letter queries to fan out to thousands of file reads, bypassing the "50 filenames" limit entirely.

**Why it matters:** The 50-filename limit was intended to cap resource usage, but partial matching turned it into a multiplier instead of a cap. 50 single-letter queries could read the entire vault.

**Fix:** Capped partial matches to 5 results per query. If more files match, the response includes a count and a message suggesting a more specific search term.

**Files:** `src/read.ts`

---

#### 19. No path length or depth limits — directory creation DoS

**Finding:** The `filePath` input had no `maxLength` in its Zod schema and no depth limit. An AI could create deeply nested directory trees (hundreds of levels) or use extremely long filenames to waste disk space and inodes.

**Why it matters:** While the filesystem enforces some limits (255-byte component names, ~4096-byte total path on Linux), the AI could still create thousands of directories per call. Over many calls, this fills the inode table and makes the vault unusable for Obsidian and glob operations.

**Fix:** Added `assertPathLimits()` enforcing a 512-character maximum path length and 10-level maximum directory depth.

**Files:** `src/utils.ts`, `src/write.ts`

---

## Defense Layers

Every write operation now passes through this validation chain:

```
filePath input
  │
  ├── assertNoNullBytes()         — reject \0 bytes
  ├── assertNoDotPaths()          — reject .obsidian/, .git/, etc.
  ├── assertAllowedExtension()    — reject .js, .sh, .py, .html, etc.
  ├── assertPathLimits()          — reject > 512 chars or > 10 levels
  │
  ├── path.resolve()              — normalize to absolute path
  ├── assertInsideVault()         — must be strictly under vault root
  │
  ├── mkdirSync (if needed)       — create parent directories
  ├── assertNoSymlinkedParents()  — reject symlinked parent dirs
  │
  └── fs.openSync(O_NOFOLLOW)     — atomic symlink rejection on write
```

Read operations are protected by:

- Glob with `dot: false` and `follow: false`
- Symlink filtering via `lstatSync`
- `assertInsideVault()` before every `readFileSync`
- 10MB file size cap
- 50 filename limit per request
- 5 partial match cap per query
- Null byte rejection

## Test Coverage

The test suite contains **61 tests** covering:

- Path traversal prevention (3 tests)
- Symlink file rejection on writes (3 tests)
- Symlinked parent directory rejection (2 tests)
- Dotfile/dotdir write blocking (4 tests)
- File extension allowlist (9 tests)
- Path length and depth limits (3 tests)
- Content size limits (2 tests)
- Filename count limits (2 tests)
- File creation and update behavior (4 tests)
- Read operations: exact, case-insensitive, partial match (6 tests)
- TODO scanning with symlink exclusion (7 tests)
- Vault path validation (6 tests)
- File listing with symlink/dotfile exclusion (7 tests)
- Empty vault and edge cases (3 tests)
