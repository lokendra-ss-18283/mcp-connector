import { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth";

export interface MCPServerConfig {
  name: string;
  url: string; // Now supports http://, https://
  port?: number;
}

export interface TokenSchema extends OAuthTokens {
  createdAt?: number
}

export interface TokensList {
  tokenDetails: TokenSchema,
  url: string
}