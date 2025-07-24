import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { DEBUG_MODE } from "../cli.js";

export class FileLogger {
  private logPath: string;
  private logFile: string;

  constructor(serverName: string, urlHash: string) {
    if(serverName === "default") {
      this.logPath = join(homedir(), ".mcp-connector");
      this.logFile = join(this.logPath, `mcp-connector-${new Date().toISOString().split('T')[0]}.log`);
    } else {
      this.logPath = join(homedir(), ".mcp-connector", urlHash);
      this.logFile = join(this.logPath, `${serverName}.log`);
    }
    this.ensureLogDirectoryExists();
  }

  private ensureLogDirectoryExists(): void {
    try {
      if (!existsSync(this.logPath)) {
        mkdirSync(this.logPath, { recursive: true });
      }
    } catch {
      console.log("Error while creating log directory :: ", this.logPath);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${dataStr}\n`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private writeLog(level: string, message: string, data?: any): void {
    try {
      const logEntry = this.formatMessage(level, message, data);
      appendFileSync(this.logFile, logEntry, 'utf8');
    } catch(e: unknown) {
      console.log("Error while writing log to file :: ", this.logFile, e);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(message: string, data?: any): void {
    if(DEBUG_MODE) {
      this.writeLog('debug', message, data);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(message: string, data?: any): void {
    this.writeLog('info', message, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(message: string, data?: any): void {
    this.writeLog('warn', message, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(message: string, data?: any): void {
    this.writeLog('error', message, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  success(message: string, data?: any): void {
    this.writeLog('success', message, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oauth(message: string, data?: any): void {
    this.writeLog('oauth', message, data);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  progress(message: string, data?: any): void {
    this.writeLog('progress', message, data);
  }
}

export function createLogger(serverName: string, urlHash: string) {
  return new FileLogger(serverName, urlHash);
}

export const logger = new FileLogger("default", "");
