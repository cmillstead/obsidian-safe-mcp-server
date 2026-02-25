# Obsidian MCP Server

A lightweight [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that enables AI assistants like Cursor & Claude to read from and write to your Obsidian vault.

## Example Interactions

- "Create a new note for standup tomorrow describing the code changes I've made today" (should also use Git)
- "Check my notes about project ideas"
- "Check what todos I have related to refactoring"

## Tools

### Read

1. **getAllFilenames**

   - Gets a list of all filenames in the Obsidian vault, sorted by most recently modified
   - Useful for discovering what files are available

2. **readMultipleFiles**

   - Retrieves the contents of specified files from the Obsidian vault
   - Supports exact filenames, partial filenames, or case-insensitive matches
   - Each file's content is prefixed with '# File: filename' for clear identification
   - Limited to 50 filenames per request

3. **getOpenTodos**

   - Retrieves all open TODO items from markdown files in the Obsidian vault
   - Finds unchecked checkbox items (lines containing '- [ ] ')
   - Returns them with their file locations

### Write

1. **updateFileContent**
   - Updates the content of a specified file in the Obsidian vault with new markdown content
   - If the file doesn't exist, it will be created
   - Automatically creates any necessary directories
   - Content limited to 1MB per write

## Security

All file operations are confined to the vault directory. The threat model assumes the connected AI assistant could be manipulated, so all tool inputs are treated as untrusted:

- **Path traversal protection** — all read and write operations resolve and validate paths to prevent escaping the vault (e.g. `../../etc/passwd` is rejected). Null bytes in paths are rejected to prevent path truncation attacks.
- **Symlink safety** — symlink files are excluded from all read operations. Writes use `O_NOFOLLOW` to atomically reject symlinks, eliminating TOCTOU race conditions. Parent directories are also checked for symlinks to prevent writes through symlinked intermediate directories.
- **Dotfile/dotdir protection** — writes to dot-prefixed paths are blocked, preventing code injection via `.obsidian/plugins/`, `.git/hooks/`, or other hidden directories.
- **File extension allowlist** — only safe file types can be written (`.md`, `.txt`, `.csv`, `.json`, `.yaml`, `.yml`, `.canvas`). Executable extensions like `.js`, `.sh`, `.py`, `.html` are rejected.
- **Vault path validation** — the vault path is validated at startup to ensure it is an existing directory, resolved to an absolute real path. The path is immutable after startup.
- **Input limits** — file reads are limited to 50 filenames per request, individual file reads are capped at 10MB, writes are limited to 1MB, file paths are capped at 512 characters and 10 levels of depth, and partial filename matches are capped at 5 results per query.
- **Error sanitization** — error messages returned to the client do not expose filesystem paths or system details. Unexpected errors are logged to stderr and a generic message is returned.

## Install & Build

```bash
npm install
npm run build
```

## Testing

```bash
npm test
```

The test suite (61 tests) covers path traversal prevention, symlink rejection, dotfile write blocking, extension allowlisting, path length/depth limits, symlinked parent directory prevention, input validation limits, vault path validation, and all read/write tool behaviors.

## Integrating with Claude Desktop and Cursor

To use your MCP server with Claude Desktop add it to your Claude configuration:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": [
        "obsidian-mcp-server/build/index.js",
        "/path/to/your/vault"
      ]
    }
  }
}
```

For Cursor go to the MCP tab `Cursor Settings` (command + shift + J). Add a server with this command:

```bash
node obsidian-mcp-server/build/index.js /path/to/your/vault
```

## Comparison with Other Solutions

While this implementation is intentionally lightweight, other solutions like [jacksteamdev/obsidian-mcp-tools](https://github.com/jacksteamdev/obsidian-mcp-tools) offer a more feature-rich approach as an Obsidian plugin.

This standalone server has the advantage of direct filesystem access without requiring the Obsidian application to be running.

## Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
