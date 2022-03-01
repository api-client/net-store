/* eslint-disable import/no-named-as-default-member */
import http from 'http';
import { WebSocket } from 'ws';
import { IUser, IBackendCommand, IHttpProject } from '@advanced-rest-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import { SocketRoute } from './SocketRoute.js';
import projectsCache from '../cache/ProjectsCache.js';

/**
 * A route for the web socket server that serves the information about 
 * a single project.
 * 
 * The client can:
 * - observe changes to a project
 * - patch a project
 * - delete a project (note, this will close the connection to the server)
 */
export class ProjectWsRoute extends SocketRoute {
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
      console.error(e);
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
    const data = await this.readProjectAndCache(space, project, user);
    const result = ooPatch.apply(data, patch, { reversible: true });
    await this.store.updateSpaceProject(space, project, result.doc, patch, user);
    await this.store.addProjectRevision(space, project, result.revert);
  }

  protected async handleProjectDelete(ws: WebSocket): Promise<void> {
    const user = this.getUserInfo(ws);
    if (!user) {
      throw new Error(`Unauthorized`);
    }
    const space = this.route[1];
    const project = this.route[3];
    await this.store.deleteSpaceProject(space, project, user);
  }

  /**
   * If the project is cached in memory it returns the cached project. Otherwise it reads the project
   * from the store and puts it into the cache.
   * 
   * @param space The key of the owning space.
   * @param project The key of the project.
   * @param user Optional user to test the authorization for
   * @returns The project information. It throws when project is not found.
   */
  protected async readProjectAndCache(space: string, project: string, user?: IUser): Promise<IHttpProject> {
    const cached = projectsCache.get(project);
    if (cached) {
      return cached.data;
    }
    const result = await this.store.readSpaceProject(space, project, user);
    if (!result) {
      throw new Error('Project not found.');
    }
    projectsCache.set(space, project, result);
    return result;
  }
}
