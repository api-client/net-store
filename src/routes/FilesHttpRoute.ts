/* eslint-disable no-unused-vars */
/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { 
  IFile, IUser, RouteBuilder, IAccessPatchInfo, IWorkspace, IHttpProject, 
  WorkspaceKind, HttpProjectKind, Project, IProject, ProjectKind, ApiError,
  IPatchInfo, IPatchRevision,
} from '@api-client/core';
import { Patch } from '@api-client/json';
import { BaseRoute } from './BaseRoute.js';
import { IApplicationState } from '../definitions.js';
import { IFileAddOptions } from '../persistence/level/AbstractFiles.js';
import { AltType } from '../persistence/level/AbstractRevisions.js';
import { validatePatch } from '../lib/Patch.js';

export default class FilesRoute extends BaseRoute {
  async setup(): Promise<void> {
    const { router } = this;
    const filesPath = RouteBuilder.files();
    router.get(filesPath, this.filesList.bind(this));
    router.post(filesPath, this.filesCreate.bind(this));

    const bulkPath = RouteBuilder.filesBulk();
    router.post(bulkPath, this.bulkRead.bind(this));

    const filePath = RouteBuilder.file(':file');
    router.get(filePath, this.fileRead.bind(this));
    router.patch(filePath, this.filePatch.bind(this));
    router.delete(filePath, this.fileDelete.bind(this));
    router.post(filePath, this.fileCreate.bind(this));
    
    const usersPath = RouteBuilder.fileUsers(':file');
    router.patch(usersPath, this.patchUser.bind(this));
    router.get(usersPath, this.listUsers.bind(this));

    const revisionsPath = RouteBuilder.fileRevisions(':project');
    router.get(revisionsPath, this.revisionsList.bind(this));
  }

