import express from "express";
import { createServer, Server } from "http";
import { HTMLRenderer } from "./html-renderer.js";
import { FileLogger } from "../utils/file-logger.js";
import { getAuthAvailablePort, getOAuthState, globalStateStore, globalStateStoreCompleted, OAuthState, verifyOAuthState,  } from "../auth/auth-provider.js";
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { EventEmitter } from "events";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

interface OAuthProxyOptions {
  port?: number;
  timeout?: number;
  maxRetries?: number;
  clientTransport: Transport,
  logger: FileLogger
}

export class OAuthProxyServer extends EventEmitter {
  private app: express.Application;
  private server!: Server;
  private htmlRenderer: HTMLRenderer;
  private options: Required<OAuthProxyOptions>;
  private isRunning: boolean = false;
  private clientTransport!: StreamableHTTPClientTransport;

  constructor(options: OAuthProxyOptions) {
    super();
    this.options = {
      port: options.port || 54757,
      timeout: 5 * 60 * 1000,
      maxRetries: options.maxRetries || 3,
      clientTransport: options.clientTransport,
      logger: options.logger
    };

    this.app = express();
    this.htmlRenderer = new HTMLRenderer();
    this.clientTransport = options.clientTransport as StreamableHTTPClientTransport;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use(express.static("public"));

    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        uptime: process.uptime(),
        activeStates: globalStateStore.size,
      });
    });

    this.app.get("/callback", async (req, res) => {
      const logger = this.options.logger;
      try {
        const { code, state, error } = req.query;
        logger.error("OAuth callback received ::: ", { code, state, error });

        if (error) {
          logger.error(`OAuth error: ${error}`);
          res.send(
            this.htmlRenderer.renderErrorPage(
              "Authentication Failed",
              `OAuth Error: ${error}`
            )
          );
          logger.error("Authentication failed with error : ", error);
          await this.stop(logger);
          return;
        }

        if (!state || !code) {
          logger.error("Missing state or code parameter");
          res.send(
            this.htmlRenderer.renderErrorPage(
              "Authentication Failed",
              "Missing required parameters."
            )
          );
          logger.error("Authentication failed : mandatory parameters (code, state) is not present in request");
          await this.stop(logger);
          return;
        }

        // Load OAuth state from memory
        const oauthState = verifyOAuthState(state as string, logger);
        if (!oauthState) {
          if(globalStateStoreCompleted.has(state as string)) {
            logger.info("Trying to access already completed state. Hence returning.");
            res.send(this.htmlRenderer.renderSuccessPage(globalStateStoreCompleted.get(state as string)?.url || "null", true));
            await this.stop(logger);
            return;
          }
          logger.error(`Invalid or expired state: ${state}`);
          res.send(
            this.htmlRenderer.renderErrorPage(
              "Authentication Failed",
              "Invalid or expired authentication state."
            )
          );
          await this.stop(logger);
          return;
        }
        
        logger.debug(`Processing OAuth callback for state: ${state}`);
        
        const oauthStateValue: OAuthState | undefined = getOAuthState(state as string);
        await this.clientTransport?.finishAuth(code.toString());
        if(oauthStateValue) {
          globalStateStoreCompleted.set(state as string, oauthStateValue);
        }
        globalStateStore.delete(state as string);
        this.emit("oauth-success", { url: oauthStateValue?.url });
        res.send(this.htmlRenderer.renderSuccessPage(oauthStateValue?.url || "null"));

      } catch (error) {
        logger.error("Callback handler error:", error);
        res.send(
          this.htmlRenderer.renderErrorPage(
            "Internal Error",
            "An unexpected error occurred during authentication."
          )
        );
        await this.stop(logger);
        return;
      }
    });
  }

  public async ensureServerRunning(logger: FileLogger): Promise<void> {
    if (this.isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      this.server.on("error", async (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          logger.warn(`Port ${this.options.port} is in use, trying ${this.options.port + 1}...`);
          const availablePort = await getAuthAvailablePort();
          this.options.port = availablePort;
          this.server.listen(this.options.port);
        } else {
          reject(error);
        }
      });

      this.server.listen(this.options.port, () => {
        this.isRunning = true;
        logger.debug(`OAuth proxy server started on http://localhost:${this.options.port}`);
        resolve();
      });
    });
  }

  public async stop(logger: FileLogger): Promise<void> {
    if (this.server && this.isRunning) {
      return new Promise((resolve) => {
        this.server.close(() => {
          globalStateStoreCompleted.clear();
          this.isRunning = false;
          logger.info("OAuth proxy server stopped");
          resolve();
        });
      });
    }
  }

  public getActiveStateCount(): number {
    return globalStateStore.size;
  }

  public getServerInfo(): { isRunning: boolean; port: number; states: number } {
    return {
      isRunning: this.isRunning,
      port: this.options.port,
      states: globalStateStore.size,
    };
  }
}