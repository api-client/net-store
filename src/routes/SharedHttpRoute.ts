/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { RouteBuilder } from '@api-client/core';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';

/**
 * A route that handles shared items.
 * 
 * Clients can:
 * - list shared items
 */
export default class SharedHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const spacesRoute = RouteBuilder.sharedSpaces();
    router.get(spacesRoute, this.listSpacesRoute.bind(this));
  }

  protected async listSpacesRoute(ctx: ParameterizedContext): Promise<void> {
    if (this.info.mode !== 'multi-user') {
      this.errorResponse(ctx, new ApiError('Not available in the non-multi-user mode', 400));
      return;
    }
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.shared.listSpaces(user, options);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
