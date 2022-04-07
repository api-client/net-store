import { IUser, IListResponse, IListOptions } from '@api-client/core';

export interface IUserListOptions {
  /**
   * Removes the `provider` property before returning the user.
   */
  removeProviderData?: boolean;
}

export interface IUserStore {
  add(userKey: string, user: IUser): Promise<void>;
  read(userKey: string, opts?: IUserListOptions): Promise<IUser | undefined>;
  read(userKeys: string[], opts?: IUserListOptions): Promise<IListResponse<IUser | undefined>>;
  list(options?: IListOptions): Promise<IListResponse>;
  filter(user: IUser, lowerQuery: string): boolean;
  listMissing(keys: string[]): Promise<string[]>;
}
