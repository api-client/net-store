import { IAppRequest, IListOptions, IListResponse, IBatchUpdateResult, IBatchReadResult, IBatchDeleteResult, IRevertResponse, IDeleteRecord, IUser, IRevertResult, ApiError, IPatchInfo, IPatchRevision, RouteBuilder, IBackendEvent, AppRequestKind } from '@api-client/core';
import { PutBatch, AbstractIteratorOptions } from 'abstract-leveldown';
import { KeyGenerator } from '../KeyGenerator.js';
import { validatePatch } from '../../lib/Patch.js';
import { SubStore } from '../SubStore.js';
import { IGetOptions, IStoredEntity } from './AbstractApp.js';
import { IAppRequestStore } from './AbstractAppRequest.js';
import { Patch } from '@api-client/json';
import Clients, { IClientFilterOptions } from '../../routes/WsClients.js';

/**
 * The AppRequests stores application requests. 
 * These are not shared with others and kept only for a specific type of application and user.
 */
export class AppRequests extends SubStore implements IAppRequestStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  async create(value: IAppRequest, appId: string, user: IUser): Promise<IAppRequest> {
    if (!value) {
      throw new ApiError(`Expected a value when inserting a request.`, 400);
    }
    if (!value.key) {
      throw new ApiError(`Unable to process the value when inserting to requests: the key is missing.`, 400);
    }
    if (!value.created) {
      value.created = Date.now();
    }
    if (!value.updated) {
      value.updated = value.created;
    }
    const key = KeyGenerator.appRequest(appId, value.key, user.key);
    const entity: IStoredEntity = {
      meta: {},
      data: value,
    };
    await this.db.put(key, this.parent.encodeDocument(entity));

