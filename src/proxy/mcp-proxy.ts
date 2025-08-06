import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  JSONRPCMessage,
  JSONRPCRequest,
  InitializeRequest,
  isJSONRPCRequest,
  isJSONRPCResponse,
  JSONRPCResponse,
  isJSONRPCError,
  JSONRPCError,
  isJSONRPCNotification,
  JSONRPCNotification,
} from "@modelcontextprotocol/sdk/types.js";

import { FileLogger } from "../utils/file-logger.js";
import { TokenManager } from "../auth/token-manager.js";
import { hasKeyInJson } from "../utils/cli-util.js";
import { DefaultAuthProvider } from "../auth/auth-provider.js";
import { AUTH_CONSTANTS, ROOT_CONFIG } from "../constants/constants.js";

export class McpProxy {
  private transportToClient: Transport;
  private transportToServer: Transport;
  private logger: FileLogger;
  private url: string;
  private authProvider?: DefaultAuthProvider;
  private transportToClientClosed = false;
  private transportToServerClosed = false;
  private currentRetry: number = 0; // For 401 while connecting to server initially
  private currentRefreshRetry: number = 0; // For 401 while connecting to server via refresh token initially
  private stalledMsgByUnAuth: JSONRPCMessage | null = null;

  constructor({
    transportToClient,
    transportToServer,
    logger,
    url,
    authProvider,
  }: {
    transportToClient: Transport;
    transportToServer: Transport;
    logger: FileLogger;
    url: string;
    authProvider?: DefaultAuthProvider;
  }) {
    this.transportToClient = transportToClient;
    this.transportToServer = transportToServer;
    this.logger = logger;
    this.url = url;
    this.authProvider = authProvider;

    this.setupListeners();
  }

  // --- Getters ---
  public get clientTransport(): Transport {
    return this.transportToClient;
  }

  public get serverTransport(): Transport {
    return this.transportToServer;
  }

  public get log(): FileLogger {
    return this.logger;
  }

  public get proxyUrl(): string {
    return this.url;
  }

  public get auth(): DefaultAuthProvider | undefined {
    return this.authProvider;
  }

  public get isClientClosed(): boolean {
    return this.transportToClientClosed;
  }

  public get isServerClosed(): boolean {
    return this.transportToServerClosed;
  }

  public get retry(): number {
    return this.currentRetry;
  }

  public get unauthMsg(): JSONRPCMessage | null {
    return this.stalledMsgByUnAuth;
  }

  public get refreshRetry(): number {
    return this.currentRefreshRetry;
  }

  // --- Setters ---
  public set retry(value: number) {
    this.currentRetry = value;
  }

  public set unauthMsg(msg: JSONRPCMessage | null) {
    this.stalledMsgByUnAuth = msg;
  }

  public set refreshRetry(value: number) {
    this.currentRefreshRetry = value;
  }

