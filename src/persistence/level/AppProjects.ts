/* eslint-disable import/no-named-as-default-member */
import { IAppProject, IListOptions, IListResponse, IBatchUpdateResult, IBatchReadResult, IBatchDeleteResult, IRevertResponse, IDeleteRecord, ApiError, IRevertResult, IUser, IPatchRevision, IPatchInfo, RouteBuilder, IBackendEvent, AppProjectKind, IQueryResponse } from '@api-client/core';
import { Patch } from '@api-client/json';
import { PutBatch, AbstractIteratorOptions } from 'abstract-leveldown';
import FlexSearch from 'flexsearch';
import { validatePatch } from '../../lib/Patch.js';
import { KeyGenerator } from '../KeyGenerator.js';
import { SubStore } from '../SubStore.js';
import { IGetOptions, IStoredEntity } from './AbstractApp.js';
import { IAppProjectStore } from './AbstractAppProject.js';
import Clients, { IClientFilterOptions } from '../../routes/WsClients.js';

interface IndexedDocument {
  doc: IAppProject;
  meta: {
    /**
     * The key of the document (not the data store key)
     */
    id: string;
    /**
     * this **always** contains the app id and user key.
     */
    tag: string[];
  }
}

/**
 * The AppProjects stores application projects. 
 * These are not shared with others and kept only for a specific type of application and user.
 */
export class AppProjects extends SubStore implements IAppProjectStore {
  index?: FlexSearch.Document<IndexedDocument, false>;
  indexStarted = false;

  async warmup(): Promise<void> {
    this.resetIndex();
  }

  resetIndex(): void {
    const indexes: string[] = [
      'doc:info:name',
      'doc:info:displayName',
      'doc:info:description',

      'doc:definitions[]:folders[]:info:name',
      'doc:definitions[]:folders[]:info:displayName',
      'doc:definitions[]:folders[]:info:description',

      'doc:definitions[]:requests[]:info:name',
      'doc:definitions[]:requests[]:info:displayName',
      'doc:definitions[]:requests[]:info:description',
      'doc:definitions[]:requests[]:expects:url',
      'doc:definitions[]:requests[]:expects:headers',

      'doc:definitions[]:environments[]:info:name',
      'doc:definitions[]:environments[]:info:displayName',
      'doc:definitions[]:environments[]:info:description',

      'doc:definitions[]:environments[]:server:uri',
      'doc:definitions[]:environments[]:variables[]:name',
    ];
    this.index = new FlexSearch.Document<IndexedDocument, false>({
      document: {
        id: 'meta:id',
        tag: 'meta:tag',
        index: indexes,
        store: false,
      },
      charset: 'latin:extra',
      tokenize: 'reverse',
      resolution: 9,
    });
    this.indexStarted = false;
  }

  async cleanup(): Promise<void> {
    await this.db.close();
  }

