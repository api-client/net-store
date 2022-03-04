import { 
  IUser, IWorkspace, IUserWorkspace, Workspace, AccessControlLevel, IHttpProject, IListResponse, 
  UserAccessOperation, Logger,
} from '@advanced-rest-client/core';
import { JsonPatch } from 'json8-patch';

export interface IListOptions {
  /**
   * Page cursor to use with the query.
   */
  cursor?: string;
  /**
   * Number of items in the result.
   * Ignored when `cursor` is set.
   * 
   * Note, when changing the number of items in the result
   * you need to start listing over again.
   */
  limit?: number;
  /**
   * Supported by some endpoints. When set it performs a query on the data store.
   */
  query?: string;
  /**
   * Only with the `query` property. Tells the system in which fields to search for the query term.
   */
  queryField?: string[];
  // /**
  //  * The start key to use.
  //  */
  // start?: string;
  // /**
  //  * The last key to use.
  //  */
  // end?: string;
}

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

/**
 * An abstract class that creates an interface to implement any storage layer
 * for ARC data.
 */
export abstract class StorePersistence {
  /**
   * The default limit of items returned by the list operation.
   */
  defaultLimit = 35;
  /**
   * Initializes the data store. I.E., opens the connection, creates a filesystem, etc.
   */
  abstract initialize(): Promise<void>;
  /**
   * Cleans up before closing the server.
   */
  abstract cleanup(): Promise<void>;

  constructor(protected logger: Logger) { }

  /**
   * Creates a default space for the user. This is called when the user has no spaces created.
   * 
   * @param owner The owning user. When not set the `default` is set for the single-user environment.
   * @returns The workspace to create for the user.
   */
  defaultSpace(owner?: string): IWorkspace {
    const workspace = Workspace.fromName('Drafts', owner);
    return workspace.toJSON();
  }

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

  /**
   * Lists spaces of a user. When user is not set it lists all spaces as this means a single-user environment.
   * 
   * @param options Listing options.
   * @param user The current user
   */
  abstract listUserSpaces(options?: IListOptions, user?: IUser): Promise<IListResponse>;
  /**
   * Creates a space in the store for a user.
   * When user is not set it lists all spaces as this means a single-user environment.
   * 
   * @param key Workspace key. Note, the store may persists the value in a different key. The read operation will use the same key.
   * @param space The space to store.
   * @param user The current user
   */
  abstract createUserSpace(key: string, space: IWorkspace, user?: IUser, access?: AccessControlLevel): Promise<void>;
  /**
   * Reads a space for the given user.
   * 
   * @param key The key of the space to read.
   * @param user Optional user object. When set it tests whether the user has access to the space.
   */
  abstract readUserSpace(key: string, user?: IUser): Promise<IUserWorkspace | undefined>;
  /**
   * Updates the user space in the store.
   * 
   * @param key Workspace key. Note, the store may persists the value in a different key. The read operation will use the same key.
   * @param space The space to store.
   * @param patch The patch object sent to the server. It is used to notify clients about the change.
   * @param user The current user
   */
  abstract updateUserSpace(key: string, space: IWorkspace, patch: JsonPatch, user?: IUser): Promise<void>;
  /**
   * Deletes the space from the system
   * @param key The space key
   * @param user The current user, if any.
   */
  abstract deleteUserSpace(key: string, user?: IUser): Promise<void>;
  /**
   * Adds or removes users to/from the space.
   * Only available in a multi-user environment.
   * 
   * @param key The key of the space to update
   * @param patch The list of patch operations to perform on user access to the space.
   * @param user The user that triggered the change.
   */
  abstract patchSpaceUsers(key: string, patch: UserAccessOperation[], user: IUser): Promise<void>;
  /**
   * Lists projects that are embedded in a space.
   * 
   * @param key The key of the space that has projects.
   * @param options Listing options
   * @param user Optional user for authorization.
   */
  abstract listSpaceProjects(key: string, options?: IListOptions, user?: IUser): Promise<IListResponse>;
  /**
   * Creates a project in a user space.
   * 
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param project The project to insert.
   * @param user Optional, user that triggers the insert.
   */
  abstract createSpaceProject(spaceKey: string, projectKey: string, project: IHttpProject, user?: IUser): Promise<void>;
  /**
   * Reads project data from the space.
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param user Optional, user for which to check the permission.
   */
  abstract readSpaceProject(spaceKey: string, projectKey: string, user?: IUser): Promise<IHttpProject | undefined>;
  /**
   * Updates a project data in the store.
   * 
   * Note, this is not intended to be used by clients directly. Clients must use the `PATCH` mechanism
   * to update projects. This is for the server to finally commit the patch to the store.
   * 
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param project The project to update.
   * @param patch The patch object sent to the server. It is used to notify clients about the change.
   * @param user Optional, user that triggers the update.
   */
  abstract updateSpaceProject(spaceKey: string, projectKey: string, project: IHttpProject, patch: JsonPatch, user?: IUser): Promise<void>;
  /**
   * Deletes a project from a space.
   * @param spaceKey The user space key.
   * @param projectKey The project key
   */
  abstract deleteSpaceProject(spaceKey: string, projectKey: string, user?: IUser): Promise<void>;
  /**
   * Adds a project revision information to the store.
   * Note, this does not check whether the user has access to the space.
   * 
   * @param projectKey The project key
   * @param patch The reversible patch applied to the project.
   */
  abstract addProjectRevision(spaceKey: string, projectKey: string, patch: JsonPatch): Promise<void>;
  /**
   * Lists revisions for a project.
   * 
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param options Listing options
   * @param user Optional user for authorization.
   */
  abstract listProjectRevisions(spaceKey: string, projectKey: string, options?: IListOptions, user?: IUser): Promise<IListResponse>;
  /**
   * Adds a new user to the system.
   * This is only called after a successful authentication.
   * 
   * @param userKey The user key.
   * @param user The user to store.
   */
  abstract addSystemUser(userKey: string, user: IUser): Promise<void>;
  /**
   * Reads the user data from the store.
   * 
   * @param userKey The user key.
   */
  abstract readSystemUser(userKey: string): Promise<IUser | undefined>;
  /**
   * Reads multiple system users with one query. Typically used when the UI asks for
   * user data to render "user pills" in the access control list.
   * 
   * @param userKeys The list of user keys.
   * @returns Ordered list of users defined by the `userKeys` order.
   * Note, when the user is not found an `undefined` is set at the position.
   */
  abstract readSystemUsers(userKeys: string[]): Promise<IListResponse>;
  /**
   * Lists the registered users.
   * The final list won't contain the current user.
   * The user can query for a specific data utilizing the `query` filed.
   */
  abstract listSystemUsers(options?: IListOptions, user?: IUser): Promise<IListResponse>;
  /**
   * Permanently stores session data in the data store.
   * 
   * @param key The session identifier
   * @param value The value to store.
   */
  abstract setSessionData(key: string, value: unknown): Promise<void>;
  /**
   * Permanently destroys session data in the data store.
   * 
   * @param key The session identifier
   */
  abstract deleteSessionData(key: string): Promise<void>;
  /**
   * Reads the session data from the store.
   * 
   * @param key The session identifier
   */
  abstract readSessionData(key: string): Promise<unknown | undefined>;
}
