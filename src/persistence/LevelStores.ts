import {
  IUser, IWorkspace, IHttpProject, IListResponse, HistoryListOptions,
  IListOptions, IHttpHistory, ICursorOptions, IHttpHistoryBulkAdd,
  AccessOperation, IPermission, PermissionRole, IAccessAddOperation, IFile,
  IAccessRemoveOperation, IGroup,
} from '@api-client/core';
import { JsonPatch } from 'json8-patch';
import { IUserListOptions } from './LevelUserStore.js';
import { IAddSpaceOptions } from '../routes/RouteOptions.js';

export type HistoryState = HistoryListOptions & {
  lastKey?: string;
}

export interface IHistoryStore {
  add(history: IHttpHistory, user: IUser): Promise<string>;
  bulkAdd(info: IHttpHistoryBulkAdd, user: IUser): Promise<string[]>;
  list(user: IUser, options?: HistoryState | ICursorOptions): Promise<IListResponse>;
  delete(key: string, user: IUser): Promise<void>;
  bulkDelete(keys: string[], user: IUser): Promise<void>;
  read(encodedKey: string, user: IUser): Promise<IHttpHistory>;
}

export interface IUserStore {
  add(userKey: string, user: IUser): Promise<void>;
  read(userKey: string, opts?: IUserListOptions): Promise<IUser | undefined>;
  read(userKeys: string[], opts?: IUserListOptions): Promise<IListResponse<IUser | undefined>>;
  list(options?: IListOptions): Promise<IListResponse>;
  filter(user: IUser, lowerQuery: string): boolean;
  listMissing(keys: string[]): Promise<string[]>;
}

export interface IBinStore {
  add(key: string, user: IUser): Promise<void>;
  isDeleted(key: string): Promise<boolean>;
  isSpaceDeleted(space: string): Promise<boolean>;
  isUserDeleted(user: string): Promise<boolean>;
  isProjectDeleted(space: string, project: string): Promise<boolean>;
}
export interface IRevisionsStore {
  addProject(spaceKey: string, projectKey: string, patch: JsonPatch): Promise<void>;
  listProject(spaceKey: string, projectKey: string, user: IUser, options?: IListOptions): Promise<IListResponse>;
}
export interface IProjectsStore {
  list(key: string, user: IUser, options?: IListOptions): Promise<IListResponse>;
  add(spaceKey: string, projectKey: string, project: IHttpProject, user: IUser): Promise<void>;
  read(spaceKey: string, projectKey: string, user: IUser): Promise<IHttpProject>;
  update(spaceKey: string, projectKey: string, project: IHttpProject, patch: JsonPatch, user: IUser): Promise<void>;
  delete(spaceKey: string, projectKey: string, user: IUser): Promise<void>;
  checkAccess(minimumLevel: PermissionRole, space: string, project: string, user: IUser): Promise<PermissionRole>;
}
export interface ISpaceStore {
  defaultSpace(owner?: string): IWorkspace;
  list(user: IUser, options?: IListOptions): Promise<IListResponse>;
  add(key: string, space: IWorkspace, user: IUser, opts?: IAddSpaceOptions): Promise<void>;
  read(key: string, user: IUser): Promise<IWorkspace | undefined>;
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
  applyPatch(key: string, patch: JsonPatch, user: IUser): Promise<JsonPatch>;
  update(key: string, space: IWorkspace, patch: JsonPatch, user: IUser): Promise<void>;
  delete(key: string, user: IUser): Promise<void>;
  patchAccess(key: string, patch: AccessOperation[], user: IUser): Promise<void>;
  addPermission(space: IWorkspace, operation: IAccessAddOperation, addingUser: IUser): Promise<void>;
  removePermission(space: IWorkspace, operation: IAccessRemoveOperation, removingUser: IUser): Promise<void>;
  checkAccess(minimumLevel: PermissionRole, key: string, user: IUser): Promise<PermissionRole>;
  /**
   * Lists users allowed in the space.
   * @param key The key of the space to update
   * @param user The user that requested the list
   */
  listUsers(key: string, user: IUser): Promise<IListResponse<IUser | undefined>>;
}
export interface ISessionStore {
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  read(key: string): Promise<unknown | undefined>;
}

export interface IPermissionStore {
  /**
   * Reads the list of permissions in a bulk operation.
   * @param ids The ids of permissions.
   */
  list(ids: string[]): Promise<IPermission[]>;
  /**
   * Writes a permission object to the store.
   * 
   * @param key The key to write the into under
   * @param info The permission object.
   */
  write(key: string, info: IPermission): Promise<void>;

  /**
   * Reads the permission object.
   * 
   * @param key The key of the permission.
   * @returns The permission object or undefined when the permission does not exist or is deleted.
   */
  read(key: string): Promise<IPermission | undefined>;