  private setupListeners() {
    this.transportToClient.onmessage = (_message) => {
      const message = _message as JSONRPCRequest;
      this.logger.info(
        `[Client → Server] Method: ${message.method || "unknown"} | ID: ${
          message.id ?? "none"
        }`
      );

      this.logger.debug(`[Client → Server] Full Message:`, {
        method: message.method,
        id: message.id,
        params: message.params
          ? JSON.stringify(message.params).substring(0, 500)
          : undefined,
      });

      if (message.method === "initialize" && message.params) {
        const initMsg = message as unknown as InitializeRequest;
        const { clientInfo } = initMsg.params;
        if (clientInfo)
          clientInfo.name = `${clientInfo.name} (via mcp-connector)`;
        this.logger.info(
          `[Client → Server] Initialization: ${JSON.stringify(
            message,
            null,
            2
          )}`
        );

        this.logger.debug(`[Client → Server] Modified Client Info:`, {
          clientInfo,
        });
      }

      this.sendServerTransportMessage(message);
    };

    this.transportToServer.onmessage = (_message) => {
      const message = _message as JSONRPCMessage;

      this.logger.debug(
        `[Server → Client] :: Message :: ${JSON.stringify(message)}`
      );

      if (isJSONRPCRequest(message)) {
        const request = message as unknown as JSONRPCRequest;
        this.logger.info(
          `[Server → Client] : JSONRPCRequest → Method: ${
            request.method || "unknown"
          } | ID: ${message.id ?? "none"}`
        );
      }

      if (isJSONRPCResponse(message)) {
        const response = message as unknown as JSONRPCResponse;
        this.logger.info(
          `[Server → Client] : JSONRPCResponse → Result: ${
            response.result ? "present" : "absent"
          } | ID: ${response.id ?? "none"}`
        );
      }

      if (isJSONRPCError(message)) {
        const error = message as unknown as JSONRPCError;
        this.logger.info(
          `[Server → Client] : JSONRPCError → Error: ${
            error.error ? JSON.stringify(error.error) : "none"
          } | ID: ${error.id ?? "none"}`
        );
      }

      if (isJSONRPCNotification(message)) {
        const notitfication = message as unknown as JSONRPCNotification;
        this.logger.info(
          `[Server → Client] : JSONRPCNotification → Method: ${
            notitfication.method || "unknown"
          }`
        );
      }

      this.transportToClient
        .send(message)
        .catch((error) => this.onClientError(error));
    };

    this.transportToClient.onclose = () => {
      AUTH_CONSTANTS.proxyInstances.delete(TokenManager.hashUrl(this.url));
      this.unauthMsg = null;
      if (this.transportToServerClosed) {
        return;
      }

      this.transportToClientClosed = true;
      this.logger.debug(
        "[Transport] Local transport closed, closing remote transport"
      );
      this.transportToServer
        .close()
        .catch((error) => this.onServerError(error));
    };

    this.transportToServer.onclose = () => {
      AUTH_CONSTANTS.proxyInstances.delete(TokenManager.hashUrl(this.url));
      this.unauthMsg = null;
      if (this.transportToClientClosed) {
        return;
      }
      this.transportToServerClosed = true;
      this.logger.debug(
        "[Transport] Remote transport closed, closing local transport"
      );
      this.transportToClient
        .close()
        .catch((error) => this.onClientError(error));
    };

    this.transportToClient.onerror = (error) => this.onClientError(error);
    this.transportToServer.onerror = (error) => this.onServerError(error);
  }

  private onClientError(error: Error) {
    this.logger.error(
      `[Client Error] Local client transport: ${error.message}`
    );
    this.logger.debug("[Client Error] Local client transport stack:", {
      stack: error.stack,
    });
  }

  private onServerError(error: Error) {
    this.logger.error(
      `[Server Error] Remote server transport: ${error.message}`
    );
    this.logger.debug("[Server Error] Remote server transport stack:", {
      stack: error.stack,
    });
  }

  public sendServerTransportMessage(message: JSONRPCMessage) {
    this.transportToServer
      .send(message)
      .then(() => ((this.retry = 0), (this.refreshRetry = 0)))
      .catch((error: Error) => {
        if (
          error instanceof UnauthorizedError ||
          (error instanceof Error && error.message.includes("Unauthorized"))
        ) {
          if (hasKeyInJson(ROOT_CONFIG.headers, "Authorization")) {
            this.logger.error(
              "[Client → Server] Received a 401 from the server because the cli headers contain a static Authorization header. Skipping the OAuth mechanism and closing the connection."
            );
            process.exit(1);
          }

          if (this.retry++ < ROOT_CONFIG.unauthRetries) {
            this.logger.warn(
              `[Client → Server] UnAuthorized error :: Retry attempt ${this.retry} of ${ROOT_CONFIG.unauthRetries}.`
            );
          }
          this.logger.debug(
            "[Client → Server] UnAuthorized error :: Storing init msg in map to retry after successful auth."
          );
          this.unauthMsg = message;
        } else {
          this.logger.info("IN SERVER ERROR");
          this.onServerError(error);
        }
      });
  }

  public validateRefTokenUnauth(tokenManager: TokenManager, url: string): void {
    if (this.refreshRetry > 0) {
      // If refresh token present in already saved token, it'll go on for infinite recursion in MCP package. Hence we will remove the token file to restart auth.
      // Like bro who tf designs an open source project like this.
      this.logger.oauth(
        "[Client → Server] UnAuthorized error :: New access token generated using refresh token throwing 401. Hence we will be removing token file and reauthorizing the server."
      );
      tokenManager.removeToken(url);
      this.refreshRetry = 0;
    }
    this.refreshRetry++;
  }
}
