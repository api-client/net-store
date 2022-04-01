/* eslint-disable no-unused-vars */
/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { IWorkspace, IUser, RouteBuilder, AccessOperation } from '@api-client/core';
import { JsonPatch } from 'json8-patch';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { IApplicationState } from '../definitions.js';

/**
 * An HTTP route for the server that serves the information about 
 * a specific user space.
 * 
 * The client can:
 * - read the space data
 * - patch space meta
 * - delete a space and its content
 * - add a user to the space
 * - remove a user from the space
 * - list spaces
 * - create a space
 */
export default class SpacesHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const spacesPath = RouteBuilder.spaces();
    router.get(spacesPath, this.handleSpacesList.bind(this));
    router.post(spacesPath, this.handleSpacesCreate.bind(this));

    const spacePath = RouteBuilder.space(':space');
    router.get(spacePath, this.handleSpaceRead.bind(this));
    router.patch(spacePath, this.handleSpacePatch.bind(this));
    router.delete(spacePath, this.handleSpaceDelete.bind(this));
    router.post(spacePath, this.handleSpaceCreate.bind(this));
    
    const usersPath = RouteBuilder.spaceUsers(':space');
    router.patch(usersPath, this.handleSpacePatchUser.bind(this));
    router.get(usersPath, this.handleSpaceListUsers.bind(this));
  }

  /**
   * Handles for spaces listing.
   */
   protected async handleSpacesList(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.space.list(user, options);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handles for creating a space.
   */
  protected async handleSpacesCreate(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IWorkspace;
      if (!body || !body.key) {
        throw new ApiError('Invalid space definition.', 400);
      }
      await this.store.space.add(body.key, body, user);
      ctx.status = 204;
      const spacePath = RouteBuilder.space(body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handler for reading a read.
   */
  protected async handleSpaceRead(ctx: ParameterizedContext): Promise<void> {
    const { space } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const result = await this.store.space.read(space, user);
      if (!result) {
        throw new ApiError(`Not found`, 404);
      }
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handler for patching a space
   */
  protected async handleSpacePatch(ctx: ParameterizedContext): Promise<void> {
    const { space: spaceKey } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const patch = await this.readJsonBody(ctx.request) as JsonPatch;
      const result = await this.store.space.applyPatch(spaceKey, patch, user);
      ctx.body = {
        status: 'OK',
        revert: result,
      };
      ctx.status = 200;
      ctx.type = 'application/json';
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handler for deleting a space
   */
  protected async handleSpaceDelete(ctx: ParameterizedContext): Promise<void> {
    const { space: spaceKey } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      await this.store.space.delete(spaceKey, user);
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handler for adding a user to a space
   */
  protected async handleSpacePatchUser(ctx: ParameterizedContext): Promise<void> {
    const { space: spaceKey } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      if (!user) {
        throw new ApiError(`Operation not allowed in a single-user mode.`, 400);
      }
      // Note, this is not the semantics of JSON patch. This is done so we can support PATCH on the users
      // resource to add / remove users. Normally this would be POST and DELETE but DELETE requests cannot 
      // have body: https://github.com/httpwg/http-core/issues/258
      const patches = await this.readJsonBody(ctx.request) as AccessOperation[];
      if (!Array.isArray(patches)) {
        throw new ApiError(`Expected array with patch in the body.`, 400);
      }
      this.verifyUserAccessRecords(patches);
      await this.store.space.patchAccess(spaceKey, patches, user);
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleSpaceListUsers(ctx: ParameterizedContext): Promise<void> {
    const { space: spaceKey } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      if (!user) {
        throw new ApiError(`Operation not allowed in a single-user mode.`, 400);
      }
      const result = await this.store.space.listUsers(spaceKey, user);
      result.data = this.cleanUpUsers(result.data as IUser[]);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Creates a child in the space.
   * Currently a space has only another space.
   */
  protected async handleSpaceCreate(ctx: ParameterizedContext): Promise<void> {
    const { space: spaceKey } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IWorkspace;
      if (!body || !body.key) {
        throw new ApiError('Invalid space definition.', 400);
      }
      await this.store.space.add(body.key, body, user, {
        parent: spaceKey,
      });
      ctx.status = 204;
      const spacePath = RouteBuilder.space(body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
