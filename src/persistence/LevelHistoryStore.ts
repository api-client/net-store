/* eslint-disable import/no-named-as-default-member */
/* eslint-disable import/no-named-as-default */
import sub from 'subleveldown';
import { AbstractIteratorOptions } from 'abstract-leveldown';
import { 
  IUser, IBackendEvent, IListResponse, HttpHistory, IHttpHistory, ICursorOptions,
} from '@api-client/core';
import FlexSearch from 'flexsearch';
import { IHistoryStore, HistoryState } from './StorePersistence.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { RouteBuilder } from '../routes/RouteBuilder.js';
import { KeyGenerator } from './KeyGenerator.js';
import { SubStore } from './SubStore.js';
import { ArcLevelUp, DataStoreType } from './ArcLevelUp.js';
import { ApiError } from '../ApiError.js';
import { Encryption } from '../lib/Encryption.js';

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
  
  constructor(protected parent: ArcLevelUp, db: DataStoreType) {
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
    const object = new HttpHistory(history);
    object.user = user.key;
    const date = new Date(object.created);
    const time = date.toJSON();
    const { space, project, request, app } = object;
    const dataKey = KeyGenerator.historyDataKey(time, user.key);
    const promises: Promise<void>[] = [];
    const buff = Buffer.from(dataKey);
    const encodedKey = buff.toString('base64url');
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
      url: RouteBuilder.buildHistoryRoute(),
    };
    Clients.notify(event, filter);
    return encodedKey;
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
    const { space, user: userKey, project, request } = data;
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
    await Promise.allSettled(ps);
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
      await this.parent.checkSpaceAccess('read', space, user);
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
    result.cursor = await this.encodeHistoryCursor(state, lastKey);
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
      await this.parent.checkSpaceAccess('read', state.id, user);
      const it = this.getIteratorOptions(state.id, user, state.user);
      info = await this.listStoreDataKeys(this.space, it, state);
    } else if (type === 'project') {
      this.validateStateId(state);
      this.validateStateSpace(state);
      await this.parent.checkProjectAccess('read', state.space, state.id, user);
      // it the read won't throw an error then the project exists in the space.
      await this.parent.project.read(state.space, state.id, user);
      const it = this.getIteratorOptions(state.id, user, state.user);
      info = await this.listStoreDataKeys(this.project, it, state);
    } else if (type === 'request') {
      this.validateStateId(state);
      this.validateStateSpace(state);
      await this.parent.checkSpaceAccess('read', state.space, user);
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
    result.cursor = await this.encodeHistoryCursor(state, info.lastKey);
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

  /**
   * Reads the cursor received from the client by decrypting its contents.
   * It throws an error when the cursor is invalid
   */
  protected async decodeHistoryCursor(cursor: string): Promise<HistoryState> {
    const config = await this.parent.config.read();
    const encryption = new Encryption();
    let result: HistoryState;
    try {
      const data = encryption.decrypt(cursor, config.secret);
      result = JSON.parse(data);
    } catch (e) {
      throw new ApiError(`Invalid page cursor.`, 400);
    }
    return result;
  }

  protected async encodeHistoryCursor(state: HistoryState, lastKey?: string): Promise<string> {
    const copy: HistoryState = { ...state };
    if (!copy.limit) {
      copy.limit = this.parent.defaultLimit;
    }
    if (lastKey) {
      copy.lastKey = lastKey;
    }
    const str = JSON.stringify(copy);
    const config = await this.parent.config.read();
    const encryption = new Encryption();
    return encryption.encrypt(str, config.secret);
  }

  protected async readHistoryListState(source: HistoryState | ICursorOptions): Promise<HistoryState> {
    if (source.cursor) {
      return this.decodeHistoryCursor(source.cursor);
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
      await this.parent.checkSpaceAccess('read', spaceId, user);
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
    result.cursor = await this.encodeHistoryCursor(state, lastKey);
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