  /**
   * Marks the permission as deleted.
   * @param key The key of the permission to delete
   * @param removingUser The key of the user that deleted the permission
   */
  delete(key: string, removingUser: string): Promise<void>;
  /**
   * Adds a user permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  addUserPermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<string>;

  /**
   * Adds a group permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  addGroupPermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<string>;

  /**
   * Adds the "anyone" permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  addAnyonePermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<string>;
  /**
   * Removes a user permission from the object that extends the File.
   * 
   * Note, it does nothing when the permission is not found.
   * 
   * @param file The file to alter, removes the permission from.
   * @param operation The remove operation.
   * @param removingUser The id of the user that removes the permission.
   */
  removeUserPermission(file: IFile, operation: IAccessRemoveOperation, removingUser: string): Promise<void>;

  /**
   * Removes a group permission from the object that extends the File.
   * 
   * Note, it does nothing when the permission is not found.
   * 
   * @param file The file to alter, removes the permission from.
   * @param operation The remove operation.
   * @param removingUser The id of the user that removes the permission.
   */
  removeGroupPermission(file: IFile, operation: IAccessRemoveOperation, removingUser: string): Promise<void>;

  /**
   * Removes the "anyone" permission from the object that extends the File.
   * 
   * Note, it does nothing when the permission is not found.
   * 
   * @param file The file to alter, removes the permission from.
   * @param operation The remove operation.
   * @param removingUser The id of the user that removes the permission.
   */
  removeAnyonePermission(file: IFile, operation: IAccessRemoveOperation, removingUser: string): Promise<void>;

  /**
   * Finds a permission to the File in the file's permissions list for the user.
   * 
   * @param file The file to search in.
   * @param id The user id.
   * @param id The list of groups the user belongs to.
   * @returns The permission for the user or a group if specified, the "anyone" if specified, or undefined.
   */
  findUserPermission(file: IFile, id: string, userRoles?: IGroup[]): PermissionRole | undefined;

  /**
   * Checks whether the current user role meets the minimum required role.
   * 
   * @param minimumLevel The minimum requested role
   * @param currentRole The user role.
   * @returns True if the `currentRole` is at least the `minimumRole`
   */
  hasRole(minimumLevel: PermissionRole, currentRole: PermissionRole): boolean;

  /**
   * In the unsorted array of permissions finds the permission that has a role with the highest
   * value.
   * 
   * @param permissions The unsorted list of permissions
   * @returns The permission that has the highest role or undefined when passed an empty array.
   */
  findHighestPermission(permissions: IPermission[]): IPermission | undefined;

  /**
   * Sorts the permissions in the array from the lowest (reader) to the highest (owner)
   * @param permissions The list of permissions. This mutates the array
   */
  sortPermissions(permissions: IPermission[]): void;
  /**
   * Reads user access to an object that extends the File.
   * 
   * @param keyOrFile The id or the object that extends the IFile
   * @param userKey The user key we search for access
   * @param generator The function called when requesting for the IFile object. The passed argument is the id of the file.
   * @returns The highest user role for the file or undefined when the user has no role.
   */
  readFileAccess(keyOrFile: string | IFile, userKey: string, generator: (keyOrFile: string) => Promise<IFile>, userGroups?: IGroup[]): Promise<PermissionRole | undefined>;
}

export interface ISharedStore {
  /**
   * Adds a space to the shared spaced for a user
   * @param space The shared space
   * @param userId The target user
   */
  addSpace(space: IWorkspace, userId: string): Promise<void>;

  /**
   * Removes a reference to a shared space from the user.
   * 
   * @param spaceId The id of the previously shared space
   * @param userId The target user id.
   */
  removeSpace(spaceId: string, userId: string): Promise<void>;

  /**
   * Lists spaces shared with the user.
   * 
   * @param user The user to list for shared spaces.
   * @param options Query options.
   * @returns The list of spaces that are shared with the user.
   */
  listSpaces(user: IUser, options?: IListOptions): Promise<IListResponse<IWorkspace>>;
  /**
   * Removes all entries that are linking to a `target`
   * @param target The key if the target.
   */
  deleteByTarget(target: string): Promise<void>;
}

export interface IListState {
  /**
   * Number of items in the result.
   */
  limit?: number;
  /**
   * The key of the last item returned by the query.
   * Used with pagination.
   */
  lastKey?: string;
  /**
   * The start key to use.
   */
  start?: string;
  /**
   * The last key to use.
   */
  end?: string;
  /**
   * Supported by some endpoints. When set it performs a query on the data store.
   */
  query?: string;
  /**
   * Only with the `query` property. Tells the system in which fields to search for the query term.
   */
  queryField?: string[];
  /**
   * Whether the list should contain children of a parent.
   * This is a key of the parent.
   */
  parent?: string;
}
