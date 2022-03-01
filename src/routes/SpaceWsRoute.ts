import http from 'http';
import { WebSocket } from 'ws';
import { IUser } from '@advanced-rest-client/core';
import { SocketRoute } from './SocketRoute.js';
/**
 * A route for the web socket server that serves the information about 
 * a single space.
 * 
 * The client can:
 * - list space projects (listing)
 * - observe list of projects (listing)
 */
export class SpaceWsRoute extends SocketRoute {
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
  }
}
