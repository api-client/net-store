import { Request, ParameterizedContext } from 'koa';
import Router from '@koa/router';
import { IUser, AccessOperation, Logger, IListOptions, ApiError, IApiError } from '@api-client/core';
import { StorePersistence } from '../persistence/StorePersistence.js';
import { AppSession } from '../session/AppSession.js';
import { BackendInfo } from '../BackendInfo.js';
import { IApplicationState } from '../definitions.js';

export interface ISpaceConfiguration {
  router: Router;
  store: StorePersistence;
  info: BackendInfo;
  session: AppSession;
  logger: Logger;
}

export abstract class BaseRoute {
  protected router: Router;
  protected store: StorePersistence;
  protected info: BackendInfo;
  protected session: AppSession;
  protected logger: Logger;

  /**
   * @param init Route configuration
   */
  constructor(init: ISpaceConfiguration) { 
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

  get jsonType(): string {
    return 'application/json';
  }

  wrapError(cause: ApiError): IApiError {
    const { code = 500, detail, message } = cause;
    return {
      error: true,
      code,
      message,
      detail: detail || 'There was an error. That is all we know.'
    };
  }

  /**
   * Takes an Error object (preferably the ApiError) and response with an error.
   * @param ctx 
   * @param cause 
   */
  errorResponse(ctx: ParameterizedContext, cause: any): void {
    const e = cause as IApiError;
    const error = new ApiError(e.message || 'Unknown error', e.code || 400);
    error.detail = e.detail;
    ctx.body = this.wrapError(error);
    ctx.status = error.code;
    ctx.type = this.jsonType;
  }

  /**
   * Reads the request body and parses it as a JSON value.
   * @throws an error when no body or invalid JSON value.
   */
  protected async readJsonBody(request: Request): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let message: Buffer;
      request.req.on('data', (chunk) => {
        try {
          if (message) {
            message = Buffer.concat([message, chunk]);
          } else {
            message = chunk;
          }
        } catch (e) {
          reject(e);
          throw e;
        }
      });
      request.req.on('end', () => {
        if (!message) {
          reject(new Error(`Invalid request body. Expected a message.`));
          return;
        }
        let data: unknown | undefined;
        try {
          data = JSON.parse(message.toString('utf8'));
        } catch (e) {
          reject(new Error(`Invalid request body. Expected JSON value.`));
          return;
        }
        resolve(data);
      });
    });
  }
  
  protected collectListingParameters(ctx: ParameterizedContext): IListOptions {
    const { cursor, limit, query, queryField, parent } = ctx.query;
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
    return options;
  }

  protected listKinds(ctx: ParameterizedContext): string[] {
    let { kind } = ctx.query;
    if (!kind) {
      throw new ApiError(`The "kind" parameter is not set.`, 400);
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
