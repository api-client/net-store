/* eslint-disable no-unused-vars */
/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { IWorkspace, UserAccessOperation } from '@advanced-rest-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';
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
export class SpacesHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const spacesPath = RouteBuilder.buildSpacesRoute();
    router.get(spacesPath, this.handleSpacesList.bind(this));
    router.post(spacesPath, this.handleSpaceCreate.bind(this));

    const spacePath = RouteBuilder.buildSpaceRoute(':space');
    router.get(spacePath, this.handleSpaceRead.bind(this));
    router.patch(spacePath, this.handleSpacePatch.bind(this));
    router.delete(spacePath, this.handleSpaceDelete.bind(this));
    
    const usersPath = RouteBuilder.buildSpaceUsersRoute(':space');
    router.patch(usersPath, this.handleSpacePatchUser.bind(this));
  }

  /**
   * Handles for spaces listing.
   */
   protected async handleSpacesList(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const result = await this.store.listUserSpaces(options, user);
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
  protected async handleSpaceCreate(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as IWorkspace;
      if (!body || !body.key) {
        throw new ApiError('Invalid space definition.', 400);
      }
      await this.store.createUserSpace(body.key, body, user, 'owner');
      ctx.status = 204;
      const spacePath = RouteBuilder.buildSpaceRoute(body.key);
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
      const result = await this.store.readUserSpace(space, user);
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
      const isValid = ooPatch.valid(patch);
      if (!isValid) {
        throw new ApiError(`Malformed patch information.`, 400);
      }
      const userSpace = await this.store.readUserSpace(spaceKey, user) as any;
      if (!userSpace) {
        throw new ApiError(`Not found`, 404);
      }
      delete userSpace.access;
      const space = userSpace as IWorkspace;
      const result = ooPatch.apply(space, patch, { reversible: true });
      await this.store.updateUserSpace(spaceKey, result.doc as IWorkspace, patch, user);
      ctx.body = {
        status: 'OK',
        revert: result.revert,
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
      await this.store.deleteUserSpace(spaceKey, user);
      // delete all space's cached projects from the cache
      const keys: string[] = [];
      this.projectsCache.projects.forEach((p, k) => {
        if (p.space === spaceKey) {
          keys.push(k);
        }
      });
      keys.forEach(k => this.projectsCache.projects.delete(k));
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
      const patches = await this.readJsonBody(ctx.request) as UserAccessOperation;
      if (!Array.isArray(patches)) {
        throw new ApiError(`Expected array with patch in the body.`, 400);
      }
      this.verifyUserAccessRecords(patches);
      await this.store.patchSpaceUsers(spaceKey, patches, user);
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
