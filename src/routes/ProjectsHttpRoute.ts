import { ParameterizedContext } from 'koa';
import { IHttpProject } from '@advanced-rest-client/core';
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
    const baseRoute = RouteBuilder.buildSpaceProjectsRoute(':space');
    router.get(baseRoute, this.handleProjectsList.bind(this));
    router.post(baseRoute, this.handleProjectCreate.bind(this));
  }

  async handleProjectsList(ctx: ParameterizedContext): Promise<void> {
    const { space } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.listSpaceProjects(space, options, user);
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
      await this.store.createSpaceProject(space, body.key, body, user);
      ctx.status = 204;
      const spacePath = RouteBuilder.buildSpaceProjectRoute(space, body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
