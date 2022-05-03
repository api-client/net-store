import { IPatchInfo, IPatchRevision, IUser } from "@api-client/core";

export interface IStoredMedia<T = unknown> {
  value: T;
  mime: string;
  deleted?: boolean;
}

export interface IMediaReadOptions {
  /**
   * When set it reads the file that was marked as `_deleted`. By default it throws when file was deleted.
   */
  deleted?: boolean;
}

/**
 * A media is the contents of a File.
 * Keys are the same as for a file but kept in a different namespace.
 */
export interface IAbstractMedia {
  /**
   * Saves a file contents in the store. It overrides the contents if previously set by default.
   * 
   * Note, this method does not check for permissions. This must be performed on the `file`.
   * 
   * @param key The File key
   * @param contents The file contents. It is serialized with the `JSON.stringify()` function. This store does not support binary data.
   * @param mime The mime type of the contents. This is returned back by the `read()` method to set the proper `content-type` header.
   * @param allowOverwrite When true (the default behavior) it overrides the value if the contents already exists. When `false` it throws when trying to re-set the contents.
   */
  set(key: string, contents: unknown, mime: string, allowOverwrite?: boolean): Promise<void>;

  /**
   * Reads the contents data.
   * 
   * Note, this method does not check for permissions. This must be performed on the `file`.
   * 
   * @param key The File key
   * @returns The contents casted to its original format with the mime type information.
   */
  read(key: string, opts?: IMediaReadOptions): Promise<IStoredMedia>;

  /**
   * Deletes the contents.
   * 
   * @param key The File key
   * @param kind The kind of the related File. Used to build the "bin" key.
   * @param user The deleting user. This is to move the contents to the "bin" and 
   */
  delete(key: string, kind: string, user: IUser): Promise<void>;

  /**
   * Applies a patch to the media. It assumes that the media is a JSON contents. 
   * 
   * This method does not check for file access. This must be performed on the `file`.
   * 
   * @param key The File key
   * @param kind The kind of the related File. Used to build the key for the "revisions".
   * @param patch The patch to apply
   * @param user The patching user
   * @returns The revert information of the patch.
   */
  applyPatch(key: string, kind: string, patch: IPatchInfo, user: IUser): Promise<IPatchRevision>;
}
