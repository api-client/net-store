import { ParameterizedContext } from 'koa';
import { IHttpProject, IUser } from '@api-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';

/**
 * An HTTP route for the server that serves the information about 
 * space's projects.
 * 
 * The client can:
 * - list current projects (listing)
 * - create a project
 */
export class ProjectsHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const projectsRoute = RouteBuilder.buildSpaceProjectsRoute(':space');
    router.get(projectsRoute, this.handleProjectsList.bind(this));
    router.post(projectsRoute, this.handleProjectCreate.bind(this));

    const projectPath = RouteBuilder.buildSpaceProjectRoute(':space', ':project');
    router.get(projectPath, this.handleProjectRead.bind(this));
    router.patch(projectPath, this.handleProjectPatch.bind(this));
    router.delete(projectPath, this.handleProjectDelete.bind(this));

    const revisionsPath = RouteBuilder.buildProjectRevisionsRoute(':space', ':project');
    router.get(revisionsPath, this.handleRevisionsList.bind(this));
  }

  async handleProjectsList(ctx: ParameterizedContext): Promise<void> {
    const { space } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.project.list(space, user, options);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  async handleProjectCreate(ctx: ParameterizedContext): Promise<void> {
    const { space } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IHttpProject;
      if (!body || !body.key) {
        throw new ApiError('Invalid project definition.', 400);
      }
      await this.store.project.add(space, body.key, body, user);
      ctx.status = 204;
      const spacePath = RouteBuilder.buildSpaceProjectRoute(space, body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
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
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
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
      await this.store.project.update(space, project, result.doc, patch, user);
      await this.store.revisions.addProject(space, project, result.revert);
      ctx.body = {
        status: 'OK',
        revert: result.revert,
      };
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleRevisionsList(ctx: ParameterizedContext): Promise<void> {
    const space = ctx.params.space as string;
    const project = ctx.params.project as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.revisions.listProject(space, project, user, options);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
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
  protected async readProjectAndCache(space: string, project: string, user: IUser): Promise<IHttpProject> {
    const cached = this.projectsCache.get(project);
    if (cached) {
      if (cached.space !== space) {
        throw new ApiError(`Space not found.`, 404);
      }
      return cached.data;
    }
    const result = await this.store.project.read(space, project, user);
    if (!result) {
      throw new ApiError('Not found.', 404);
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
      await this.store.project.delete(space, project, user);
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
