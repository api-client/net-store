import { IAppProject, IAppRequest, IListOptions, IQueryResponse, IUser } from '@api-client/core';
import { IAppProjectStore } from './AbstractAppProject.js';
import { IAppRequestStore } from './AbstractAppRequest.js';

export interface IGetOptions {
  /**
   * Whether to return a deleted document.
   */
  deleted?: boolean;
}

export interface IEntityMeta {
  deleted?: boolean;
  user: string;
  appId: string;
}

export interface IStoredEntity<T = unknown> {
  meta: IEntityMeta;
  data: T;
}

export interface IAppStore {
  projects: IAppProjectStore;
  requests: IAppRequestStore;

  /**
   * Queries the app store.
   * 
   * @param appId The application id.
   * @param user The current user
   * @param options The list options with required `query` property.
   */
  query(appId: string, user: IUser, options: IListOptions): Promise<IQueryResponse<IAppProject | IAppRequest>>;
}
