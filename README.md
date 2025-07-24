# MCP Connect

**MCP Connect** is a CLI tool and proxy server for the [Model Context Protocol](https://github.com/modelcontextprotocol) (MCP), providing secure, streamable HTTP transport with OAuth authentication support.

---

## Features

- 🔒 OAuth2 PKCE authentication flow
- 🔗 Streamable HTTP proxy for MCP clients
- 🛠️ CLI for managing tokens, logs, and server connections
- 📦 Token storage and management in `~/.mcp-connector`
- 📝 Easy integration with the MCP SDK
- 🖥️ Native OS dialogs for authentication (macOS, Windows, Linux)
- 📋 Automatic browser launch or copy OAuth URL to clipboard
- 🧹 Cleanup logic for tokens, logs, and server state
- 🏷️ **Static headers support:** Add static headers (including `Authorization`) to MCP server requests. If an `Authorization` header is present, it will be used as static authentication and OAuth 2.1 will not be triggered.

---

## Installation

```bash
npm install -g mcp-connector
```

Or use with `npx`:

```bash
npx mcp-connector [options]
```

---

## Usage

```bash
mcp-connector [options]
```

### Options

| Option                | Description                                               |
|-----------------------|----------------------------------------------------------|
| `--config <path> --server-name <name>`     | Path to configuration file and the server name to start    |
| `--inline-config <name> <url> <port>`       | Inline configuration of the MCP server                    |
| `--headers <json>`    | Add static headers to MCP server requests (JSON format). If the headers include an `Authorization` header, it will be used as static authentication and OAuth 2.1 will not be triggered.  |
| `--url-map`           | List all URL hash mappings to access logs and tokens     |
| `--list-tokens`       | List all saved authentication tokens                     |
| `--clean-tokens`      | Remove expired authentication tokens                     |
| `--clean-all`         | Remove all files in the `~/.mcp-connector` folder          |
| `--help` or `-h`      | Show this help message                                   |
| `--debug` or `-d`     | Enable debug mode                                        |

### Examples

```bash
# CLI usage documentation
npx mcp-connector --help
npx mcp-connector -h

# Connect to a single MCP server
npx mcp-connector --inline-config mcp-connector-server http://localhost:3000

# Connect using a config file
npx mcp-connector --config ./my-config.json --server-name mcp-connector-server

# Connect to a server with headers
npx mcp-connector --inline-config mcp-connector-server http://localhost:3000 --headers '{"header1":"value1","header2":"value2"}'

# List all URL hash mappings
npx mcp-connector --url-map

# List all stored tokens
npx mcp-connector --list-tokens

# Clean expired tokens
npx mcp-connector --clean-tokens

# Remove all MCP Connect data
npx mcp-connector --clean-all

# Enable debug mode
npx mcp-connector --debug [--options]
```

---

## Configuration

### Using CLI Arguments

You can specify servers directly:
```bash
npx mcp-connector --inline-config mcp-connector-server http://localhost:3000
```

### Using a Config File

Example `my-config.json`:
```bash
{
  "server-name": { 
    "name": "local", # If not provided, the object key will be used as the server name
    "url": "http://localhost:3000",
    "port": 8080 # OAuth callback port (optional)
  }
}
```

---

## Token & Log Storage

- Tokens and logs are stored in `~/.mcp-connector/{server_hash}/`
- Each token file is named with the SHA256 hash of the URL and mapped in `url-hash-map.json`

---

## Authentication Flow

- When authentication is required, MCP Connect will:
  - Show a native OS dialog (macOS, Windows, Linux) to guide you through OAuth.
  - Open the browser automatically or copy the OAuth URL to your clipboard.
  - Wait for authentication to complete (timeout: 5 minutes).
  - Store tokens securely in `~/.mcp-connector/{server_hash}/`.

---

## Cleanup Logic

On process exit (`SIGINT`, `SIGTERM`), MCP Connect will:
- 🛑 Close all proxy transports.
- 🧹 Clean up pending initialization errors.
- 🗑️ Clear global state stores.
- 🧽 Clean expired tokens.
- 📴 Stop the OAuth proxy server.
- 🗂️ Clear server configs.

---

## Development

```bash
npm install
npm run build
npm run build:watch # Start the TypeScript watcher
```

---

## Troubleshooting

- **Fetch failed:**  
  - Ensure the MCP server URL is correct and reachable.
  - Check for SSL certificate issues.
  - Make sure the server is running and listening on the correct port.

- **Dialog/Clipboard issues:**  
  - Make sure required OS utilities (`osascript`, `powershell`, `zenity`, `pbcopy`, `clip`, `xclip`, `xsel`) are available.

---

## License

MIT

---

## Author

[slokendra2102@gmail.com](mailto:slokendra2102@gmail.com)

---

## Contributing

Pull requests and issues are welcome!