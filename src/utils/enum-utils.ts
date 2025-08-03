import { TransportType } from "../constants/enum.js";

export function getTransportType(args: Array<string>): TransportType {
  for (const value of Object.values(TransportType)) {
    if (args.includes(value)) {
      return value as TransportType;
    }
  }

  return TransportType.PROXY_HTTP;
}
