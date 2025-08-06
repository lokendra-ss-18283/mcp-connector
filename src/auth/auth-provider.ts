import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import { AddressInfo, Socket } from "net";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthClientMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthClientInformation } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { OAuthDialogManager } from "../utils/dialog-manager.js";
import { OAuthProxyServer } from "../proxy/oauth-proxy-server.js";
import {
  MCPServerConfig,
  OAuthState,
  TokenSchema,
} from "../interface/interface.js";
import {
  createLogger,
  FileLogger,
  logger as DefaultLogger,
} from "../utils/file-logger.js";
import {
  AUTH_CONSTANTS,
  ROOT_CONFIG,
  TransportClientClassMap,
} from "../constants/constants.js";
import { McpProxy } from "../proxy/mcp-proxy.js";

import { TokenManager } from "./token-manager.js";

export class DefaultAuthProvider implements OAuthClientProvider {
  public redirectUrl!: string;
  public port: number = 0;
  public clientMetadata!: OAuthClientMetadata;

  public static oauthProxy: OAuthProxyServer | null;

  private baseUrl: URL;
  private clientTransport?: Transport;
  private dialogManager: OAuthDialogManager;
  private tokenManager: TokenManager;
  private logger;

  constructor(server: MCPServerConfig) {
    // Use server name from global config if available, else fallback to hash
    const baseUrl: URL = new URL(server.url);
    const serverName = server.name;
    this.logger = serverName
      ? createLogger(serverName, TokenManager.hashUrl(baseUrl.toString()))
      : DefaultLogger;
    this.logger.debug(
      "Initializing DefaultAuthProvider with base URL",
      baseUrl.toString()
    );
    this.baseUrl = baseUrl;
    this.dialogManager = new OAuthDialogManager(baseUrl.toString());
    this.tokenManager = new TokenManager(this.logger, baseUrl.toString());
  }

