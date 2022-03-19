import http from 'http';
import { WebSocket } from 'ws';
import { IUser, IBackendCommand, IWorkspace } from '@api-client/core';
import { SocketRoute } from './SocketRoute.js';

/**
 * A route for the web socket server that serves the information about 
 * user spaces.
 * 
 * The client can:
 * - listen for the changes in the spaces (listing)
 * - create a space
 */
export default class SpacesWsRoute extends SocketRoute {

  async isAuthorized(user?: IUser): Promise<boolean> {
    if (!user) {
      return false;
    }
    return true;
  }
  
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
    ws.on('message', this._messageHandler.bind(this, ws));
  }

  protected async _messageHandler(ws: WebSocket, command: IBackendCommand): Promise<void> {
    let promise: Promise<void> | undefined;
    switch (command.operation) {
      case 'create': promise = this.handleSpaceCreate(ws, command.value as IWorkspace); break;
    }
    if (!promise) {
      this.sendError(ws, `Unsupported command for /projects route.`);
      return;
    }
    try {
      await promise;
    } catch (e) {
      const error = e as Error;
      this.logger.error(e);
      this.sendError(ws, `Unable to process projects collection. ${error.message}`);
      return;
    }
  }

  protected async handleSpaceCreate(ws: WebSocket, body: IWorkspace): Promise<void> {
    const user = this.getUserInfo(ws);
    if (!user) {
      throw new Error(`Unauthorized`);
    }
    if (!body || !body.key) {
      throw new Error('Invalid space definition.');
    }
    try {
      await this.store.space.add(body.key, body, user, 'owner');
    } catch (e) {
      const error = e as Error;
      this.logger.error(e);
      this.sendError(ws, `Unable to process the message. ${error.message}`);
      return;
    }
  }
}
