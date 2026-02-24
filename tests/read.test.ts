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

// Import after the mock so the mock is in place when modules load
const { getAllFilenames, readFiles, getOpenTodos } = await import(
  "../src/read.js"
);

const extra = {} as any;

let tmpDir: string;

beforeEach(() => {
  tmpDir = createTempVault();
  mockVaultPath = tmpDir;
});

afterEach(() => {
  removeTempVault(tmpDir);
});

// -- getAllFilenames (direct, no mock needed) --

describe("getAllFilenames", () => {
  it("returns all files in a flat directory", () => {
    createFile(tmpDir, "a.md", "a");
    createFile(tmpDir, "b.txt", "b");
    createFile(tmpDir, "c.md", "c");

    const result = getAllFilenames(tmpDir);
    expect(result).toHaveLength(3);
    expect(result).toContain("a.md");
    expect(result).toContain("b.txt");
    expect(result).toContain("c.md");
  });

  it("returns files sorted by mtime (most recent first)", () => {
    createFile(tmpDir, "old.md", "old");
    createFile(tmpDir, "mid.md", "mid");
    createFile(tmpDir, "new.md", "new");

    const now = Date.now();
    fs.utimesSync(path.join(tmpDir, "old.md"), new Date(now - 3000), new Date(now - 3000));
    fs.utimesSync(path.join(tmpDir, "mid.md"), new Date(now - 2000), new Date(now - 2000));
    fs.utimesSync(path.join(tmpDir, "new.md"), new Date(now - 1000), new Date(now - 1000));

    const result = getAllFilenames(tmpDir);
    expect(result[0]).toBe("new.md");
    expect(result[2]).toBe("old.md");
  });

  it("returns nested files with relative paths", () => {
    createFile(tmpDir, "sub/deep/file.md", "deep");

    const result = getAllFilenames(tmpDir);
    expect(result).toContain("sub/deep/file.md");
  });

  it("excludes dotfiles and files in dot directories", () => {
    createFile(tmpDir, ".hidden", "hidden");
    createFile(tmpDir, ".obsidian/config", "config");
    createFile(tmpDir, "visible.md", "visible");

    const result = getAllFilenames(tmpDir);
    expect(result).toEqual(["visible.md"]);
  });

  it("excludes symlink files", () => {
    createFile(tmpDir, "real.md", "real");
    createSymlink(tmpDir, "link.md", path.join(tmpDir, "real.md"));

    const result = getAllFilenames(tmpDir);
    expect(result).toContain("real.md");
    expect(result).not.toContain("link.md");
  });

  it("does not follow symlinked directories", () => {
    const outsideDir = createTempVault();
    createFile(outsideDir, "secret.md", "secret");
    createSymlink(tmpDir, "linked-dir", outsideDir);

    const result = getAllFilenames(tmpDir);
    expect(result.some((f: string) => f.includes("secret"))).toBe(false);

    removeTempVault(outsideDir);
  });

  it("returns empty array for empty directory", () => {
    const result = getAllFilenames(tmpDir);
    expect(result).toEqual([]);
  });
});

// -- readMultipleFiles tool handler --

describe("readMultipleFiles handler", () => {
  it("reads a file by exact name", () => {
    createFile(tmpDir, "notes/hello.md", "hello world");

    const result = readFiles.handler({ filenames: ["notes/hello.md"] }, extra);
    expect(result.content[0].text).toContain("# File: notes/hello.md");
    expect(result.content[0].text).toContain("hello world");
  });

  it("reads a file by case-insensitive name", () => {
    createFile(tmpDir, "Notes/Hello.md", "case test");

    const result = readFiles.handler({ filenames: ["notes/hello.md"] }, extra);
    expect(result.content[0].text).toContain("case test");
  });

  it("reads a file by partial name match", () => {
    createFile(tmpDir, "2024-01-15-meeting-notes.md", "meeting content");

    const result = readFiles.handler({ filenames: ["meeting"] }, extra);
    expect(result.content[0].text).toContain("meeting content");
  });

  it("returns 'File not found' for non-existent file", () => {
    createFile(tmpDir, "exists.md", "here");

    const result = readFiles.handler(
      { filenames: ["nonexistent.md"] },
      extra
    );
    expect(result.content[0].text).toContain("File not found in vault");
  });

  it("returns 'No matching files' when given empty filenames array", () => {
    const result = readFiles.handler({ filenames: [] }, extra);
    expect(result.content[0].text).toBe("No matching files found in the vault.");
  });

  it("handles multiple filenames in one call", () => {
    createFile(tmpDir, "a.md", "content a");
    createFile(tmpDir, "b.md", "content b");

    const result = readFiles.handler({ filenames: ["a.md", "b.md"] }, extra);
    expect(result.content[0].text).toContain("content a");
    expect(result.content[0].text).toContain("content b");
  });

  it("rejects filenames array exceeding 50 items via zod schema", () => {
    const schema = z.object(readFiles.schema);
    const input = { filenames: Array(51).fill("x.md") };
    expect(() => schema.parse(input)).toThrow();
  });

  it("accepts filenames array of exactly 50 items", () => {
    const schema = z.object(readFiles.schema);
    const input = { filenames: Array(50).fill("x.md") };
    expect(() => schema.parse(input)).not.toThrow();
  });
});

// -- getOpenTodos tool handler --

describe("getOpenTodos handler", () => {
  it("finds open TODOs in markdown files", () => {
    createFile(
      tmpDir,
      "tasks.md",
      "- [ ] Buy groceries\n- [x] Done task\n- [ ] Call dentist"
    );

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).toContain("Buy groceries");
    expect(result.content[0].text).toContain("Call dentist");
    expect(result.content[0].text).not.toContain("Done task");
  });

  it("returns count in header", () => {
    createFile(
      tmpDir,
      "tasks.md",
      "- [ ] One\n- [ ] Two"
    );

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).toContain("(2 items)");
  });

  it("includes file path in each TODO line", () => {
    createFile(tmpDir, "tasks.md", "- [ ] Do something");

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).toContain("**tasks.md**");
  });

  it("finds TODOs across multiple files", () => {
    createFile(tmpDir, "a.md", "- [ ] From A");
    createFile(tmpDir, "b.md", "- [ ] From B1\n- [ ] From B2");

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).toContain("(3 items)");
    expect(result.content[0].text).toContain("From A");
    expect(result.content[0].text).toContain("From B1");
    expect(result.content[0].text).toContain("From B2");
  });

  it("returns 'No open TODOs' for vault with no TODOs", () => {
    createFile(tmpDir, "clean.md", "All done!");

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).toBe(
      "No open TODOs found in the vault."
    );
  });

  it("ignores TODOs inside symlinked files", () => {
    const outsideDir = createTempVault();
    createFile(outsideDir, "todo.md", "- [ ] sneaky");
    createSymlink(tmpDir, "linked.md", path.join(outsideDir, "todo.md"));

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).not.toContain("sneaky");

    removeTempVault(outsideDir);
  });

  it("ignores TODOs in files inside symlinked directories", () => {
    const outsideDir = createTempVault();
    createFile(outsideDir, "todo.md", "- [ ] hidden");
    createSymlink(tmpDir, "linked-dir", outsideDir);

    const result = getOpenTodos.handler({}, extra);
    expect(result.content[0].text).not.toContain("hidden");

    removeTempVault(outsideDir);
  });
});
