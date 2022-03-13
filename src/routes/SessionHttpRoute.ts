/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import jwt from 'jsonwebtoken';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';
import { IApplicationState } from '../definitions.js';
import DefaultUser from '../authentication/DefaultUser.js';
import { SingleUserAuthentication } from '../authentication/SingleUserAuthentication.js';

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
    router.delete(baseRoute, this.handleSessionDelete.bind(this));
  }

  /**
   * A handler to create a user session in the store.
   * 
   * It generates a JWT with some very basic information.
   * 
   * This API is only available in the multi-user mode.
   */
  protected async handleMultiUserModeSessionCreate(ctx: ParameterizedContext): Promise<void> {
    try {
      const token = await this.session.generateUnauthenticatedSession();
      const info = jwt.decode(token) as jwt.JwtPayload;
      if (info.exp) {
        const date = new Date(info.exp);
        ctx.set('expires', date.toISOString());
      }
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * In a single user mode this endpoint always creates authenticated token for the default user.
   */
  protected async handleSingleUserModeSessionCreate(ctx: ParameterizedContext): Promise<void> {
    try {
      const token = await this.session.generateAuthenticatedSession(DefaultUser.key, SingleUserAuthentication.defaultSid);
      const info = jwt.decode(token) as jwt.JwtPayload;
      if (info.exp) {
        const date = new Date(info.exp);
        ctx.set('expires', date.toISOString());
      }
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * A handler to create a user session in the store.
   * This API is only available in the multi-user mode.
   */
  protected async handleSessionRenew(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      if (!ctx.state.sid || !ctx.state.user) {
        throw new ApiError('Not authorized', 401);
      }
      const token = await this.session.generateAuthenticatedSession(ctx.state.user.key, ctx.state.sid);
      const info = jwt.decode(token) as jwt.JwtPayload;
      if (info.exp) {
        const date = new Date(info.exp);
        ctx.set('expires', date.toISOString());
      }
      ctx.body = token;
      ctx.type = 'text';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Deletes a session in the store.
   * Clients should use this route when the client won't be using this session anymore.
   */
  protected async handleSessionDelete(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      if (!ctx.state.sid || !ctx.state.user) {
        throw new ApiError('Not authorized', 401);
      }
      await this.session.delete(ctx.state.sid);
      ctx.status = 205;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
