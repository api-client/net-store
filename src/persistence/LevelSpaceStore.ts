/* eslint-disable import/no-named-as-default */
import { Bytes } from 'leveldown';
// import { PutBatch } from 'abstract-leveldown';
import { 
  IUser, IBackendEvent, IListResponse, IListOptions,
  Workspace, IWorkspace, WorkspaceKind, HttpProjectKind, AccessOperation,
  ICursorOptions, RouteBuilder, IAccessAddOperation, IAccessRemoveOperation,
  PermissionRole,
} from '@api-client/core';
import ooPatch, { JsonPatch, diff } from 'json8-patch';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { SubStore } from './SubStore.js';
import { ApiError } from '../ApiError.js';
import { KeyGenerator } from './KeyGenerator.js';
import { ISpaceStore } from './LevelStores.js';
import { IAddSpaceOptions } from '../routes/RouteOptions.js';

/**
 * The part of the store that takes care of the user spaces data.
 */
export class LevelSpaceStore extends SubStore implements ISpaceStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Creates a default space for the user. This is called when the user has no spaces created.
   * 
   * @param owner The owning user. When not set the `default` is set for the single-user environment.
   * @returns The workspace to create for the user.
   */
  defaultSpace(owner?: string): IWorkspace {
    const workspace = Workspace.fromName('Drafts', owner);
    return workspace.toJSON();
  }

  /**
   * Lists spaces of a user. When user is not set it lists all spaces as this means a single-user environment.
   * 
   * @param user The current user
   * @param options Listing options.
   */
  async list(user: IUser, options?: IListOptions | ICursorOptions): Promise<IListResponse> {
    const state = await this.parent.readListState(options);
    const { limit = this.parent.defaultLimit, parent } = state;
    let lastKey: string | undefined;
    const data: IWorkspace[] = [];
    let remaining = limit;
    const iterator = this.db.iterator();
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const obj = JSON.parse(value) as IWorkspace;
        if (obj.deleted) {
          continue;
        }
        if (obj.parents && obj.parents.length) {
          // this space is a sub-space
          if (!parent) {
            // not listing children right now.
            continue;
          }
          // search only for the direct parent (last object on the parents list).
          if (obj.parents[obj.parents.length - 1] !== parent) {
            continue;
          }
        } else if (parent) {
          continue;
        }
        // note, we are only listing for owners here. Shared spaces are available through the `shared` route / store.
        // however, sub-space listing is handled by this logic.
        if (!parent && obj.owner !== user.key) {
          continue;
        }
        obj.permissions = await this.parent.permission.list(obj.permissionIds);
        if (parent) {
          const access = await this.parent.permission.readFileAccess(obj, user.key, async (id) => this.get(id));
          if (!access) {
            continue;
          }
        }
        data.push(obj);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    const cursor = await this.parent.cursor.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Creates a space in the store for the current user.
   * 
   * @param key Workspace key.
   * @param space The user space definition.
   * @param user The current user
   */
  async add(key: string, space: IWorkspace, user: IUser, opts: IAddSpaceOptions = {}): Promise<void> {let exists = false;
    try {
      await this.db.get(key);
      exists = true;
    } catch (e) {
      // OK
    }
    if (exists) {
      throw new ApiError(`A space with the identifier ${key} already exists`, 400);
    }
    if (opts.parent) {
      // checks write access to the parent space.
      await this.checkAccess('writer', opts.parent, user);
      const parent = await this.get(opts.parent, false);
      if (!parent) {
        throw new ApiError(`The parent space does not exists: ${opts.parent}`, 400);
      }
      const parents: string[] = [...parent.parents, parent.key];
      space.parents = parents;
    } else {
      space.parents = [];
    }

    space.permissions = [];
    space.permissionIds = [];
    space.owner = user.key;

    const value = this.parent.encodeDocument(space);
    await this.db.put(key, value);
    
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: space,
      kind: WorkspaceKind,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.spaces(),
      users: user.key === 'default' ? undefined : [user.key],
    };
    Clients.notify(event, filter);
  }

  /**
   * Reads a space for the given user.
   * It throws when the user is not authorized to use the space.
   * 
   * @param key The key of the space to read.
   * @param user Optional user object. When set it tests whether the user has access to the space.
   * @returns The user space or undefined when not found.
   */
  async read(key: string, user: IUser): Promise<IWorkspace|undefined> {
    await this.checkAccess('reader', key, user);
    const space = await this.get(key);
    if (!space || space.deleted) {
      return undefined;
    }
    return space;
  }

  /**
   * Reads the space without checking for user role.
   * @param key The key of the space.
   * @param includePermissions Whether to read space permissions. Default to true.
   * @returns The space of undefined when not found.
   */
  async get(key: string, includePermissions=true): Promise<IWorkspace|undefined> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      return;
    }
    const space = this.parent.decodeDocument(raw) as IWorkspace;
    if (includePermissions && space.permissionIds.length) {
      space.permissions = await this.parent.permission.list(space.permissionIds);
    } else {
      space.permissions = [];
    }
    return space;
  }

  /**
   * Applies a patch information to the space.
   * 
   * This method throws when the user is not authorized, space does not exists, or
   * when the patch information is invalid.
   * 
   * @param key The space key
   * @param patch The patch to apply
   * @param user The patching user
   * @returns The revert information of the patch.
   */
  async applyPatch(key: string, patch: JsonPatch, user: IUser): Promise<JsonPatch> {
    const isValid = ooPatch.valid(patch);
    if (!isValid) {
      throw new ApiError(`Malformed patch information.`, 400);
    }
    const prohibited: string[] = ['/permissions', '/permissionIds', '/deleted', '/deletedTime', '/deletingUser', '/parents', '/key', '/kind', '/owner'];
    const invalid = patch.find(p => {
      return prohibited.some(path => p.path.startsWith(path));
    });
    if (invalid) {
      throw new ApiError(`Invalid patch path: ${invalid.path}.`, 400);
    }
    const space = await this.read(key, user);
    if (!space) {
      throw new ApiError(`Not found`, 404);
    }
    const result = ooPatch.apply(space, patch, { reversible: true });
    await this.update(key, result.doc, patch, user);
    return result.revert;
  }

  /**
   * Writes to the user space.
   * 
   * Note, this function should not be used by API routes directly.
   * 
   * @param space The updated space object.
   * @param key The space key
   * @param patch The patch object sent to the server. It is used to notify clients about the change.
   * @param user Optional user to check access to the space.
   */
  async update(key: string, space: IWorkspace, patch: JsonPatch, user: IUser): Promise<void> {
    await this.checkAccess('writer', key, user);
    const value = this.parent.encodeDocument(space);
    await this.db.put(key, value);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: patch,
      kind: WorkspaceKind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.space(key),
    };
    Clients.notify(event, filter);
  }

  /**
   * Deletes the space from the system
   * @param key The space key
   * @param user The current user
   */
  async delete(key: string, user: IUser): Promise<void> {
    const access = await this.checkAccess('writer', key, user);

    const space = await this.get(key);
    if (!space) {
      throw new ApiError(`Not found.`, 404);
    }
    if (access !== 'owner') {
      throw new ApiError(`Unauthorized to delete the space.`, 403)
    }
    space.deleted = true;
    space.deletedTime = Date.now();
    space.deletingUser = user.key;
    const deletedKey = KeyGenerator.deletedSpaceKey(key);

    // persist the data
    await this.parent.bin.add(deletedKey, user);
    await this.db.put(key, this.parent.encodeDocument(space));
    await this.parent.shared.deleteByTarget(space.key);

    // inform clients the space is deleted
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: WorkspaceKind,
      id: key,
    };
    // informs spaces list clients about the delete.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.spaces(),
    };
    Clients.notify(event, filter);
    // Disconnect clients connected to the space.
    Clients.closeByUrl(RouteBuilder.space(key));
    // Disconnect clients connected to the space projects.
    Clients.closeByUrl(RouteBuilder.spaceProjects(key));
    
    // now, inform space projects listeners that the project is also deleted
    const list = await this.parent.project.allIndexes(key);
    list.forEach((project) => {
      const event2 = { 
        type: 'event',
        operation: 'deleted',
        kind: HttpProjectKind,
        id: project.key,
      };
      const url = RouteBuilder.spaceProject(key, project.key);
      const filter2: IClientFilterOptions = {
        url,
      };
      Clients.notify(event2, filter2);
      Clients.closeByUrl(url);
    });
  }

  /**
   * Adds or removes users to/from the space.
   * Only available in a multi-user environment.
   * 
   * @param key The key of the space to update
   * @param patch The list of patch operations to perform on user access to the space.
   * @param user The user that triggered the change.
   */
  async patchAccess(key: string, patch: AccessOperation[], user: IUser): Promise<void> {
    await this.checkAccess('writer', key, user);
    
    const space = await this.get(key);
    if (!space) {
      throw new ApiError(`Not found.`, 404);
    }
    const copy = JSON.parse(JSON.stringify(space)) as IWorkspace;
    
    // we do every operation separately as they may be about the same user.

    for (const info of patch) {
      if (info.op === 'add') {
        await this.addPermission(space, info, user);
      } else if (info.op === 'remove') {
        await this.removePermission(space, info, user);
      } else {
        throw new Error(`Unknown operation: ${(info as AccessOperation).op}`);
      }
    }

    const resultingSpace: IWorkspace = { ...space, permissions: [] };
    
    await this.db.put(key, this.parent.encodeDocument(resultingSpace));

    // JSON-patch library takes care of the difference to the object
    const diffPatch = diff(copy, space);
    // note, we add the `permissions` field to the patch as the client already has this field filled up.
    
    // we inform about the space change only when there was an actual change (may not be when updating permissions only).
    if (diffPatch.length) {
      const event: IBackendEvent = {
        type: 'event',
        operation: 'updated',
        data: diffPatch,
        kind: WorkspaceKind,
        id: key,
      };
      const filter: IClientFilterOptions = {
        url: RouteBuilder.space(key),
      };
      Clients.notify(event, filter);
    }
  }

  async addPermission(space: IWorkspace, operation: IAccessAddOperation, addingUser: IUser): Promise<void> {
    if (!['user', 'group', 'anyone'].includes(operation.type)) {
      throw new Error(`Unknown permission type: ${operation.type}`);
    }
    // 1. check if group/user exists and throw when not.
    // 2. check whether the permission for the user/group/anyone exists. If so, update it.
    // 3. else, add new permission.

    switch (operation.type) {
      case 'user': await this.addUserPermission(space, operation, addingUser); break;
      case 'group': await this.addGroupPermission(space, operation, addingUser); break;
      case 'anyone': await this.parent.permission.addAnyonePermission(space, operation, addingUser.key); break;
    }
  }

  private async addUserPermission(space: IWorkspace, operation: IAccessAddOperation, addingUser: IUser): Promise<void> {
    await this.parent.permission.addUserPermission(space, operation, addingUser.key);
    await this.parent.shared.addSpace(space, operation.id!);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'access-granted',
      kind: WorkspaceKind,
      id: space.key,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.spaces(),
      users: [operation.id!],
    };
    Clients.notify(event, filter);
  }

  private async addGroupPermission(space: IWorkspace, operation: IAccessAddOperation, addingUser: IUser): Promise<void> {
    await this.parent.permission.addGroupPermission(space, operation, addingUser.key);
    // TODO: Notify group users.
  }

  async removePermission(space: IWorkspace, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void> {
    switch (operation.type) {
      case 'user': await this.removeUserPermission(space, operation, removingUser); break;
      case 'group': await this.removeGroupPermission(space, operation, removingUser); break;
      case 'anyone': await this.parent.permission.removeAnyonePermission(space, operation, removingUser.key); break;
      default:
        throw new Error(`Unknown permission type: ${operation.type}`);
    }
  }

  private async removeUserPermission(space: IWorkspace, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void> {
    await this.parent.permission.removeUserPermission(space, operation, removingUser.key);
    await this.parent.shared.removeSpace(space.key, operation.id!);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'access-removed',
      kind: WorkspaceKind,
      id: space.key,
    };
    const f = { url: RouteBuilder.spaces(), users: [operation.id!], };
    Clients.notify(event, f);
  }

  private async removeGroupPermission(space: IWorkspace, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void> {
    await this.parent.permission.removeGroupPermission(space, operation, removingUser.key);
    // TODO: Notify group users.
  }

  async checkAccess(minimumLevel: PermissionRole, key: string, user: IUser): Promise<PermissionRole>;
  async checkAccess(minimumLevel: PermissionRole, space: IWorkspace, user: IUser): Promise<PermissionRole>;

  /**
   * Checks whether the user has read or write access to the space.
   * 
   * It throws errors when the user has no access or when the user has no access to the resource.
   * 
   * @param minimumLevel The minimum access level required for this operation.
   * @param keyOrSpace The user space key or the space object.
   * @param user The user object. When not set on the session this always throws an error.
   */
  async checkAccess(minimumLevel: PermissionRole, keyOrSpace: string | IWorkspace, user: IUser): Promise<PermissionRole> {
    if (!user) {
      throw new ApiError(`Authentication required.`, 401)
    }
    const role = await this.parent.permission.readFileAccess(keyOrSpace, user.key, async (id) => this.get(id));
    if (!role) {
      throw new ApiError(`Not found.`, 404);
    }
    const sufficient = this.parent.permission.hasRole(minimumLevel, role);
    if (!sufficient) {
      throw new ApiError(`Insufficient permissions to access this resource.`, 403);
    }
    return role;
  }

  /**
   * Lists users allowed in the space.
   * @param key The key of the space to update
   * @param user The user that requested the list
   */
  async listUsers(key: string, user: IUser): Promise<IListResponse<IUser | undefined>> {
    await this.checkAccess('reader', key, user);
    const ids: string[] = [];
    const space = await this.get(key) as IWorkspace;
    space.permissions.forEach((p) => {
      const { type } = p;
      if (type === 'user') {
        if (p.owner) {
          ids.push(p.owner);
        }
      }
    });
    return this.parent.user.read(ids, { removeProviderData: true });
  }
}
