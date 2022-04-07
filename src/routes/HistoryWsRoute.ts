import http from 'http';
import { WebSocket } from 'ws';
import { IUser } from '@api-client/core';
import { SocketRoute } from './SocketRoute.js';

export default class HistoryWsRoute extends SocketRoute {
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
