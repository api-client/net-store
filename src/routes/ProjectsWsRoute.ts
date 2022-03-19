import http from 'http';
import { WebSocket } from 'ws';
import { IUser, IBackendCommand, IHttpProject } from '@api-client/core';
import { SocketRoute } from './SocketRoute.js';

/**
 * The client can:
 * - observe changes to the list of projects
 * - create a project
 */
export default class ProjectsWsRoute extends SocketRoute {
  async isAuthorized(user: IUser): Promise<boolean> {
    if (!user) {
      return false;
    }
    const spaceId = this.route[1];
    const projectId = this.route[3];
    let valid = false;
    try {
      await this.store.project.checkAccess('read', spaceId, projectId, user);
      valid = true;
    } catch (e) {
      // ...
    }
    return valid;
  }

  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
    ws.on('message', this._messageHandler.bind(this, ws));
  }

  protected async _messageHandler(ws: WebSocket, command: IBackendCommand): Promise<void> {
    let promise: Promise<void> | undefined;
    switch (command.operation) {
      case 'create': promise = this.handleProjectCreate(ws, command.value as IHttpProject); break;
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
      this.sendError(ws, `Unable to process message. ${error.message}`);
    }
  }

  protected async handleProjectCreate(ws: WebSocket, body: IHttpProject): Promise<void> {
    const user = this.getUserInfo(ws);
    if (!user) {
      throw new Error(`Unauthorized`);
    }
    if (!body || !body.key) {
      throw new Error('Invalid Http Project definition.');
    }
    const space = this.route[1];
    try {
      await this.store.project.add(space, body.key, body, user);
    } catch (e) {
      const error = e as Error;
      this.logger.error(e);
      this.sendError(ws, `Unable to process message. ${error.message}`);
    }
  }
}
