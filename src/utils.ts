import { existsSync, statSync, realpathSync, lstatSync } from "fs";
import p from "path";

const MAX_READ_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PATH_LENGTH = 512;
const MAX_PATH_DEPTH = 10;

/** Extensions that are safe to write to an Obsidian vault. */
const ALLOWED_WRITE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".canvas",
]);

/** Reject paths containing null bytes (path truncation attack vector). */
export function assertNoNullBytes(filePath: string): void {
  if (filePath.includes("\0")) {
    throw new Error("File path contains null bytes.");
  }
}

/** Verify a resolved absolute path is strictly inside the vault directory. */
export function assertInsideVault(
  fullPath: string,
  resolvedVault: string
): void {
  if (!fullPath.startsWith(resolvedVault + p.sep)) {
    throw new Error("File path escapes the vault directory.");
  }
}

/** Reject paths that target dot-prefixed files or directories (.git, .obsidian, etc.). */
export function assertNoDotPaths(filePath: string): void {
  const segments = filePath.split(p.sep);
  for (const seg of segments) {
    if (seg.startsWith(".")) {
      throw new Error(
        "Cannot write to dot-prefixed files or directories."
      );
    }
  }
}

/** Reject file extensions not on the allowlist. */
export function assertAllowedExtension(filePath: string): void {
  const ext = p.extname(filePath).toLowerCase();
  if (!ext || !ALLOWED_WRITE_EXTENSIONS.has(ext)) {
    throw new Error(
      `File extension "${ext || "(none)"}" is not allowed. Allowed: ${[...ALLOWED_WRITE_EXTENSIONS].join(", ")}`
    );
  }
}

/** Reject paths that are too long or too deeply nested. */
export function assertPathLimits(filePath: string): void {
  if (filePath.length > MAX_PATH_LENGTH) {
    throw new Error(
      `File path exceeds the maximum length of ${MAX_PATH_LENGTH} characters.`
    );
  }
  const depth = filePath.split(p.sep).length;
  if (depth > MAX_PATH_DEPTH) {
    throw new Error(
      `File path exceeds the maximum depth of ${MAX_PATH_DEPTH} levels.`
    );
  }
}

/**
 * Walk from fullPath up to resolvedVault and verify no intermediate
 * directory is a symlink. This prevents writes through symlinked parent
 * directories that would land outside the vault.
 */
export function assertNoSymlinkedParents(
  fullPath: string,
  resolvedVault: string
): void {
  let current = p.dirname(fullPath);
  while (current !== resolvedVault && current.startsWith(resolvedVault)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("Cannot write through a symlinked directory.");
    }
    current = p.dirname(current);
  }
}

/** Return the max allowed read size in bytes. */
export function getMaxReadSize(): number {
  return MAX_READ_SIZE;
}

export const validateVaultPath = (vaultPath: string | undefined): string => {
  if (!vaultPath) {
    throw new Error(
      "Vault path must be provided as a command line argument.\nUsage: <command> <vault_path>"
    );
  }

  const resolved = p.resolve(vaultPath);

  if (!existsSync(resolved)) {
    throw new Error(
      `Invalid vault path: "${vaultPath}"\nPlease provide a path to an existing Obsidian vault`
    );
  }

  if (!statSync(resolved).isDirectory()) {
    throw new Error(
      `Invalid vault path: "${vaultPath}"\nPath must be a directory, not a file`
    );
  }

  // Resolve symlinks so all downstream path comparisons use the real path
  return realpathSync(resolved);
};
