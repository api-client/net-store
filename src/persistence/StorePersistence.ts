import { 
  IUser, IWorkspace, IUserWorkspace, AccessControlLevel, IHttpProject, IListResponse, 
  UserAccessOperation, Logger, IListOptions, IHttpHistory, HistoryListOptions,
  IUserSpaces, ICursorOptions,
} from '@api-client/core';
import { JsonPatch } from 'json8-patch';
import { Config } from '../lib/Config.js';

export interface IListState {
  /**
   * Number of items in the result.
   */
  limit?: number;
  /**
   * The key of the last item returned by the query.
   * Used with pagination.
   */
  lastKey?: string;
  /**
   * The start key to use.
   */
  start?: string;
  /**
   * The last key to use.
   */
  end?: string;
  /**
   * Supported by some endpoints. When set it performs a query on the data store.
   */
  query?: string;
  /**
   * Only with the `query` property. Tells the system in which fields to search for the query term.
   */
  queryField?: string[];
}

export type HistoryState = HistoryListOptions & {
  lastKey?: string;
}

export interface IHistoryStore {
  add(history: IHttpHistory, user: IUser): Promise<string>;
  list(user: IUser, options?: HistoryState | ICursorOptions): Promise<IListResponse>;
  delete(key: string, user: IUser): Promise<void>;
}

export interface IUserStore {
  add(userKey: string, user: IUser): Promise<void>;
  read(userKey: string): Promise<IUser | undefined>;
  read(userKeys: string[]): Promise<IListResponse>;
  list(options?: IListOptions): Promise<IListResponse>;
  filter(user: IUser, lowerQuery: string): boolean;
  listMissing(keys: string[]): Promise<string[]>;
}

export interface IBinStore {
  add(key: string, user: IUser): Promise<void>;
  isDeleted(key: string): Promise<boolean>;
  isSpaceDeleted(space: string): Promise<boolean>;
  isUserDeleted(user: string): Promise<boolean>;
  isProjectDeleted(space: string, project: string): Promise<boolean>;
}
export interface IRevisionsStore {
  addProject(spaceKey: string, projectKey: string, patch: JsonPatch): Promise<void>;
  listProject(spaceKey: string, projectKey: string, user: IUser, options?: IListOptions): Promise<IListResponse>;
}
export interface IProjectsStore {
  list(key: string, user: IUser, options?: IListOptions): Promise<IListResponse>;
  add(spaceKey: string, projectKey: string, project: IHttpProject, user: IUser): Promise<void>;
  read(spaceKey: string, projectKey: string, user: IUser): Promise<IHttpProject>;
  update(spaceKey: string, projectKey: string, project: IHttpProject, patch: JsonPatch, user: IUser): Promise<void>;
  delete(spaceKey: string, projectKey: string, user: IUser): Promise<void>;
  checkAccess(minimumLevel: AccessControlLevel, space: string, project: string, user: IUser): Promise<AccessControlLevel>;
}
export interface ISpaceStore {
  defaultSpace(owner?: string): IWorkspace;
  readUserSpaces(userKey: string): Promise<IUserSpaces | undefined>;
  readUsersSpaces(users: string[], fillEmpty: false): Promise<(IUserSpaces | undefined)[]>;
  readUsersSpaces(users: string[], fillEmpty: true): Promise<IUserSpaces[]>;
  readSpaceAccess(spaceKey: string, userKey: string): Promise<AccessControlLevel | undefined>;
  list(user: IUser, options?: IListOptions): Promise<IListResponse>;
  add(key: string, space: IWorkspace, user: IUser, access?: AccessControlLevel): Promise<void>;
  read(key: string, user: IUser): Promise<IUserWorkspace|undefined>;
  update(key: string, space: IWorkspace, patch: JsonPatch, user: IUser): Promise<void>;
  delete(key: string, user: IUser): Promise<void>;
  patchUsers(key: string, patch: UserAccessOperation[], user: IUser): Promise<void>;
  listUsers(key: string, user: IUser): Promise<IListResponse>;
  checkAccess(minimumLevel: AccessControlLevel, key: string, user: IUser): Promise<AccessControlLevel>;
}
export interface ISessionStore {
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  read(key: string): Promise<unknown | undefined>;
}

/**
 * An abstract class that creates an interface to implement any storage layer
 * for ARC data.
 */
