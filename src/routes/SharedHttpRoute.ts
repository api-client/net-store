/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { RouteBuilder, ApiError } from '@api-client/core';
import { BaseRoute } from './BaseRoute.js';

/**
 * A route that handles shared items.
 * 
 * Clients can:
 * - list shared items
 */
export default class SharedHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const spacesRoute = RouteBuilder.shared();
    router.get(spacesRoute, this.listSpacesRoute.bind(this));
  }

  protected async listSpacesRoute(ctx: ParameterizedContext): Promise<void> {
    if (this.info.info.mode !== 'multi-user') {
      this.errorResponse(ctx, new ApiError('Not available in the non-multi-user mode', 400));
      return;
    }
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const kinds = this.listKinds(ctx);
      const result = await this.store.shared.list(user, kinds, options);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
