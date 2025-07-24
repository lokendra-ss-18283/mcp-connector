#!/usr/bin/env node

import { TokenManager } from "./auth/token-manager.js";
import { MCPServerConfig } from "./types/index.js";
import { logger } from "./utils/file-logger.js";
import {
  clearAllData,
  getMCPConnectVersion,
  isValidJson,
  listTokens,
  parseServerUrls,
  printHelperText,
  printUrlMap,
  proxyConfig,
  removeArg,
} from "./utils/cli-util.js";
import { cleanupOnExit, onProcessStart } from "./utils/process-util.js";

interface CLIConfig {
  servers: MCPServerConfig[];
  auth?: {
    port?: number;
    secretKey?: string;
    required?: boolean;
  };
  client?: {
    maxRetries?: number;
    retryDelay?: number;
    streamingEnabled?: boolean;
  };
}

export const GLOBAL_SERVER_CONFIGS: Map<string, MCPServerConfig> = new Map<
  string,
  MCPServerConfig
>();

export let DEBUG_MODE: boolean = false;
export let MCP_CONNECT_VERSION : string;

export let HEADERS: Record<string, string> = {};

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
  MCP_CONNECT_VERSION = await getMCPConnectVersion();
  HEADERS = {
    "user-agent": `mcp-connector/${MCP_CONNECT_VERSION}`,
  }

  onProcessStart();
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelperText(logger);
    process.exit(0);
  }

  // Handle token management commands
  const tokenManager = new TokenManager(logger);

  if (args.includes("--list-tokens")) {
    listTokens(tokenManager, logger);
    process.exit(0);
  }

  if (args.includes("--clean-tokens")) {
    tokenManager.cleanExpiredTokens();
    logger.info("🧹 Cleaning expired tokens...");
    process.exit(0);
  }

  if (args.includes("--clean-all")) {
    clearAllData(tokenManager, logger);
    process.exit(0);
  }

  if (args.includes("--url-map")) {
    printUrlMap(tokenManager, logger);
    process.exit(0);
  }

  // Remove debug argument from args list.
  DEBUG_MODE = args.includes("--debug") || args.includes("-d");
  if (DEBUG_MODE) {
    removeArg(args, "--debug");
    removeArg(args, "--d");
  }

  const hasUrl = args.includes("--inline-config");
  const hasConfig = args.includes("--config");
  if (!hasUrl && !hasConfig) {
    console.error(
      "❌ You must pass either --inline-config or --config to start the MCP server."
    );
    process.exit(1);
  }

  if (hasUrl && hasConfig) {
    console.error(
      "❌ Please pass only one of --inline-config or --config, not both."
    );
    process.exit(1);
  }

  const hasHeaders = args.includes("--headers");
  const headersIndex = hasHeaders ? args[args.indexOf("--headers") + 1] : "";
  if(hasHeaders && headersIndex) {
    const headers = isValidJson(headersIndex);
    HEADERS = {...HEADERS, ...headers}
    removeArg(args, "--headers");
    removeArg(args, headersIndex);
  }

  try {
    console.info("🚀 Starting MCP Connect...\n");

    // Parse server URLs from arguments
    const argStartIndex = hasUrl
      ? args.indexOf("--inline-config")
      : args.indexOf("--config");
    parseServerUrls(args.slice(argStartIndex), logger);
    const serverUrls = Array.from(GLOBAL_SERVER_CONFIGS.values());

    // Load configuration
    const config = await loadConfig(serverUrls);

    if (config.servers.length === 0) {
      logger.error(
        "❌ No servers configured. Please provide URLs or use --config option."
      );
      printHelperText(logger);
      return;
    }

    await Promise.allSettled(
      config.servers.map((server) => {
        logger.debug("Current MCP server configuration", server);
        proxyConfig(server);
      })
    );
  } catch (error) {
    console.log(error);

    logger.error("💥 Fatal error:", error);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  cleanupOnExit();
  console.log("👋 Goodbye!");
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupOnExit();
  console.log("👋 Goodbye!");
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