    // notifies on the collection but only the current app / current user pair .
    const filter: IClientFilterOptions = {
      url: RouteBuilder.appRequests(appId),
      users: [user.key],
    };
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: value,
      kind: value.kind,
      id: value.key,
    };
    Clients.notify(event, filter);
    return value;
  }

  async list(appId: string, user: IUser, options?: IListOptions): Promise<IListResponse<IAppRequest>> {
    const state = await this.parent.readListState(options);
    const itOpts: AbstractIteratorOptions = {
      reverse: true,
      gte: KeyGenerator.appUserRequests(user.key, appId),
      lte: `${KeyGenerator.appUserRequests(user.key, appId)}~`,
    };
    const iterator = this.db.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    const { limit = this.parent.defaultLimit } = state;
    const result: IListResponse<IAppRequest> = {
      items: [],
    };
    let remaining = limit;
    let lastKey = undefined;

    // @ts-ignore
    for await (const [key, value] of iterator) {
      const media = this.parent.decodeDocument(value) as IStoredEntity<IAppRequest>;
      if (media.meta.deleted) {
        continue;
      }
      result.items.push(media.data);
      lastKey = key;
      remaining -= 1;
      if (remaining === 0) {
        break;
      }
    }
    if (result.items.length) {
      result.cursor = await this.parent.cursor.encodeCursor(state, lastKey);
    }
    return result;
  }

  async createBatch(values: IAppRequest[], appId: string, user: IUser): Promise<IBatchUpdateResult<IAppRequest>> {
    if (!Array.isArray(values)) {
      throw new ApiError(`Unexpected argument. An array must be passed to "createBatch()" method.`, 400);
    }
    if (!values.length) {
      return { items: [] };
    }
    const invalid = values.some(i => !i.key);
    if (invalid) {
      throw new ApiError(`Unable to process bulk values when inserting to requests: a key is missing.`, 400);
    }
    const result: IBatchUpdateResult<IAppRequest> = {
      items: [],
    };
    
    const data: PutBatch[] = [];
    values.forEach((value) => {
      if (!value.created) {
        value.created = Date.now();
      }
      if (!value.updated) {
        value.updated = value.created;
      }
      const media: IStoredEntity<IAppRequest> = {
        meta: {},
        data: value,
      };
      data.push({
        type: 'put',
        key: KeyGenerator.appRequest(appId, value.key, user.key),
        value: this.parent.encodeDocument(media),
      });
      result.items.push(value);
    });
    await this.db.batch(data);

    // notifies on the collection but only the current app / current user pair .
    const filter: IClientFilterOptions = {
      url: RouteBuilder.appRequests(appId),
      users: [user.key],
    };
    result.items.forEach((value) => {
      const event: IBackendEvent = {
        type: 'event',
        operation: 'created',
        data: value,
        kind: value.kind,
        id: value.key,
      };
      Clients.notify(event, filter);
    });

    return result;
  }

  async readBatch(keys: string[], appId: string, user: IUser, opts: IGetOptions = {}): Promise<IBatchReadResult<IAppRequest>> {
    if (!keys) {
      throw new ApiError(`The "keys" argument is missing.`, 400);
    }
    if (!Array.isArray(keys)) {
      throw new ApiError(`The "keys" argument expected to be an array.`, 400);
    }
    const dbKeys = keys.map(i => KeyGenerator.appRequest(appId, i, user.key));
    const raw = await this.db.getMany(dbKeys);
    const result: IBatchReadResult<IAppRequest> = {
      items: [],
    };
    for (const item of raw) {
      if (!item) {
        result.items.push(undefined);
        continue;
      }
      const media = this.parent.decodeDocument(item) as IStoredEntity<IAppRequest>;
      if (media.meta.deleted && !opts.deleted) {
        result.items.push(undefined);
        continue;
      }
      result.items.push(media.data);
    }
    return result;
  }

  async deleteBatch(keys: string[], appId: string, user: IUser): Promise<IBatchDeleteResult> {
    if (!keys) {
      throw new ApiError(`The "keys" argument is missing.`, 400);
    }
    if (!Array.isArray(keys)) {
      throw new ApiError(`The "keys" argument expected to be an array.`, 400);
    }

    const dbKeys = keys.map(i => KeyGenerator.appRequest(appId, i, user.key));
    const raw = await this.db.getMany(dbKeys);
    const result: IBatchDeleteResult = {
      items: [],
    };
    const data: PutBatch[] = [];
    for (const item of raw) {
      if (!item) {
        result.items.push(undefined);
        continue;
      }
      const media = this.parent.decodeDocument(item) as IStoredEntity<IAppRequest>;
      media.meta.deleted = true;
      const record: IDeleteRecord = { key: media.data.key };
      result.items.push(record);
      data.push({
        type: 'put',
        key: KeyGenerator.appRequest(appId, media.data.key, user.key),
        value: this.parent.encodeDocument(media),
      });
    }
    await this.db.batch(data);

    // inform clients the media is deleted (collection + the media)
    const filter: IClientFilterOptions = {
      users: [user.key],
    };
    
    const collectionUrl = RouteBuilder.appRequests(appId);
    result.items.forEach((item) => {
      if (!item) {
        return;
      }
      const { key } = item;
      const event: IBackendEvent = {
        type: 'event',
        operation: 'deleted',
        kind: AppRequestKind,
        id: key,
      };

      // notify on the collection
      Clients.notify(event, { ...filter, url: collectionUrl });
      const mediaUrl = RouteBuilder.appRequestItem(appId, key);
      // notify on the item
      Clients.notify(event, { ...filter, url: mediaUrl });
      // Disconnect clients connected to the contents.
      Clients.closeByUrl(mediaUrl);
    });

    return result;
  }

  async undeleteBatch(keys: string[], appId: string, user: IUser): Promise<IRevertResponse<IAppRequest>> {
    if (!keys) {
      throw new ApiError(`The "keys" argument is missing.`, 400);
    }
    if (!Array.isArray(keys)) {
      throw new ApiError(`The "keys" argument expected to be an array.`, 400);
    }

    const dbKeys = keys.map(i => KeyGenerator.appRequest(appId, i, user.key));
    const raw = await this.db.getMany(dbKeys);
    const result: IRevertResponse<IAppRequest> = {
      items: [],
    };
    const data: PutBatch[] = [];
    for (const item of raw) {
      if (!item) {
        result.items.push(undefined);
        continue;
      }
      const media = this.parent.decodeDocument(item) as IStoredEntity<IAppRequest>;
      if (!media.meta.deleted) {
        result.items.push(undefined);
        continue;
      }
      media.meta.deleted = false;
      data.push({
        type: 'put',
        key: KeyGenerator.appRequest(appId, media.data.key, user.key),
        value: this.parent.encodeDocument(media),
      });
      const record: IRevertResult<IAppRequest> = { key: media.data.key, item: media.data, kind: media.data.kind };
      result.items.push(record);
    }
    await this.db.batch(data);

    // inform clients the media is created (collection)
    const filter: IClientFilterOptions = {
      users: [user.key],
      url: RouteBuilder.appProjects(appId),
    };
    result.items.forEach((item) => {
      if (!item) {
        return;
      }
      const event: IBackendEvent = {
        type: 'event',
        operation: 'created',
        data: item.item,
        kind: item.kind as string,
        id: item.key,
      };
      Clients.notify(event, filter);
    });

    return result;
  }

  async read(key: string, appId: string, user: IUser, opts: IGetOptions = {}): Promise<IAppRequest> {
    if (!key) {
      throw new ApiError(`The "key" argument is missing.`, 400);
    }
    const dbKey = KeyGenerator.appRequest(appId, key, user.key);
    let entity: IStoredEntity<IAppRequest>;
    try {
      const raw = await this.db.get(dbKey);
      entity = this.parent.decodeDocument(raw) as IStoredEntity<IAppRequest>;
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    if (entity.meta.deleted && !opts.deleted) {
      throw new ApiError(`Not found.`, 404);
    }
    return entity.data;
  }

  async delete(key: string, appId: string, user: IUser): Promise<IDeleteRecord> {
    if (!key) {
      throw new ApiError(`The "key" argument is missing.`, 400);
    }
    const dbKey = KeyGenerator.appRequest(appId, key, user.key);
    let entity: IStoredEntity<IAppRequest>;
    try {
      const raw = await this.db.get(dbKey);
      entity = this.parent.decodeDocument(raw) as IStoredEntity<IAppRequest>;
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    if (entity.meta.deleted) {
      throw new ApiError(`Not found.`, 404);
    }
    entity.meta.deleted = true;
    await this.db.put(dbKey, this.parent.encodeDocument(entity));

    // inform clients the media is deleted (collection + the media)
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: entity.data.kind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      users: [user.key],
    };
    // notify on the collection
    Clients.notify(event, { ...filter, url: RouteBuilder.appRequests(appId) });
    // notify on the item
    Clients.notify(event, { ...filter, url: RouteBuilder.appRequestItem(appId, key) });
    // Disconnect clients connected to the contents.
    Clients.closeByUrl(RouteBuilder.appRequestItem(appId, key));

    const result: IDeleteRecord = {
      key,
    };
    return result;
  }

  async patch(key: string, appId: string, value: IPatchInfo, user: IUser): Promise<IPatchRevision> {
    validatePatch(value);
    const ignored: string[] = ['/key', '/kind'];
    const filtered = value.patch.filter(p => {
      return !ignored.some(path => p.path.startsWith(path));
    });
    if (!filtered.length) {
      return { ...value, revert: [] };
    }
    const file = await this.read(key, appId, user);
    const ar = Patch.apply(file, filtered, { reversible: true });
    const result: IPatchRevision = {
      ...value,
      revert: ar.revert,
      app: appId,
    };
    await this.update(key, appId, ar.doc as IAppRequest, result, user);
    return result;
  }

  /**
   * Updates the value without changing the document meta.
   * 
   * @param key The request key.
   * @param appId The owner application id
   * @param value The value to patch
   * @param patch The patch revision info (to inform the WS clients)
   * @param user The current user.
   */
  private async update(key: string, appId: string, value: IAppRequest, patch: IPatchRevision, user: IUser): Promise<void> {
    const dbKey = KeyGenerator.appRequest(appId, key, user.key);
    const raw = await this.db.get(dbKey);
    const entity = this.parent.decodeDocument(raw) as IStoredEntity<IAppRequest>;
    entity.data = value;
    await this.db.put(dbKey, this.parent.encodeDocument(entity));

    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: patch,
      kind: value.kind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      users: [user.key],
      url: RouteBuilder.appRequestItem(appId, key),
    };
    Clients.notify(event, filter);
  }
}
