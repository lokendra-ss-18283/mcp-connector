import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { FileLogger } from "../utils/file-logger.js";
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
import { TokenManager } from "../auth/token-manager.js";
import { HEADERS } from "../cli.js";
import { hasKeyInJson } from "../utils/cli-util.js";

export const pendingInitErrors: Map<string, JSONRPCMessage> = new Map<
  string,
  JSONRPCMessage
>();
export const proxyInstances: Map<
  string,
  ReturnType<typeof McpProxyConfig>
> = new Map<string, ReturnType<typeof McpProxyConfig>>();

export function McpProxyConfig({
  transportToClient,
  transportToServer,
  logger,
  url,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
  logger: FileLogger;
  url: string;
}): {
  transportToClient: Transport;
  transportToServer: Transport;
} {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  const instance = {
    transportToClient,
    transportToServer,
    logger,
  };

  transportToClient.onmessage = (_message) => {
    const message = _message as JSONRPCRequest;
    logger.info(
      `[Client → Server] Method: ${message.method || "unknown"} | ID: ${
        message.id ?? "none"
      }`
    );

    logger.debug(`[Client → Server] Full Message:`, {
      method: message.method,
      id: message.id,
      params: message.params
        ? JSON.stringify(message.params).substring(0, 500)
        : undefined,
    });

    if (message.method === "initialize" && message.params) {
      const initMsg = message as unknown as InitializeRequest;
      const { clientInfo } = initMsg.params;
      if (clientInfo) clientInfo.name = `${clientInfo.name} (via mcp-connector)`;
      logger.info(
        `[Client → Server] Initialization: ${JSON.stringify(message, null, 2)}`
      );

      logger.debug(`[Client → Server] Modified Client Info:`, {
        clientInfo,
      });
    }

    transportToServer.send(message).catch((error: Error) => {
      if ( error.message.includes("Authentication required") ||
        error instanceof UnauthorizedError ||
        (error instanceof Error && error.message.includes("Unauthorized"))
      ) {
        if(hasKeyInJson(HEADERS, "Authorization")) {
          logger.error("[Client → Server] Received a 401 from the server because the cli headers contain a static Authorization header. Skipping the OAuth mechanism and closing the connection.");
          console.error("[Client → Server] Received a 401 from the server because the cli headers contain a static Authorization header. Skipping the OAuth mechanism and closing the connection.");
          process.exit(1);
        }
        logger.debug(
          "[Client → Server] UnAuthorized error :: Storing init msg in map to retry after successful auth."
        );
        pendingInitErrors.set(TokenManager.hashUrl(url), _message);
      } else {
        onServerError(error);
      }
    });
  };

  transportToServer.onmessage = (_message) => {
    const message = _message as JSONRPCMessage;

    logger.debug(`[Server → Client] :: Message :: ${message}`);

    if (isJSONRPCRequest(message)) {
      const request = message as unknown as JSONRPCRequest;
      logger.info(
        `[Server → Client] : JSONRPCRequest → Method: ${
          request.method || "unknown"
        } | ID: ${message.id ?? "none"}`
      );
    }

    if (isJSONRPCResponse(message)) {
      const response = message as unknown as JSONRPCResponse;
      logger.info(
        `[Server → Client] : JSONRPCResponse → Result: ${
          response.result ? "present" : "absent"
        } | ID: ${response.id ?? "none"}`
      );
    }

    if (isJSONRPCError(message)) {
      const error = message as unknown as JSONRPCError;
      logger.info(
        `[Server → Client] : JSONRPCError → Error: ${
          error.error ? JSON.stringify(error.error) : "none"
        } | ID: ${error.id ?? "none"}`
      );
    }

    if (isJSONRPCNotification(message)) {
      const notitfication = message as unknown as JSONRPCNotification;
      logger.info(
        `[Server → Client] : JSONRPCNotification → Method: ${
          notitfication.method || "unknown"
        }`
      );
    }

    transportToClient.send(message).catch(onClientError);
  };

  transportToClient.onclose = () => {
    proxyInstances.delete(TokenManager.hashUrl(url));
    pendingInitErrors.delete(TokenManager.hashUrl(url));
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    logger.debug(
      "[Transport] Local transport closed, closing remote transport"
    );
    transportToServer.close().catch(onServerError);
  };

  transportToServer.onclose = () => {
    proxyInstances.delete(TokenManager.hashUrl(url));
    pendingInitErrors.delete(TokenManager.hashUrl(url));
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;
    logger.debug(
      "[Transport] Remote transport closed, closing local transport"
    );
    transportToClient.close().catch(onClientError);
  };

  transportToClient.onerror = onClientError;
  transportToServer.onerror = onServerError;

  function onClientError(error: Error) {
    logger.error(`[Client Error] Local client transport: ${error.message}`);
    logger.debug("[Client Error] Local client transport stack:", {
      stack: error.stack,
    });
  }

  function onServerError(error: Error) {
    logger.error(`[Server Error] Remote server transport: ${error.message}`);
    logger.debug("[Server Error] Remote server transport stack:", {
      stack: error.stack,
    });
  }

  return instance;
}
