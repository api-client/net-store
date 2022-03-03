import { Request, ParameterizedContext } from 'koa';
import Router from '@koa/router';
import { IUser, UserAccessOperation, Logger } from '@advanced-rest-client/core';
import { StorePersistence, IListOptions } from '../persistence/StorePersistence.js';
import { AppSession } from '../session/AppSession.js';
import { ApiError } from '../ApiError.js';
import { BackendInfo } from '../BackendInfo.js';
import { IApplicationState } from '../definitions.js';

export interface IApiError {
  error: boolean;
  code: number;
  message: string;
  detail: string;
}

export abstract class BaseRoute {
  /**
   * @param router The Koa router instance to append paths to.
   * @param store The instance of the storage layer for the routes.
   */
  constructor(
    protected router: Router, 
    protected store: StorePersistence, 
    protected info: BackendInfo, 
    protected session: AppSession,
    protected logger: Logger
  ) { }

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
    return !!this.info.hasAuthentication;
  }

  get jsonType(): string {
    return 'application/json';
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
   * Takes an Error object (preferably the ApiError) and response with an error.
   * @param ctx 
   * @param cause 
   */
  errorResponse(ctx: ParameterizedContext, cause: any): void {
    const e = cause as ApiError;
    const error = new ApiError(e.message || 'Unknown error', e.code || 400);
    ctx.body = this.wrapError(error, error.code);
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

  /**
   * Verifies the user access records.
   */
  verifyUserAccessRecords(records: UserAccessOperation[]): void {
    records.forEach((info, index) => {
      const { op, uid } = info;
      if (!uid) {
        throw new ApiError(`Invalid access definition. Missing "uid" at position: ${index}.`, 400);
      }
      if (op === 'add') {
        if (!info.value) {
          throw new ApiError(`Invalid access definition. Missing "value" at position: ${index}.`, 400);
        }
      } else if (op !== 'remove') {
        throw new ApiError(`Invalid access definition. Invalid "op" value at position: ${index}.`, 400);
      }
    });
  }
}
