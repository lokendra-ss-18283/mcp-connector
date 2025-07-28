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

  public async showAuthDialog(url: string): Promise<void> {
    await this.showOSPrompt(url);
  }

  private async showOSPrompt(url: string): Promise<void> {
    this.logger.info(`OAuth authentication URL: ${url}`);

    const title = "MCP Connector - OAuth Authentication";
    // Truncate URL for display if it's too long
    const displayUrl = url.length > 80 ? url.substring(0, 80) + "..." : url;
    const message = `OAuth 2.1 Authentication Required\n\nURL: ${displayUrl}\n\nA browser window will open to complete the OAuth flow.\nYou will be redirected to the authorization server to sign in.\n\nChoose an option:`;

    if (process.platform.includes("darwin")) {
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
        return;
      }
    }

    try {
      notifier.notify(
        {
          title: title,
          message: message,
          wait: true,
          actions: ["Close", "Copy URL", "Open Browser"],
          closeLabel: "Close",
          timeout: 30,
          // icon: "random.png"
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err: any, response: string, metadata: any) => {
          console.log(err, response, metadata);
          if (err) {
            console.error("Error in dialog box");
            this.logger.oauth("Error in dialog box");
            this.logger.debug("Error in dialog box :: ", err);
          }
  
          if (response === "timeout") {
            console.log("Dialog timeout exceeded. Opening the browser");
            this.logger.oauth("Dialog timeout exceeded. Opening the browser");
            this.performBrowserOpen(url);
            this.logger.oauth("Spawning browser.");
            return;
          }
  
          if (
            response === "close" ||
            (metadata && metadata.activationValue === "Close")
          ) {
            console.log("OAuth Rejected. Terminating the server");
            this.logger.oauth("OAuth Rejected. Terminating the server");
            process.exit(0);
          }
  
          if (response === "copy url") {
            this.copyUrlToClipboard(url);
            console.log("OAuth URL copied to clipboard.");
            this.logger.oauth("OAuth URL copied to clipboard.");
            return;
          }
  
          this.performBrowserOpen(url);
          this.logger.oauth("Spawning browser.");
        }
      );
    } catch (error) {
      this.logger.info("Error in notifier. Will be opening browser direclty.")
      this.logger.debug("Error in notifier. Will be opening browser direclty. Error :: ", error)
      this.performBrowserOpen(url);
    }

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
          console.log(error, stdout);

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

          const choice = stdout.trim();
          console.log(choice);
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