  async create(value: IAppProject, appId: string, user: IUser): Promise<IAppProject> {
    if (!value) {
      throw new ApiError(`Expected a value when inserting a project.`, 400);
    }
    if (!value.key) {
      throw new ApiError(`Unable to process the value when inserting to projects: the key is missing.`, 400);
    }
    if (!value.created) {
      value.created = Date.now();
    }
    if (!value.updated) {
      value.updated = value.created;
    }
    const key = KeyGenerator.appProject(appId, value.key, user.key);
    const entity: IStoredEntity = {
      meta: {
        appId,
        user: user.key,
      },
      data: value,
    };
    await this.db.put(key, this.parent.encodeDocument(entity));

    // notifies on the collection but only the current app / current user pair .
    const filter: IClientFilterOptions = {
      url: RouteBuilder.appProjects(appId),
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
    if (this.indexStarted && this.index) {
      this.index.add({ doc: value, meta: { id: value.key, tag: [appId, user.key] } });
    }
    return value;
  }

  async list(appId: string, user: IUser, options: IListOptions = {}): Promise<IListResponse<IAppProject>> {
    const state = await this.parent.readListState(options);
    
    const itOpts: AbstractIteratorOptions = {
      reverse: true,
      gte: KeyGenerator.appUserProjects(user.key, appId),
      lte: `${KeyGenerator.appUserProjects(user.key, appId)}~`,
    };
    const iterator = this.db.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    const { limit = this.parent.defaultLimit } = state;
    const result: IListResponse<IAppProject> = {
      items: [],
    };
    let remaining = limit;
    let lastKey = undefined;

    // @ts-ignore
    for await (const [key, value] of iterator) {
      const media = this.parent.decodeDocument(value) as IStoredEntity<IAppProject>;
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

  async createBatch(values: IAppProject[], appId: string, user: IUser): Promise<IBatchUpdateResult<IAppProject>> {
    if (!Array.isArray(values)) {
      throw new ApiError(`Unexpected argument. An array must be passed to "createBatch()" method.`, 400)
    }
    if (!values.length) {
      return { items: [] };
    }
    const invalid = values.some(i => !i.key);
    if (invalid) {
      throw new ApiError(`Unable to process bulk values when inserting to projects: a key is missing.`, 400);
    }
    const result: IBatchUpdateResult<IAppProject> = {
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
      const media: IStoredEntity<IAppProject> = {
        meta: {
          appId,
          user: user.key,
        },
        data: value,
      };
      data.push({
        type: 'put',
        key: KeyGenerator.appProject(appId, value.key, user.key),
        value: this.parent.encodeDocument(media),
      });
      result.items.push(value);
    });
    await this.db.batch(data);

    // notifies on the collection but only the current app / current user pair .
    const filter: IClientFilterOptions = {
      url: RouteBuilder.appProjects(appId),
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

      if (this.indexStarted && this.index) {
        this.index.add({ doc: value, meta: { id: value.key, tag: [appId, user.key] } });
      }
    });

    return result;
  }

  async readBatch(keys: string[], appId: string, user: IUser, opts: IGetOptions = {}): Promise<IBatchReadResult<IAppProject>> {
    if (!keys) {
      throw new ApiError(`The "keys" argument is missing.`, 400);
    }
    if (!Array.isArray(keys)) {
      throw new ApiError(`The "keys" argument expected to be an array.`, 400);
    }
    const dbKeys = keys.map(i => KeyGenerator.appProject(appId, i, user.key));
    const raw = await this.db.getMany(dbKeys);
    const result: IBatchReadResult<IAppProject> = {
      items: [],
    };
    for (const item of raw) {
      if (!item) {
        result.items.push(undefined);
        continue;
      }
      const media = this.parent.decodeDocument(item) as IStoredEntity<IAppProject>;
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

    const dbKeys = keys.map(i => KeyGenerator.appProject(appId, i, user.key));
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
      const media = this.parent.decodeDocument(item) as IStoredEntity<IAppProject>;
      media.meta.deleted = true;
      const record: IDeleteRecord = { key: media.data.key };
      result.items.push(record);
      data.push({
        type: 'put',
        key: KeyGenerator.appProject(appId, media.data.key, user.key),
        value: this.parent.encodeDocument(media),
      });
    }
    await this.db.batch(data);

    // inform clients the media is deleted (collection + the media)
    const filter: IClientFilterOptions = {
      users: [user.key],
    };
    
    const collectionUrl = RouteBuilder.appProjects(appId);
    result.items.forEach((item) => {
      if (!item) {
        return;
      }
      const { key } = item;
      const event: IBackendEvent = {
        type: 'event',
        operation: 'deleted',
        kind: AppProjectKind,
        id: key,
      };

      // notify on the collection
      Clients.notify(event, { ...filter, url: collectionUrl });
      const mediaUrl = RouteBuilder.appProjectItem(appId, key);
      // notify on the item
      Clients.notify(event, { ...filter, url: mediaUrl });
      // Disconnect clients connected to the contents.
      Clients.closeByUrl(mediaUrl);

      if (this.indexStarted && this.index) {
        this.index.remove(key);
      }
    });

    return result;
  }

  async undeleteBatch(keys: string[], appId: string, user: IUser): Promise<IRevertResponse<IAppProject>> {
    if (!keys) {
      throw new ApiError(`The "keys" argument is missing.`, 400);
    }
    if (!Array.isArray(keys)) {
      throw new ApiError(`The "keys" argument expected to be an array.`, 400);
    }

    const dbKeys = keys.map(i => KeyGenerator.appProject(appId, i, user.key));
    const raw = await this.db.getMany(dbKeys);
    const result: IRevertResponse<IAppProject> = {
      items: [],
    };
    const data: PutBatch[] = [];
    for (const item of raw) {
      if (!item) {
        result.items.push(undefined);
        continue;
      }
      const media = this.parent.decodeDocument(item) as IStoredEntity<IAppProject>;
      if (!media.meta.deleted) {
        result.items.push(undefined);
        continue;
      }
      media.meta.deleted = false;
      data.push({
        type: 'put',
        key: KeyGenerator.appProject(appId, media.data.key, user.key),
        value: this.parent.encodeDocument(media),
      });
      const record: IRevertResult<IAppProject> = { key: media.data.key, item: media.data, kind: media.data.kind };
      result.items.push(record);
    }
    await this.db.batch(data);

    // inform clients the media is created (collection)
    const filter: IClientFilterOptions = {
      users: [user.key],
      url: RouteBuilder.appProjects(appId),
    };
    result.items.forEach((item) => {
      if (!item || !item.item) {
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

      if (this.indexStarted && this.index) {
        this.index.add({ doc: item.item, meta: { id: item.key, tag: [appId, user.key] }  });
      }
    });

    return result;
  }

  async read(key: string, appId: string, user: IUser, opts: IGetOptions = {}): Promise<IAppProject> {
    if (!key) {
      throw new ApiError(`The "key" argument is missing.`, 400);
    }
    const dbKey = KeyGenerator.appProject(appId, key, user.key);
    let entity: IStoredEntity<IAppProject>;
    try {
      const raw = await this.db.get(dbKey);
      entity = this.parent.decodeDocument(raw) as IStoredEntity<IAppProject>;
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
    const dbKey = KeyGenerator.appProject(appId, key, user.key);
    let entity: IStoredEntity<IAppProject>;
    try {
      const raw = await this.db.get(dbKey);
      entity = this.parent.decodeDocument(raw) as IStoredEntity<IAppProject>;
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
    Clients.notify(event, { ...filter, url: RouteBuilder.appProjects(appId) });
    // notify on the item
    Clients.notify(event, { ...filter, url: RouteBuilder.appProjectItem(appId, key) });
    // Disconnect clients connected to the contents.
    Clients.closeByUrl(RouteBuilder.appProjectItem(appId, key));
    if (this.indexStarted && this.index) {
      this.index.remove(key);
    }
    
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
    };
    await this.update(key, appId, ar.doc as IAppProject, result, user);
    return result;
  }

  /**
   * Updates the value without changing the document meta.
   * 
   * @param key The project key.
   * @param appId The owner application id
   * @param value The value to patch
   * @param patch The patch revision info (to inform the WS clients)
   * @param user The current user.
   */
  private async update(key: string, appId: string, value: IAppProject, patch: IPatchRevision, user: IUser): Promise<void> {
    const dbKey = KeyGenerator.appProject(appId, key, user.key);
    const raw = await this.db.get(dbKey);
    const entity = this.parent.decodeDocument(raw) as IStoredEntity<IAppProject>;
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
      url: RouteBuilder.appProjectItem(appId, key),
    };
    Clients.notify(event, filter);

    if (this.indexStarted && this.index) {
      this.index.update({ doc: value, meta: { id: key, tag: [appId, user.key] } });
    }
  }

  async query(appId: string, user: IUser, options: IListOptions): Promise<IQueryResponse<IAppProject>> {
    const { query, limit = this.parent.defaultLimit } = options;
    const { index } = this;
    if (!query || !index) {
      return { items: [] };
    }

    if (!this.indexStarted) {
      await this.indexAll();
      this.indexStarted = true;
    }
    
    const searchResult = index.search(query, {
      tag: [appId, user.key],
      limit,
    });

    const ids: string[] = [];
    searchResult.forEach((indexGroup) => {
      const { result } = indexGroup;
      result.forEach((key) => {
        const dbKey = KeyGenerator.appProject(appId, key as string, user.key);
        if (!ids.includes(dbKey)) {
          ids.push(dbKey);
        }
      });
    });
    if (!ids.length) {
      return { items: [] };
    }

    const rawDocs = await this.db.getMany(ids);
    const docs: Record<string, IAppProject> = {};
    rawDocs.forEach((doc) => {
      if (!doc) {
        return;
      }
      const media = this.parent.decodeDocument(doc) as IStoredEntity<IAppProject>;
      docs[media.data.key] = media.data;
    });
    const result: IQueryResponse<IAppProject> = {
      items: [],
    };

    searchResult.forEach((indexGroup) => {
      const { result: indexes, field } = indexGroup;
      indexes.forEach((rawId) => {
        const id = rawId as string;
        const existing = result.items.find(i => i.doc.key === id);
        if (existing) {
          existing.index.push(field);
        } else {
          const doc = docs[id];
          if (doc) {
            result.items.push({
              doc,
              index: [field],
            });
          }
        }
      });
    });
    return result;
  }

  private async indexAll(): Promise<void> {
    const { index } = this;
    if (!index) {
      return;
    }
    const iterator = this.db.iterator({ keys: false });
    // @ts-ignore
    for await (const [, value] of iterator) {
      const media = this.parent.decodeDocument(value) as IStoredEntity<IAppProject>;
      if (media.meta.deleted) {
        continue;
      }
      index.add({ doc: media.data, meta: { id: media.data.key, tag: [media.meta.appId, media.meta.user] } });
    }
  }
}
