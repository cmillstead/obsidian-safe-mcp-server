import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { z } from "zod";
import {
  createTempVault,
  removeTempVault,
  createFile,
  createSymlink,
} from "./helpers.js";

let mockVaultPath = "";

vi.mock("../src/index.js", () => ({
  get vaultPath() {
    return mockVaultPath;
  },
  server: {},
}));

const { updateFileContent } = await import("../src/write.js");

const extra = {} as any;

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempVault();
  mockVaultPath = tmpDir;
});

afterEach(() => {
  removeTempVault(tmpDir);
});

// -- Path traversal prevention --

describe("path traversal prevention", () => {
  it("rejects ../../etc/passwd", () => {
    const result = updateFileContent.handler(
      { filePath: "../../etc/passwd", content: "pwned" },
      extra
    );
    expect(result.content[0].text).toContain("escapes the vault directory");
  });

  it("rejects absolute path /etc/passwd", () => {
    const result = updateFileContent.handler(
      { filePath: "/etc/passwd", content: "pwned" },
      extra
    );
    expect(result.content[0].text).toContain("escapes the vault directory");
  });

  it("rejects notes/../../../etc/shadow", () => {
    const result = updateFileContent.handler(
      { filePath: "notes/../../../etc/shadow", content: "pwned" },
      extra
    );
    expect(result.content[0].text).toContain("escapes the vault directory");
  });

  it("allows notes/hello.md", () => {
    const result = updateFileContent.handler(
      { filePath: "notes/hello.md", content: "hello" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully created new file");
    expect(
      fs.readFileSync(path.join(tmpDir, "notes/hello.md"), "utf8")
    ).toBe("hello");
  });

  it("allows sub/dir/file.md", () => {
    const result = updateFileContent.handler(
      { filePath: "sub/dir/file.md", content: "nested" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully created new file");
    expect(fs.existsSync(path.join(tmpDir, "sub/dir/file.md"))).toBe(true);
  });

  it("allows root-level file.md", () => {
    const result = updateFileContent.handler(
      { filePath: "file.md", content: "root" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully created new file");
  });
});

// -- Symlink rejection --

describe("symlink rejection", () => {
  it("rejects writing to a symlink file inside the vault", () => {
    createFile(tmpDir, "real.md", "original");
    createSymlink(tmpDir, "link.md", path.join(tmpDir, "real.md"));

    const result = updateFileContent.handler(
      { filePath: "link.md", content: "overwrite" },
      extra
    );
    expect(result.content[0].text).toContain(
      "Cannot write to a symbolic link"
    );
    expect(fs.readFileSync(path.join(tmpDir, "real.md"), "utf8")).toBe(
      "original"
    );
  });

  it("rejects writing to a symlink that points outside the vault", () => {
    const outsideDir = createTempVault();
    const outsideFile = createFile(outsideDir, "target.md", "outside");
    createSymlink(tmpDir, "escape.md", outsideFile);

    const result = updateFileContent.handler(
      { filePath: "escape.md", content: "pwned" },
      extra
    );
    expect(result.content[0].text).toContain(
      "Cannot write to a symbolic link"
    );

    removeTempVault(outsideDir);
  });

  it("allows writing to a regular existing file", () => {
    createFile(tmpDir, "existing.md", "old");

    const result = updateFileContent.handler(
      { filePath: "existing.md", content: "new" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully updated existing file");
    expect(fs.readFileSync(path.join(tmpDir, "existing.md"), "utf8")).toBe(
      "new"
    );
  });
});

// -- Content size limit --

describe("content size limit", () => {
  it("rejects content exceeding 1MB via zod schema", () => {
    const schema = z.object(updateFileContent.schema);
    const input = {
      filePath: "test.md",
      content: "x".repeat(1_000_001),
    };
    expect(() => schema.parse(input)).toThrow();
  });

  it("accepts content at exactly 1MB boundary", () => {
    const schema = z.object(updateFileContent.schema);
    const input = {
      filePath: "test.md",
      content: "x".repeat(1_000_000),
    };
    expect(() => schema.parse(input)).not.toThrow();
  });
});

// -- File creation and update --

describe("file creation and update", () => {
  it("creates intermediate directories", () => {
    updateFileContent.handler(
      { filePath: "new/deep/dir/file.md", content: "deep" },
      extra
    );
    expect(
      fs.readFileSync(path.join(tmpDir, "new/deep/dir/file.md"), "utf8")
    ).toBe("deep");
  });

  it("reports 'created new file' for new files", () => {
    const result = updateFileContent.handler(
      { filePath: "brand-new.md", content: "fresh" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully created new file");
  });

  it("reports 'updated existing file' for existing files", () => {
    createFile(tmpDir, "existing.md", "old");

    const result = updateFileContent.handler(
      { filePath: "existing.md", content: "updated" },
      extra
    );
    expect(result.content[0].text).toContain(
      "Successfully updated existing file"
    );
  });

  it("returns error when vaultPath is empty", () => {
    mockVaultPath = "";

    const result = updateFileContent.handler(
      { filePath: "file.md", content: "x" },
      extra
    );
    expect(result.content[0].text).toContain("No vault path provided");
  });
});
