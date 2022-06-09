import { IAppProject, IBatchReadResult, IListResponse, IListOptions, IBatchUpdateResult, IBatchDeleteResult, IRevertResponse, IDeleteRecord, IUser, IPatchInfo, IPatchRevision } from '@api-client/core';
import { IGetOptions } from './AbstractApp.js';

export interface IAppProjectStore {
  /**
   * Adds a single project to the app.
   * 
   * @param value The project to add.
   * @param appId The application id for which to create the project.
   * @param request Optional request options
   * @returns The created project with updated server-side properties.
   */
  create(value: IAppProject, appId: string, user: IUser): Promise<IAppProject>;

  /**
   * Lists application projects.
   * 
   * @param appId The application id to which lists the projects.
   * @param options List query options.
   * @returns The list response with `AppProject`s
   */
  list(appId: string, user: IUser, options?: IListOptions): Promise<IListResponse<IAppProject>>;

  /**
   * Creates a number of `AppProject`s in a batch operation.
   * 
   * @param values The `AppProject`s list to insert.
   * @param appId The application id generating these projects.
   * @returns The ordered list of created projects.
   */
  createBatch(values: IAppProject[], appId: string, user: IUser): Promise<IBatchUpdateResult<IAppProject>>;

  /**
   * Reads `AppProject`s in a batch operation.
   * 
   * @param keys The list of project keys to read.
   * @param appId The application id that generated the app projects.
   * @returns The ordered list of results. The undefined/null value means the object couldn't be read (does not exists or no access).
   */
  readBatch(keys: string[], appId: string, user: IUser, opts?: IGetOptions): Promise<IBatchReadResult<IAppProject>>;

  /**
   * Deletes `AppProject`s in a batch operation.
   * 
   * @param keys The list of project keys to delete.
   * @param appId The application id that generated the app projects.
   * @returns A delete record for each project or null/undefined when couldn't delete the record.
   */
  deleteBatch(keys: string[], appId: string, user: IUser): Promise<IBatchDeleteResult>;

  /**
   * Restores previously deleted `AppProject`s.
   * 
   * @param keys The list of keys of deleted records.
   * @param appId The application id that generated the app projects.
   * @returns The ordered list of the restored projects. An item can be null/undefined when the service couldn't restore the project.
   */
  undeleteBatch(keys: string[], appId: string, user: IUser): Promise<IRevertResponse<IAppProject>>;

  /**
   * Reads a single AppProject entry from the store.
   * 
   * @param key The key of the project to read.
   * @param appId The application id that created this entry.
   * @returns The stored AppProject.
   */
  read(key: string, appId: string, user: IUser, opts?: IGetOptions): Promise<IAppProject>;

  /**
   * Deletes a single `AppProject`.
   * 
   * @param key The key of the `AppProject` to delete.
   * @param appId The application id that created this entry.
   * @returns The delete record for the project.
   */
  delete(key: string, appId: string, user: IUser): Promise<IDeleteRecord>;

  /**
   * Patches an app project in the store.
   * 
   * @param key The key of the project to patch
   * @param value The JSON patch to be processed.
   * @returns The JSON patch to revert the change using the `@api-client/json` library
   */
  patch(key: string, appId: string, value: IPatchInfo, user: IUser): Promise<IPatchRevision>;
}
