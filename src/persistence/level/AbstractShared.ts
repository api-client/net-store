import { IUser, IListResponse, IListOptions, IFile } from '@api-client/core';

export interface ISharedLink {
  /**
   * The data target of the link
   */
  id: string;
  /**
   * The kind of file.
   */
  kind: string;
  /**
   * The user id that is the target user.
   */
  uid: string;
  /**
   * The closest parent of the data.
   */
  parent?: string;
}

export interface ISharedStore {
  /**
   * Adds a file to the shared files for a user
   * @param file The shared file
   * @param userId The target user
   */
  add(file: IFile, userId: string): Promise<void>;

  /**
   * Removes a reference to a shared file from the user.
   * 
   * @param file The previously shared file
   * @param userId The target user id.
   */
  remove(file: IFile, userId: string): Promise<void>;

  /**
   * Lists files shared with the user.
   * 
   * @param user The user to list for shared files.
   * @param kinds Optional list of kinds to list. Spaces are ignored and always included.
   * @param options Query options.
   * @returns The list of files that are shared with the user.
   */
  list(user: IUser, kinds?: string[], options?: IListOptions): Promise<IListResponse<IFile>>;
  /**
   * Removes all entries that are linking to a `target`
   * @param targetKey The key of the target.
   */
  deleteByTarget(targetKey: string): Promise<void>;
}
