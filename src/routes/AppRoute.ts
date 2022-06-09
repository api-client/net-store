/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { RouteBuilder, ApiError, IAppProject, IAppRequest, IBatchUpdate } from '@api-client/core';
import { BaseRoute } from './BaseRoute.js';
import { IApplicationState } from '../definitions.js';

/**
 * A route that handles application specific data.
 * 
 * Currently it supports:
 * - HTTP request (stored per application and not project)
 * - Project (application project, not the HTTP project which is stored as file)
 */
export default class AppRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const projects = RouteBuilder.appProjects(':appId');
    const projectBatchCreate = RouteBuilder.appProjectsBatchCreate(':appId');
    const projectBatchRead = RouteBuilder.appProjectsBatchRead(':appId');
    const projectBatchDelete = RouteBuilder.appProjectsBatchDelete(':appId');
    const projectBatchUndelete = RouteBuilder.appProjectsBatchUndelete(':appId');
    const projectItem = RouteBuilder.appProjectItem(':appId', ':key');
    const requests = RouteBuilder.appRequests(':appId');
    const requestsBatchCreate = RouteBuilder.appRequestsBatchCreate(':appId');
    const requestsBatchRead = RouteBuilder.appRequestsBatchRead(':appId');
    const requestsBatchDelete = RouteBuilder.appRequestsBatchDelete(':appId');
    const requestsBatchUndelete = RouteBuilder.appRequestsBatchUndelete(':appId');
    const requestItem = RouteBuilder.appRequestItem(':appId', ':key');

    router.get(projects, this.listProjectsRoute.bind(this));
    router.post(projects, this.createProjectRoute.bind(this));
    router.get(projectItem, this.projectReadRoute.bind(this));
    router.delete(projectItem, this.projectDeleteRoute.bind(this));
    router.post(projectBatchCreate, this.projectBatchCreateRoute.bind(this));
    router.post(projectBatchRead, this.projectBatchReadRoute.bind(this));
    router.post(projectBatchDelete, this.projectBatchDeleteRoute.bind(this));
    router.post(projectBatchUndelete, this.projectBatchUndeleteRoute.bind(this));

    router.get(requests, this.listRequestsRoute.bind(this));
    router.post(requests, this.createRequestRoute.bind(this));
    router.get(requestItem, this.requestReadRoute.bind(this));
    router.delete(requestItem, this.requestDeleteRoute.bind(this));
    router.post(requestsBatchCreate, this.requestBatchCreateRoute.bind(this));
    router.post(requestsBatchRead, this.requestBatchReadRoute.bind(this));
    router.post(requestsBatchDelete, this.requestBatchDeleteRoute.bind(this));
    router.post(requestsBatchUndelete, this.requestBatchUndeleteRoute.bind(this));
  }

  protected async listProjectsRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.app.projects.list(appId, user, options);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async listRequestsRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.app.requests.list(appId, user, options);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async createProjectRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IAppProject;
      if (!body || !body.kind) {
        throw new ApiError('Invalid project definition.', 400);
      }
      const result = await this.store.app.projects.create(body, appId, user);
      ctx.set('location', RouteBuilder.appProjectItem(appId, result.key));
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async createRequestRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IAppRequest;
      if (!body || !body.kind) {
        throw new ApiError('Invalid request definition.', 400);
      }
      const result = await this.store.app.requests.create(body, appId, user);
      ctx.set('location', RouteBuilder.appRequestItem(appId, result.key));
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async projectReadRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    const key = ctx.params.key as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const result = await this.store.app.projects.read(key, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async requestReadRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    const key = ctx.params.key as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const result = await this.store.app.requests.read(key, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async projectDeleteRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    const key = ctx.params.key as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const result = await this.store.app.projects.delete(key, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async requestDeleteRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    const key = ctx.params.key as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const result = await this.store.app.requests.delete(key, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async projectBatchCreateRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IBatchUpdate<IAppProject>;
      if (!body || !Array.isArray(body.items)) {
        throw new ApiError('Invalid batch project create list in the request.', 400);
      }
      const result = await this.store.app.projects.createBatch(body.items, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async requestBatchCreateRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IBatchUpdate<IAppRequest>;
      if (!body || !Array.isArray(body.items)) {
        throw new ApiError('Invalid batch request create list in the request.', 400);
      }
      const result = await this.store.app.requests.createBatch(body.items, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async projectBatchReadRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Invalid batch project read list in the request.', 400);
      }
      const result = await this.store.app.projects.readBatch(body, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async requestBatchReadRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Invalid batch request read list in the request.', 400);
      }
      const result = await this.store.app.requests.readBatch(body, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async projectBatchDeleteRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Invalid batch project delete list in the request.', 400);
      }
      const result = await this.store.app.projects.deleteBatch(body, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async requestBatchDeleteRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Invalid batch request delete list in the request.', 400);
      }
      const result = await this.store.app.requests.deleteBatch(body, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async projectBatchUndeleteRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Invalid batch project undelete list in the request.', 400);
      }
      const result = await this.store.app.projects.undeleteBatch(body, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async requestBatchUndeleteRoute(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    const appId = ctx.params.appId as string;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Invalid batch request undelete list in the request.', 400);
      }
      const result = await this.store.app.requests.undeleteBatch(body, appId, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
