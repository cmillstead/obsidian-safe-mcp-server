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
  getVaultPath: () => {
    if (!mockVaultPath) throw new Error("Vault path is not configured.");
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
      { filePath: "../../etc/passwd.md", content: "pwned" },
      extra
    );
    // Caught by dot-path guard (.. starts with .)
    expect(result.content[0].text).toContain("Error");
    expect(result.content[0].text).not.toContain("Successfully");
  });

  it("rejects absolute path /etc/passwd", () => {
    const result = updateFileContent.handler(
      { filePath: "/etc/passwd.md", content: "pwned" },
      extra
    );
    expect(result.content[0].text).toContain("escapes the vault directory");
  });

  it("rejects notes/../../../etc/shadow", () => {
    const result = updateFileContent.handler(
      { filePath: "notes/../../../etc/shadow.md", content: "pwned" },
      extra
    );
    // Caught by dot-path guard (.. starts with .)
    expect(result.content[0].text).toContain("Error");
    expect(result.content[0].text).not.toContain("Successfully");
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
    // Empty vault path is validated at startup; getVaultPath() throws
    // if somehow called with an empty path, and the handler returns a
    // generic error to avoid leaking system details.
    expect(result.content[0].text).toContain("Failed to write file");
  });
});

// -- Dotfile / dotdir write prevention --

describe("dotfile write prevention", () => {
  it("rejects writing to .obsidian/plugins/evil/main.js", () => {
    const result = updateFileContent.handler(
      { filePath: ".obsidian/plugins/evil/main.js", content: "malicious" },
      extra
    );
    expect(result.content[0].text).toContain("dot-prefixed");
  });

  it("rejects writing to .git/hooks/pre-commit", () => {
    const result = updateFileContent.handler(
      { filePath: ".git/hooks/pre-commit", content: "#!/bin/bash\nrm -rf /" },
      extra
    );
    expect(result.content[0].text).toContain("dot-prefixed");
  });

  it("rejects writing to .hidden.md at root", () => {
    const result = updateFileContent.handler(
      { filePath: ".hidden.md", content: "secret" },
      extra
    );
    expect(result.content[0].text).toContain("dot-prefixed");
  });

  it("rejects writing into a dot-prefixed subdirectory", () => {
    const result = updateFileContent.handler(
      { filePath: "notes/.secret/file.md", content: "hidden" },
      extra
    );
    expect(result.content[0].text).toContain("dot-prefixed");
  });
});

// -- File extension allowlist --

describe("file extension allowlist", () => {
  it("rejects .js files", () => {
    const result = updateFileContent.handler(
      { filePath: "evil.js", content: "require('child_process')" },
      extra
    );
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects .sh files", () => {
    const result = updateFileContent.handler(
      { filePath: "evil.sh", content: "#!/bin/bash" },
      extra
    );
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects .py files", () => {
    const result = updateFileContent.handler(
      { filePath: "evil.py", content: "import os" },
      extra
    );
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects .html files", () => {
    const result = updateFileContent.handler(
      { filePath: "evil.html", content: "<script>alert(1)</script>" },
      extra
    );
    expect(result.content[0].text).toContain("not allowed");
  });

  it("rejects files with no extension", () => {
    const result = updateFileContent.handler(
      { filePath: "Makefile", content: "all:" },
      extra
    );
    expect(result.content[0].text).toContain("not allowed");
  });

  it("allows .md files", () => {
    const result = updateFileContent.handler(
      { filePath: "note.md", content: "hello" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully");
  });

  it("allows .txt files", () => {
    const result = updateFileContent.handler(
      { filePath: "note.txt", content: "hello" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully");
  });

  it("allows .canvas files", () => {
    const result = updateFileContent.handler(
      { filePath: "board.canvas", content: "{}" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully");
  });

  it("allows .json files", () => {
    const result = updateFileContent.handler(
      { filePath: "data.json", content: "{}" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully");
  });
});

// -- Path length and depth limits --

describe("path length and depth limits", () => {
  it("rejects paths exceeding 512 characters", () => {
    const longName = "notes/" + "a".repeat(504) + ".md"; // 514 chars, shallow
    const result = updateFileContent.handler(
      { filePath: longName, content: "x" },
      extra
    );
    expect(result.content[0].text).toContain("maximum length");
  });

  it("rejects paths exceeding 10 levels of depth", () => {
    const deepPath = "a/b/c/d/e/f/g/h/i/j/k/file.md"; // 12 segments
    const result = updateFileContent.handler(
      { filePath: deepPath, content: "x" },
      extra
    );
    expect(result.content[0].text).toContain("maximum depth");
  });

  it("allows paths at exactly 10 levels of depth", () => {
    const okPath = "a/b/c/d/e/f/g/h/i/file.md"; // 10 segments
    const result = updateFileContent.handler(
      { filePath: okPath, content: "x" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully");
  });
});

// -- Symlinked parent directory prevention --

describe("symlinked parent directory prevention", () => {
  it("rejects writes through a symlinked parent directory", () => {
    const outsideDir = createTempVault();
    // Create a symlinked directory inside the vault pointing outside
    createSymlink(tmpDir, "linked-dir", outsideDir);

    const result = updateFileContent.handler(
      { filePath: "linked-dir/payload.md", content: "escaped" },
      extra
    );
    expect(result.content[0].text).toContain("symlinked directory");
    // Verify nothing was written outside
    expect(fs.existsSync(path.join(outsideDir, "payload.md"))).toBe(false);

    removeTempVault(outsideDir);
  });

  it("allows writes through regular subdirectories", () => {
    fs.mkdirSync(path.join(tmpDir, "real-dir"), { recursive: true });

    const result = updateFileContent.handler(
      { filePath: "real-dir/note.md", content: "safe" },
      extra
    );
    expect(result.content[0].text).toContain("Successfully");
  });
});
