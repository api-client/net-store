import http from 'http';
import { WebSocket } from 'ws';
import { IUser } from '@api-client/core';
import { SocketRoute } from './SocketRoute.js';

/**
 * A route for the web socket server that serves application specific data (collection and the data)
 */
export default class AppWsRoute extends SocketRoute {
  /**
   * Here the user is always authorized because this space does not support sharing
   * and the path is depending on the current user.
   */
  async isAuthorized(user?: IUser): Promise<boolean> {
    if (!user) {
      return false;
    }
    return true;
  }
  
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
  }
}
