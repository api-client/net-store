import { WebSocket, RawData } from 'ws';
export { RawData };

export default class WsHelper {
  /**
   * Creates a WS client with optional token
   * @param addr The ws:// address
   * @param token Optional token to add.
   */
  getClient(addr: string, token?: string): WebSocket {
    let url = addr;
    if (token) {
      url += url.includes('?') ? '&' : '?';
      url += 'token=';
      url += token;
    }
    return new WebSocket(url);
  }

  /**
   * Connect to the WS server
   * 
   * @param client The client to wait for connection.
   */
  connect(client: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      client.once('open', () => {
        client.removeAllListeners('error');
        resolve();
      });
      client.once('error', (err) => {
        client.removeAllListeners('open');
        reject(err);
      });
    });
  }

  disconnect(client: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      client.once('close', () => {
        client.removeAllListeners('error');
        resolve();
      });
      client.once('error', (err) => {
        client.removeAllListeners('close');
        reject(err);
      });
      client.close();
    });
  }

  /**
   * The combination of `getClient()` and `connect()`.
   */
  async createAndConnect(addr: string, token?: string): Promise<WebSocket> {
    const client = this.getClient(addr, token);
    await this.connect(client);
    return client;
  }
}
