import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  Dirent,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";

import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

import { FileLogger } from "../utils/file-logger.js";
import { TokenSchema, TokensList } from "../interface/interface.js";

export class TokenManager {
  private tokenStorePath: string;
  private mcpConnectRootPath: string;
  private logger: FileLogger;
  private url: string | null = null;
  private tokenCache: Record<string, TokenSchema | null> = {};

  constructor(logger: FileLogger, url?: string) {
    this.mcpConnectRootPath = join(homedir(), ".mcp-connector");
    this.tokenStorePath = join(homedir(), ".mcp-connector");
    if (url) {
      this.url = url;
      this.tokenStorePath = join(
        homedir(),
        ".mcp-connector",
        TokenManager.hashUrl(url)
      );
    }
    this.logger = logger;
    this.ensureStoreExists();
    this.ensureRootPathExists();
  }

  private ensureStoreExists(): void {
    try {
      if (!existsSync(this.tokenStorePath)) {
        mkdirSync(this.tokenStorePath, { recursive: true });
        this.logger.debug(
          `Created token store directory: ${this.tokenStorePath}`
        );
      }
    } catch (error) {
      this.logger.warn("Failed to create token store directory:", error);
    }
  }

  private ensureRootPathExists(): void {
    try {
      if (!existsSync(this.mcpConnectRootPath)) {
        mkdirSync(this.mcpConnectRootPath, { recursive: true });
        this.logger.debug(
          `Created mcp connector directory: ${this.mcpConnectRootPath}`
        );
      }
    } catch (error) {
      this.logger.warn("Failed to create mcp connector root directory:", error);
    }
  }

  public static hashUrl(url: string): string {
    return createHash("sha256").update(url).digest("hex");
  }

  private getTokenFilePath(): string | null {
    if (this.url === null) return null;
    const urlHash = TokenManager.hashUrl(this.url);
    return join(this.tokenStorePath, `${urlHash}.token`);
  }

  private addUrlInHashMapFile(hash: string, url: string): void {
    try {
      const mapFilePath = join(this.mcpConnectRootPath, "url-hash-map.json");
      const mapData: Record<string, string> = this.getUrlInHashMapFile();
      mapData[hash] = url;

      writeFileSync(mapFilePath, JSON.stringify(mapData, null, 2), "utf8");
      this.logger.debug(`added URL-hash mapping for ${url}`);
    } catch (error) {
      this.logger.warn(`Failed to add URL-hash mapping for ${url}:`, error);
    }
  }

  public getUrlInHashMapFile(): Record<string, string> {
    let mapData: Record<string, string> = {};
    try {
      const mapFilePath = join(this.mcpConnectRootPath, "url-hash-map.json");

      if (existsSync(mapFilePath)) {
        const existingData = readFileSync(mapFilePath, "utf8");
        mapData = JSON.parse(existingData);
      }

      this.logger.debug(`Retrived URL-hash mapping`);
    } catch (error) {
      this.logger.warn(`Failed to get URL-hash mapping:`, error);
    }
    return mapData;
  }

  private removeUrlInHashMapFile(hash: string): Record<string, string> {
    const mapData: Record<string, string> = {};
    try {
      const mapFilePath = join(this.mcpConnectRootPath, "url-hash-map.json");
      const mapData: Record<string, string> = this.getUrlInHashMapFile();
      delete mapData[hash];

      writeFileSync(mapFilePath, JSON.stringify(mapData, null, 2), "utf8");

      this.logger.debug(`Removed URL-hash mapping`);
    } catch (error) {
      this.logger.warn(`Failed to get URL-hash mapping:`, error);
    }
    return mapData;
  }

  public saveToken(url: string, tokenDetails: TokenSchema): void {
    try {
      const tokenFilePath = this.getTokenFilePath();
      if (tokenFilePath == null) {
        this.logger.info(`URL is null couldn't save token.`);
        return;
      }
      tokenDetails.createdAt = Date.now();
      writeFileSync(
        tokenFilePath,
        JSON.stringify(tokenDetails, null, 2),
        "utf8"
      );
      const hashUrl = TokenManager.hashUrl(url);
      this.addUrlInHashMapFile(hashUrl, url);
      this.tokenCache[hashUrl] = tokenDetails;
      this.logger.debug(`Saved auth token for ${url}`);
    } catch (error) {
      this.logger.warn(`Failed to save auth token for ${url}:`, error);
    }
  }

