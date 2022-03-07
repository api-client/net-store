/* eslint-disable import/no-named-as-default-member */
import http from 'http';
import { WebSocket } from 'ws';
import { IUser, IBackendCommand, IWorkspace } from '@api-client/core';
import { SocketRoute } from './SocketRoute.js';
import ooPatch, { JsonPatch } from 'json8-patch';

/**
 * A route for the web socket server that serves the information about 
 * a single space.
 * 
 * The client can:
 * - observe list of projects (listing)
 * - create a space
 */
export class SpaceWsRoute extends SocketRoute {

  async isAuthorized(user?: IUser): Promise<boolean> {
    if (!user) {
      return false;
    }
    const spaceId = this.route[1];
    let valid = false;
    try {
      await this.store.checkSpaceAccess('read', spaceId, user);
      valid = true;
    } catch (e) {
      // ...
    }
    return valid;
  }
  
  protected _connectionHandler(ws: WebSocket, request: http.IncomingMessage, user?: IUser, sid?: string): void {
    this.registerClient(ws, user, sid);
  }

  protected async _messageHandler(ws: WebSocket, command: IBackendCommand): Promise<void> {
    let promise: Promise<void> | undefined;
    switch (command.operation) {
      case 'create': promise = this.handleSpacePatch(ws, command.value as JsonPatch); break;
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

  protected async handleSpacePatch(ws: WebSocket, patch: JsonPatch): Promise<void> {
    const user = this.getUserInfo(ws);
    if (!user) {
      throw new Error(`Unauthorized`);
    }
    const spaceKey = this.route[1];
    const userSpace = await this.store.readUserSpace(spaceKey, user) as any;
    delete userSpace.access;
    const space = userSpace as IWorkspace;
    const isValid = ooPatch.valid(patch);
    if (!isValid) {
      throw new Error(`Invalid patch information.`);
    }
    const result = ooPatch.apply(space, patch, { reversible: true });
    await this.store.updateUserSpace(spaceKey, result.doc as IWorkspace, patch, user);
    // TODO: Create spaces revision history
  }
}
