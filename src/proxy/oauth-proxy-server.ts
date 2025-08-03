import { createServer, Server } from "http";
import { EventEmitter } from "events";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import express from "express";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { HTMLRenderer } from "../utils/html-renderer.js";
import { FileLogger } from "../utils/file-logger.js";
import { DefaultAuthProvider } from "../auth/auth-provider.js";
import { OAuthProxyOptions, OAuthState } from "../interface/interface.js";
import { AUTH_CONSTANTS } from "../constants/constants.js";

export class OAuthProxyServer extends EventEmitter {
  private app: express.Application;
  private server!: Server;
  private htmlRenderer: HTMLRenderer;
  private options: Required<OAuthProxyOptions>;
  private isRunning: boolean = false;
  private clientTransport!: StreamableHTTPClientTransport;
  private shutdownTimeout: NodeJS.Timeout | null = null;

  constructor(options: OAuthProxyOptions) {
    super();
    this.options = {
      port: options.port || 54757,
      timeout: 5 * 60 * 1000,
      maxRetries: options.maxRetries || 3,
      clientTransport: options.clientTransport,
      logger: options.logger,
    };

    this.app = express();
    this.htmlRenderer = new HTMLRenderer();
    this.clientTransport =
      options.clientTransport as StreamableHTTPClientTransport;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    this.app.use(express.static(join(__dirname, "../../public")));

    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        uptime: process.uptime(),
        activeStates: AUTH_CONSTANTS.globalStateStore.size,
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
          logger.error(
            "Authentication failed : mandatory parameters (code, state) is not present in request"
          );
          setTimeout(async () => {
            await this.stop(logger);
          }, 250000);
          return;
        }

        // Load OAuth state from memory
        const oauthState = DefaultAuthProvider.verifyOAuthState(
          state as string,
          logger
        );
        if (!oauthState) {
          if (AUTH_CONSTANTS.globalStateStoreCompleted.has(state as string)) {
            logger.info(
              "Trying to access already completed state. Hence returning."
            );
            res.send(
              this.htmlRenderer.renderSuccessPage(
                AUTH_CONSTANTS.globalStateStoreCompleted.get(state as string)
                  ?.url || "null",
                true
              )
            );
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
          await new Promise((resolve) => setTimeout(resolve, 5 * 1000)); // Close the server after 5 seconds
          await this.stop(logger);
          return;
        }

        logger.debug(`Processing OAuth callback for state: ${state}`);

        const oauthStateValue: OAuthState | undefined =
          DefaultAuthProvider.getOAuthState(state as string);
        await this.clientTransport?.finishAuth(code.toString());
        if (oauthStateValue) {
          AUTH_CONSTANTS.globalStateStoreCompleted.set(
            state as string,
            oauthStateValue
          );
        }
        AUTH_CONSTANTS.globalStateStore.delete(state as string);
        this.emit("oauth-success", { url: oauthStateValue?.url });
        res.send(
          this.htmlRenderer.renderSuccessPage(oauthStateValue?.url || "null")
        );
        return;
      } catch (error) {
        logger.error("Callback handler error:", error);
        res.send(
          this.htmlRenderer.renderErrorPage(
            "Internal Error",
            "An unexpected error occurred during authentication."
          )
        );
        this.resetShutdownTimer(logger);
        await this.stop(logger);
        return;
      }
    });
  }

  private resetShutdownTimer(logger: FileLogger) {
    if (this.shutdownTimeout) {
      clearTimeout(this.shutdownTimeout);
      this.shutdownTimeout = null;
    }
    this.shutdownTimeout = setTimeout(async () => {
      logger.info(
        "OAuth proxy server timeout reached (5 seconds after last callback). Stopping server."
      );
      await this.stop(logger);
    }, 5 * 1000); // 5 seconds
  }

  public async ensureServerRunning(logger: FileLogger): Promise<void> {
    if (this.isRunning) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      this.server.on("error", async (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          logger.warn(
            `Port ${this.options.port} is in use, trying ${
              this.options.port + 1
            }...`
          );
          const availablePort =
            await DefaultAuthProvider.getAuthAvailablePort();
          this.options.port = availablePort;
          this.server.listen(this.options.port);
        } else {
          reject(error);
        }
      });

      this.server.listen(this.options.port, () => {
        this.isRunning = true;
        logger.debug(
          `OAuth proxy server started on http://localhost:${this.options.port}`
        );
        setTimeout(async () => {
          logger.info(
            "OAuth proxy server timeout reached (5 minutes). Stopping server."
          );
          await this.stop(logger);
        }, this.options.timeout);
        resolve();
      });
    });
  }

  public async stop(logger: FileLogger): Promise<void> {
    if (this.server && this.isRunning) {
      return new Promise((resolve) => {
        this.server.close(() => {
          AUTH_CONSTANTS.globalStateStoreCompleted.clear();
          DefaultAuthProvider.oauthProxy = null;
          this.isRunning = false;
          logger.info("OAuth proxy server stopped");
          resolve();
        });
      });
    }
  }

  public getActiveStateCount(): number {
    return AUTH_CONSTANTS.globalStateStore.size;
  }

  public getServerInfo(): { isRunning: boolean; port: number; states: number } {
    return {
      isRunning: this.isRunning,
      port: this.options.port,
      states: AUTH_CONSTANTS.globalStateStore.size,
    };
  }
}