  public getToken(url: string): TokenSchema | null {
    const hashUrl = TokenManager.hashUrl(url);
    if (this.tokenCache[hashUrl]) {
      return this.tokenCache[hashUrl];
    }
    try {
      const tokenFilePath = this.getTokenFilePath();
      if (tokenFilePath == null) {
        this.logger.info(`URL is null couldn't save token.`);
        return null;
      }
      if (!existsSync(tokenFilePath)) {
        this.removeUrlInHashMapFile(hashUrl);
        return null;
      }

      const tokenData: TokenSchema = JSON.parse(
        readFileSync(tokenFilePath, "utf8")
      );
      this.tokenCache[hashUrl] = tokenData;
      return tokenData;
    } catch (error) {
      this.logger.warn(`Failed to load auth token for ${url}:`, error);
      return null;
    }
  }

  public listTokens(isArgLog: boolean = false): TokensList[] {
    try {
      let tokenFiles = readdirSync(this.tokenStorePath, {
        withFileTypes: true,
      });
      const urlMapData = this.getUrlInHashMapFile();
      const tokensList: TokensList[] = [];
      tokenFiles = tokenFiles.filter((file) => file.isDirectory());

      tokenFiles.map((currDir) => {
        const getFilesinDir = readdirSync(
          join(currDir.parentPath, currDir.name),
          {
            withFileTypes: true,
          }
        ).filter((file) => file.isFile() && file.name.endsWith(".token"));

        getFilesinDir.map((file: Dirent) => {
          try {
            if (!urlMapData[file.name.replace(".token", "")]) {
              unlinkSync(join(file.parentPath, file.name));
            }
            const tokenData = JSON.parse(
              readFileSync(join(file.parentPath, file.name), "utf8")
            );

            tokensList.push({
              url: urlMapData[file.name.replace(".token", "")] || "Unknown URL",
              tokenDetails: tokenData,
            });
          } catch {
            if (isArgLog) {
              console.warn(`Failed to parse token file ${file}`);
            } else {
              this.logger.warn(`Failed to parse token file ${file}`);
            }
          }

          return null;
        });
      });

      return tokensList;
    } catch (error) {
      if (isArgLog) {
        console.warn("Failed to list stored tokens:", error);
      } else {
        this.logger.warn("Failed to list stored tokens:", error);
      }
      return [];
    }
  }

  public removeToken(url: string): boolean {
    try {
      const hashUrl = TokenManager.hashUrl(url);
      const tokenFilePath = this.getTokenFilePath();
      if (tokenFilePath == null) {
        this.logger.info(`URL is null couldn't save token.`);
        return false;
      }
      if (existsSync(tokenFilePath)) {
        unlinkSync(tokenFilePath);
        this.removeUrlInHashMapFile(hashUrl);
        delete this.tokenCache[hashUrl];
        this.logger.debug(`Removed token for ${url}`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.warn(`Failed to remove token for ${url}:`, error);
      return false;
    }
  }

  public getStorePath(): string {
    return this.tokenStorePath;
  }

  public getTokenCount(): number {
    try {
      const tokenFiles = readdirSync(this.tokenStorePath);
      return tokenFiles.filter((file) => file.endsWith(".token")).length;
    } catch (error) {
      this.logger.warn("Failed to count tokens:", error);
      return 0;
    }
  }

  public cleanExpiredTokens(): void {
    try {
      const tokenFiles = readdirSync(this.tokenStorePath);
      const urlMapData = this.getUrlInHashMapFile();

      tokenFiles.forEach((file) => {
        if (file.endsWith(".token")) {
          const tokenData: Record<string, OAuthTokens> = JSON.parse(
            readFileSync(join(this.tokenStorePath, file), "utf8")
          );

          if (
            (tokenData.expires_in &&
              tokenData.expires_in &&
              Date.now() >
                (tokenData.expires_in as unknown as number) * 1000) ||
            (!tokenData.expires_in && !tokenData.refresh_token)
          ) {
            unlinkSync(join(this.tokenStorePath, file));
            delete urlMapData[file.replace(".token", "")];
            this.logger.debug(
              `Removed expired token for ${
                urlMapData[file.replace(".token", "")]
              }`
            );
          }
        }
      });

      writeFileSync(
        join(this.mcpConnectRootPath, "url-hash-map.json"),
        JSON.stringify(urlMapData, null, 2),
        "utf8"
      );
    } catch (error) {
      this.logger.warn("Failed to clean expired tokens:", error);
    }
  }

  public updateUrlHashMapFile(map: Record<string, string>): void {
    try {
      const mapFilePath = join(this.mcpConnectRootPath, "url-hash-map.json");
      writeFileSync(mapFilePath, JSON.stringify(map, null, 2), "utf8");
      if (this.url) {
        this.logger.info(`Updated URL-hash mapping file:`);
      } else {
        console.log(`Updated URL-hash mapping file:`);
      }
    } catch (error) {
      if (this.url) {
        this.logger.warn(`Failed to update URL-hash mapping file:`, error);
      } else {
        console.warn(`Failed to update URL-hash mapping file:`, error);
      }
    }
  }

  public getMcpConnectFolderPath(): string {
    return this.mcpConnectRootPath;
  }
}
