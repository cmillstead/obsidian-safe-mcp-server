import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { tool } from "./types.js";
import { getVaultPath } from "./index.js";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { getAllFilenames } from "./read.js";
import {
  assertNoNullBytes,
  assertInsideVault,
  assertNoDotPaths,
  assertAllowedExtension,
  assertPathLimits,
  assertNoSymlinkedParents,
} from "./utils.js";

export const updateFileContent: tool<{
  filePath: z.ZodString;
  content: z.ZodString;
}> = {
  name: "updateFileContent",
  description:
    "Updates the content of a specified file in the Obsidian vault with new markdown content. If the file doesn't exist, it will be created. The tool accepts a file path (relative to the vault root) and the new content to write to the file. Note: if updating an existing file, you need to include both the old and new content in a single Markdown string.",
  schema: {
    filePath: z
      .string()
      .describe("The path of the file to update, relative to the vault root"),
    content: z.string().max(1_000_000).describe("The markdown content to write to the file"),
  },
  handler: (args, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
    const { filePath, content } = args;

    try {
      const vaultPath = getVaultPath();
      assertNoNullBytes(filePath);
      assertNoDotPaths(filePath);
      assertAllowedExtension(filePath);
      assertPathLimits(filePath);

      const resolvedVault = path.resolve(vaultPath);
      const fullPath = path.resolve(resolvedVault, filePath);

      // Must be strictly inside the vault — not the vault root itself
      assertInsideVault(fullPath, resolvedVault);

      const allFiles = getAllFilenames(vaultPath);
      const fileExists = allFiles.includes(filePath);

      const dirPath = path.dirname(fullPath);

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Verify no parent directory is a symlink (prevents vault escape
      // through symlinked intermediate directories)
      assertNoSymlinkedParents(fullPath, resolvedVault);

      // Use O_NOFOLLOW to atomically reject symlinks at write time,
      // closing the TOCTOU race between a stat check and the write.
      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC |
        fs.constants.O_NOFOLLOW;
      const fd = fs.openSync(fullPath, flags, 0o644);
      try {
        fs.writeFileSync(fd, content, "utf8");
      } finally {
        fs.closeSync(fd);
      }

      return {
        content: [
          {
            type: "text",
            text: fileExists
              ? `Successfully updated existing file: ${filePath}`
              : `Successfully created new file: ${filePath}`,
          },
        ],
      };
    } catch (error) {
      // Return symlink-specific message for ELOOP (O_NOFOLLOW on a symlink)
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ELOOP") {
        return {
          content: [
            {
              type: "text",
              text: "Error: Cannot write to a symbolic link.",
            },
          ],
        };
      }

      // Surface our own validation errors
      if (error instanceof Error && (
        error.message === "File path contains null bytes." ||
        error.message === "File path escapes the vault directory." ||
        error.message === "Cannot write to dot-prefixed files or directories." ||
        error.message === "Cannot write through a symlinked directory." ||
        error.message.startsWith("File extension") ||
        error.message.startsWith("File path exceeds")
      )) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
        };
      }

      // Generic message for all other errors — don't leak system details
      console.error("Write failed:", error);
      return {
        content: [
          {
            type: "text",
            text: "Error: Failed to write file.",
          },
        ],
      };
    }
  },
};

export const writeTools = [updateFileContent];
