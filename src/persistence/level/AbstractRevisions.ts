import { IUser, IListResponse, IListOptions,IRevisionInfo } from '@api-client/core';
import { JsonPatch } from 'json8-patch';

export type AltType = 'media' | 'meta';

export interface IRevisionsStore {
  add(kind: string, key: string, patch: JsonPatch, user: IUser, alt?: AltType): Promise<void>;
  list(key: string, user: IUser, alt?: AltType, options?: IListOptions): Promise<IListResponse<IRevisionInfo>>;
}
