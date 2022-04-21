import { OutgoingHttpHeaders } from "http";

export interface IProxyResult {
  status?: number;
  headers?: OutgoingHttpHeaders;
  body?: Buffer;
}


export default abstract class Proxy {
  /**
   * The time when this class was initialized.
   */
  time = Date.now();

  /**
   * Configures the proxy before running it.
   */
  abstract configure(...args: unknown[]): Promise<unknown>;

  /**
   * Executes the proxy.
   */
  abstract execute(body?: Buffer): Promise<IProxyResult>;
}
