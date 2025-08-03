import { MCPServerConfig } from "../interface/interface.js";
import { FileLogger } from "../utils/file-logger.js";

export abstract class BaseClient {
  protected logger: FileLogger;
  protected server: MCPServerConfig;

  constructor(server: MCPServerConfig, logger: FileLogger) {
    this.server = server;
    this.logger = logger;
  }

  abstract setup(): Promise<void>;
}