  /**
   * Lists files (spaces, projects, etc.)
   */
  protected async filesList(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const options = this.collectListingParameters(ctx);
      const kinds = this.listKinds(ctx);
      const result = await this.store.file.list(kinds, user, options);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Creates a file.
   */
  protected async filesCreate(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as any;
      if (!body || !body.key || !body.kind) {
        throw new ApiError('Invalid file definition.', 400);
      }
      if (body.kind === WorkspaceKind) {
        await this.createWorkspace(body as IWorkspace, user);
      } else if (body.kind === HttpProjectKind) {
        await this.createProject(body as IHttpProject, user);
      } else {
        throw new ApiError(`Unsupported kind: ${body.kind}.`, 400);
      }
      ctx.status = 204;
      const spacePath = RouteBuilder.file(body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async bulkRead(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as string[];
      if (!Array.isArray(body)) {
        throw new ApiError('Expected list of file keys in the message.', 400);
      }
      const result = await this.store.file.readBulk(body, user);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  private async createWorkspace(space: IWorkspace, user: IUser, parent?: string): Promise<void> {
    const opts: IFileAddOptions = {};
    if (parent) {
      opts.parent = parent;
    }
    await this.store.file.add(space.key, space, user, opts);
  }

  private async createProject(project: IHttpProject, user: IUser, parent?: string): Promise<void> {
    const opts: IFileAddOptions = {};
    if (parent) {
      opts.parent = parent;
    }
    // create a file object
    const file = Project.fromProject(project).toJSON();
    await this.store.file.add(file.key, file, user, opts);
    await this.store.project.add(project.key, project);
  }

  /**
   * Reads the file.
   * Depending on the `alt` property it either returns the file (the metadata) or
   * the contents (like for an HttpProject).
   */
  protected async fileRead(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    const { alt } = ctx.query;
    try {
      const user = this.getUserOrThrow(ctx);
      if (alt && alt !== 'media') {
        throw new ApiError(`Unsupported "alt" parameter.`, 400);
      }
      const meta = await this.store.file.read(file, user);
      if (!meta) {
        throw new ApiError(`Not found`, 404);
      }
      let result: any;
      if (alt === 'media') {
        result = await this.readFileMedia(meta);
        if (!result) {
          throw new ApiError(`The media for the file is missing.`, 500);
        }
      } else {
        result = meta;
      }
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  private async readFileMedia(meta: IFile): Promise<any> {
    if (meta.kind === WorkspaceKind) {
      throw new ApiError(`Spaces have no media. Remove the "alt" parameter.`, 400);
    } 
    if (meta.kind !== ProjectKind) {
      throw new ApiError(`The file has unsupported kind: ${meta.kind}.`, 400);
    }
    return this.store.project.read(meta.key);
  }

  /**
   * Patches a file.
   * Depending on the `alt` parameter it either patched the file contents or the metadata.
   */
  protected async filePatch(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    const { alt } = ctx.query;
    try {
      const user = this.getUserOrThrow(ctx);
      if (alt && alt !== 'media') {
        throw new ApiError(`Unsupported "alt" parameter.`, 400);
      }
      const patch = await this.readJsonBody(ctx.request) as IPatchInfo;
      let result: IPatchRevision;
      if (alt === 'media') {
        result = await this.patchFileContents(file, patch, user);
      } else {
        result = await this.store.file.applyPatch(file, patch, user);
      }
      ctx.body = result;
      ctx.status = 200;
      ctx.type = this.jsonType;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  private async patchFileContents(key: string, patch: IPatchInfo, user: IUser): Promise<IPatchRevision> {
    const meta = await this.store.file.read(key, user);
    if (!meta) {
      throw new ApiError(`File media not found`, 404);
    }
    if (meta.kind === WorkspaceKind) {
      throw new ApiError(`Spaces have no media. Remove the "alt" parameter.`, 400);
    } 
    if (meta.kind !== ProjectKind) {
      throw new ApiError(`The file has unsupported kind: ${meta.kind}.`, 400);
    }
    validatePatch(patch);
    const result = await this.store.project.applyPatch(meta.key, patch, user);
    const file = new Project(meta as IProject);
    file.setLastModified(user);
    const updatedFile = file.toJSON();
    const delta = Patch.diff(meta, updatedFile);
    const metaPatch: IPatchInfo = { ...patch, patch: delta };
    await this.store.file.update(key, updatedFile, metaPatch, user);
    return result;
  }

  /**
   * Deletes a file and the media, if any.
   */
  protected async fileDelete(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const meta = await this.store.file.read(file, user);
      if (!meta) {
        throw new ApiError(`Not found`, 404);
      }
      await this.store.file.delete(file, user);
      await this.tryDeleteMedia(meta, user);
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  private async tryDeleteMedia(meta: IFile, user: IUser): Promise<void> {
    if (meta.kind !== HttpProjectKind) {
      return;
    }
    await this.store.project.delete(meta.key, user);
  }

  /**
   * Creates a file inside a space.
   */
  protected async fileCreate(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const body = await this.readJsonBody(ctx.request) as any;
      if (!body || !body.key || !body.kind) {
        throw new ApiError('Invalid file definition.', 400);
      }
      const meta = await this.store.file.read(file, user);
      if (!meta) {
        throw new ApiError(`Not found`, 404);
      }
      if (meta.kind !== WorkspaceKind) {
        throw new ApiError(`The parent file must be a space.`, 400);
      }
      if (body.kind === WorkspaceKind) {
        await this.createWorkspace(body as IWorkspace, user, file);
      } else if (body.kind === HttpProjectKind) {
        await this.createProject(body as IHttpProject, user, file);
      } else {
        throw new ApiError(`Unsupported kind: ${body.kind}`, 400);
      }
      ctx.status = 204;
      const spacePath = RouteBuilder.file(body.key);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Handler for adding a user to a space
   */
  protected async patchUser(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      if (!user) {
        throw new ApiError(`Operation not allowed in a single-user mode.`, 400);
      }
      // Note, this is not the semantics of JSON patch. This is done so we can support PATCH on the users
      // resource to add / remove users. Normally this would be POST and DELETE but DELETE requests cannot 
      // have body: https://github.com/httpwg/http-core/issues/258
      const info = await this.readJsonBody(ctx.request) as IAccessPatchInfo;
      if (!Array.isArray(info.patch)) {
        throw new ApiError(`Expected array with patch in the body.`, 400);
      }
      this.verifyUserAccessRecords(info.patch);
      await this.store.file.patchAccess(file, info, user);
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async listUsers(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      if (!user) {
        throw new ApiError(`Operation not allowed in a single-user mode.`, 400);
      }
      const result = await this.store.file.listUsers(file, user);
      result.data = this.cleanUpUsers(result.data as IUser[]);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  protected async revisionsList(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    const alt = ctx.query.alt as AltType;
    try {
      const user = this.getUserOrThrow(ctx);
      if (alt && alt !== 'media') {
        // currently only HttpProject revisions are stored. In the future this would require
        // changes to how we query for the data.
        throw new ApiError(`Unsupported "alt" parameter.`, 400);
      }
      const options = this.collectListingParameters(ctx);
      const result = await this.store.revisions.list(file, user, alt, options);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
}
