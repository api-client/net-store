import http from 'http';
import { WebSocket } from 'ws';
import { SocketRoute } from './SocketRoute.js';

/**
 * A route for the web socket server that serves the information about 
 * a single project.
 * 
 * The client can:
 * - observe changes to an authentication state.
 */
export class AuthWsRoute extends SocketRoute {
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: any, sid?: string): void {
    this.registerClient(ws, undefined, sid);
  }

  async isAuthorized(): Promise<boolean> {
    return true;
  }
}
