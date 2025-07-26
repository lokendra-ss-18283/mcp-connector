import open from "open";
import { exec } from "child_process";
import notifier from "node-notifier";

import {
  createLogger,
  FileLogger,
  logger as DefaultLogger,
} from "../utils/file-logger.js";
import { TokenManager } from "../auth/token-manager.js";
import { GLOBAL_SERVER_CONFIGS } from "../cli.js";

export class OAuthDialogManager {
  private logger: FileLogger = DefaultLogger;

  constructor(url: string) {
    let serverName = null;
    const hash = TokenManager.hashUrl(url);
    if (GLOBAL_SERVER_CONFIGS && GLOBAL_SERVER_CONFIGS.has(hash)) {
      serverName = GLOBAL_SERVER_CONFIGS.get(hash)!.name || null;
    }
    this.logger = serverName ? createLogger(serverName, hash) : DefaultLogger;
  }

  public showAuthDialog(url: string): void {
    this.showOSPrompt(url);
  }

  private showOSPrompt(url: string): void {
    this.logger.info(`OAuth authentication URL: ${url}`);

    const title = "MCP Connector - OAuth Authentication";
    // Truncate URL for display if it's too long
    const displayUrl = url.length > 80 ? url.substring(0, 80) + "..." : url;
    const message = `OAuth 2.1 Authentication Required\n\nURL: ${displayUrl}\n\nA browser window will open to complete the OAuth flow.\nYou will be redirected to the authorization server to sign in.\n\nChoose an option:`;

    notifier.notify(
      {
        title:title,
        message: message,
        wait: true,
        actions: [
          "Close",
          "Copy URL",
          "Open Browser"
        ],
        timeout: 30,
        // icon: "random.png" 
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err: any, response: string, metadata: any) => {
        if(err) {
          console.error("Error in dialog box");
          this.logger.oauth("Error in dialog box");
          this.logger.debug("Error in dialog box :: ", err);
          process.exit(1);
        }

        if(response === "timeout") {
          console.log("Dialog timeout exceeded. Terminating the server");
          this.logger.oauth("Dialog timeout exceeded. Terminating the server");
          process.exit(1);
        }

        if(response === "close") {
          console.log("OAuth Rejected. Terminating the server");
          this.logger.oauth("OAuth Rejected. Terminating the server");
          process.exit(0);
        }

        if(response === "copy url") {
          this.copyUrlToClipboard(url);
          console.log("OAuth URL copied to clipboard.");
          this.logger.oauth("OAuth URL copied to clipboard.");
        }
        
        if(response === "open browser") {
          this.performBrowserOpen(url);
          this.logger.oauth("Spawning browser.");
        }
      }
    );
  }

  private copyUrlToClipboard(url: string): void {
    this.logger.progress("Copying URL to clipboard...");

    let copyCommand: string;

    switch (process.platform) {
      case "darwin": // macOS
        copyCommand = `echo "${url}" | pbcopy`;
        break;
      case "win32": // Windows
        copyCommand = `echo "${url}" | clip`;
        break;
      default: // Linux and others
        // Try xclip first, fallback to xsel
        copyCommand = `echo "${url}" | xclip -selection clipboard 2>/dev/null || echo "${url}" | xsel --clipboard --input 2>/dev/null`;
        break;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exec(copyCommand, (error: any) => {
      if (error) {
        this.logger.error("Could not copy to clipboard automatically");
        this.showManualInstructions(url);
        this.performBrowserOpen(url);
      } else {
        this.logger.success("URL copied to clipboard successfully!");
        this.logger.info("");
        this.logger.info(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        );
        this.logger.info("📋 URL Copied to Clipboard");
        this.logger.info(
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        );
        this.logger.info("");
        this.logger.info("✅ The OAuth URL has been copied to your clipboard.");
        this.logger.info(
          "📝 Paste it into your browser to complete authentication."
        );
        this.logger.info("");
        this.logger.info("⏳ Waiting for authentication to complete...");
        this.logger.info("   (This will timeout in 5 minutes)");
        this.logger.info("");
      }
    });
  }

  private showManualInstructions(url: string): void {
    this.logger.info("");
    this.logger.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    this.logger.info("📋 Manual Authentication");
    this.logger.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    this.logger.info("");
    this.logger.info(
      "Please manually copy and paste this URL into your browser:"
    );
    this.logger.info("");
    this.logger.info(`🔗 ${url}`);
    this.logger.info("");
    this.logger.info("⏳ Waiting for authentication to complete...");
    this.logger.info("   (This will timeout in 5 minutes)");
    this.logger.info("");
  }

  private async performBrowserOpen(url: string): Promise<void> {
    this.logger.progress("Opening browser...");

    try {
      await open(this.sanitizeUrl(url.toString()));
      this.logger.info("Browser opened automatically.");
    } catch (error) {
      this.logger.error(
        "Could not open browser automatically. Please copy and paste the URL above into your browser."
      );
      this.logger.debug("Failed to open browser", error);
    }
  }

  // Only localhost is allowed as callback
  private sanitizeUrl(raw: string): string {
    try {
      const url = new URL(raw, "http://localhost");
      if (
        url.protocol === "http:" ||
        url.protocol === "https:" ||
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1"
      ) {
        return url.toString();
      }
      return "about:blank";
    } catch {
      return "about:blank";
    }
  }
}
