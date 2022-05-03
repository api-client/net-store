import { ParameterizedContext } from 'koa';
import { IUser } from '@api-client/core';
import { BaseRoute } from '../../src/routes/BaseRoute.js';
import { DataHelper, ISharedSpacesInit } from './DataHelper.js';
import { TestStore } from './TestStore.js';

export interface IGeneratedSessionUsers {
  user: IUser;
  token: string;
}

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
    router.delete('/test/reset/files', this.handleDataResetFiles.bind(this));
    router.delete('/test/reset/projects', this.handleDataResetProjects.bind(this));
    router.delete('/test/reset/revisions', this.handleDataResetRevisions.bind(this));
    router.delete('/test/reset/bin', this.handleDataResetBin.bind(this));
    router.delete('/test/reset/history', this.handleDataResetHistory.bind(this));
    router.delete('/test/reset/shared', this.handleDataResetShared.bind(this));
    router.delete('/test/reset/permissions', this.handleDataResetPermissions.bind(this));
    router.post('/test/generate/spaces', this.handleDataGenerateSpaces.bind(this));
    // router.post('/test/generate/projects/:parent', this.handleDataGenerateProjects.bind(this));
    router.post('/test/generate/revisions/pr/:project', this.handleDataGenerateProjectRevisions.bind(this));
    router.post('/test/generate/users', this.generateUsers.bind(this));
    router.post('/test/generate/shared/files', this.generateSharedFiles.bind(this));
  }

  protected async handleDataResetUsers(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearUsers();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetSessions(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearSessions();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetFiles(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearFiles();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetProjects(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearFileMedia();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetRevisions(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearRevisions();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetBin(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.clearBin();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetHistory(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.history.data.clear();
      await this.testStore.history.space.clear();
      await this.testStore.history.project.clear();
      await this.testStore.history.request.clear();
      await this.testStore.history.app.clear();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetShared(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.shared.db.clear();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async handleDataResetPermissions(ctx: ParameterizedContext): Promise<void> {
    try {
      await this.testStore.permission.db.clear();
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
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
      const generated = await this.testStore.generateSpaces(ownerParam as string, sizeParam);
      ctx.status = 200;
      ctx.type = 'json';
      ctx.body = generated;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  // protected async handleDataGenerateProjects(ctx: ParameterizedContext): Promise<void> {
  //   const { size='25' } = ctx.query;
  //   const sizeParam = Number(size);
  //   const { parent } = ctx.params;
  //   try {
  //     const generated = await this.testStore.generateProjects(space, sizeParam);
  //     ctx.status = 200;
  //     ctx.type = 'json';
  //     ctx.body = generated;
  //   } catch (cause) {
  //     this.errorResponse(ctx, cause);
  //   }
  // }

  protected async handleDataGenerateProjectRevisions(ctx: ParameterizedContext): Promise<void> {
    const { size='25' } = ctx.query;
    const sizeParam = Number(size);
    const { project } = ctx.params;
    try {
      const generated = await this.testStore.generateRevisions(project, sizeParam);
      ctx.status = 200;
      ctx.type = 'json';
      ctx.body = generated;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async generateUsers(ctx: ParameterizedContext): Promise<void> {
    const { size } = ctx.query;
    const sizeParam = size ? Number(size) : undefined;
    const result: IGeneratedSessionUsers[] = [];
    try {
      // @ts-ignore
      const users = await DataHelper.generateUsers(this.store, sizeParam);
      for (const user of users) {
        const token = await this.session.generateAuthenticatedSession(user.key);
        result.push({
          user,
          token,
        });
      }
      ctx.status = 200;
      ctx.type = 'json';
      ctx.body = result;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async generateSharedFiles(ctx: ParameterizedContext): Promise<void> {
    const { size, owner, target, type, role } = ctx.query;
    const init: ISharedSpacesInit = {};
    if (size) {
      init.size = Number(size);
    }
    if (typeof owner === 'string') {
      init.owner = owner;
    }
    if (typeof target === 'string') {
      init.target = target;
    }
    if (typeof type === 'string') {
      init.type = type as any;
    }
    if (typeof role === 'string') {
      init.role = role as any;
    }
    try {
      // @ts-ignore
      const spaces = await DataHelper.generateSharedSpaces(this.store, init);
      ctx.status = 200;
      ctx.type = 'json';
      ctx.body = spaces;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
