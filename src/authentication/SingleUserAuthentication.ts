import { IUser } from '@advanced-rest-client/core';
import { ParameterizedContext, DefaultState, DefaultContext, Next } from 'koa';
import { Authentication } from './Authentication.js';
import DefaultUser from './DefaultUser.js'

export class SingleUserAuthentication extends Authentication {
  static get defaultSid(): string {
    return 'default';
  }

  async initialize(): Promise<void> {
    // ...
  }

  async getSessionId(): Promise<string | undefined> {
    return SingleUserAuthentication.defaultSid;
  }

  async getSessionUser(): Promise<IUser | undefined> {
    return DefaultUser;
  }

  async middleware(ctx: ParameterizedContext<DefaultState, DefaultContext, unknown>, next: Next): Promise<void> {
    ctx.state.sid = SingleUserAuthentication.defaultSid;
    ctx.state.user = DefaultUser;
    return next();
  }

  getAuthLocation(): string {
    return '/';
  }
}
