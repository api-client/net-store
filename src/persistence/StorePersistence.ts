import { 
  IUser, IWorkspace, IUserWorkspace, AccessControlLevel, IHttpProject, IListResponse, 
  UserAccessOperation, Logger, IListOptions, IHttpHistory, HistoryListOptions,
  IUserSpaces, ICursorOptions,
} from '@api-client/core';
import { JsonPatch } from 'json8-patch';
import { Cursor } from './Cursor.js';

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
  read(encodedKey: string, user: IUser): Promise<IHttpHistory>;
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
 * for API Client's data.
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

  cursor = new Cursor();

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

  async readListState(source: IListOptions | ICursorOptions = {}): Promise<IListState> {
    if (source.cursor) {
      return this.cursor.decodeCursor(source.cursor);
    }
    return { ...source } as IListState;
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
}
