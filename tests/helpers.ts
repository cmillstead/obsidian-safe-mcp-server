import fs from "fs";
import os from "os";
import path from "path";

export function createTempVault(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
  // Resolve symlinks to avoid macOS /var vs /private/var mismatch
  return fs.realpathSync(tmpDir);
}

export function removeTempVault(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function createFile(
  vaultDir: string,
  relativePath: string,
  content: string
): string {
  const fullPath = path.join(vaultDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  return fullPath;
}

export function createSymlink(
  vaultDir: string,
  linkRelativePath: string,
  targetPath: string
): string {
  const fullLinkPath = path.join(vaultDir, linkRelativePath);
  fs.mkdirSync(path.dirname(fullLinkPath), { recursive: true });
  fs.symlinkSync(targetPath, fullLinkPath);
  return fullLinkPath;
}
