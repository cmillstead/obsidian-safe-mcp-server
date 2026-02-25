import { existsSync, statSync, realpathSync } from "fs";
import p from "path";

const MAX_READ_SIZE = 10 * 1024 * 1024; // 10 MB

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
