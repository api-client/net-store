import { ParameterizedContext } from 'koa';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';
import { IApplicationState } from '../definitions.js';

/**
 * A route that handles client sessions.
 * 
 * Clients can:
 * - start a new session
 * - delete a session
 * - validate session token.
 */
export class SessionHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const baseRoute = RouteBuilder.buildSessionsRoute();
    router.post(baseRoute, this.handleSessionCreate.bind(this));
    router.post(RouteBuilder.buildSessionRenewRoute(), this.handleSessionRenew.bind(this));
  }

  /**
   * A handler to create a user session in the store.
   * 
   * It generates a JWT with some very basic information.
   */
  protected async handleSessionCreate(ctx: ParameterizedContext): Promise<void> {
    try {
      const token = await this.session.generateUnauthenticatedSession();
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  /**
   * A handler to create a user session in the store.
   */
  protected async handleSessionRenew(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      if (!ctx.state.sid || !ctx.state.user) {
        throw new ApiError('Not authorized', 401);
      }
      const token = await this.session.generateAuthenticatedSession(ctx.state.sid, ctx.state.user.key);
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }
}
