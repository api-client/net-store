import http from 'http';
import { WebSocket } from 'ws';
import { IUser } from '@advanced-rest-client/core';
import { SocketRoute } from './SocketRoute.js';

/**
 * The client can:
 * - observe changes to the list of projects
 */
export class ProjectsWsRoute extends SocketRoute {
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
  }
}
