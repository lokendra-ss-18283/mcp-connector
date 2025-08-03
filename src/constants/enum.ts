// In Priority Order
export enum TransportType {
  PROXY_HTTP = "--proxy-http",
  PROXY_SSE = "--proxy-sse",
}

/**
 * @description Class Based Model for Complex Enum. Will take more space than light weight enum as each class is stored as object
 * 
export class TransportType {
  static readonly PROXY_HTTP = new TransportType('--proxy-http');
  static readonly PROXY_SSE = new TransportType('--proxy-sse');
  static readonly HTTP = new TransportType('--http');
  static readonly SSE = new TransportType('--sse');

  private constructor(
    public readonly label: string,
  ) {}

  static values() {
    return [TransportType.PROXY_HTTP, TransportType.PROXY_SSE, TransportType.HTTP, TransportType.SSE];
  }
}
 */
