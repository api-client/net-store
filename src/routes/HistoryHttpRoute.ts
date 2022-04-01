import { ParameterizedContext } from 'koa';
import { IHttpHistory, IHttpHistoryBulkAdd, RouteBuilder } from '@api-client/core';
import { BaseRoute } from './BaseRoute.js';
import { IApplicationState } from '../definitions.js';
import { ApiError } from '../ApiError.js';
import { HistoryState } from '../persistence/LevelStores.js';

export default class HistoryHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;

    const basePath = RouteBuilder.history();
    const batchCreatePath = RouteBuilder.historyBatchCreate();
    const batchDeletePath = RouteBuilder.historyBatchDelete();
    const itemPath = RouteBuilder.historyItem(':id');

    router.post(basePath, this.createHandler.bind(this));
    router.get(basePath, this.listHandler.bind(this));
    router.post(batchCreatePath, this.batchCreateHandler.bind(this));
    router.post(batchDeletePath, this.batchDeleteHandler.bind(this));
    router.get(itemPath, this.readHandler.bind(this));
    router.delete(itemPath, this.deleteHandler.bind(this));
  }

  protected async createHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IHttpHistory;
      if (!body || !body.log) {
        throw new ApiError('Invalid history definition.', 400);
      }
      const key = await this.store.history.add(body, user);
      ctx.set('location', RouteBuilder.historyItem(key));
      ctx.body = key;
      ctx.type = 'text/plain';
      ctx.status = 200;
    } catch (cause) {
      this.logger.error(cause);
      this.errorResponse(ctx, cause);
    }
  }

  protected async batchCreateHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IHttpHistoryBulkAdd;
      if (!body || !Array.isArray(body.log) || !body.log.length) {
        throw new ApiError('Invalid history list definition.', 400);
      }
      const keys = await this.store.history.bulkAdd(body, user);
      ctx.body = {
        data: keys,
      };
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.logger.error(cause);
      this.errorResponse(ctx, cause);
    }
  }

  protected async listHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectHistoryListingParameters(ctx);
      const result = await this.store.history.list(user, options);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.logger.error(cause);
      this.errorResponse(ctx, cause);
    }
  }

  protected async readHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const id = ctx.params.id as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const data = await this.store.history.read(id, user);
      ctx.body = data;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.logger.error(cause);
      this.errorResponse(ctx, cause);
    }
  }

  protected async deleteHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const id = ctx.params.id as string;
    try {
      const user = this.getUserOrThrow(ctx);
      await this.store.history.delete(id, user);
      ctx.status = 204;
    } catch (cause) {
      this.logger.error(cause);
      this.errorResponse(ctx, cause);
    }
  }

  protected async batchDeleteHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body) || !body.length) {
        throw new ApiError('Expected list of history identifiers.', 400);
      }
      await this.store.history.bulkDelete(body, user);
      ctx.status = 204;
    } catch (cause) {
      this.logger.error(cause);
      this.errorResponse(ctx, cause);
    }
  }

  protected collectHistoryListingParameters(ctx: ParameterizedContext): HistoryState {
    const base = this.collectListingParameters(ctx);
    const result = { ...base } as HistoryState;
    const { type, space, id, user } = ctx.query;
    if (type) {
      if (Array.isArray(type)) {
        throw new ApiError(`The type parameter cannot be an array`, 400);
      }
      result.type = type as any;
    }
    if (space) {
      if (Array.isArray(space)) {
        throw new ApiError(`The space parameter cannot be an array`, 400);
      }
      // @ts-ignore
      result.space = space as any;
    }
    if (id) {
      if (Array.isArray(id)) {
        throw new ApiError(`The id parameter cannot be an array`, 400);
      }
      // @ts-ignore
      result.id = id as any;
    }
    if (user) {
      if (Array.isArray(user)) {
        throw new ApiError(`The id parameter cannot be an array`, 400);
      }
      // @ts-ignore
      result.user = user === 'true' || user === '';
    }
    return result;
  }
}
