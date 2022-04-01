/* eslint-disable import/no-named-as-default-member */
/* eslint-disable import/no-named-as-default */
import sub from 'subleveldown';
import { AbstractIteratorOptions, PutBatch, DelBatch } from 'abstract-leveldown';
import { 
  IUser, IBackendEvent, IListResponse, HttpHistory, IHttpHistory, ICursorOptions,
  IHttpHistoryBulkAdd, HttpHistoryKind, RouteBuilder,
} from '@api-client/core';
import FlexSearch from 'flexsearch';
import { IHistoryStore, HistoryState } from './LevelStores.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { KeyGenerator } from './KeyGenerator.js';
import { SubStore } from './SubStore.js';
import { StoreLevelUp, DataStoreType } from './StoreLevelUp.js';
import { ApiError } from '../ApiError.js';

interface IndexKeysResult {
  keys: string[];
  lastKey?: string;
}

/**
 * The part of the store that takes care of the HTTP history data.
 */
export class LevelHistoryStore extends SubStore implements IHistoryStore {
  data: DataStoreType;
  space: DataStoreType;
  project: DataStoreType;
  request: DataStoreType;
  app: DataStoreType;
  
  constructor(protected parent: StoreLevelUp, db: DataStoreType) {
    super(parent, db);
    this.data = sub(db, "history-data") as DataStoreType;
    this.space = sub(db, "history-space") as DataStoreType;
    this.project = sub(db, "history-project") as DataStoreType;
    this.request = sub(db, "history-request") as DataStoreType;
    this.app = sub(db, "history-app") as DataStoreType;
  }

  async cleanup(): Promise<void> {
    await this.data.close();
    await this.space.close();
    await this.project.close();
    await this.request.close();
    await this.db.close();
  }

