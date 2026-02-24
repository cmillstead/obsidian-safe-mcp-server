import { existsSync, statSync, realpathSync } from "fs";
import p from "path";

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
