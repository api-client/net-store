/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { IHttpProject, IUser } from '@advanced-rest-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import Router from '@koa/router';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';
import { StorePersistence } from '../persistence/StorePersistence.js';
import { ProjectsCache } from '../cache/ProjectsCache.js';
import { BackendInfo } from '../BackendInfo.js';
import { AppSession } from '../session/AppSession.js';

/**
 * An HTTP route for the server that serves the information about 
 * a project.
 * 
 * This route is expecting a high volume of traffic.
 * 
 * The client can:
 * - read project data.
 * - patch project data
 * - delete a project
 * 
 * @TODO: We should consider a queue mechanism for updating the project data. Especially,
 * when we would like to run the store in a separate process.
 */
export class ProjectHttpRoute extends BaseRoute {
  protected projectsCache: ProjectsCache;
  /**
   * @param router The Koa router instance to append paths to.
   * @param store The instance of the storage layer for the routes.
   */
  constructor(router: Router, store: StorePersistence, info: BackendInfo, session: AppSession, projectsCache: ProjectsCache) {
    super(router, store, info, session);
    this.projectsCache = projectsCache;
  }

  async setup(): Promise<void> {
    const { router } = this;
    const basePath = RouteBuilder.buildSpaceProjectRoute(':space', ':project');
    router.get(basePath, this.handleProjectRead.bind(this));
    router.patch(basePath, this.handleProjectPatch.bind(this));
    router.delete(basePath, this.handleProjectDelete.bind(this));

    const revisionsPath = RouteBuilder.buildProjectRevisionsRoute(':space', ':project');
    router.get(revisionsPath, this.handleRevisionsList.bind(this));
  }

  /**
   * A handler for reading project data.
   */
  protected async handleProjectRead(ctx: ParameterizedContext): Promise<void> {
    const space = ctx.params.space as string;
    const project = ctx.params.project as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const data = await this.readProjectAndCache(space, project, user);
      ctx.body = data;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  /**
   * A handler for patching a project data.
   */
  protected async handleProjectPatch(ctx: ParameterizedContext): Promise<void> {
    const space = ctx.params.space as string;
    const project = ctx.params.project as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const data = await this.readProjectAndCache(space, project, user);
      const patch = await this.readJsonBody(ctx.request) as JsonPatch;
      const isValid = ooPatch.valid(patch);
      if (!isValid) {
        throw new ApiError(`Invalid patch information.`, 400);
      }
      const result = ooPatch.apply(data, patch, { reversible: true });
      await this.store.updateSpaceProject(space, project, result.doc, patch, user);
      await this.store.addProjectRevision(space, project, result.revert);
      ctx.body = {
        status: 'OK',
        revert: result.revert,
      };
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  protected async handleRevisionsList(ctx: ParameterizedContext): Promise<void> {
    const space = ctx.params.space as string;
    const project = ctx.params.project as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.listProjectRevisions(space, project, options, user);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
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
    const cached = this.projectsCache.get(project);
    if (cached) {
      return cached.data;
    }
    const result = await this.store.readSpaceProject(space, project, user);
    if (!result) {
      throw new ApiError('Project not found.', 404);
    }
    this.projectsCache.set(space, project, result);
    return result;
  }

  /**
   * Removes a project from the space.
   */
  protected async handleProjectDelete(ctx: ParameterizedContext): Promise<void> {
    const space = ctx.params.space as string;
    const project = ctx.params.project as string;
    try {
      const user = this.getUserOrThrow(ctx);
      await this.store.deleteSpaceProject(space, project, user);
      ctx.status = 204;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }
}
