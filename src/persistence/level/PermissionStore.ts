import { 
  ApiError, Permission, IPermission, IFile, IAccessAddOperation, IAccessRemoveOperation, 
  PermissionRole, IGroup 
} from '@api-client/core';
import { Bytes } from 'leveldown';
import { SubStore } from '../SubStore.js';
import { IPermissionStore } from './AbstractPermission.js';

const orderedRoles: PermissionRole[] = ["reader", "commenter", "writer", "owner"];

/**
 * The part of the store that takes care of the user spaces data.
 */
export class PermissionStore extends SubStore implements IPermissionStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Reads the list of permissions in a bulk operation.
   * @param ids The ids of permissions.
   */
  async list(ids: string[]): Promise<IPermission[]> {
    const result: IPermission[] = [];
    if (!ids || !ids.length) {
      return result;
    }
    const list = await this.db.getMany(ids);
    list.forEach((item) => {
      if (!item) {
        return;
      }
      const decoded = this.parent.decodeDocument(item) as IPermission;
      result.push(decoded);
    });
    return result;
  }

  /**
   * Writes a permission object to the store.
   * 
   * @param key The key to write the into under
   * @param info The permission object.
   */
  async write(key: string, info: IPermission): Promise<void> {
    const value = this.parent.encodeDocument(info);
    await this.db.put(key, value);
  }

  /**
   * Reads the permission object.
   * 
   * @param key The key of the permission.
   * @returns The permission object or undefined when the permission does not exist or is deleted.
   */
  async read(key: string): Promise<IPermission | undefined> {
    let raw: Bytes | undefined;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      return;
    }
    return this.parent.decodeDocument(raw) as IPermission;
  }

  /**
   * Marks the permission as deleted.
   * @param key The key of the permission to delete
   * @param removingUser The key of the user that deleted the permission
   */
  async delete(key: string, removingUser: string): Promise<void> {
    const data = await this.read(key);
    if (!data) {
      return;
    }
    data.deleted = true;
    data.deletedTime = Date.now();
    data.deletingUser = removingUser;
  }
  
  /**
   * Adds a permission to an object that extends a file.
   * This is a low-level API.
   * 
   * @param file The file object. It changes the object.
   * @param operation The add operation description.
   * @param addingUser The key of the adding the operation user
   * @param fn The function that generates the permission when the `permission` missing
   * @param permission Optional permission if already existed.
   */
  async addPermission(file: IFile, operation: IAccessAddOperation, addingUser: string, fn: () => IPermission, permission?: IPermission): Promise<IPermission> {
    if (!permission) {
      permission = fn();
      file.permissionIds.push(permission.key);
      file.permissions.push(permission);
    } else {
      permission.addingUser = addingUser;
      permission.role = operation.value;
    }
    if (operation.expirationTime) {
      if (operation.expirationTime < Date.now()) {
        throw new ApiError(`The permission expiration date is in the past.`, 400);
      }
      permission.expirationTime = operation.expirationTime;
    }
    await this.write(permission.key, permission);
    return permission;
  }

  /**
   * Adds a user permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  async addUserPermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<IPermission> {
    const { id } = operation;
    if (!id) {
      throw new ApiError('Missing "id" parameter when adding the permission to a user.', 400);
    }
    const readUser = await this.parent.user.read(id);
    if (!readUser) {
      throw new ApiError(`User "${id}" not found.`, 400);
    }
    const permission = file.permissions.find(p => p.type === 'user' && p.owner === id);
    return this.addPermission(file, operation, addingUser, () => {
      const p = Permission.fromUserRole(operation.value, id, addingUser);
      p.owner = id;
      return p.toJSON()
    }, permission);
  }

  /**
   * Adds a group permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  async addGroupPermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<IPermission> {
    const { id } = operation;
    if (!id) {
      throw new ApiError('Missing "id" parameter when adding the permission to a group.', 400);
    }
    // TODO: check whether the group exists.
    const permission = file.permissions.find(p => p.type === 'group' && p.owner === id);
    return this.parent.permission.addPermission(file, operation, addingUser, () => {
      const p = Permission.fromGroupRole(operation.value, id, addingUser);
      p.owner = id;
      return p.toJSON()
    }, permission);
  }

  /**
   * Adds the "anyone" permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  async addAnyonePermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<IPermission> {
    const permission = file.permissions.find(p => p.type === 'anyone');
    return this.parent.permission.addPermission(file, operation, addingUser, () => {
      return Permission.fromAnyoneRole(operation.value, addingUser).toJSON()
    }, permission);
  }

  /**
   * Removes a user permission from the object that extends the File.
   * 
   * Note, it does nothing when the permission is not found.
   * 
   * @param file The file to alter, removes the permission from.
   * @param operation The remove operation.
   * @param removingUser The id of the user that removes the permission.
   */
  async removeUserPermission(file: IFile, operation: IAccessRemoveOperation, removingUser: string): Promise<void> {
    const { id } = operation;
    if (!id) {
      throw new ApiError('Missing "id" parameter when removing a user permission.', 400);
    }
    const index = file.permissions.findIndex(i => i.type === operation.type && i.owner === id);
    await this.removePermission(file, index, removingUser);
  }

  /**
   * Removes a group permission from the object that extends the File.
   * 
   * Note, it does nothing when the permission is not found.
   * 
   * @param file The file to alter, removes the permission from.
   * @param operation The remove operation.
   * @param removingUser The id of the user that removes the permission.
   */
  async removeGroupPermission(file: IFile, operation: IAccessRemoveOperation, removingUser: string): Promise<void> {
    const { id } = operation;
    if (!id) {
      throw new ApiError('Missing "id" parameter when removing a group permission.', 400);
    }
    const index = file.permissions.findIndex(i => i.type === operation.type && i.owner === id);
    await this.removePermission(file, index, removingUser);
  }

  /**
   * Removes the "anyone" permission from the object that extends the File.
   * 
   * Note, it does nothing when the permission is not found.
   * 
   * @param file The file to alter, removes the permission from.
   * @param operation The remove operation.
   * @param removingUser The id of the user that removes the permission.
   */
  async removeAnyonePermission(file: IFile, operation: IAccessRemoveOperation, removingUser: string): Promise<void> {
    const index = file.permissions.findIndex(i => i.type === operation.type);
    await this.removePermission(file, index, removingUser);
  }

  private async removePermission(file: IFile, index: number, removingUser: string): Promise<void> {
    if (index < 0) {
      return;
    }
    const permission = file.permissions[index];
    const { key } = permission;

    file.permissions.splice(index, 1);
    await this.delete(key, removingUser);
    
    const idIndex = file.permissionIds.indexOf(key);
    if (idIndex >= 0) {
      file.permissionIds.splice(idIndex, 1);
    }
  }

  /**
   * Finds a permission to the File in the file's permissions list for the user.
   * 
   * @param file The file to search in.
   * @param id The user id.
   * @param id The list of groups the user belongs to.
   * @returns The permission for the user or a group if specified, the "anyone" if specified, or undefined.
   */
  findUserPermission(file: IFile, id: string, userGroups: IGroup[] = []): PermissionRole | undefined {
    if (file.owner === id) {
      return 'owner';
    }
    const { permissions=[] } = file;
    let user: IPermission | undefined;
    let anyone: IPermission | undefined;
    let groups: IPermission[] = [];
    const now = Date.now();
    const groupIds: string[] = userGroups.map(i => i.key);
    for (const p of permissions) {
      if (p.deleted) {
        continue;
      }
      if (p.expirationTime && p.expirationTime < now) {
        continue;
      }
      if (p.type === 'anyone') {
        anyone = p;
      } else if (p.type === 'user' && p.owner === id) {
        user = p;
        // here break as the user role takes precedence over anyone role.
        break;
      } else if (p.type === 'group' && groupIds.includes(p.owner!)) {
        groups.push(p);
      }
    }
    // user permission always overrides the other roles.
    if (user) {
      return user.role;
    }
    // pick a role that is highest among "anyone" and "group".
    if (anyone) {
      groups.push(anyone);
    }
    const perm = this.findHighestPermission(groups);
    if (perm) {
      return perm.role;
    }
    return undefined;
  }

  /**
   * In the unsorted array of permissions finds the permission that has a role with the highest
   * value.
   * 
   * @param permissions The unsorted list of permissions
   * @returns The permission that has the highest role or undefined when passed an empty array.
   */
  findHighestPermission(permissions: IPermission[]): IPermission | undefined {
    const cp: IPermission[] = [...permissions];
    this.sortPermissions(cp);
    return cp[cp.length -1];
  }

  /**
   * Sorts the permissions in the array from the lowest (reader) to the highest (owner)
   * @param permissions The list of permissions. This mutates the array
   */
  sortPermissions(permissions: IPermission[]): void {
    permissions.sort((a, b) => {
      const aIndex = orderedRoles.indexOf(a.role);
      const bIndex = orderedRoles.indexOf(b.role);
      return aIndex - bIndex;
    });
  }

  /**
   * Reads user access to an object that extends the File.
   * 
   * @param keyOrFile The id or the object that extends the IFile
   * @param userKey The user key we search for access
   * @param generator The function called when requesting for the IFile object. The passed argument is the id of the file.
   * @returns The highest user role for the file or undefined when the user has no role.
   */
  async readFileAccess(keyOrFile: string | IFile, userKey: string, generator: (keyOrFile: string) => Promise<IFile | undefined>, userGroups: IGroup[] = []): Promise<PermissionRole | undefined> {
    const isString = typeof keyOrFile === 'string';
    const file = isString ? await generator(keyOrFile) : keyOrFile;
    if (!file || file.deleted) {
      return undefined;
    }
    
    const role = this.findUserPermission(file, userKey, userGroups);
    if (role) {
      return role;
    }
    if (file.parents.length) {
      const parent = file.parents[file.parents.length - 1];
      // checks for parent permissions.
      return this.readFileAccess(parent, userKey, generator, userGroups);
    }
    return undefined;
  }
}
