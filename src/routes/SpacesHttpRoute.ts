import { ParameterizedContext } from 'koa';
import { IWorkspace } from '@advanced-rest-client/core';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';
import { IApplicationState } from '../definitions.js';

/**
 * An HTTP route for the server that serves the information about 
 * user spaces.
 * 
 * The client can:
 * - list current spaces (listing)
 * - create a space
 */
export class SpacesHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const spacesPath = RouteBuilder.buildSpacesRoute();
    router.get(spacesPath, this.handleSpacesList.bind(this));
    router.post(spacesPath, this.handleSpaceCreate.bind(this));
  }

  /**
   * Handles for spaces listing.
   */
  protected async handleSpacesList(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.listUserSpaces(options, user);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handles for creating a space.
   */
  protected async handleSpaceCreate(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IWorkspace;
      if (!body || !body.key) {
        throw new ApiError('Invalid space definition.', 400);
      }
      await this.store.createUserSpace(body.key, body, user, 'owner');
      ctx.status = 204;
      const spacePath = RouteBuilder.buildSpaceRoute(body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
