import {
  IUser, IListResponse, HistoryListOptions, IHttpHistory, ICursorOptions, IHttpHistoryBulkAdd,
} from '@api-client/core';

export type HistoryState = HistoryListOptions & {
  lastKey?: string;
  query?: string;
}

export interface IHistoryStore {
  add(history: IHttpHistory, user: IUser): Promise<string>;
  bulkAdd(info: IHttpHistoryBulkAdd, user: IUser): Promise<string[]>;
  list(user: IUser, options?: HistoryState | ICursorOptions): Promise<IListResponse>;
  delete(key: string, user: IUser): Promise<void>;
  bulkDelete(keys: string[], user: IUser): Promise<void>;
  read(encodedKey: string, user: IUser): Promise<IHttpHistory>;
}
