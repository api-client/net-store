import http from 'http';
import { WebSocket } from 'ws';
import { IUser, IBackendCommand, IWorkspace } from '@advanced-rest-client/core';
import { SocketRoute } from './SocketRoute.js';

/**
 * A route for the web socket server that serves the information about 
 * user spaces.
 * 
 * The client can:
 * - listen for the changes in the spaces (listing)
 * - create a space
 */
export class SpacesWsRoute extends SocketRoute {
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
    await this.store.createUserSpace(body.key, body, user, 'owner');
  }
}
