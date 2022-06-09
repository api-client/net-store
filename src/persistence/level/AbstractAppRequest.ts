import { IAppRequest, IBatchReadResult, IListResponse, IListOptions, IBatchUpdateResult, IBatchDeleteResult, IRevertResponse, IDeleteRecord, IUser, IPatchInfo, IPatchRevision } from '@api-client/core';
import { IGetOptions } from './AbstractApp.js';

export interface IAppRequestStore {
  /**
   * Adds a single HTTP request to the app.
   * 
   * @param value The HTTP request to add.
   * @param appId The application id for which to create the request.
   * @returns The created AppRequest with updated server-side properties.
   */
  create(value: IAppRequest, appId: string, user: IUser): Promise<IAppRequest>;

  /**
   * Lists application requests.
   * 
   * @param appId The application id to which lists the requests.
   * @param options List query options.
   * @returns The list response with `AppRequest`s
   */
  list(appId: string, user: IUser, options?: IListOptions): Promise<IListResponse<IAppRequest>>;

  /**
   * Creates a number of `AppRequest`s in a batch operation.
   * 
   * @param values The `AppRequest`s list to insert.
   * @param appId The application id generating these requests.
   * @returns The ordered list of created requests.
   */
  createBatch(values: IAppRequest[], appId: string, user: IUser): Promise<IBatchUpdateResult<IAppRequest>>;

  /**
   * Reads `AppRequest`s in a batch operation.
   * 
   * @param keys The list of request keys to read.
   * @param appId The application id that generated the app requests.
   * @returns The ordered list of results. The undefined/null value means the object couldn't be read (does not exists or no access).
   */
  readBatch(keys: string[], appId: string, user: IUser, opts?: IGetOptions): Promise<IBatchReadResult<IAppRequest>>;

  /**
   * Deletes `AppRequest`s in a batch operation.
   * 
   * @param keys The list of request keys to delete.
   * @param appId The application id that generated the app requests.
   * @returns A delete record for each request or null/undefined when couldn't delete the record.
   */
  deleteBatch(keys: string[], appId: string, user: IUser): Promise<IBatchDeleteResult>;

  /**
   * Restores previously deleted `AppRequest`s.
   * 
   * @param keys The list of keys of deleted records.
   * @param appId The application id that generated the app requests.
   * @returns The ordered list of the restored requests. An item can be null/undefined when the service couldn't restore the request.
   */
  undeleteBatch(keys: string[], appId: string, user: IUser): Promise<IRevertResponse<IAppRequest>>;

  /**
   * Reads a single AppRequest entry from the store.
   * 
   * @param key The key of the request to read.
   * @param appId The application id that created this entry.
   * @returns The stored AppRequest.
   */
  read(key: string, appId: string, user: IUser, opts?: IGetOptions): Promise<IAppRequest>

  /**
   * Deletes a single AppRequest.
   * 
   * @param key The key of the AppRequest to delete.
   * @param appId The application id that created this entry.
   * @returns The delete record for the request.
   */
  delete(key: string, appId: string, user: IUser): Promise<IDeleteRecord>;
  /**
   * Patches an app request in the store.
   * 
   * @param key The key of the request to patch
   * @param value The JSON patch to be processed.
   * @returns The JSON patch to revert the change using the `@api-client/json` library
   */
  patch(key: string, appId: string, value: IPatchInfo, user: IUser): Promise<IPatchRevision>;
}
