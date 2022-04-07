import http from 'http';
import { WebSocket } from 'ws';
import { IUser } from '@api-client/core';
import { SocketRoute } from './SocketRoute.js';

/**
 * A route for the web socket server that serves the information about 
 * a user file.
 */
export default class FileWsRoute extends SocketRoute {
  async isAuthorized(user?: IUser): Promise<boolean> {
    if (!user) {
      return false;
    }
    const fileId = this.route[1];
    let valid = false;
    try {
      await this.store.file.checkAccess('reader', fileId, user);
      valid = true;
    } catch (e) {
      // ...
    }
    return valid;
  }
  
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
  }
}
