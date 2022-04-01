/* eslint-disable import/no-named-as-default-member */
import http from 'http';
import { WebSocket } from 'ws';
import { IUser, IBackendCommand } from '@api-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import { SocketRoute } from './SocketRoute.js';

/**
 * A route for the web socket server that serves the information about 
 * a single project.
 * 
 * The client can:
 * - observe changes to a project
 * - patch a project
 * - delete a project (note, this will close the connection to the server)
 */
export default class ProjectWsRoute extends SocketRoute {
  async isAuthorized(user?: IUser): Promise<boolean> {
    if (!user) {
      return false;
    }
    const spaceId = this.route[1];
    const projectId = this.route[3];
    let valid = false;
    try {
      await this.store.project.checkAccess('reader', spaceId, projectId, user);
      valid = true;
    } catch (e) {
      // ...
    }
    return valid;
  }

  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
    ws.on('message', this._messageHandler.bind(this, ws))
  }

  protected async _messageHandler(ws: WebSocket, command: IBackendCommand): Promise<void> {
    let promise: Promise<void> | undefined;
    switch (command.operation) {
      case 'patch': promise = this.handleProjectPatch(ws, command.value as JsonPatch); break;
      case 'delete': promise = this.handleProjectDelete(ws); break;
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

  protected async handleProjectPatch(ws: WebSocket, patch: JsonPatch): Promise<void> {
    const user = this.getUserInfo(ws);
    if (!user) {
      throw new Error(`Unauthorized`);
    }
    const space = this.route[1];
    const project = this.route[3];
    const isValid = ooPatch.valid(patch);
    if (!isValid) {
      throw new Error(`Invalid patch information.`);
    }
    const data = await this.store.project.read(space, project, user);
    const result = ooPatch.apply(data, patch, { reversible: true });
    try {
      await this.store.project.update(space, project, result.doc, patch, user);
      await this.store.revisions.addProject(space, project, result.revert);
    } catch (e) {
      const error = e as Error;
      this.logger.error(e);
      this.sendError(ws, `Unable to process message. ${error.message}`);
    }
  }

  protected async handleProjectDelete(ws: WebSocket): Promise<void> {
    const user = this.getUserInfo(ws);
    if (!user) {
      throw new Error(`Unauthorized`);
    }
    const space = this.route[1];
    const project = this.route[3];
    try {
      await this.store.project.delete(space, project, user);
    } catch (e) {
      const error = e as Error;
      this.logger.error(e);
      this.sendError(ws, `Unable to process message. ${error.message}`);
    }
  }
}
