import { ParameterizedContext } from 'koa';
import { RouteBuilder } from '@api-client/core';
import { BaseRoute } from './BaseRoute.js';

/**
 * An HTTP route to read information about the backend configuration that is relevant
 * to the clients.
 */
export default class BackendHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const baseRoute = RouteBuilder.backend();
    router.get(baseRoute, this.handleStoreInfo.bind(this));
  }

  protected async handleStoreInfo(ctx: ParameterizedContext): Promise<void> {
    const info = this.info.toJSON();
    ctx.body = info;
    ctx.type = 'application/json';
    ctx.status = 200;
  }
}
