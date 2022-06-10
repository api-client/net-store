import { ParameterizedContext } from 'koa';
import Router from '@koa/router';
import { IUser, AccessOperation, Logger, IListOptions, ApiError } from '@api-client/core';
import { StorePersistence } from '../persistence/StorePersistence.js';
import { AppSession } from '../session/AppSession.js';
import { BackendInfo } from '../BackendInfo.js';
import { IApplicationState } from '../definitions.js';
import ApiRoute from './ApiRoute.js';

export interface ISpaceConfiguration {
  router: Router;
  store: StorePersistence;
  info: BackendInfo;
  session: AppSession;
  logger: Logger;
}

export abstract class BaseRoute extends ApiRoute {
  protected router: Router;
  protected store: StorePersistence;
  protected info: BackendInfo;
  protected session: AppSession;
  protected logger: Logger;

  /**
   * @param init Route configuration
   */
  constructor(init: ISpaceConfiguration) {
    super(); 
    this.router = init.router;
    this.store = init.store;
    this.info = init.info;
    this.session = init.session;
    this.logger = init.logger;
  }

  abstract setup(): Promise<void>;

  /**
   * Cleans up the route before server shutdown.
   * Optional to implement.
   */
  async cleanup(): Promise<void> {
    // ...
  }

  /**
   * Checks whether the server is configured to support user authentication.
   */
  get isMultiUser(): boolean {
    return this.info.info.mode === 'multi-user';
  }
  
  protected collectListingParameters(ctx: ParameterizedContext): IListOptions {
    const { cursor, limit, query, queryField, parent, since } = ctx.query;
    const options: IListOptions = {};
    if (typeof cursor === 'string' && cursor) {
      options.cursor = cursor;
    } 
    if (typeof limit === 'string' && limit) {
      const value = Number(limit);
      if (Number.isNaN(value)) {
        throw new ApiError('The "limit" parameter is not a number.', 400);
      }
      options.limit = value;
    }
    if (Array.isArray(query)) {
      throw new ApiError(`The "query" parameter cannot be an array.`, 400);
    }
    if (typeof query === 'string') {
      options.query = query;
    }
    if (queryField && !Array.isArray(queryField)) {
      throw new ApiError(`The "queryField" parameter must be an array.`, 400);
    }
    if (queryField) {
      options.queryField = queryField as string[];
    }
    if (Array.isArray(parent)) {
      throw new ApiError(`The "parent" parameter cannot be an array.`, 400);
    }
    if (typeof parent === 'string') {
      options.parent = parent;
    }
    if (typeof since === 'string') {
      const typed = Number(since);
      if (Number.isInteger(typed)) {
        options.since = typed;
      }
    }
    return options;
  }

  /**
   * Lists the "kind" query parameter and when set it returns the array value.
   * 
   * @returns The list of kinds or undefined when not specified in the query parameters.
   */
  protected listKinds(ctx: ParameterizedContext): string[] | undefined {
    let { kind } = ctx.query;
    if (!kind) {
      return undefined;
    }
    if (!Array.isArray(kind)) {
      kind = [kind];
    }
    return kind;
  }

  /**
   * When the server is configured to run in a single-user environment
   * this always returns `undefined`.
   * 
   * When in multi-user environment, this throws when user information is not set.
   * Otherwise it returns user data.
   */
  getUserOrThrow(ctx: ParameterizedContext<IApplicationState>): IUser {
    const { user } = ctx.state;
    if (!user) {
      throw new ApiError(`The client is not authorized to access this resource.`, 401);
    }
    return user;
  }

  /**
   * Verifies the user access records.
   */
  verifyUserAccessRecords(records: AccessOperation[]): void {
    records.forEach((info, index) => {
      const { op, id, type } = info;
      if (!['user', 'group', 'anyone'].includes(type)) {
        throw new ApiError(`Invalid access definition. Invalid "type" at position: ${index}.`, 400);
      }
      if (!['add', 'remove'].includes(op)) {
        throw new ApiError(`Invalid access definition. Invalid "op" value at position: ${index}.`, 400);
      }
      if (type !== 'anyone' && !id) {
        throw new ApiError(`Invalid access definition. Missing "id" at position: ${index}.`, 400);
      }
      if (op === 'add') {
        if (!info.value) {
          throw new ApiError(`Invalid access definition. Missing "value" at position: ${index}.`, 400);
        }
      }
    });
  }

  protected cleanUpUsers(users: IUser[]): IUser[] {
    return users.map((i) => this.cleanUpUser(i));
  }

  /**
   * Removes server side stuff that clients should not see, like refresh tokens etc.
   * @returns The copy of the object.
   */
  protected cleanUpUser(user: IUser): IUser {
    const item = { ...user };
      delete item.provider;
      return item;
  }
}
