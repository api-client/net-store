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
}

export interface IStoredEntity<T = unknown> {
  meta: IEntityMeta;
  data: T;
}

export interface IAppStore {
  projects: IAppProjectStore;
  requests: IAppRequestStore;
}
