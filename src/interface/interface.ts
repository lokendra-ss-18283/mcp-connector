import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { FileLogger } from "../utils/file-logger.js";
import { McpProxy } from "../proxy/mcp-proxy.js";
import { TransportType } from "../constants/enum.js";

export interface MCPServerConfig {
  name: string;
  url: string; // Now supports http://, https://
  port?: number;
}

export interface TokenSchema extends OAuthTokens {
  createdAt?: number;
}

export interface TokensList {
  tokenDetails: TokenSchema;
  url: string;
}

export interface CLIConfig {
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

export interface OAuthState {
  timestamp: number;
  url: string;
}

export interface OAuthProxyOptions {
  port?: number;
  timeout?: number;
  maxRetries?: number;
  clientTransport: Transport;
  logger: FileLogger;
}

export interface AuthConstants {
  globalStateStore: Map<string, OAuthState>;
  globalStateStoreCompleted: Map<string, OAuthState>;
  codeVerifierStore: Map<string, string>;
  msgStalledByAuth: Map<string, JSONRPCMessage>;
  proxyInstances: Map<string, McpProxy>;
}

export interface RootConfig {
  headers: Record<string, string>;
  servers: Map<string, MCPServerConfig>;
  unauthRetries: number;
  transportType: TransportType;
}
