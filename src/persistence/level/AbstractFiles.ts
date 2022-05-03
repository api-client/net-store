import {
  IUser, IListResponse, IListOptions, PermissionRole, IAccessAddOperation, IFile,
  IAccessRemoveOperation, IPatchInfo, IPatchRevision, IAccessPatchInfo,
} from '@api-client/core';

export interface IFileAddOptions {
  /**
   * The parent space where to put the file.
   * The `parents` array is always cleared from the space object before adding it to the store.
   */
  parent?: string;
}

/**
 * A breadcrumb when creating the breadcrumb list for a file.
 */
export interface IFileBreadcrumb {
  /**
   * The datastore key of the object.
   */
  key: string;
  /**
   * THe kind of the object.
   */
  kind: string;
  /**
   * The name of the object.
   */
  name: string;
}

export interface IFilesStore {
  /**
   * A link to the `PermissionStore.readFileAccess()`.
   */
  readFileAccess(keyOrFile: string | IFile, userKey: string): Promise<PermissionRole | undefined>;
  
  /**
   * Lists file entities from the store.
   * 
   * It tests for the `user` access to the files.
   * 
   * Note, on the root level this only lists the files for the owner of the file. Use `share` store to list shared files.
   * It is allowed to list files in a shared parent using this method.
   * 
   * @param user The current user making the query.
   * @param kinds The list of file kinds to query for. Spaces are **always** included. When not set it returns all files.
   * @param options List query options.
   */
  list(user: IUser, kinds?: string[], options?: IListOptions): Promise<IListResponse<IFile>>;
  /**
   * Adds a file to the files.
   * 
   * It tests for the `user` access to the files (when specifying the parent).
   * 
   * @param key The key under which to store the file.
   * @param file The file to store.
   * @param user The current user that becomes the owner of the file.
   * @param opts Additional and optional add options.
   * @returns The file with modified properties.
   */
  add(key: string, file: IFile, user: IUser, opts?: IFileAddOptions): Promise<IFile>;
  /**
   * Reads the object from the data store.
   * 
   * It tests for the `user` access to the file.
   * 
   * @param key The key of the object
   * @param user The current user. It tests the permissions to the file against this user.
   */
  read(key: string, user: IUser): Promise<IFile>;
  /**
   * Reads a number of files in a bulk operation.
   * 
   * @param keys The list of keys to read. When the user has no access to the file it returns undefined in that place.
   * @param user The current user.
   */
  readBulk(keys: string[], user: IUser): Promise<IListResponse<IFile|undefined>>;
  /**
   * Applies a patch information to the file.
   * 
   * This method throws when the user is not authorized, file does not exists, or
   * when the patch information is invalid.
   * 
   * @param key The file key
   * @param patch The patch to apply
   * @param user The patching user
   * @returns The revert information of the patch.
   */
  applyPatch(key: string, patch: IPatchInfo, user: IUser): Promise<IPatchRevision>;
  /**
   * Updates the file in the store. This is not intended to be used by the HTTP routes.
   * It simply stores the already patched file and informs the clients about the change.
   * 
   * It tests for the `user` access to the file. 
   * 
   * @param key The key of the file to patch.
   * @param file The file to update.
   * @param patch The revere patch information after applying the patch.
   * @param user The current user to test permissions against.
   */
  update(key: string, file: IFile, patch: IPatchInfo, user: IUser): Promise<void>;
  /**
   * Deletes a file in the store.
   * 
   * It tests for the `user` access to the file. 
   * 
   * @param key The file key.
   * @param user The current user to test the permission against.
   */
  delete(key: string, user: IUser): Promise<void>;
  /**
   * The permission modification entrypoint for HTTP routes. Changes permission to the file.
   * 
   * @param key The key of the file to manipulate the permissions for.
   * @param patch The access operation patch.
   * @param user The current user to test the permissions against.
   */
  patchAccess(key: string, patch: IAccessPatchInfo, user: IUser): Promise<void>;
  /**
   * An atomic ADD permission operation. Not intended to use outside the persistance layer.
   * It adds the permission mutating the file but does not store the file.
   * 
   * @param file The file to add the permission to. The file is mutated.
   * @param operation The access add operation definition.
   * @param addingUser The user that is adding the permission.
   * @param users The list of users to notify about the change
   */
  addPermission(file: IFile, operation: IAccessAddOperation, addingUser: IUser, users: string[]): Promise<void>;
  /**
   * An atomic REMOVE permission operation. Not intended to use outside the persistance layer.
   * It removes the permission mutating the file but does not store the file.
   * 
   * @param file The file to remove the permission from. The file is mutated.
   * @param operation The access remove operation definition.
   * @param removingUser The user that is removing the permission.
   * @param users The list of users to notify about the change
   */
  removePermission(file: IFile, operation: IAccessRemoveOperation, removingUser: IUser, users: string[]): Promise<void>;
  /**
   * Confirms user access to the file.
   * 
   * It throws errors when the user has no access to the file.
   * 
   * @param minimumLevel The minimum access level.
   * @param key The file key to check the access to.
   * @param user The user object. When not this always throws an error.
   */
  checkAccess(minimumLevel: PermissionRole, key: string, user: IUser): Promise<PermissionRole>;
  /**
   * Confirms user access to the file.
   * 
   * It throws errors when the user has no access to the file.
   * 
   * @param minimumLevel The minimum access level.
   * @param file The file file object to check the access to.
   * @param user The user object. When not this always throws an error.
   */
  checkAccess(minimumLevel: PermissionRole, file: IFile, user: IUser): Promise<PermissionRole>;

  /**
   * Confirms user access to the file.
   * 
   * It throws errors when the user has no access to the file.
   * 
   * @param minimumLevel The minimum access level.
   * @param keyOrFile The file key or the file object.
   * @param user The user object. When not this always throws an error.
   */
  checkAccess(minimumLevel: PermissionRole, keyOrFile: string | IFile, user: IUser): Promise<PermissionRole>
  /**
   * Lists users having permission to the file.
   * 
   * @param key The key of the file to update
   * @param user The user that requested the list
   */
  listUsers(key: string, user: IUser): Promise<IListResponse<IUser | undefined>>;
  /**
   * A helper method listing all user ids that have access to the file.
   * This includes the owner and all shared users.
   * 
   * Note, groups are currently not supported.
   * 
   * Note, this does not check for file permissions. This must be done before calling this function.
   * 
   * @param key The file key
   * @returns The list of users that have access to the file. The first one is always the owner.
   */
  fileUserIds(key: string): Promise<string[]>;
}
