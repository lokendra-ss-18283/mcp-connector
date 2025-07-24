import { existsSync, readdirSync, rmSync } from "fs";
import {
  codeVerifierStore,
  DefaultAuthProvider,
  globalStateStore,
  globalStateStoreCompleted,
} from "../auth/auth-provider.js";
import { TokenManager } from "../auth/token-manager.js";
import { GLOBAL_SERVER_CONFIGS } from "../cli.js";
import { pendingInitErrors, proxyInstances } from "../proxy/mcp-proxy.js";
import { logger } from "./file-logger.js";
import { join } from "path";

export const cleanupOnExit = async () => {
  // Clean up proxy instances
  if (typeof proxyInstances !== "undefined") {
    for (const [hash, instance] of proxyInstances.entries()) {
      try {
        instance.transportToClient?.close?.();
        instance.transportToServer?.close?.();
      } catch (e) {
        console.log("Error in proxy instances clean up :: ", e);
      }
      proxyInstances.delete(hash);
    }
  }

  // Clean up pending init errors
  if (typeof pendingInitErrors !== "undefined") {
    pendingInitErrors.clear();
  }

  // Clean up global state stores
  if (typeof globalStateStore !== "undefined") {
    globalStateStore.clear();
  }
  if (typeof globalStateStoreCompleted !== "undefined") {
    globalStateStoreCompleted.clear();
  }

  // Clean up token manager data
  try {
    const tokenManager = new TokenManager(logger);
    tokenManager.cleanExpiredTokens();
  } catch (e) {
    console.log("Error in token clean up :: ", e);
  }

  // Clean up OAuth proxy server if running
  try {
    if (
      typeof DefaultAuthProvider !== "undefined" &&
      DefaultAuthProvider.oauthProxy
    ) {
      await DefaultAuthProvider.oauthProxy.stop?.(logger);
      DefaultAuthProvider.oauthProxy = null;
    }
  } catch (e) {
    console.log("Error in proxy server clean up :: ", e);
  }

  // Clean up code verifier store
  if (typeof codeVerifierStore !== "undefined") {
    codeVerifierStore.clear();
  }

  // Clean up server configs
  if (typeof GLOBAL_SERVER_CONFIGS !== "undefined") {
    GLOBAL_SERVER_CONFIGS.clear();
  }

  logger.info("🧹 Cleaned up all process data before exit.");
};

export const onProcessStart = () => {
  // remove folders which are not in map and remove urls from map if no folders exist
  try {
    const tokenManager = new TokenManager(logger);
    const getUrlMap: Record<string, string> =
      tokenManager.getUrlInHashMapFile();
    const hashKeys = Object.keys(getUrlMap);

    readdirSync(tokenManager.getMcpConnectFolderPath(), {
      withFileTypes: true,
    }).filter((d) => d.isDirectory()).map((dir) => {
      if(!hashKeys.includes(dir.name)) {
        if(existsSync(join(dir.parentPath, dir.name))) {
          rmSync(join(dir.parentPath, dir.name), { recursive: true, force: true })
        }
      }
    })

    if (hashKeys.length > 0) {
      let needsHashFileUpdate = false;
      hashKeys.map((key: string) => {
        const isFolderPresent = existsSync(
          join(tokenManager.getMcpConnectFolderPath(), key)
        );
        if (!isFolderPresent) {
          delete getUrlMap[key];
          needsHashFileUpdate = true;
        }
      });

      if (needsHashFileUpdate) {
        tokenManager.updateUrlHashMapFile(getUrlMap);
      }
    }
  } catch (error) {
    console.log("Error in url has map clean up :: ", error);
  }
}