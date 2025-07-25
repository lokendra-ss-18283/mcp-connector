import { createRequire } from "module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createLogger,
  FileLogger,
  logger as DefaultLogger,
} from "./file-logger.js";
import { createAuthProvider } from "../auth/auth-provider.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  McpProxyConfig,
  pendingInitErrors,
  proxyInstances,
} from "../proxy/mcp-proxy.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TokenManager } from "../auth/token-manager.js";
import { GLOBAL_SERVER_CONFIGS, HEADERS } from "../cli.js";
import { existsSync, readFileSync, rmSync } from "fs";
import { MCPServerConfig, TokensList } from "../types/index.js";
import { join } from "path";

export async function proxyConfig(server: MCPServerConfig) {
  let serverName = null;
  const url: string = server.url;
  const hash = TokenManager.hashUrl(url);
  if (GLOBAL_SERVER_CONFIGS && GLOBAL_SERVER_CONFIGS.has(hash)) {
    serverName = GLOBAL_SERVER_CONFIGS.get(hash)!.name || null;
  }
  const logger = serverName ? createLogger(serverName, hash) : DefaultLogger;

  if (proxyInstances.has(hash)) {
    const proxyInstance = proxyInstances.get(hash);
    const pendingInitError = pendingInitErrors.get(hash);
    if (proxyInstance && pendingInitError) {
      proxyInstance.transportToServer.send(pendingInitError);
      pendingInitErrors.delete(hash);
    }
  } else {
    const localTransport = new StdioServerTransport();
    logger.debug("STDIO transport created");

    // Create auth provider first
    const authProvider = await createAuthProvider(server);

    const clientTransport: Transport = new StreamableHTTPClientTransport(
      new URL(url),
      {
        authProvider: hasKeyInJson(HEADERS, "Authorization") ? undefined : authProvider,
        requestInit: {
          headers: HEADERS
        },
      }
    );

    await clientTransport.start();

    if (authProvider && typeof authProvider.setClientTransport === "function") {
      logger.debug("Setting client transport in auth provider");
      authProvider.setClientTransport(clientTransport);
      logger.debug("Client transport set successfully");
    } else {
      logger.warn("Auth provider does not have setClientTransport method");
    }

    proxyInstances.set(
      hash,
      McpProxyConfig({
        transportToClient: localTransport,
        transportToServer: clientTransport,
        logger,
        url,
      })
    );
    await localTransport.start();
  }
}
export async function getMCPConnectVersion() {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require("../../package.json");
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export const printHelperText = (logger: FileLogger): void => {
  console.info(`
Usage: npx mcp-connector [urls...] [options]

Arguments:
  urls                One or more MCP server URLs

Options:
  --config <path>     Path to configuration file (optional if URLs provided)
  --auth-port <port>  Authentication server port (default: 3001)
  --url-map          List all url hash map to access logs and tokens
  --list-tokens      List all saved authentication tokens
  --clean-tokens     Remove expired authentication tokens
  --clean-all        Remove all files in ~/.mcp-connector folder
  --help             Show this help message

Examples:
  npx mcp-connector http://localhost:3000
  npx mcp-connector --url-map
  npx mcp-connector --list-tokens
  npx mcp-connector --clean-tokens

Token Storage:
  Tokens are stored in ~/.mcp-connector/ directory
  Logs can be accessed in ~/.mcp-connector/logs directory
  Each token file is named with the SHA256 hash of the URL and stored in url-hash-map.json
  `);
};

export const listTokens = (tokenManager: TokenManager, logger: FileLogger) => {
  console.log("📋 Stored Authentication Tokens:\n");
  const tokens: TokensList[] = tokenManager.listTokens(true);

  if (tokens.length === 0) {
    console.log("No stored tokens found.");
    process.exit(0);
  }

  tokens.forEach((token, index) => {
    console.log(`${index + 1}. URL: ${token.url}`);
    console.log(
      `   Hash: ${token?.url ? TokenManager.hashUrl(token.url) : "null"}...`
    );
    console.log(
      `   Created: ${
        token.tokenDetails.createdAt
          ? new Date(token.tokenDetails.createdAt).toLocaleString()
          : "No Created Time Found"
      }`
    );
    if (token.tokenDetails.expires_in) {
      if (token.tokenDetails.createdAt) {
        console.log(
          `   Expires: ${new Date(
            +new Date(token.tokenDetails.createdAt) +
              token.tokenDetails.expires_in * 1000
          ).toLocaleString()}`
        );
      } else {
        console.log(`   Expires: ${token.tokenDetails.expires_in}ms`);
      }
    }
  });

  console.log(`\n📍 Token store location: ${tokenManager.getStorePath()}`);
};

export const clearAllData = (
  tokenManager: TokenManager,
  logger: FileLogger
) => {
  if (existsSync(tokenManager.getMcpConnectFolderPath())) {
    try {
      rmSync(tokenManager.getMcpConnectFolderPath(), {
        recursive: true,
        force: true,
      });
      console.log("🗑️ Removed all files and folders in ~/.mcp-connector");
    } catch (error) {
      console.log("Failed to remove ~/.mcp-connector:", error);
    }
  } else {
    console.log("No ~/.mcp-connector folder found to remove.");
  }
};

export const printUrlMap = (tokenManager: TokenManager, logger: FileLogger) => {
  const urls: Record<string, string> = tokenManager.getUrlInHashMapFile();
  const keys = Object.keys(urls);
  if (keys.length > 0) {
    console.log("🔗 URL Hash Map (SHA256 → URL):\n");
    for (const key of keys) {
      console.log(`🔑 ${key}  👉  ${urls[key]}`);
    }
    console.log(
      `\n📍 Map file location: ${tokenManager.getStorePath()}/url-hash-map.json`
    );
  } else {
    console.log("🚫 No URLs stored in url hashmap.");
  }
};

export const parseServerUrls = (args: string[], logger: FileLogger) => {
  let foundInlineConfig = false;

  let i = 0;
  while (i < args.length) {
    // Only support --inline-config {name} {url} {port(optional)}
    if (args[i] === "--inline-config" && args[i + 1] && args[i + 2]) {
      foundInlineConfig = true;
      const nameRaw = args[i + 1];
      const url = args[i + 2];
      let port: number | undefined = undefined;

      let name = nameRaw.replace(/[^a-zA-Z0-9-_ ]/g, "");
      name = name.replace(/ +/g, "-");
      
      if (!name) {
        console.error("❌ Invalid server name. Please provide a name containing only alphanumeric characters, hyphens, underscores, or spaces.");
        process.exit(1);
      }

      try {
        new URL(url);
      } catch {
        console.error(`❌ Invalid URL provided for inline config: "${url}". Please provide a valid http(s) URL.`);
        process.exit(1);
      }

      // Add port to config if present
      if (args[i + 3] && !isNaN(Number(args[i + 3]))) {
        port = Number(args[i + 3]);
        i += 4;
      } else {
        i += 3;
      }

      const serverConfig: MCPServerConfig =
        port !== undefined ? { name, url, port } : { name, url };

      GLOBAL_SERVER_CONFIGS.set(TokenManager.hashUrl(url), serverConfig);
      continue;
    }
    i += 1;
  }

  const urlArgs = args.filter(
    (arg) => arg.startsWith("http://") || arg.startsWith("https://")
  );
  const isFile = args.includes("--config");

  if (!foundInlineConfig && !isFile && urlArgs.length > 1) {
    console.error(
      "❌ Only a single URL is allowed as a CLI argument. For multiple servers, use a config file."
    );
    process.exit(1);
  }

  if (foundInlineConfig) {
    return;
  }

  const isConfig = args.includes("--config");
  const isServerName = args.includes("--server-name");
  if (
    !(
      isConfig &&
      args[args.indexOf("--config") + 1] &&
      isServerName &&
      args[args.indexOf("--server-name") + 1]
    )
  ) {
    console.error(
      "❌ The --config option requires a valid path to a JSON configuration file and a server name. Please specify both after --config and --server-name."
    );
    process.exit(1);
  }

  const getFile = args[args.indexOf("--config") + 1];
  const serverName = args[args.indexOf("--server-name") + 1];
  if (!serverName.trim()) {
    console.error(
      "❌ Please provide a valid server name after --server-name when using --config."
    );
    process.exit(1);
  }
  if (getFile.endsWith(".json") && existsSync(getFile)) {
    try {
      const fileConfig: Record<string, MCPServerConfig> = JSON.parse(
        readFileSync(join(getFile), "utf8")
      );

      const isServerPresentInConfig = hasKeyInJson(
        fileConfig,
        serverName.trim()
      );
      if (!isServerPresentInConfig) {
        console.error(
          `❌ No server configuration found for the server name "${serverName}" in the config file. Please check your --server-name argument and the contents of your config file.`
        );
        process.exit(1);
      }

      const getServerConfig = fileConfig[serverName];
      if (isValidMCPServerConfig(getServerConfig)) {
        const serverConfig: MCPServerConfig = {
          name: getServerConfig.name || serverName,
          url: getServerConfig.url,
        };
        if (getServerConfig.port && typeof getServerConfig.port === "number") {
          serverConfig.port = getServerConfig.port;
        }
        GLOBAL_SERVER_CONFIGS.set(
          TokenManager.hashUrl(serverConfig.url),
          serverConfig
        );
      } else {
        console.error(
          `❌ Invalid server configuration for "${serverName}" in the config file. Please ensure the server entry is correctly formatted and contains only valid keys (name, url, port).`
        );
        process.exit(1);
      }
    } catch (error) {
      console.log(
        "❌ Invalid configuration file. Please verify the file format and try again."
      );
      process.exit(1);
    }
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isValidMCPServerConfig(value: any): value is MCPServerConfig {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof value.url === "string"
    );
  } catch (error) {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isValidJson(value: any): Record<string, string> {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function removeArg(args: string[], key: string): string[] {
  const idx = args.indexOf(key);
  if (idx !== -1) {
    args.splice(idx, 2);
  }
  return args;
}

export function hasKeyInJson(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