  /**
   * Adds a history object to the store.
   * 
   * @param history The history object
   * @param user The current user.
   */
  async add(history: IHttpHistory, user: IUser): Promise<string> {
    await this.validateHistoryObject(history, user);

    const object = new HttpHistory(history);
    const { space, project, request, app } = object;
    
    object.user = user.key;
    const date = new Date(object.created);
    const time = date.toJSON();
    const dataKey = KeyGenerator.historyDataKey(time, user.key);
    const promises: Promise<void>[] = [];
    const encodedKey = Buffer.from(dataKey).toString('base64url');
    object.key = encodedKey;

    promises.push(this.data.put(dataKey, this.parent.encodeDocument(object)));
    if (space) {
      const spaceKey = KeyGenerator.historySpaceKey(time, space, user.key);
      promises.push(this.space.put(spaceKey, dataKey));
    }
    if (project) {
      const projectKey = KeyGenerator.historyProjectKey(time, project, user.key);
      promises.push(this.project.put(projectKey, dataKey));
    }
    if (request) {
      const requestKey = KeyGenerator.historyRequestKey(time, request, user.key);
      promises.push(this.request.put(requestKey, dataKey));
    }
    if (app) {
      const appKey = KeyGenerator.historyAppKey(time, app, user.key);
      promises.push(this.app.put(appKey, dataKey));
    }
    await Promise.all(promises);

    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: object.toJSON(),
      kind: object.kind,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.history(),
    };
    Clients.notify(event, filter);
    return encodedKey;
  }

  /**
   * Validates the history object before inserting it into the store.
   * It also tests access to the space/project when defined.
   */
  private async validateHistoryObject(object: IHttpHistory | IHttpHistoryBulkAdd, user: IUser): Promise<void> {
    const { space, project, request, app } = object;
    // validators
    if (project && !space) {
      throw new ApiError(`The "space" parameter is required when adding a project history.`, 400);
    }
    if (request && !space) {
      throw new ApiError(`The "space" parameter is required when adding a request history.`, 400);
    }
    if (request && !project) {
      throw new ApiError(`The "project" parameter is required when adding a request history.`, 400);
    }
    if (project) {
      await this.parent.project.checkAccess('writer', space as string, project, user);
    } else if (space) {
      await this.parent.space.checkAccess('writer', space, user);
    } else if (!app) {
      throw new ApiError(`Either the "app" or "type" parameter is required.`, 400);
    }
  }

  /**
   * Adds history in a bulk operation.
   * @param info The bulk add operation schema.
   * @param user The current user.
   */
  async bulkAdd(info: IHttpHistoryBulkAdd, user: IUser): Promise<string[]> {
    await this.validateHistoryObject(info, user);
    const { space, project, request, app, log } = info;
    if (!Array.isArray(log) || !log.length) {
      throw new ApiError(`History log not provided.`, 400);
    }
    
    const history: PutBatch[] = [];
    const spaces: PutBatch[] = [];
    const projects: PutBatch[] = [];
    const requests: PutBatch[] = [];
    const apps: PutBatch[] = [];
    const result: string[] = [];
    const promises: Promise<void>[] = [];
    const eventData: IHttpHistory[] = [];

    log.forEach((hLog) => {
      const created = hLog.request?.endTime || Date.now();
      const object = new HttpHistory({
        created,
        kind: HttpHistoryKind,
        log: hLog,
        user: user.key,
      }).toJSON();
      eventData.push(object);
      const date = new Date(created);
      const time = date.toJSON();
      const dataKey = KeyGenerator.historyDataKey(time, user.key);
      const encodedKey = Buffer.from(dataKey).toString('base64url');
      object.key = encodedKey;
      result.push(encodedKey);
      if (space) {
        object.space = space;
        const spaceKey = KeyGenerator.historySpaceKey(time, space, user.key);
        spaces.push({
          key: spaceKey,
          type: 'put',
          value: dataKey,
        });
      }
      if (project) {
        object.project = project;
        const projectKey = KeyGenerator.historyProjectKey(time, project, user.key);
        projects.push({
          key: projectKey,
          type: 'put',
          value: dataKey,
        });
      }
      if (request) {
        object.request = request;
        const requestKey = KeyGenerator.historyRequestKey(time, request, user.key);
        requests.push({
          key: requestKey,
          type: 'put',
          value: dataKey,
        });
      }
      if (app) {
        object.app = app;
        const appKey = KeyGenerator.historyAppKey(time, app, user.key);
        apps.push({
          key: appKey,
          type: 'put',
          value: dataKey,
        });
      }
      
      history.push({
        key: dataKey,
        type: 'put',
        value: this.parent.encodeDocument(object),
      });
    });

    promises.push(this.data.batch(history));
    if (spaces.length) {
      promises.push(this.space.batch(spaces));
    }
    if (projects.length) {
      promises.push(this.project.batch(projects));
    }
    if (requests.length) {
      promises.push(this.request.batch(requests));
    }
    if (apps.length) {
      promises.push(this.app.batch(apps));
    }
    await Promise.all(promises);

    const filter: IClientFilterOptions = {
      url: RouteBuilder.history(),
    };
    eventData.forEach((item) => {
      const event: IBackendEvent = {
        type: 'event',
        operation: 'created',
        data: item,
        kind: item.kind,
      };
      Clients.notify(event, filter);
    });
    
    return result;
  }

  /**
   * Lists the history data.
   * @param user The current user.
   * @param options List options
   */
  async list(user: IUser, options: HistoryState | ICursorOptions): Promise<IListResponse> {
    const state = await this.readHistoryListState(options);
    if (state.query) {
      return this.queryHistory(user, state);
    }
    const hasQuery = !!state.type && state.type !== 'user';
    if (hasQuery) {
      return this.listHistoryType(user, state);
    }
    return this.listAllUserHistory(user, state);
  }

  /**
   * Marks the data as deleted. It also removes the data from the indexes.
   * Only the owner can delete the history object. This may change in the future.
   * 
   * TODO: restoring deleted objects is not yet implemented in the store. When 
   * a history object is being restored, the corresponding keys have to be restored too.
   * 
   * @param encodedKey The history object key to delete. This is an URL-encoded key.
   */
  async delete(encodedKey: string, user: IUser): Promise<void> {
    const key = Buffer.from(encodedKey, 'base64url').toString();
    // first read the data and mark it as deleted
    let data: IHttpHistory | undefined;
    try {
      const raw = await this.data.get(key);
      data = this.parent.decodeDocument(raw) as IHttpHistory;
    } catch (e) {
      // 
    }
    if (!data) {
      throw new ApiError(`Not found.`, 404);
    }
    const { space, user: userKey, project, request, app } = data;
    if (!userKey) {
      throw new ApiError('Invalid state. The history record is missing the user key.', 500)
    }
    if (userKey !== user.key) {
      throw new ApiError('You are not authorized to delete this object.', 403)
    }
    (data as any)._deleted = true;
    await this.data.put(key, this.parent.encodeDocument(data));
    // now, lets take care of the indexes
    const date = new Date(data.created);
    const time = date.toJSON();
    const ps: Promise<void>[] = [];
    if (space) {
      const spaceKey = KeyGenerator.historySpaceKey(time, space, userKey);
      ps.push(this.space.del(spaceKey));
    }
    if (project) {
      const projectKey = KeyGenerator.historyProjectKey(time, project, userKey);
      ps.push(this.project.del(projectKey));
    }
    if (request) {
      const requestKey = KeyGenerator.historyRequestKey(time, request, userKey);
      ps.push(this.request.del(requestKey));
    }
    if (app) {
      const appKey = KeyGenerator.historyAppKey(time, app, userKey);
      ps.push(this.app.del(appKey));
    }
    await Promise.allSettled(ps);

    // inform clients the object is deleted
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: HttpHistoryKind,
      id: encodedKey,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.historyItem(encodedKey),
    };
    Clients.notify(event, filter);
  }

  /**
   * Deletes a history in a bulk operation.
   * @param encodedKeys The list of history keys to delete. This is base64url encoded keys
   * @param user The current user.
   */
  async bulkDelete(encodedKeys: string[], user: IUser): Promise<void> {
    const decodedKeys = encodedKeys.map(encodedKey => Buffer.from(encodedKey, 'base64url').toString());
    let items: (IHttpHistory | undefined)[] = [];
    try {
      const list = await this.data.getMany(decodedKeys);
      items = list.map((item) => {
        if (!item) {
          return undefined;
        }
        return this.parent.decodeDocument(item) as IHttpHistory;
      })
    } catch (e) {
      throw new ApiError(`Unable to read history data from the store`, 500);
    }
    
    const history: PutBatch[] = [];
    const spaces: DelBatch[] = [];
    const projects: DelBatch[] = [];
    const requests: DelBatch[] = [];
    const apps: DelBatch[] = [];
    const promises: Promise<void>[] = [];
    const events: IBackendEvent[] = [];

    for (let i = 0, len = items.length; i < len; i++) {
      const item = items[i];
      if (!item) {
        continue;
      }
      const encodedKey = encodedKeys[i];
      const decodedKey = decodedKeys[i];
      const { space, user: userKey, project, request, app } = item;
      if (!userKey) {
        throw new ApiError('Invalid state. The history record is missing the user key.', 500)
      }
      if (userKey !== user.key) {
        throw new ApiError('You are not authorized to delete this object.', 403)
      }
      (item as any)._deleted = true;
      history.push({
        key: decodedKey,
        type: 'put',
        value: this.parent.encodeDocument(item),
      });
      // now, lets take care of the indexes
      const date = new Date(item.created);
      const time = date.toJSON();
      if (space) {
        spaces.push({
          key: KeyGenerator.historySpaceKey(time, space, userKey),
          type: 'del',
        });
      }
      if (project) {
        projects.push({
          key: KeyGenerator.historyProjectKey(time, project, userKey),
          type: 'del',
        });
      }
      if (request) {
        requests.push({
          key: KeyGenerator.historyRequestKey(time, request, userKey),
          type: 'del',
        });
      }
      if (app) {
        apps.push({
          key: KeyGenerator.historyAppKey(time, app, userKey),
          type: 'del',
        });
      }
      events.push({
        type: 'event',
        operation: 'deleted',
        kind: HttpHistoryKind,
        id: encodedKey,
      });
    }
    
    promises.push(this.data.batch(history));
    if (spaces.length) {
      promises.push(this.space.batch(spaces));
    }
    if (projects.length) {
      promises.push(this.project.batch(projects));
    }
    if (requests.length) {
      promises.push(this.request.batch(requests));
    }
    if (apps.length) {
      promises.push(this.app.batch(apps));
    }
    await Promise.all(promises);

    events.forEach((item) => {
      const filter: IClientFilterOptions = {
        url: RouteBuilder.historyItem(item.id!),
      };
      Clients.notify(item, filter);
    });
  }

  async read(encodedKey: string, user: IUser): Promise<IHttpHistory> {
    const key = Buffer.from(encodedKey, 'base64url').toString();
    let data: IHttpHistory | undefined;
    try {
      const raw = await this.data.get(key);
      data = this.parent.decodeDocument(raw) as IHttpHistory;
    } catch (e) {
      // 
    }
    if (!data || (data as any)._deleted) {
      throw new ApiError(`Not found.`, 404);
    }
    const { space, user: userKey } = data;
    if (space) {
      // when space is set then the access depends on the space access
      await this.parent.space.checkAccess('reader', space, user);
      // Note, we intentionally are not checking for the project access as the project may be deleted at this
      // point and the project access checks whether the project is deleted.
    } else if (userKey) {
      // otherwise only the user can read the resource
      if (user.key !== userKey) {
        throw new ApiError(`You are not authorized to read this resource.`, 401);
      }
    } else {
      throw new ApiError(`The history object is incomplete. Missing access information.`, 500);
    }
    return data;
  }

  /**
   * Lists all history. This is only available to query for the user data.
   */
  protected async listAllUserHistory(user: IUser, state: HistoryState): Promise<IListResponse> {
    const { data } = this;
    const itOpts: AbstractIteratorOptions = {
      reverse: true,
      gte: `~${user.key}~`,
      lte: `~${user.key}~~`,
    };
    const iterator = data.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    const { limit = this.parent.defaultLimit } = state;
    const result: IListResponse = {
      data: [],
    };
    let remaining = limit;
    let lastKey = undefined;
    // @ts-ignore
    for await (const [key, value] of iterator) {
      const doc = this.parent.decodeDocument(value);
      if ((doc as any)._deleted) {
        continue;
      }
      result.data.push(doc);
      lastKey = key;
      remaining -= 1;
      if (remaining === 0) {
        break;
      }
    }
    result.cursor = await this.parent.cursor.encodeHistoryCursor(state, lastKey);
    return result;
  }

  /**
   * Lists a history for a specific history type.
   * A client may ask to list history for:
   * 
   * - a user
   * - a space (list history within a space)
   * - a project (list history within a project)
   * - a request (list history for a specific request object)
   */
  protected async listHistoryType(user: IUser, state: HistoryState): Promise<IListResponse> {
    const { type } = state;
    if (!type) {
      throw new Error(`The "type" is required.`);
    }
    let info: IndexKeysResult | undefined;
    if (type === 'space') {
      this.validateStateId(state);
      await this.parent.space.checkAccess('reader', state.id, user);
      const it = this.getIteratorOptions(state.id, user, state.user);
      info = await this.listStoreDataKeys(this.space, it, state);
    } else if (type === 'project') {
      this.validateStateId(state);
      this.validateStateSpace(state);
      await this.parent.project.checkAccess('reader', state.space, state.id, user);
      // it the read won't throw an error then the project exists in the space.
      await this.parent.project.read(state.space, state.id, user);
      const it = this.getIteratorOptions(state.id, user, state.user);
      info = await this.listStoreDataKeys(this.project, it, state);
    } else if (type === 'request') {
      this.validateStateId(state);
      this.validateStateSpace(state);
      await this.parent.space.checkAccess('reader', state.space, user);
      const it = this.getIteratorOptions(state.id, user, state.user);
      info = await this.listStoreDataKeys(this.request, it, state);
    } else if (type === 'app') {
      this.validateStateId(state);
      const it = this.getIteratorOptions(state.id, user, true);
      info = await this.listStoreDataKeys(this.app, it, state);
    }
    if (!info) {
      throw new Error(`Unknown query type: ${type}`);
    }
    const result: IListResponse = {
      data: [],
    };
    if (!info.keys.length) {
      return result;
    }
    result.cursor = await this.parent.cursor.encodeHistoryCursor(state, info.lastKey);
    const read = await this.data.getMany(info.keys);
    try {
      result.data = read.map((item) => this.parent.decodeDocument(item));
    } catch (e) {
      this.parent.logger.debug('Query data dump', info);
      this.parent.logger.error(e);
      throw e;
    }
    return result;
  }

  protected getIteratorOptions(id: string, user: IUser, withUser = false): AbstractIteratorOptions {
    if (!id) {
      throw new Error(`This history query must include the "id" parameter.`);
    }
    const gte = withUser ? `~${id}~${user.key}~` : `~${id}~`;
    const lte = withUser ? `~${id}~${user.key}~~` : `~${id}~~`;
    const itOpts: AbstractIteratorOptions = {
      reverse: true,
      gte,
      lte,
    };
    return itOpts;
  }

  protected async listStoreDataKeys(store: DataStoreType, itOpts: AbstractIteratorOptions, opts: HistoryState): Promise<IndexKeysResult> {
    const { limit=this.parent.defaultLimit } = opts;
    const iterator = store.iterator(itOpts);
    if (opts.lastKey) {
      iterator.seek(opts.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    
    const keys: string[] = [];
    let remaining = limit;
    let lastKey = undefined;
    // @ts-ignore
    for await (const [key, value] of iterator) {
      keys.push(value.toString());
      lastKey = key;
      remaining -= 1;
      if (remaining === 0) {
        break;
      }
    }
    return {
      keys,
      lastKey,
    };
  }

  protected async readHistoryListState(source: HistoryState | ICursorOptions): Promise<HistoryState> {
    if (source.cursor) {
      return this.parent.cursor.decodeHistoryCursor(source.cursor);
    }
    return { ...source } as HistoryState;
  }

  /**
   * Performs a search on the history data.
   * 
   * @param user The current user
   * @param options The options with the `query` set.
   */
  protected async queryHistory(user: IUser, options: HistoryState): Promise<IListResponse> {
    if (!options.query) {
      throw new Error(`The "query" value is required.`);
    }
    const state = await this.readHistoryListState(options);
    let { type } = state;
    let userOnly = false;
    let typeId: string | undefined;
    let spaceId: string | undefined;
    if (state.type === 'app') {
      this.validateStateId(state);
      typeId = state.id;
      userOnly = true;
    } else if (state.type === 'request' || state.type === 'project') {
      this.validateStateId(state);
      this.validateStateSpace(state);
      typeId = state.id;
      spaceId = state.space;
      if (!userOnly && state.user) {
        userOnly = true;
      }
    } else if (state.type === 'space') {
      this.validateStateId(state);
      spaceId = state.id;
      typeId = state.id;
      if (!userOnly && state.user) {
        userOnly = true;
      }
    } else if (type === 'user') {
      userOnly = true;
    } else {
      userOnly = true;
    }

    if (spaceId) {
      await this.parent.space.checkAccess('reader', spaceId, user);
    }

    const itOpts: AbstractIteratorOptions = {
      reverse: true,
    };
    if (userOnly) {
      itOpts.gte = `~${user.key}~`;
      itOpts.lte = `~${user.key}~~`;
    }
    const iterator = this.data.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    const { limit = this.parent.defaultLimit } = state;
    const hasTypeQuery = !!type && type !== 'user' && !!typeId;
    const result: IListResponse = {
      data: [],
    };
    let remaining = limit;
    let lastKey = undefined;
    // @ts-ignore
    for await (const [key, value] of iterator) {
      const doc = this.parent.decodeDocument(value) as IHttpHistory;
      if ((doc as any)._deleted) {
        continue;
      }
      if (hasTypeQuery) {
        // do this comparison first as it is much faster.
        if (!this.filterType(doc, type, typeId!)) {
          continue;
        }
      }
      if (!this.filter(key, doc, options.query)) {
        continue;
      }
      result.data.push(doc);
      lastKey = key;
      remaining -= 1;
      if (remaining === 0) {
        break;
      }
    }
    result.cursor = await this.parent.cursor.encodeHistoryCursor(state, lastKey);
    return result;
  }

  /**
   * Searches for an term in the document.
   * @param key The key of the history entry
   * @param doc The history entry
   * @param q The term.
   * @returns true when the term was found in the history object.
   */
  filter(key: string, doc: IHttpHistory, q: string): boolean {
    const indexes: string[] = [
      'doc:log:request:url',
      'doc:log:request:headers',
      'doc:log:request:httpMessage',
      'doc:log:response:headers',
    ];
    if (doc.log.request) {
      const { payload } = doc.log.request;
      if (payload) {
        if (typeof payload === 'string') {
          indexes.push('doc:log:request:payload');
        } else if (typeof payload.data === 'string') {
          indexes.push('doc:log:request:payload:data');
        }
      }
    }
    if (doc.log.response) {
      const { payload } = doc.log.response;
      if (payload) {
        if (typeof payload === 'string') {
          indexes.push('doc:log:response:payload');
        } else if (typeof payload.data === 'string') {
          indexes.push('doc:log:response:payload:data');
        }
      }
    }
    const index = new FlexSearch.Document({
      document: {
        id: 'id',
        index: indexes,
      },
      charset: 'latin:extra',
      tokenize: 'reverse',
      resolution: 9,
    });
    index.add({
      id: key,
      doc,
    });
    const result = index.search(q);
    return result.some((item) => !!item.result.length);
  }

  /**
   * Filters the history object by the given type.
   * 
   * @param doc The document to test
   * @param type The type to check against
   * @param value The type value
   */
  filterType(doc: IHttpHistory, type: string, value: string): boolean {
    if (type === 'space') {
      return doc.space === value;
    }
    if (type === 'project') {
      return doc.project === value;
    }
    if (type === 'request') {
      return doc.request === value;
    }
    if (type === 'app') {
      return doc.app === value;
    }
    return false;
  }

  private validateStateId(state: any): void {
    if (!state.id) {
      throw new ApiError(`The "id" parameter is required for this query.`, 400);
    }
  }

  private validateStateSpace(state: any): void {
    if (!state.space) {
      throw new ApiError(`The "space" parameter is required for this query.`, 400);
    }
  }
}
