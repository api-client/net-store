import { Request, ParameterizedContext } from 'koa';
import Router from '@koa/router';
import { IUser } from '@advanced-rest-client/core';
import { StorePersistence, IListOptions } from '../persistence/StorePersistence.js';
import { ApiError } from '../ApiError.js';
import backend from '../BackendInfo.js';
import { IApplicationState } from '../definitions.js';

export interface IApiError {
  error: boolean;
  code: number;
  message: string;
  detail: string;
}

export abstract class BaseRoute {
  protected router: Router;
  protected store: StorePersistence;

  /**
   * @param router The Koa router instance to append paths to.
   * @param store The instance of the storage layer for the routes.
   */
  constructor(router: Router, store: StorePersistence) {
    this.router = router;
    this.store = store;
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
    return !!backend.hasAuthentication;
  }

  wrapError(cause: Error, code = 500, detail?: string): IApiError {
    return {
      error: true,
      code,
      message: cause.message,
      detail: detail || 'The server misbehave. That is all we know.'
    };
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
        let data: unknown | undefined;
        try {
          data = JSON.parse(message.toString('utf8'));
        } catch (e) {
          reject(e as Error);
          return;
        }
        resolve(data);
      });
    });
  }

  protected collectListingParameters(ctx: ParameterizedContext): IListOptions {
    const { cursor, limit, query, queryField } = ctx.query;
    const options: IListOptions = {};
    if (typeof cursor === 'string' && cursor) {
      options.cursor = cursor;
    } 
    if (typeof limit === 'string' && limit) {
      const value = Number(limit);
      if (Number.isNaN(value)) {
        throw new ApiError('The "limit" parameter is not a number', 400);
      }
      options.limit = value;
    }
    if (Array.isArray(query)) {
      throw new ApiError(`The "query" parameter cannot be an array`, 400);
    }
    if (typeof query === 'string') {
      options.query = query;
    }
    if (queryField && !Array.isArray(queryField)) {
      throw new ApiError(`The "queryField" parameter must be an array`, 400);
    }
    if (queryField) {
      options.queryField = queryField as string[];
    }
    return options;
  }

  /**
   * When the server is configured to run in a single-user environment
   * this always returns `undefined`.
   * 
   * When in multi-user environment, this throws when user information is not set.
   * Otherwise it returns user data.
   */
  getUserOrThrow(ctx: ParameterizedContext<IApplicationState>): IUser | undefined {
    if (!this.isMultiUser) {
      return undefined;
    }
    const { user } = ctx.state;
    if (!user) {
      throw new ApiError(`The client is not authorized to access this resource.`, 401);
    }
    return user;
  }
}
