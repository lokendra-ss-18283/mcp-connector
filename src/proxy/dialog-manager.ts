import { exec } from "child_process";
import readline from "readline";
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
    let command: string;
    let args: string[];

    const title = "MCP Connector - OAuth Authentication";
    // Truncate URL for display if it's too long
    const displayUrl = url.length > 80 ? url.substring(0, 80) + "..." : url;

    switch (process.platform) {
      case "darwin": {
        // macOS
        const script = `tell application "System Events" to display dialog "OAuth 2.1 Authentication Required

URL: ${displayUrl}

A browser window will open to complete the OAuth flow. You will be redirected to the authorization server to sign in.

Choose an option:" with title "${title}" buttons {"Cancel", "Copy URL", "Open Browser"} default button "Open Browser" with icon note`;

        command = "osascript";
        args = ["-e", script];
        break;
      }
      case "win32": {
        // Windows
        const message = `OAuth 2.1 Authentication Required\\n\\nURL: ${displayUrl}\\n\\nA browser window will open to complete the OAuth flow.\\nYou will be redirected to the authorization server to sign in.\\n\\nChoose an option:`;

        command = "powershell";
        args = [
          "-Command",
          `Add-Type -AssemblyName System.Windows.Forms; $result = [System.Windows.Forms.MessageBox]::Show("${message}", "${title}", [System.Windows.Forms.MessageBoxButtons]::YesNoCancel, [System.Windows.Forms.MessageBoxIcon]::Question); if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { Write-Output "browser" } elseif ($result -eq [System.Windows.Forms.DialogResult]::No) { Write-Output "copy" } else { Write-Output "cancel" }`,
        ];
        break;
      }
      default: {
        // Linux and others
        command = "zenity";
        args = [
          "--question",
          "--title",
          title,
          "--text",
          `OAuth 2.1 Authentication Required\n\nURL: ${displayUrl}\n\nA browser window will open to complete the OAuth flow.\nYou will be redirected to the authorization server to sign in.\n\nClick Yes to open browser automatically\nClick No to copy URL\nClick Cancel to abort`,
          "--ok-label",
          "Open Browser",
          "--cancel-label",
          "Copy URL",
          "--extra-button",
          "Cancel",
        ];
        break;
      }
    }

    exec(
      `${command} ${args
        .map((arg) => `'${arg.replace(/'/g, "'\"'\"'")}'`)
        .join(" ")}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error: any, stdout: string) => {
        if (error) {
          this.logger.warn(
            "Unable to show OS dialog, falling back to console prompt"
          );
          this.logger.debug("Dialog error:", error.message);
          this.showConsoleFallback(url);
          return;
        }

        const choice = stdout.trim();
        this.logger.debug(`Dialog choice: "${choice}"`);

        if (
          choice.toLowerCase().includes("open") ||
          choice.toLowerCase().includes("browser") ||
          choice === "yes"
        ) {
          this.performBrowserOpen(url);
        } else if (
          choice.toLowerCase().includes("copy") ||
          choice.toLowerCase().includes("url") ||
          choice === "no"
        ) {
          this.copyUrlToClipboard(url);
        } else {
          this.logger.oauth("Authentication cancelled by user");
        }
      }
    );
  }

  private showConsoleFallback(url: string): void {
    this.logger.oauth("OAuth authentication required for MCP server");
    this.logger.debug(`Session URL: ${url}`);
    this.logger.info("");
    this.logger.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    this.logger.oauth("OAuth 2.1 Authentication Required");
    this.logger.info(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    );
    this.logger.info("");
    this.logger.info(`📍 URL to open: ${url}`);
    this.logger.info("");
    this.logger.info("A browser window will open to complete the OAuth flow.");
    this.logger.info(
      "You will be redirected to the authorization server to sign in."
    );
    this.logger.info("");
    this.logger.info("Options:");
    this.logger.info("  [O] Open browser automatically (recommended)");
    this.logger.info("  [C] Copy URL to clipboard");
    this.logger.info("  [X] Cancel authentication");
    this.logger.info("");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Choose an option [O/c/x]: ", (answer: string) => {
      const choice = answer.toLowerCase().trim() || "o";

      switch (choice) {
        case "o":
        case "open":
        case "browser":
          this.performBrowserOpen(url);
          break;
        case "c":
        case "copy":
        case "url":
          this.copyUrlToClipboard(url);
          break;
        case "x":
        case "cancel":
          this.logger.oauth("Authentication cancelled by user");
          break;
        default:
          this.logger.warn("Invalid choice. Defaulting to copy URL mode...");
          this.copyUrlToClipboard(url);
          break;
      }

      rl.close();
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

  private performBrowserOpen(url: string): void {
    this.logger.progress("Opening browser...");

    const openCommand =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
        ? "start"
        : "xdg-open";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exec(`${openCommand} "${url}"`, (error: any) => {
      if (error) {
        this.logger.error("Could not open browser automatically");
        this.showManualInstructions(url);
      } else {
        this.logger.success("Browser opened successfully");
        this.logger.info(
          "📝 Complete the authentication in your browser window"
        );
        this.logger.info("⏳ Waiting for authentication to complete...");
        this.logger.info("   (This will timeout in 5 minutes)");
      }
    });
  }
}