export abstract class StorePersistence {
  /**
   * The default limit of items returned by the list operation.
   */
  defaultLimit = 35;
  abstract get history(): IHistoryStore;
  abstract get user(): IUserStore;
  abstract get bin(): IBinStore;
  abstract get revisions(): IRevisionsStore;
  abstract get project(): IProjectsStore;
  abstract get space(): ISpaceStore;
  abstract get session(): ISessionStore;
  /**
   * Initializes the data store. I.E., opens the connection, creates a filesystem, etc.
   */
  abstract initialize(): Promise<void>;
  /**
   * Cleans up before closing the server.
   */
  abstract cleanup(): Promise<void>;

  config = new Config();

  constructor(public logger: Logger) { }

  /**
   * Encodes the passed document to be stored in the store.
   * @param doc The value to store.
   * @returns Serialized to string value.
   */
  encodeDocument(doc: string | Buffer | unknown): string {
    let value;
    if (typeof doc === 'string') {
      value = doc;
    } else if (Buffer.isBuffer(doc)) {
      value = doc.toString('utf8');
    } else {
      value = JSON.stringify(doc);
    }
    return value;
  }

  decodeDocument(value: string | Buffer): unknown {
    let typed: string;
    if (Buffer.isBuffer(value)) {
      typed = value.toString('utf8');
    } else {
      typed = value;
    }
    let parsed: any | undefined;
    try {
      parsed = JSON.parse(typed);
    } catch (e) {
      throw new Error(`Invalid datastore entry.`);
    }
    return parsed;
  }

  readListState(options: IListOptions = {}): IListState {
    let state: IListState = {};
    if (options.cursor) {
      state = this.decodeCursor(options.cursor);
    } else {
      if (typeof options.limit === 'number') {
        state.limit = options.limit;
      } else {
        state.limit = this.defaultLimit;
      }
      if (options.query) {
        state.query = options.query;
      }
      if (Array.isArray(options.queryField) && options.queryField.length) {
        state.queryField = options.queryField;
      }
      // if (options.start) {
      //   state.start = options.start;
      // }
      // if (options.end) {
      //   state.end = options.end;
      // }
    }
    return state;
  }

  /**
   * Checks whether the given access level allows the user to write changes to a resource.
   * @param access The user access level.
   * @returns True when write is allowed.
   */
  canWrite(access: AccessControlLevel): boolean {
    return ['write', 'admin', 'owner'].includes(access);
  }

  /**
   * Checks whether the given access level allows the user to write changes to a resource.
   * @param access The user access level.
   * @returns True when write is allowed.
   */
  canRead(access: AccessControlLevel): boolean {
    if (this.canWrite(access)) {
      return true;
    }
    return ['read', 'comment'].includes(access);
  }

  /**
   * Encoded the current state of the list search into the cursor string.
   * 
   * @param state The state of the search.
   * @param lastKey The last read key from the store.
   * @returns Encoded cursor.
   */
  encodeCursor(state: IListState = {}, lastKey?: string): string {
    const copy: IListState = { ...state };
    if (!copy.limit) {
      copy.limit = this.defaultLimit;
    }
    if (lastKey) {
      copy.lastKey = lastKey;
    }
    const str = JSON.stringify(copy);
    const buff = Buffer.from(str);
    return buff.toString('base64url');
  }
  
  /**
   * Decodes the given cursor to the list state object.
   * @param cursor The cursor to decode.
   */
  decodeCursor(cursor: string): IListState {
    let buff;
    try {
      buff = Buffer.from(cursor, 'base64url');
    } catch (e) {
      throw new Error(`Invalid cursor.`);
    }
    const str = buff.toString();
    let data: IListState;
    try {
      data = JSON.parse(str);
    } catch (e) {
      throw new Error(`Invalid cursor. Unable to decode.`);
    }
    const result: IListState = {};
    if (data.lastKey) {
      result.lastKey = data.lastKey;
    }
    if (typeof data.limit === 'number') {
      result.limit = data.limit;
    }
    if (data.start) {
      result.start = data.start;
    }
    if (data.end) {
      result.end = data.end;
    }
    if (data.query) {
      result.query = data.query;
    }
    if (Array.isArray(data.queryField) && data.queryField.length) {
      result.queryField = data.queryField;
    }
    return result;
  }
}
