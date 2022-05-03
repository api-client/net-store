/* eslint-disable no-unused-vars */
/* eslint-disable import/no-named-as-default-member */
import { ParameterizedContext } from 'koa';
import { 
  IFile, File, IUser, RouteBuilder, IAccessPatchInfo, WorkspaceKind, ApiError, IPatchInfo, 
  IPatchRevision, uuidV4 
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
    // read a file
    router.get(filesPath, this.filesList.bind(this));
    // create a file on root or a space.
    router.post(filesPath, this.filesCreateHandler.bind(this));

    // read in bulk (its post to )
    const bulkPath = RouteBuilder.filesBulk();
    router.post(bulkPath, this.bulkRead.bind(this));

    const filePath = RouteBuilder.file(':file');
    // reads the file.
    router.get(filePath, this.fileReadHandler.bind(this));
    // patches the file.
    router.patch(filePath, this.filePatchHandler.bind(this));
    // deletes the file
    router.delete(filePath, this.fileDeleteHandler.bind(this));
    // uploads the media of the file.
    router.put(filePath, this.filePutHandler.bind(this));
    
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
      const result = await this.store.file.list(user, kinds, options);
      ctx.body = result;
      ctx.type = this.jsonType;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Creates a file metadata object.
   * 
   * The file create flow is a 2-step process (except for workspaces/folders).
   * First the client creates a meta entry in the first request. After that the client reads the `location` headers,
   * appends the `alt=media` query parameter, and makes another request with the file contents (the media.)
   * Only exception here ius the `workspace` which has no media and it only exists as a meta data. When creating a workspace (a folder)
   * only the first step is performed.
   * 
   * The `meta` part of the file must expends the IFile interface defined in the `core` library. The file media (the contents)
   * can be any, non-binary contents.
   */
  protected async filesCreateHandler(ctx: ParameterizedContext<IApplicationState>): Promise<void> {
    try {
      const id = await this.createFile(ctx);
      ctx.status = 204;
      const spacePath = RouteBuilder.file(id);
      ctx.set('location', spacePath);
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }
  
  /**
   * A function that creates either a file meta or media (depending on the request).
   * 
   * @param ctx The server context.
   * @returns The key of the file.
   */
  private async createFile(ctx: ParameterizedContext<IApplicationState>): Promise<string> {
    const user = this.getUserOrThrow(ctx);
    const alt: AltType | undefined = ctx.query.alt as AltType | undefined;
    if (alt && !['media', 'meta'].includes(alt)) {
      const err = new ApiError(`Unsupported "alt" parameter.`, 400);
      err.detail = 'Only "media" and "meta" parameters are supported when creating a file.';
      throw err;
    }
    const mime = ctx.get('content-type');
    if (!mime) {
      const err = new ApiError(`The media content-type header is missing.`, 400);
      err.detail = 'The content-type of the file is stored with the file and used again when reading the file';
      throw err;
    }
    const isJson = mime.includes('json');
    if (alt === 'media') {
      let id: string | undefined;
      if (typeof ctx.params.file === 'string') {
        id = ctx.params.file;
      }
      if (!id) {
        const err = new ApiError(`Media upload can only be performed on a file. This is the files collection endpoint.`, 400);
        err.detail = 'Use a file endpoint with the "PUT" operation to upload file media (its contents).';
        throw err;
      }
      let body: unknown;
      if (isJson) {
        body = await this.readJsonBody(ctx.request);
      } else {
        // probably the best I can do for now (not as much time to spend on this.)
        body = (await this.readBufferBody(ctx.request)).toString('utf8');
      }
      return this.createFileMedia(id, body, mime, user);
    }
    // only "meta" alt is possible here.
    if (!isJson) {
      throw new ApiError(`Expected application/json mime type for a file meta but got ${mime}.`, 400);
    }
    const body = await this.readJsonBody(ctx.request) as unknown;
    if (!body) {
      const err = new ApiError('Invalid file definition. File has no contents.', 400);
      err.detail = 'File metadata must be a JSON value.';
      throw err;
    }
    let parent: string | undefined;
    if (typeof ctx.query.parent === 'string') {
      parent = ctx.query.parent;
    }
    return this.createFileMeta(body as IFile, user, parent);
  }

  /**
   * Creates a file metadata entry in the store.
   * 
   * @param file The file extending the IFile interface.
   * @param user The adding user.
   * @param parent Optional parent folder (workspace).
   * @returns The key of the created file.
   */
  private async createFileMeta(file: IFile, user: IUser, parent?: string): Promise<string> {
    if (!file.kind) {
      throw new ApiError(`Invalid file meta definition. Missing "kind" property.`, 400);
    }
    if (!file.key) {
      file.key = uuidV4();
    }
    const opts: IFileAddOptions = {};
    if (parent) {
      opts.parent = parent;
    }
    await this.store.file.add(file.key, file, user, opts);
    return file.key;
  }

  private async createFileMedia(id: string, file: unknown, mime: string, user: IUser): Promise<string> {
    // as a principle, all files that have `kind` property are only allowed to be patched after create.
    const allowOverwrite = !(file as any).kind;
    await this.store.file.checkAccess('writer', id, user);
    await this.store.media.set(id, file, mime, allowOverwrite);
    return id;
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

  /**
   * Reads the file.
   * Depending on the `alt` property it either returns the file (the metadata) or
   * the contents (like for an HttpProject).
   */
  protected async fileReadHandler(ctx: ParameterizedContext): Promise<void> {
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
      let mime = this.jsonType;
      if (alt === 'media') {
        if (meta.kind === WorkspaceKind) {
          throw new ApiError(`Spaces have no media. Remove the "alt" parameter.`, 400);
        }
        const data = await this.store.media.read(meta.key);
        if (!data) {
          throw new ApiError(`The media for the file is missing.`, 500);
        }
        mime = data.mime || this.jsonType;
        result = data.value;
      } else {
        result = meta;
      }
      ctx.body = result;
      ctx.type = mime;
      ctx.status = 200;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Patches a file.
   * Depending on the `alt` parameter it either patched the file contents or the metadata.
   */
  protected async filePatchHandler(ctx: ParameterizedContext): Promise<void> {
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
    validatePatch(patch);
    const result = await this.store.media.applyPatch(meta.key, meta.kind, patch, user);

    const copy = { ...meta };
    File.setLastModified(copy, user);
    
    const delta = Patch.diff(meta, copy);
    const metaPatch: IPatchInfo = { ...patch, patch: delta };
    await this.store.file.update(key, copy, metaPatch, user);

    return result;
  }

  /**
   * Deletes a file and the media, if any.
   */
  protected async fileDeleteHandler(ctx: ParameterizedContext): Promise<void> {
    const { file } = ctx.params;
    try {
      const user = this.getUserOrThrow(ctx);
      const meta = await this.store.file.read(file, user);
      if (!meta) {
        throw new ApiError(`Not found`, 404);
      }
      await this.store.file.delete(file, user);
      if (meta.kind !== WorkspaceKind) {
        await this.store.media.delete(meta.key, meta.kind, user);
      }
      ctx.status = 204;
    } catch (cause) {
      this.errorResponse(ctx, cause);
    }
  }

  /**
   * Allows to upload file media after creating file's meta.
   * Only requests with `alt=media` are allowed.
   */
  protected async filePutHandler(ctx: ParameterizedContext): Promise<void> {
    try {
      const alt: AltType | undefined = ctx.query.alt as AltType | undefined;
      if (!alt || alt !== 'media') {
        throw new ApiError(`Unsupported "alt" parameter.`, 400);
      }
      const id = await this.createFile(ctx);
      ctx.status = 204;
      const filePath = RouteBuilder.file(id);
      ctx.set('location', filePath);
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
