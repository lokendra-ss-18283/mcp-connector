import { exec } from "child_process";

import open from "open";
import notifier from "node-notifier";

import { TokenManager } from "../auth/token-manager.js";
import { ROOT_CONFIG } from "../constants/constants.js";

import {
  createLogger,
  FileLogger,
  logger as DefaultLogger,
} from "./file-logger.js";

export class OAuthDialogManager {
  private logger: FileLogger = DefaultLogger;
  private responded: boolean = false;
  private error: boolean = false;

  constructor(url: string) {
    const { servers } = ROOT_CONFIG;
    let serverName = null;
    const hash = TokenManager.hashUrl(url);
    if (servers && servers.has(hash)) {
      serverName = servers.get(hash)!.name || null;
    }
    this.logger = serverName ? createLogger(serverName, hash) : DefaultLogger;
  }

  public async showAuthDialog(url: string): Promise<void> {
    await this.showOSPrompt(url);
  }

  private async showOSPrompt(url: string): Promise<void> {
    this.logger.info(`OAuth authentication URL: ${url}`);

    const title = "MCP Connector - OAuth Authentication";
    // Truncate URL for display if it's too long
    const displayUrl = url.length > 80 ? url.substring(0, 80) + "..." : url;
    const message = `OAuth 2.1 Authentication Required\n\nURL: ${displayUrl}\n\nA browser window will open to complete the OAuth flow.\nYou will be redirected to the authorization server to sign in.\n\nChoose an option:`;

    /**
     * Remove OS Specific modal handling
     * 
    if (process.platform.includes("darwin")) {
      try {
        const script = `tell application "System Events" to display dialog "OAuth 2.1 Authentication Required
  
  URL: ${displayUrl}
  
  A browser window will open to complete the OAuth flow. You will be redirected to the authorization server to sign in.
  
  Choose an option:" with title "${title}" buttons {"Cancel", "Copy URL", "Open Browser"} default button "Open Browser" with icon note`;

        const appleScriptRes = await this.executeAppleScript(
          "osascript",
          ["-e", script],
          url
        );
        if (appleScriptRes === "cancelled") process.exit(0);
        if (appleScriptRes === "success") {
          this.responded = true;
          return;
        }
      } catch (error) {
        this.logger.debug("Error in dialog manager in apple script :: ", error);
      }
    }
     */

    try {
      notifier.notify(
        {
          title: title,
          message: message,
          wait: true,
          actions: ["Close", "Copy URL", "Open Browser"],
          closeLabel: "Close",
          timeout: 7,
          // icon: "random.png"
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any, response: string, metadata: any) => {
          this.responded = true;
          if (err) {
            this.logger.oauth("Error in dialog box");
            this.logger.debug("Error in dialog box :: ", err);
          }

          if (response === "timeout") {
            this.logger.oauth("Dialog timeout exceeded. Opening the browser");
            this.performBrowserOpen(url);
            this.logger.oauth("Spawning browser.");
            return;
          }

          if (
            response === "close" ||
            (metadata && metadata.activationValue === "Close")
          ) {
            this.logger.oauth("OAuth Rejected. Terminating the server");
            process.exit(0);
          }

          if (response === "copy url") {
            this.copyUrlToClipboard(url);
            this.logger.oauth("OAuth URL copied to clipboard.");
            return;
          }

          this.performBrowserOpen(url);
          this.logger.oauth("Spawning browser.");
        }
      );
    } catch (error) {
      this.error = true;
      this.logger.info("Error in notifier. Will be opening browser direclty.");
      this.logger.debug(
        "Error in notifier. Will be opening browser direclty. Error :: ",
        error
      );
      this.performBrowserOpen(url);
    }

    // Wait for 7 seconds, then if no response, close notifier and open browser
    setTimeout(
      () => {
        if (!this.responded) {
          this.logger.info(
            "No response from user after 7 seconds. Opening browser automatically."
          );
          this.performBrowserOpen(url);
        }
      },
      this.error ? 0 : 7 * 1000
    );
  }

  private async executeAppleScript(
    command: string,
    args: string[],
    url: string
  ) {
    return new Promise((resolve, reject) => {
      exec(
        `${command} ${args
          .map((arg) => `'${arg.replace(/'/g, "'\"'\"'")}'`)
          .join(" ")}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (error: any, stdout: string) => {
          if (error) {
            if (error.message && error.message.includes("User cancelled")) {
              this.logger.oauth(
                "Authentication cancelled by user (macOS dialog)"
              );
              resolve("cancelled");
              return;
            }
            this.logger.warn(
              "Unable to show OS dialog, falling back to console prompt"
            );
            this.logger.debug("Dialog error:", error.message);
            reject("failure");
            return;
          }

          this.responded = true;
          const choice = stdout.trim();
          this.logger.debug(`Dialog choice: "${choice}"`);

          if (choice.toLowerCase().includes("open browser")) {
            this.performBrowserOpen(url);
          } else if (choice.toLowerCase().includes("copy url")) {
            this.copyUrlToClipboard(url);
          } else {
            this.logger.oauth("Authentication cancelled by user");
          }

          resolve("success");
        }
      );
    });
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