  static async create(server: MCPServerConfig): Promise<DefaultAuthProvider> {
    const instance = new DefaultAuthProvider(server);

    const filePath = instance.getClientInfoFilePath();
    let usablePort: number | undefined;
    const staticConfigPort = server.port;
    if (staticConfigPort) {
      const free = await DefaultAuthProvider.isAuthPortAvailable(
        staticConfigPort
      );
      if (free) {
        usablePort = staticConfigPort;
        instance.logger.debug(`Reusing static port from config: ${usablePort}`);
      } else {
        instance.logger.debug(
          `Port from config info (${staticConfigPort}) is not free, will use a random port`
        );
      }
    } else if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        if (data.redirect_uris && data.redirect_uris[0]) {
          const redirectUrlPort: number = this.getPortFromUrl(
            data.redirect_uris[0]
          );
          const free = await DefaultAuthProvider.isAuthPortAvailable(
            redirectUrlPort
          );
          if (free) {
            usablePort = redirectUrlPort;
            instance.logger.debug(
              `Reusing available port from client info: ${usablePort}`
            );
          } else {
            instance.logger.debug(
              `Port from client info (${redirectUrlPort}) is not free, will use a random port`
            );
          }
        }
      } catch (e) {
        instance.logger.warn("Failed to read client info for port reuse:", e);
      }
    }

    if (typeof usablePort === "undefined") {
      usablePort = await DefaultAuthProvider.getAuthAvailablePort();
    }

    instance.port = usablePort;
    instance.redirectUrl = `http://localhost:${usablePort}/callback`;
    instance.clientMetadata = {
      client_name: "MCP Connector",
      client_uri: "https://github.com/lokendra-ss-18283/mcp-connector",
      redirect_uris: [instance.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    return instance;
  }

  clientInformation():
    | OAuthClientInformation
    | undefined
    | Promise<OAuthClientInformation | undefined> {
    this.logger.debug("Getting client information", this.clientMetadata);
    try {
      const filePath = this.getClientInfoFilePath();
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        // Check and update redirect_uris if needed
        if (
          Array.isArray(data.redirect_uris) &&
          !data.redirect_uris.includes(this.redirectUrl)
        ) {
          this.logger.debug(
            "Updating client information redirect_uris to match current redirectUrl"
          );
          data.redirect_uris = [this.redirectUrl];
          this.saveClientInformation(data);
        }
        this.logger.debug("Returning client information from file", data);
        return data as OAuthClientInformationFull;
      } else {
        this.logger.debug("No client information file found for", filePath);
        return undefined;
      }
    } catch (error) {
      this.logger.warn("Failed to read client information file:", error);
      return undefined;
    }
  }

  saveClientInformation(
    clientInformation: OAuthClientInformationFull
  ): void | Promise<void> {
    try {
      const filePath = this.getClientInfoFilePath();
      writeFileSync(
        filePath,
        JSON.stringify(clientInformation, null, 2),
        "utf-8"
      );
      this.logger.debug("Saved client information to file", {
        filePath,
        client_id: clientInformation.client_id,
      });
    } catch (error) {
      this.logger.warn("Failed to save client information file:", error);
    }
  }

  state(): string | Promise<string> {
    const state = randomBytes(16).toString("base64url");

    // Store state globally with timestamp for verification
    AUTH_CONSTANTS.globalStateStore.set(state, {
      timestamp: Date.now(),
      url: this.baseUrl.toString(),
    });

    this.logger.debug("Generated and stored OAuth state", { state });
    return state;
  }

  tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined> {
    const storedTokenData: TokenSchema | null = this.tokenManager.getToken(
      this.baseUrl.toString()
    );
    this.logger.debug(
      "STORED TOKEN :: ",
      storedTokenData == null ? null : JSON.stringify(storedTokenData)
    );

    if (
      storedTokenData &&
      typeof storedTokenData.access_token === "string" &&
      typeof storedTokenData.token_type === "string"
    ) {
      const { createdAt, ...tokenWithoutCreatedAt } =
        storedTokenData as TokenSchema;
      return tokenWithoutCreatedAt as OAuthTokens;
    }
    return undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.logger.debug("Saving tokens", tokens);

    const storedTokenData: TokenSchema | null = this.tokenManager.getToken(
      this.baseUrl.toString()
    );
    if (
      storedTokenData &&
      storedTokenData.refresh_token &&
      tokens.refresh_token &&
      storedTokenData.refresh_token === tokens.refresh_token
    ) {
      const proxyInstance: McpProxy | undefined =
        AUTH_CONSTANTS.proxyInstances.get(
          TokenManager.hashUrl(this.baseUrl.toString())
        );
      proxyInstance?.validateRefTokenUnauth(
        this.tokenManager,
        this.baseUrl.toString()
      );
      if (proxyInstance?.refreshRetry === 0) {
        this.tokenManager.saveToken(this.baseUrl.toString(), tokens);
      }
    } else {
      this.tokenManager.saveToken(this.baseUrl.toString(), tokens);
    }
    this.logger.debug("Tokens saved to TokenManager");
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.logger.info("Redirect to authorization URL requested", {
      authorizationUrl: authorizationUrl.toString(),
    });
    await this.dialogManager.showAuthDialog(authorizationUrl.toString());
    this.startProxyServer();
    this.logger.info(
      `Please visit the following URL to authorize the application:`
    );
    this.logger.info(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.logger.debug("Saving code verifier");
    // Save in global map using URL hash
    const urlHash = TokenManager.hashUrl(this.baseUrl.toString());
    AUTH_CONSTANTS.codeVerifierStore.set(urlHash, codeVerifier);
  }

  codeVerifier(): string {
    const urlHash = TokenManager.hashUrl(this.baseUrl.toString());
    let verifier = AUTH_CONSTANTS.codeVerifierStore.get(urlHash);
    if (!verifier) {
      verifier = this.generatePKCECodeVerifier();
      this.logger.debug("Generated new PKCE code verifier");
      AUTH_CONSTANTS.codeVerifierStore.set(urlHash, verifier);
    }
    return verifier;
  }

  private generatePKCECodeVerifier(): string {
    const buffer = randomBytes(32);
    return buffer.toString("base64url");
  }

  generateCodeChallenge(codeVerifier?: string): string {
    const verifier = codeVerifier || this.codeVerifier();
    // Create SHA256 hash of the code verifier
    const hash = createHash("sha256").update(verifier, "ascii").digest();
    // Encode as base64url
    return hash.toString("base64url");
  }

  getCodeChallengeMethod(): string {
    return "S256";
  }

  clearTokens(): void {
    this.logger.debug("Clearing stored tokens");

    // Clear tokens from TokenManager
    this.tokenManager.removeToken(this.baseUrl.toString());
    this.logger.debug("Tokens cleared from TokenManager");
  }

  // PKCE helper methods
  generateAuthorizationUrl(
    authorizationEndpoint: string,
    clientId: string,
    state?: string
  ): string {
    this.logger.debug("Generating authorization URL");

    const codeVerifier = this.codeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: this.redirectUrl,
      code_challenge: codeChallenge,
      code_challenge_method: this.getCodeChallengeMethod(),
      scope: "mcp", // Default scope
    });

    const authUrl = `${authorizationEndpoint}?${params.toString()}`;
    this.logger.debug("Generated authorization URL with PKCE", {
      endpoint: authorizationEndpoint,
      clientId,
      codeChallenge: codeChallenge.substring(0, 10) + "...",
      state,
    });

    return authUrl;
  }

  generateState(): string {
    return randomBytes(16).toString("base64url");
  }

  setClientTransport(transport: Transport): void {
    this.clientTransport = transport;
    this.logger.debug("Client transport instance set in auth provider");
  }

  getClientTransport(): Transport | undefined {
    return this.clientTransport;
  }

  private getClientInfoFilePath(): string {
    const urlHash = TokenManager.hashUrl(this.baseUrl.toString());
    // Stores in ~/.mcp-connector/client_info_{hash}.json
    return join(
      this.tokenManager.getStorePath(),
      `client_info_${urlHash}.json`
    );
  }

  public async startProxyServer(): Promise<void> {
    if (!DefaultAuthProvider.oauthProxy) {
      this.logger.debug("Starting OAuth proxy server");
      DefaultAuthProvider.oauthProxy = new OAuthProxyServer({
        port: this.port,
        clientTransport: this.clientTransport as StreamableHTTPClientTransport,
        logger: this.logger,
      });

      DefaultAuthProvider.oauthProxy.on("oauth-success", async ({ url }) => {
        this.logger.info("OAuth successful, restarting MCP server...");
        const serverConfig: MCPServerConfig | undefined =
          ROOT_CONFIG.servers.get(TokenManager.hashUrl(url));
        if (serverConfig) {
          const clientClass =
            TransportClientClassMap[ROOT_CONFIG.transportType];
          const clientInstance = new clientClass(
            serverConfig,
            ROOT_CONFIG.transportType
          );
          await clientInstance.setup();
        } else {
          this.logger.error(
            "Couldn't find proxy server config. Exiting application. Please ensure your configuration file is present and valid."
          );
          process.exit(1);
        }
      });

      await DefaultAuthProvider.oauthProxy.ensureServerRunning(this.logger);

      this.logger.info(`OAuth proxy server started on port 8080`);
      this.logger.info(
        `OAuth callback server is running on http://localhost:8080`
      );
    }
  }

  public static getPortFromUrl(url: string | URL): number {
    let urlObj: URL;
    try {
      urlObj = typeof url === "string" ? new URL(url) : url;
      if (urlObj.port) {
        return Number(urlObj.port);
      }
      // Return default port based on protocol if not explicitly set
      if (urlObj.protocol === "http:") return 80;
      if (urlObj.protocol === "https:") return 443;
      return 0;
    } catch {
      return 0;
    }
  }

  // Global state verification function
  public static verifyOAuthState(state: string, logger: FileLogger): boolean {
    if (!AUTH_CONSTANTS.globalStateStore.has(state)) {
      logger.error("OAuth state verification failed: state not found", {
        state,
      });
      return false;
    }

    const stateData = AUTH_CONSTANTS.globalStateStore.get(state)!;
    const now = Date.now();
    const maxAge = 300000; // 5 minutes

    if (now - stateData.timestamp > maxAge) {
      logger.error("OAuth state verification failed: state expired", {
        state,
        age: now - stateData.timestamp,
      });
      AUTH_CONSTANTS.globalStateStore.delete(state);
      return false;
    }

    logger.debug("OAuth state verification successful", { state });
    return true;
  }

  public static getOAuthState(state: string): OAuthState | undefined {
    return AUTH_CONSTANTS.globalStateStore.get(state);
  }

  // Factory function to create auth provider instances
  public static async createAuthProvider(
    server: MCPServerConfig,
    config?: Partial<OAuthClientProvider>
  ): Promise<DefaultAuthProvider> {
    const provider = await DefaultAuthProvider.create(server);

    if (config) {
      Object.assign(provider, config);
    }

    return provider;
  }

  public static isAuthPortAvailable = async (port: number) => {
    return new Promise((resolve) => {
      const tester = new Socket();
      tester.once("error", () => resolve(true));
      tester.once("connect", () => {
        tester.destroy();
        resolve(false);
      });
      tester.connect(port, "127.0.0.1");
    });
  };

  public static getAuthAvailablePort = async (): Promise<number> => {
    // Get available port with dummy server
    return new Promise((resolve, reject) => {
      const tempServer = createServer();

      tempServer.listen(0, () => {
        const { port } = tempServer.address() as AddressInfo;
        tempServer.close(() => resolve(port));
      });

      tempServer.on("error", (err) => reject(err));
    });
  };
}
