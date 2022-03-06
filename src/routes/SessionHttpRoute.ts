import { ParameterizedContext } from 'koa';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';
import { IApplicationState } from '../definitions.js';
import DefaultUser from '../authentication/DefaultUser.js';

/**
 * A route that handles client sessions.
 * 
 * Clients can:
 * - start a new session
 * - delete a session
 * - validate session token
 */
export class SessionHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const baseRoute = RouteBuilder.buildSessionsRoute();
    if (this.info.mode === 'multi-user') {
      router.post(baseRoute, this.handleMultiUserModeSessionCreate.bind(this));
    } else {
      router.post(baseRoute, this.handleSingleUserModeSessionCreate.bind(this));
    }
    router.post(RouteBuilder.buildSessionRenewRoute(), this.handleSessionRenew.bind(this));
  }

  /**
   * A handler to create a user session in the store.
   * 
   * It generates a JWT with some very basic information.
   */
  protected async handleMultiUserModeSessionCreate(ctx: ParameterizedContext): Promise<void> {
    try {
      const token = await this.session.generateUnauthenticatedSession();
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * IN a single user mode this endpoint always creates authenticated token for the default user.
   */
  protected async handleSingleUserModeSessionCreate(ctx: ParameterizedContext): Promise<void> {
    try {
      const token = await this.session.generateAuthenticatedSession(DefaultUser.key, 'default-sid');
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
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
      const token = await this.session.generateAuthenticatedSession(ctx.state.user.key, ctx.state.sid);
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
