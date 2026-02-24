import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { validateVaultPath } from "../src/utils.js";
import {
  createTempVault,
  removeTempVault,
  createFile,
  createSymlink,
} from "./helpers.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempVault();
});

afterEach(() => {
  removeTempVault(tmpDir);
});

describe("validateVaultPath", () => {
  it("throws when path is undefined", () => {
    expect(() => validateVaultPath(undefined)).toThrow(
      "Vault path must be provided"
    );
  });

  it("throws when path is empty string", () => {
    expect(() => validateVaultPath("")).toThrow(
      "Vault path must be provided"
    );
  });

  it("throws when path does not exist", () => {
    expect(() => validateVaultPath("/nonexistent/path/xyz123")).toThrow(
      "Invalid vault path"
    );
  });

  it("throws when path is a file, not a directory", () => {
    const filePath = createFile(tmpDir, "not-a-dir.txt", "content");
    expect(() => validateVaultPath(filePath)).toThrow(
      "must be a directory"
    );
  });

  it("returns resolved absolute path for a valid directory", () => {
    const result = validateVaultPath(tmpDir);
    expect(result).toBe(tmpDir);
    expect(path.isAbsolute(result)).toBe(true);
  });

  it("resolves a symlinked directory to its real path", () => {
    const symlinkPath = path.join(tmpDir, "link-to-self");
    // Create a separate real directory to symlink to
    const realDir = createTempVault();
    fs.symlinkSync(realDir, symlinkPath);

    const result = validateVaultPath(symlinkPath);
    expect(result).toBe(realDir);
    expect(result).not.toBe(symlinkPath);

    removeTempVault(realDir);
  });
});
