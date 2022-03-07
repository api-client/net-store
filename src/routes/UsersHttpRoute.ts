import { ParameterizedContext } from 'koa';
import { BaseRoute } from './BaseRoute.js';
import { RouteBuilder } from './RouteBuilder.js';
import { IApplicationState } from '../definitions.js';

export class UsersHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    router.get(RouteBuilder.buildUsersMeRoute(), this.handleMe.bind(this));
  }

  /**
   * A handler to create a user session in the store.
   * 
   * It generates a JWT with some very basic information.
   */
  protected async handleMe(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      if (!ctx.state.sid) {
        ctx.status = 400;
        ctx.set('location', RouteBuilder.buildSessionsRoute());
        ctx.body = this.wrapError(new Error('Session not initialized'), 400);
        return;
      }
      if (ctx.state.user) {
        const user = { ...ctx.state.user };
        delete user.provider;
        ctx.body = user;
        ctx.type = 'text';
        ctx.status = 200;
      } else {
        ctx.status = 401;
        ctx.set('location', '/auth/login');
      }
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * This route allows to list all users in the org which is primarily targeted for autocomplete 
   * when sharing spaces.
   * 
   * Additionally the request may contain the `q` query parameter which is used to filter users by name / email.
   */
  protected async listUsers(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.listSystemUsers(options, user);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
