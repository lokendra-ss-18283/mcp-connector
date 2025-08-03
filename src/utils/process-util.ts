import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";

import { DefaultAuthProvider } from "../auth/auth-provider.js";
import { TokenManager } from "../auth/token-manager.js";
import { AUTH_CONSTANTS, ROOT_CONFIG } from "../constants/constants.js";

import { logger } from "./file-logger.js";

export const cleanupOnExit = async () => {
  // Clean up proxy instances
  if (typeof AUTH_CONSTANTS.proxyInstances !== "undefined") {
    for (const [hash, instance] of AUTH_CONSTANTS.proxyInstances.entries()) {
      try {
        instance.clientTransport?.close?.();
        instance.serverTransport?.close?.();
      } catch (e) {
        console.log("Error in proxy instances clean up :: ", e);
      }
      AUTH_CONSTANTS.proxyInstances.delete(hash);
    }
  }

  // Clean up pending init errors
  if (typeof AUTH_CONSTANTS.msgStalledByAuth !== "undefined") {
    AUTH_CONSTANTS.msgStalledByAuth.clear();
  }

  // Clean up global state stores
  if (typeof AUTH_CONSTANTS.globalStateStore !== "undefined") {
    AUTH_CONSTANTS.globalStateStore.clear();
  }
  if (typeof AUTH_CONSTANTS.globalStateStoreCompleted !== "undefined") {
    AUTH_CONSTANTS.globalStateStoreCompleted.clear();
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
    }
  } catch (e) {
    console.log("Error in proxy server clean up :: ", e);
  }

  // Clean up code verifier store
  if (typeof AUTH_CONSTANTS.codeVerifierStore !== "undefined") {
    AUTH_CONSTANTS.codeVerifierStore.clear();
  }

  // Clean up server configs
  if (typeof ROOT_CONFIG.servers !== "undefined") {
    ROOT_CONFIG.servers.clear();
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
    })
      .filter((d) => d.isDirectory())
      .map((dir) => {
        if (!hashKeys.includes(dir.name)) {
          if (existsSync(join(dir.parentPath, dir.name))) {
            rmSync(join(dir.parentPath, dir.name), {
              recursive: true,
              force: true,
            });
          }
        }
      });

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
};
