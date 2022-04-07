import { Logger, IListOptions, ICursorOptions, PermissionRole } from '@api-client/core';
import { Cursor } from './Cursor.js';
import { 
  IListState,
} from './State.js';
import { IBinStore } from './level/AbstractBin.js';
import { IFilesStore } from './level/AbstractFiles.js';
import { ISharedStore } from './level/AbstractShared.js';
import { IHistoryStore } from './level/AbstractHistory.js';
import { IPermissionStore } from './level/AbstractPermission.js';
import { IRevisionsStore } from './level/AbstractRevisions.js';
import { ISessionStore } from './level/AbstractSessions.js';
import { IUserStore } from './level/AbstractUser.js';
import { IProjectsStore } from './level/AbstractProject.js';

/**
 * An abstract class that creates an interface to implement any storage layer
 * for API Client's data.
 */
export abstract class StorePersistence {
  /**
   * The default limit of items returned by the list operation.
   * @default 35
   */
  defaultLimit = 35;
  abstract get history(): IHistoryStore;
  abstract get user(): IUserStore;
  abstract get bin(): IBinStore;
  abstract get revisions(): IRevisionsStore;
  abstract get project(): IProjectsStore;
  abstract get session(): ISessionStore;
  abstract get permission(): IPermissionStore;
  abstract get shared(): ISharedStore;
  abstract get file(): IFilesStore;

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
  canWrite(access: PermissionRole): boolean {
    const roles: PermissionRole[] = ['owner', 'writer'];
    return roles.includes(access);
  }

  /**
   * Checks whether the given access level allows the user to write changes to a resource.
   * @param access The user access level.
   * @returns True when write is allowed.
   */
  canRead(access: PermissionRole): boolean {
    const roles: PermissionRole[] = ['owner', 'writer', 'reader', 'commenter'];
    return roles.includes(access);
  }
}
