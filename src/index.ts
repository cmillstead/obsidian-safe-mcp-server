import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readTools } from "./read.js";
import { writeTools } from "./write.js";
import { validateVaultPath } from "./utils.js";

export const server = new McpServer({
  name: "obsidian-notes",
  version: "1.0.0",
});

const _vaultPath: string = validateVaultPath(process.argv[2]);
export function getVaultPath(): string {
  if (!_vaultPath) {
    throw new Error("Vault path is not configured.");
  }
  return _vaultPath;
}

[...readTools, ...writeTools].forEach((tool) => {
  server.tool(tool.name, tool.description, tool.schema, tool.handler);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Obsidian MCP Server running on stdio (using vault path: ${_vaultPath})`
  );
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
