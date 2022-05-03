import { Bytes } from 'leveldown';
import { 
  IUser, IBackendEvent, IListResponse, IListOptions, PermissionRole, IFile, ApiError,
  AccessOperation, RouteBuilder, IAccessAddOperation, IAccessRemoveOperation, WorkspaceKind,
  File, Permission, IPatchInfo, IPatchRevision, IAccessPatchInfo,
} from '@api-client/core';
import { Patch } from '@api-client/json';
import { SubStore } from '../SubStore.js';
import { IFileAddOptions, IFilesStore } from './AbstractFiles.js';
import Clients, { IClientFilterOptions } from '../../routes/WsClients.js';
import { KeyGenerator } from '../KeyGenerator.js';
import { validateKinds } from './Validator.js';
import { validatePatch } from '../../lib/Patch.js';

interface FileUser {
  id: string;
  role: PermissionRole;
}

/**
 * The Files store operates on all objects that extends the `IFile` interface.
 * 
 * A space is a folder that contains other spaces and files.
 * An example of a file is Project (which is closely related to the HttpProject)
 * or any other content stored in the store as media.
 * 
 * When an application is creating or listing objects they list spaces and all
 * objects that the application support. This gives a flexibility to share the concept
 * of a space onto different applications in the API Client suite. Each application 
 * defined which types, other than a space, it wants to list. The store returns 
 * the final list that consists of the spaces and requested file types.
 * File types are defined by the `kind` discriminator of the IFile interface.
 * 
 * Note, from the store perspective, there's no difference between a file or a space.
 * Files do not hold reference to its children so all objects works the same way.
 * 
 * For the typing system, the definitions below must include all supported kinds.
 * 
 * All events about changes are sent to specific users in the /spaces route.
 */
