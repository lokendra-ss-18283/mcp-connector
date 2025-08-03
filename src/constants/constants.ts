import { ProxyClient } from "../clients/proxy-client.js";
import {
  AuthConstants,
  MCPServerConfig,
  OAuthState,
  RootConfig,
} from "../interface/interface.js";

import { TransportType } from "./enum.js";

export const AUTH_CONSTANTS: AuthConstants = {
  globalStateStore: new Map<string, OAuthState>(),
  globalStateStoreCompleted: new Map<string, OAuthState>(),
  codeVerifierStore: new Map<string, string>(),
  msgStalledByAuth: new Map(),
  proxyInstances: new Map(),
};

export const ROOT_CONFIG: RootConfig = {
  unauthRetries: 3,
  headers: {},
  servers: new Map<string, MCPServerConfig>(),
  transportType: TransportType.PROXY_HTTP,
};

export let DEBUG_MODE: boolean = false;
export let MCP_CONNECT_VERSION: string;

// constants setters
export const setMcpConnectVersion = (version: string) =>
  (MCP_CONNECT_VERSION = version);
export const setDebugMode = (debugMode: boolean) => (DEBUG_MODE = debugMode);
export const setHeaders = (headers: Record<string, string>) =>
  (ROOT_CONFIG.headers = headers);
export const setTransportType = (transportType: TransportType) =>
  (ROOT_CONFIG.transportType = transportType);

export const TransportClientClassMap = {
  [TransportType.PROXY_HTTP]: ProxyClient,
  [TransportType.PROXY_SSE]: ProxyClient,
};
