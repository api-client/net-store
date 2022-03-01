/* eslint-disable no-unused-vars */
/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { IWorkspace } from '@advanced-rest-client/core';
import ooPatch, { JsonPatch } from 'json8-patch';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { RouteBuilder } from './RouteBuilder.js';

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
 */
export class SpaceHttpRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const mainPath = RouteBuilder.buildSpaceRoute(':space');
    router.get(mainPath, this.handleSpaceRead.bind(this));
    router.patch(mainPath, this.handleSpacePatch.bind(this));
    router.delete(mainPath, this.handleSpaceDelete.bind(this));
    const usersPath = RouteBuilder.buildSpaceUsersRoute(':space');
    router.post(usersPath, this.handleSpaceAddUser.bind(this));
    router.delete(usersPath, this.handleSpaceDeleteUser.bind(this));
  }

  /**
   * Handler for reading a read.
   */
  protected async handleSpaceRead(ctx: ParameterizedContext): Promise<void> {
    const { space } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const result = await this.store.readUserSpace(space, user);
      ctx.body = result;
      ctx.type = 'application/json';
      ctx.status = 200;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  /**
   * Handler for patching a space
   */
  protected async handleSpacePatch(ctx: ParameterizedContext): Promise<void> {
    const { space: spaceKey } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const userSpace = await this.store.readUserSpace(spaceKey, user) as any;
      delete userSpace.access;
      const space = userSpace as IWorkspace;
      const patch = await this.readJsonBody(ctx.request) as JsonPatch;
      const isValid = ooPatch.valid(patch);
      if (!isValid) {
        throw new Error(`Invalid patch information.`);
      }
      const result = ooPatch.apply(space, patch, { reversible: true });
      await this.store.updateUserSpace(spaceKey, result.doc as IWorkspace, patch, user);
      // TODO: Create spaces revision history
      ctx.body = {
        status: 'OK',
        revert: result.revert,
      };
      ctx.status = 201;
      ctx.type = 'application/json';
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  /**
   * Handler for deleting a space
   */
  protected async handleSpaceDelete(ctx: ParameterizedContext): Promise<void> {
    throw new Error(`Not yet implemented.`);
    // const { space } = ctx.params;
  }

  /**
   * Handler for adding a user to a space
   */
  protected async handleSpaceAddUser(ctx: ParameterizedContext): Promise<void> {
    throw new Error(`Not yet implemented.`);
    // const { space } = ctx.params;
  }

  /**
   * Handler for adding a user to a space
   */
  protected async handleSpaceDeleteUser(ctx: ParameterizedContext): Promise<void> {
    throw new Error(`Not yet implemented.`);
    // const { space } = ctx.params;
  }
}