export class Files extends SubStore implements IFilesStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * A link to the `PermissionStore.readFileAccess()`.
   */
  readFileAccess(keyOrFile: string | IFile, userKey: string): Promise<PermissionRole | undefined> {
    return this.parent.permission.readFileAccess(keyOrFile, userKey, async (id) => this.get(id));
  }

  async list(user: IUser, kinds?: string[], options?: IListOptions): Promise<IListResponse<IFile>> {
    validateKinds(kinds);
    const state = await this.parent.readListState(options);
    const { limit = this.parent.defaultLimit, parent } = state;
    let lastKey: string | undefined;
    const data: IFile[] = [];
    let remaining = limit;
    const iterator = this.db.iterator();
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let targetKinds: string[] | undefined;
    if (Array.isArray(kinds) && kinds.length) {
      targetKinds = [...kinds];
      if (!targetKinds.includes(WorkspaceKind)) {
        targetKinds.push(WorkspaceKind);
      }
    }
    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const obj = JSON.parse(value) as IFile;
        if (obj.deleted) {
          continue;
        }
        if (targetKinds && !targetKinds.includes(obj.kind)) {
          continue;
        }
        if (obj.parents && obj.parents.length) {
          // this file is a file located under another file
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
        // note, we are only listing for owners here. Shared files are available through the `shared` route / store.
        // however, sub-file listing is handled by this logic.
        if (!parent && obj.owner !== user.key) {
          continue;
        }
        obj.permissions = await this.parent.permission.list(obj.permissionIds);
        const role = await this.readFileAccess(obj, user.key);
        if (!role) {
          continue;
        }
        obj.capabilities = File.createFileCapabilities(obj, role);
        File.updateByMeMeta(obj, user.key);
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
    const result: IListResponse<IFile> = {
      data,
      cursor,
    };
    return result;
  }

  async add(key: string, file: IFile, user: IUser, opts: IFileAddOptions = {}): Promise<IFile> {
    let exists = false;
    try {
      await this.db.get(key);
      exists = true;
    } catch (e) {
      // OK
    }
    if (exists) {
      throw new ApiError(`An object with the identifier ${key} already exists.`, 400);
    }

    if (opts.parent) {
      // checks write access to the parent file.
      await this.checkAccess('writer', opts.parent, user);
      const parent = await this.get(opts.parent, false) as IFile; // previous line throws 404 when file does not exist.
      const parents: string[] = [...parent.parents, parent.key];
      file.parents = parents;
    } else {
      file.parents = [];
    }

    file.permissions = [];
    file.permissionIds = [];
    file.owner = user.key;
    delete file.capabilities;
    this.setModified(file, user);

    await this.db.put(key, this.parent.encodeDocument(file));

    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      // data: file,
      kind: file.kind,
      id: file.key,
    };
    if (opts.parent) {
      event.parent = opts.parent;
    }

    const filter: IClientFilterOptions = {
      url: RouteBuilder.files(),
    };
    // this included the owner
    const roles = await this.fileUsers(key);
    roles.forEach((info) => {
      const copy = { ...file };
      delete copy.capabilities;
      copy.lastModified = { ...copy.lastModified };
      if (copy.deletedInfo) {
        copy.deletedInfo = { ...copy.deletedInfo };
      }
      copy.capabilities = File.createFileCapabilities(copy, info.role);
      File.updateByMeMeta(copy, user.key);
      event.data = copy;
      Clients.notify(event, { ...filter, users: [info.id] });
    });

    file.capabilities = File.createFileCapabilities(file, 'owner');
    File.updateByMeMeta(file, user.key);
    event.data = file;
    return file;
  }

  async read(key: string, user: IUser): Promise<IFile> {
    const role = await this.checkAccess('reader', key, user);
    const file = await this.get(key) as IFile; // check permission throws when no file or was deleted
    file.capabilities = File.createFileCapabilities(file, role);
    File.updateByMeMeta(file, user.key);
    return file;
  }

  async readBulk(keys: string[], user: IUser): Promise<IListResponse<IFile|undefined>> {
    const raw = await this.db.getMany(keys);
    const result: IListResponse<IFile|undefined> = {
      data: [],
    };
    for (const item of raw) {
      if (!item) {
        result.data.push(undefined);
        continue;
      }
      const file = this.parent.decodeDocument(item) as IFile;
      const role = await this.readFileAccess(file.key, user.key);
      if (!role) {
        result.data.push(undefined);
        continue;
      }
      if (file.permissionIds.length) {
        file.permissions = await this.parent.permission.list(file.permissionIds);
      } else {
        file.permissions = [];
      }
      file.capabilities = File.createFileCapabilities(file, role);
      File.updateByMeMeta(file, user.key);
      result.data.push(file);
    }
    return result;
  }

  /**
   * Reads the file without checking for user role.
   * 
   * Note, this won't set the file capabilities.
   * 
   * @param key The key of the file.
   * @param includePermissions Whether to read file's permissions. Default to true.
   * @returns The file of undefined when not found.
   */
  async get(key: string, includePermissions=true): Promise<IFile|undefined> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      return;
    }
    const file = this.parent.decodeDocument(raw) as IFile;
    if (includePermissions && file.permissionIds.length) {
      file.permissions = await this.parent.permission.list(file.permissionIds);
    } else {
      file.permissions = [];
    }
    return file;
  }

  async applyPatch(key: string, info: IPatchInfo, user: IUser): Promise<IPatchRevision> {
    validatePatch(info);
    const ignored: string[] = [
      '/permissions', '/permissionIds', '/deleted', '/deletedInfo', '/parents', '/key', '/kind', '/owner', '/lastModified', '/capabilities'
    ];
    const filtered = info.patch.filter(p => {
      return !ignored.some(path => p.path.startsWith(path));
    });
    if (!filtered.length) {
      return { ...info, revert: [] };
    }
    const file = await this.read(key, user);
    const ar = Patch.apply(file, filtered, { reversible: true });

    const result: IPatchRevision = {
      ...info,
      revert: ar.revert,
    };

    await this.update(key, ar.doc as IFile, result, user);
    return result;
  }

  async update(key: string, file: IFile, info: IPatchRevision, user: IUser): Promise<void> {
    await this.checkAccess('writer', key, user);
    this.setModified(file, user);
    await this.db.put(key, this.parent.encodeDocument(file));
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: info,
      kind: file.kind,
      id: key,
    };
    if (file.parents && file.parents.length) {
      event.parent = file.parents[file.parents.length - 1];
    }
    const users = await this.fileUserIds(key);
    const filter: IClientFilterOptions = {
      url: RouteBuilder.files(),
      users,
    };
    Clients.notify(event, filter);
  }

  async delete(key: string, user: IUser): Promise<void> {
    const access = await this.checkAccess('writer', key, user);

    const file = await this.get(key);
    if (!file) {
      throw new ApiError(`Not found.`, 404);
    }
    if (access !== 'owner') {
      throw new ApiError(`Unauthorized to delete the object.`, 403)
    }
    file.deleted = true;
    file.deletedInfo = {
      byMe: false,
      time: Date.now(),
      name: user.name,
      user: user.key,
    };
    const deletedKey = KeyGenerator.deletedKey(file.kind, key);

    // persist the data
    await this.parent.bin.add(deletedKey, user);
    await this.db.put(key, this.parent.encodeDocument(file));
    await this.parent.shared.deleteByTarget(file.key);

    // inform clients the file is deleted
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: file.kind,
      id: key,
    };
    if (file.parents && file.parents.length) {
      event.parent = file.parents[file.parents.length - 1];
    }
    const users = await this.fileUserIds(key);
    // informs spaces list clients about the delete.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.files(),
      users,
    };
    Clients.notify(event, filter);
    // Disconnect clients connected to the file.
    Clients.closeByUrl(RouteBuilder.file(key));
  }

  /**
   * Sets the `lastModified` info on the file
   * @param file The file to mutate
   * @param user The user modifying the file.
   */
  private setModified(file: IFile, user: IUser): void {
    file.lastModified = {
      byMe: false,
      time: Date.now(),
      user: user.key,
      name: user.name,
    };
  }

  async patchAccess(key: string, patchInfo: IAccessPatchInfo, user: IUser): Promise<void> {
    await this.checkAccess('writer', key, user);
    
    const file = await this.get(key, true);
    if (!file) {
      throw new ApiError(`Not found.`, 404);
    }
    const copy = JSON.parse(JSON.stringify(file)) as IFile;

    // we do every operation separately as they may be about the same user.

    for (const info of patchInfo.patch) {
      if (info.op === 'add') {
        await this.addPermission(file, info, user);
      } else if (info.op === 'remove') {
        await this.removePermission(file, info, user);
      } else {
        throw new Error(`Unknown operation: ${(info as AccessOperation).op}`);
      }
    }

    this.setModified(file, user);
    await this.db.put(key, this.parent.encodeDocument({ ...file, permissions: [] }));

    // JSON-patch library takes care of the difference to the object
    const diffPatch = Patch.diff(copy, file);

    // note, we add the `permissions` field to the patch as the client already has this field filled up.
    
    // we inform about the space change only when there was an actual change (may not be when updating permissions only).
    if (diffPatch.length) {
      const data: IPatchRevision = {
        ...patchInfo,
        patch: diffPatch,
        revert: [],
      };

      const event: IBackendEvent = {
        type: 'event',
        operation: 'patch',
        data,
        kind: file.kind,
        id: key,
      };
      if (file.parents && file.parents.length) {
        event.parent = file.parents[file.parents.length - 1];
      }
      const updatedUsers = await this.fileUserIds(key);
      const filter: IClientFilterOptions = {
        url: RouteBuilder.files(),
        users: updatedUsers,
      };
      Clients.notify(event, filter);
    }
  }

  async addPermission(file: IFile, operation: IAccessAddOperation, addingUser: IUser): Promise<void> {
    switch (operation.type) {
      case 'user': await this.addUserPermission(file, operation, addingUser); break;
      case 'group': await this.addGroupPermission(file, operation, addingUser); break;
      case 'anyone': await this.parent.permission.addAnyonePermission(file, operation, addingUser.key); break;
      default:
        throw new Error(`Unknown permission type: ${operation.type}`);
    }
  }

  async removePermission(file: IFile, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void> {
    switch (operation.type) {
      case 'user': await this.removeUserPermission(file, operation, removingUser); break;
      case 'group': await this.removeGroupPermission(file, operation, removingUser); break;
      case 'anyone': await this.parent.permission.removeAnyonePermission(file, operation, removingUser.key); break;
      default:
        throw new Error(`Unknown permission type: ${operation.type}`);
    }
  }

  private async addUserPermission(file: IFile, operation: IAccessAddOperation, addingUser: IUser): Promise<void> {
    const permission = await this.parent.permission.addUserPermission(file, operation, addingUser.key);
    const id = operation.id as string; // previous operation throws when no id
    await this.parent.shared.add(file, id);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'access-granted',
      kind: file.kind,
      data: permission,
      id: file.key,
    };
    if (file.parents && file.parents.length) {
      event.parent = file.parents[file.parents.length - 1];
    }
    // we only notify a user that gained access to the file.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.files(),
      users: [id],
    };
    Clients.notify(event, filter);
  }

  private async addGroupPermission(file: IFile, operation: IAccessAddOperation, addingUser: IUser): Promise<void> {
    await this.parent.permission.addGroupPermission(file, operation, addingUser.key);
    // TODO: Notify group users.
  }

  private async removeUserPermission(file: IFile, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void> {
    await this.parent.permission.removeUserPermission(file, operation, removingUser.key);
    const id = operation.id as string; // previous operation throws when no id
    await this.parent.shared.remove(file, id);

    // we only notify the user that has lost access to the file.
    const event: IBackendEvent = {
      type: 'event',
      operation: 'access-removed',
      kind: file.kind,
      id: file.key,
    };
    if (file.parents && file.parents.length) {
      event.parent = file.parents[file.parents.length - 1];
    }
    const f = { url: RouteBuilder.files(), users: [id] };
    Clients.notify(event, f);
  }

  private async removeGroupPermission(file: IFile, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void> {
    await this.parent.permission.removeGroupPermission(file, operation, removingUser.key);
    // TODO: Notify group users.
  }

  checkAccess(minimumLevel: PermissionRole, key: string, user: IUser): Promise<PermissionRole>;
  checkAccess(minimumLevel: PermissionRole, file: IFile, user: IUser): Promise<PermissionRole>;
  
  async checkAccess(minimumLevel: PermissionRole, keyOrFile: string | IFile, user: IUser): Promise<PermissionRole> {
    if (!user) {
      throw new ApiError(`Authentication required.`, 401)
    }
    const role = await this.readFileAccess(keyOrFile, user.key);
    if (!role) {
      throw new ApiError(`Not found.`, 404);
    }
    const sufficient = Permission.hasRole(minimumLevel, role);
    if (!sufficient) {
      throw new ApiError(`Insufficient permissions to access this resource.`, 403);
    }
    return role;
  }

  async listUsers(key: string, user: IUser): Promise<IListResponse<IUser | undefined>> {
    await this.checkAccess('reader', key, user);
    const ids: string[] = [];
    const file = await this.get(key) as IFile;
    file.permissions.forEach((p) => {
      const { type } = p;
      if (type === 'user') {
        if (p.owner) {
          ids.push(p.owner);
        }
      }
    });
    return this.parent.user.read(ids, { removeProviderData: true });
  }

  /**
   * Compiles a list of all users who has access to the file, including permissions inherited from parent spaces.
   * 
   * @param key The file to read access user
   * @param filter When set it limits the number of users to only ones connected to the server via a web socket. 
   * Use the filter to limit the number of users. The `ids` is always replaces by the user permission currently processed.
   * @returns The list of users with their role.
   */
  async fileUsers(key: string, filter?: IClientFilterOptions): Promise<FileUser[]> {
    const file = await this.get(key, true);
    if (!file) {
      throw new ApiError(`File does not exist while reading the file users.`, 500);
    }
    const result = this.readFileUsers(file, true, filter);
    if (file.parents && file.parents.length) {
      const last = file.parents[file.parents.length -1];
      try {
        const parentAccess = await this.fileUsers(last);
        parentAccess.forEach(i => {
          const exists = result.find(e => e.id === i.id);
          if (!exists) {
            result.push(i);
          }
        });
      } catch (e) {
        this.parent.logger.error(e);
      }
    }
    return result;
  }

  readFileUsers(file: IFile, includeOwner=true, filter?: IClientFilterOptions): FileUser[] {
    const result: FileUser[] = [];
    const { owner, permissions=[] } = file;
    if (includeOwner) {
      if (filter) {
        if (Clients.hasUser(owner, filter)) {
          result.push({ id: owner, role: 'owner' });
        }
      } else {
        result.push({ id: owner, role: 'owner' });
      }
    }
    permissions.forEach((p) => {
      if (p.type !== 'user') {
        return;
      }
      if (filter) {
        if (Clients.hasUser(owner, filter)) {
          result.push({ id: p.owner as string, role: p.role });
        }
      } else {
        result.push({ id: p.owner as string, role: p.role });
      }
    });
    return result;
  }

  /**
   * Reads access to the file. It iterates over the parents to read the inherited access.
   * @param key The key of the file.
   * @returns The list of unique user ids.
   */
  async fileUserIds(key: string): Promise<string[]> {
    const file = await this.get(key, true);
    if (!file) {
      throw new ApiError(`File does not exist while reading the file users.`, 500);
    }
    const ids = this.readFileUserIds(file);
    if (file.parents && file.parents.length) {
      const last = file.parents[file.parents.length -1];
      try {
        const parentAccess = await this.fileUserIds(last);
        parentAccess.forEach(i => {
          if (!ids.includes(i)) {
            ids.push(i);
          }
        });
      } catch (e) {
        this.parent.logger.error(e);
      }
    }
    return ids;
  }

  readFileUserIds(file: IFile, includeOwner=true): string[] {
    const result: string[] = [];
    const { owner, permissions=[] } = file;
    if (includeOwner) {
      result.push(owner);
    }
    permissions.forEach((p) => {
      if (p.type === 'user') {
        result.push(p.owner as string);
      }
    });
    return result;
  }
}
