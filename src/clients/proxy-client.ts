import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createLogger, logger as DefaultLogger } from "../utils/file-logger.js";
import { DefaultAuthProvider } from "../auth/auth-provider.js";
import { hasKeyInJson } from "../utils/cli-util.js";
import { AUTH_CONSTANTS, ROOT_CONFIG } from "../constants/constants.js";
import { MCPServerConfig } from "../interface/interface.js";
import { TokenManager } from "../auth/token-manager.js";
import { McpProxy } from "../proxy/mcp-proxy.js";
import { TransportType } from "../constants/enum.js";

import { BaseClient } from "./client.js";

export class ProxyClient extends BaseClient {
  private transportType!: TransportType;
  private urlHash!: string;

  constructor(server: MCPServerConfig, transportType: TransportType) {
    const hash = TokenManager.hashUrl(server.url);
    let serverName = null;
    if (ROOT_CONFIG.servers && ROOT_CONFIG.servers.has(hash)) {
      serverName = ROOT_CONFIG.servers.get(hash)!.name || null;
    }
    const logger = serverName ? createLogger(serverName, hash) : DefaultLogger;
    super(server, logger);
    this.transportType = transportType;
    this.urlHash = hash;
  }

  async setup(): Promise<void> {
    const proxyInstance: McpProxy | undefined =
      AUTH_CONSTANTS.proxyInstances.get(this.urlHash);
    if (proxyInstance) {
      const pendingMsg = proxyInstance.unauthMsg;
      if (pendingMsg) {
        if (proxyInstance.retry >= ROOT_CONFIG.unauthRetries) {
          proxyInstance?.log.error(
            "[Client → Server] Re-authentication mechanism reached the maximum number of retries. Please check if there is a persistent 401 issue with the MCP server."
          );
          process.exit(1);
        }
        await proxyInstance?.auth?.startProxyServer();
        proxyInstance?.sendServerTransportMessage(pendingMsg);
        proxyInstance.unauthMsg = null;
      }
    } else {
      const localTransport = new StdioServerTransport();
      this.logger.debug("STDIO transport created");

      // Create auth provider first
      const authProvider = await DefaultAuthProvider.createAuthProvider(
        this.server
      );

      const clientTransport: Transport =
        this.transportType === TransportType.PROXY_HTTP
          ? new StreamableHTTPClientTransport(new URL(this.server.url), {
              authProvider: hasKeyInJson(ROOT_CONFIG.headers, "Authorization")
                ? undefined
                : authProvider,
              requestInit: {
                headers: ROOT_CONFIG.headers,
              },
            })
          : new SSEClientTransport(new URL(this.server.url), {
              authProvider: hasKeyInJson(ROOT_CONFIG.headers, "Authorization")
                ? undefined
                : authProvider,
              requestInit: {
                headers: ROOT_CONFIG.headers,
              },
            });

      await clientTransport.start();

      if (
        authProvider &&
        typeof authProvider.setClientTransport === "function"
      ) {
        this.logger.debug("Setting client transport in auth provider");
        authProvider.setClientTransport(clientTransport);
        this.logger.debug("Client transport set successfully");
      } else {
        this.logger.warn(
          "Auth provider does not have setClientTransport method"
        );
      }

      AUTH_CONSTANTS.proxyInstances.set(
        this.urlHash,
        new McpProxy({
          transportToClient: localTransport,
          transportToServer: clientTransport,
          logger: this.logger,
          url: this.server.url,
          authProvider,
        })
      );
      await localTransport.start();
    }
  }
}
