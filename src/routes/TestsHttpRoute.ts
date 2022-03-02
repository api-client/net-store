import { ParameterizedContext } from 'koa';
import { BaseRoute } from './BaseRoute.js';
import { ApiError } from '../ApiError.js';
import { TestStore } from '../../test/helpers/TestStore.js';

/**
 * This route is only initialized when running tests.
 */
export class TestsHttpRoute extends BaseRoute {

  get testStore(): TestStore {
    return this.store as TestStore;
  }

  async setup(): Promise<void> {
    const { router } = this;

    router.delete('/test/reset/users', this.handleDataResetUsers.bind(this));
    router.delete('/test/reset/sessions', this.handleDataResetSessions.bind(this));
    router.delete('/test/reset/spaces', this.handleDataResetSpaces.bind(this));
    router.post('/test/generate/spaces', this.handleDataGenerateSpaces.bind(this));
  }

  protected async handleDataResetUsers(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearUsers();
      ctx.status = 204;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  protected async handleDataResetSessions(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearSessions();
      ctx.status = 204;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  protected async handleDataResetSpaces(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearSpaces();
      ctx.status = 204;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }

  protected async handleDataGenerateSpaces(ctx: ParameterizedContext): Promise<void> {
    const { size='25', owner } = ctx.query;
    const sizeParam = Number(size);
    let ownerParam = owner;
    if (!ownerParam) {
      const { user } = ctx.state;
      if (user) {
        ownerParam = user.key;
      }
    }
    try {
      await this.testStore.generateSpaces(sizeParam, ownerParam as string | undefined);
      ctx.status = 204;
    } catch (cause) {
      const e = cause as ApiError;
      const error = new ApiError(e.message || 'Unknown error', e.code || 400);
      ctx.body = this.wrapError(error, error.code);
      ctx.status = error.code;
    }
  }
}
