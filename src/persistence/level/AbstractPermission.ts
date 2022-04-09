import {
  IPermission, PermissionRole, IAccessAddOperation, IFile,
  IAccessRemoveOperation, IGroup,
} from '@api-client/core';

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
  addUserPermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<IPermission>;

  /**
   * Adds a group permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  addGroupPermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<IPermission>;

  /**
   * Adds the "anyone" permission to an object that extends the File.
   * 
   * @param file The file to alter, adds the permission to.
   * @param operation The add permission operation.
   * @param addingUser The id of the user that is adding the permission
   * @returns The id of the created permission.
   */
  addAnyonePermission(file: IFile, operation: IAccessAddOperation, addingUser: string): Promise<IPermission>;
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
