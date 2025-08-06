#!/usr/bin/env node

import { TokenManager } from "./auth/token-manager.js";
import { CLIConfig, MCPServerConfig } from "./interface/interface.js";
import { logger } from "./utils/file-logger.js";
import {
  clearAllData,
  getMCPConnectVersion,
  isValidJson,
  listTokens,
  parseServerUrls,
  printHelperText,
  printUrlMap,
  removeArg,
} from "./utils/cli-util.js";
import { cleanupOnExit, onProcessStart } from "./utils/process-util.js";
import {
  DEBUG_MODE,
  ROOT_CONFIG,
  setDebugMode,
  setHeaders,
  setMcpConnectVersion,
  setTransportType,
  TransportClientClassMap,
} from "./constants/constants.js";
import { getTransportType } from "./utils/enum-utils.js";
import { TransportType } from "./constants/enum.js";

async function loadConfig(serverUrls: MCPServerConfig[]): Promise<CLIConfig> {
  // If URLs provided via args, use them instead of config file
  if (serverUrls.length > 0) {
    return {
      servers: serverUrls,
    };
  }

  logger.error("Invalid server configuration");
  process.exit(1);
}

async function main(): Promise<void> {
  const MCP_CONNECT_VERSION = await getMCPConnectVersion();
  setMcpConnectVersion(MCP_CONNECT_VERSION);

  setHeaders({
    "user-agent": `mcp-connector/${MCP_CONNECT_VERSION}`,
  });

  onProcessStart();
  const args: Array<string> = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`mcp-connector version: ${MCP_CONNECT_VERSION}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelperText();
    process.exit(0);
  }

  // Handle token management commands
  const tokenManager = new TokenManager(logger);

  if (args.includes("--list-tokens")) {
    listTokens(tokenManager);
    process.exit(0);
  }

  if (args.includes("--clean-tokens")) {
    tokenManager.cleanExpiredTokens();
    logger.info("🧹 Cleaning expired tokens...");
    process.exit(0);
  }

  if (args.includes("--clean-all")) {
    clearAllData(tokenManager);
    process.exit(0);
  }

  if (args.includes("--url-map")) {
    printUrlMap(tokenManager);
    process.exit(0);
  }

  // Remove debug argument from args list.
  setDebugMode(args.includes("--debug") || args.includes("-d"));
  if (DEBUG_MODE) {
    removeArg(args, "--debug");
    removeArg(args, "--d");
  }

  const hasUrl = args.includes("--inline-config");
  const hasConfig = args.includes("--config");
  if (!hasUrl && !hasConfig) {
    logger.error(
      "❌ You must pass either --inline-config or --config to start the MCP server."
    );
    process.exit(1);
  }

  if (hasUrl && hasConfig) {
    logger.error(
      "❌ Please pass only one of --inline-config or --config, not both."
    );
    process.exit(1);
  }

  // Validate transport type and remove it from args
  const transportType: TransportType = getTransportType(args);
  setTransportType(transportType);
  removeArg(args, transportType);

  const hasHeaders = args.includes("--headers");
  const headersIndex = hasHeaders ? args[args.indexOf("--headers") + 1] : "";
  if (hasHeaders && headersIndex) {
    const headers = isValidJson(headersIndex);
    setHeaders({ ...headers, ...headers });
    removeArg(args, "--headers");
    removeArg(args, headersIndex);
  }

  try {
    logger.info("🚀 Starting MCP Connector...\n");

    // Parse server URLs from arguments
    const argStartIndex = hasUrl
      ? args.indexOf("--inline-config")
      : args.indexOf("--config");
    parseServerUrls(args.slice(argStartIndex), logger);
    const serverUrls = Array.from(ROOT_CONFIG.servers.values());

    // Load configuration
    const config = await loadConfig(serverUrls);

    if (config.servers.length === 0) {
      logger.error(
        "❌ No servers configured. Please provide URLs or use --config option."
      );
      printHelperText();
      return;
    }

    await Promise.allSettled(
      config.servers.map(async (server) => {
        logger.debug("Current MCP server configuration", server);
        const clientClass = TransportClientClassMap[transportType];
        if (clientClass) {
          const clientInstance = new clientClass(server, transportType);
          await clientInstance.setup();
        }
      })
    );
  } catch (error) {
    logger.error("💥 Fatal error:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  cleanupOnExit();
  logger.info("👋 Goodbye!");
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupOnExit();
  logger.info("👋 Goodbye!");
  process.exit(0);
});

process.on("exit", () => {
  cleanupOnExit();
});

// Handle unhandled rejections
process.on("unhandledRejection", (reason) => {
  logger.error(
    "🚨 Unhandled Rejection:",
    reason instanceof Error ? reason.stack || reason.message : reason
  );
  process.exit(1);
});

main().catch((error) => {
  logger.error(
    "💥 CLI error:",
    error instanceof Error ? error.stack || error.message : error
  );
  process.exit(1);
});
