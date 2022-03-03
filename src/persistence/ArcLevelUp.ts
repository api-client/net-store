/* eslint-disable import/no-named-as-default */
import fs from 'fs/promises';
import levelUp, { LevelUp } from 'levelup';
import leveldown, { LevelDownIterator, LevelDown, Bytes } from 'leveldown';
import sub from 'subleveldown';
import { AbstractLevelDOWN, AbstractIteratorOptions, PutBatch } from 'abstract-leveldown';
import { JsonPatch, diff } from 'json8-patch';
import { 
  IUser, IWorkspace, IUserWorkspace, IHttpProjectListItem, IHttpProject, IUserSpaces, 
  AccessControlLevel, IAccessControl, IBackendEvent, HttpProjectKind, IRevisionInfo,
  RevisionInfoKind, WorkspaceKind, HttpProjectListItemKind, IListResponse, UserAccessOperation,
  IUserAccessAddOperation, IUserAccessRemoveOperation,
} from '@advanced-rest-client/core';
import { IListOptions, StorePersistence } from './StorePersistence.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { RouteBuilder } from '../routes/RouteBuilder.js';
import { ApiError } from '../ApiError.js';

export interface IBinListItem {
  /**
   * The kind of removed item.
   */
  kind: string;
  /**
   * THe timestamp when the item was deleted.
   */
  deleted: number;
  /**
   * The original key of the deleted item.
   */
  key: string;
  /**
   * The user deleting the object.
   */
  deleteBy?: string;
}

export interface IBinDataItem {
  /**
   * The data to restore.
   */
  data: unknown;
}

/**
 * The persistence layer that uses LevelUp to store data in the local file system.
 */
export class ArcLevelUp extends StorePersistence {
  dbPath: string;
  db?: LevelUp<LevelDown, LevelDownIterator>;
  /**
   * The data store for user spaces.
   */
  spaces?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * Each key is the User id. The value is the access list to the workspaces the user has access to.
   */
  userSpaces?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * Logical partition for projects data.
   */
  projects?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * The store that only keeps projects fisting for the UI.
   * Each entry corresponds to an entry in the `projectsData` store.
   */
  projectsIndex?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * The store that keeps the HTTP projects data.
   */
  projectsData?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * THe store that holds the projects revision data (changes history).
   */
  projectRevisions?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * A store for the deleted objects. It is used to list the objects only. 
   * The data are stored under the same key in the `trashBinData` store.
   */
  trashBin?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * The bin data.
   */
  trashBinData?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * The users data store.
   */
  users?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * The sessions data store.
   */
  sessions?: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  
  /**
   * @param path The path where to store the data bases.
   */
  constructor(path: string) {
    super();
    this.dbPath = path;
  }

  async initialize(): Promise<void> {
    const { dbPath } = this;
    await fs.mkdir(dbPath, { recursive: true });
    // @ts-ignore
    const db = levelUp(leveldown(dbPath)) as LevelUp<LevelDown, LevelDownIterator>;
    this.db = db;
    this.spaces = sub<Bytes, Bytes>(db, 'spaces') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.userSpaces = sub<Bytes, Bytes>(db, 'spaces') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.projects = sub<Bytes, Bytes>(db, 'projects') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.projectsIndex = sub<string, any>(this.projects, 'index') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.projectsData = sub<string, any>(this.projects, 'data') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.projectRevisions = sub<string, any>(this.projects, 'revisions') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.trashBin = sub<string, any>(db, 'bin') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.users = sub<string, any>(db, 'users') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.sessions = sub<string, any>(db, 'sessions') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  }

  /**
   * Cleans up before closing the server.
   */
  async cleanup(): Promise<void> {
    await this.db?.close();
    await this.spaces?.close();
    await this.userSpaces?.close();
    await this.projects?.close();
    await this.projectsIndex?.close();
    await this.projectsData?.close();
    await this.projectRevisions?.close();
    await this.trashBin?.close();
    await this.users?.close();
    await this.sessions?.close();
  }

  /**
   * Reads the `IUserSpaces` from the document that keeps track of which spaces the user has access to.
   * 
   * @param userKey Not required in the single-user environment. The user id to get the info from.
   * @returns 
   */
  protected async readUserSpaces(userKey = 'default'): Promise<IUserSpaces | undefined> {
    const { userSpaces } = this;
    if (!userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    let raw: Bytes | undefined;
    try {
      raw = await userSpaces.get(userKey);
    } catch (e) {
      return;
    }
    return this.decodeDocument(raw) as IUserSpaces;
  }

  /**
   * Reads user spaces information for multiple users.
   * 
   * @param users The list of user keys.
   * @returns The ordered list of user spaces. When the user does not exist it returns `undefined` at that index.
   */
  protected async readUsersSpaces(users: string[], fillEmpty: false): Promise<(IUserSpaces | undefined)[]>;
  /**
   * Reads user spaces information for multiple users.
   * 
   * @param users The list of user keys.
   * @returns The ordered list of user spaces. When the user does not exist it creates a new record at that index.
   */
  protected async readUsersSpaces(users: string[], fillEmpty: true): Promise<IUserSpaces[]>;

  /**
   * Reads user spaces information for multiple users.
   * @param users The list of user keys.
   * @param fillEmpty When set it creates an empty object when does not exist.
   */
  protected async readUsersSpaces(users: string[], fillEmpty = false): Promise<(IUserSpaces | undefined)[]> {
    const { userSpaces } = this;
    if (!userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    const raw = await userSpaces.getMany(users);
    const result: (IUserSpaces | undefined)[] = raw.map((item, index) => {
      if (!item) {
        if (fillEmpty) {
          return {
            user: users[index],
            spaces: [],
          };
        }
        return;
      }
      return this.decodeDocument(item) as IUserSpaces;
    });
    return result;
  }

  /**
   * Reads from the data store the access the user has to a space.
   * 
   * @param spaceKey The space key to check the access to.
   * @param userKey When not set it always returns `owner`.
   * @returns The access level for the space or undefined when the user has no access to it.
   */
  protected async readUserSpaceAccess(spaceKey: string, userKey = 'default'): Promise<AccessControlLevel | undefined> {
    if (userKey === 'default') {
      // single-user environment
      return 'owner';
    }
    const { userSpaces } = this;
    if (!userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    let info = await this.readUserSpaces(userKey);
    if (!info) {
      return undefined;
    }
    const access = (info.spaces || []).find(i => i.key === spaceKey);
    if (!access) {
      return undefined;
    }
    return access.level;
  }

  /**
   * Lists spaces of a user. When user is not set it lists all spaces as this means a single-user environment.
   * 
   * @param options Listing options.
   * @param user The current user
   */
  async listUserSpaces(options?: IListOptions, user?: IUser): Promise<IListResponse> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    let allowedSpaces: IAccessControl[] | undefined;
    const userKey = user && user.key;
    let info = await this.readUserSpaces(userKey);
    if (!info) {
      // the user has no spaces. We gonna create a default one for the user.
      const space = this.defaultSpace(userKey);
      await this.createUserSpace(space.key, space, user, 'owner');
      info = await this.readUserSpaces(userKey);
      if (!info) {
        throw new Error(`Unable to create a default space.`);
      }
      allowedSpaces = info.spaces;
    } else {
      allowedSpaces = info.spaces;
    }

    const state = this.readListState(options);
    let lastKey: string | undefined;
    const data: IUserWorkspace[] = [];
    let remaining = state.limit as number;
    const iterator = spaces.iterator();
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        let allowedSpace;
        if (allowedSpaces) {
          allowedSpace = allowedSpaces.find(allowed => allowed.key === key);
          if (!allowedSpace) {
            continue;
          }
        }
        let access: AccessControlLevel;
        if (allowedSpace) {
          access = allowedSpace.level;
        } else {
          access = 'owner';
        }
        const obj = JSON.parse(value);
        data.push({ ...obj, access });
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
    const cursor = this.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Creates a space in the store for a user.
   * When user is not set it lists all spaces as this means a single-user environment.
   * 
   * @param options Listing options.
   * @param key Workspace key. Note, the store may persists the value in a different key. The read operation will use the same key.
   * @param user The current user
   */
  async createUserSpace(key: string, space: IWorkspace, user?: IUser, access: AccessControlLevel = 'read'): Promise<void> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    const value = this.encodeDocument(space);
    let exists = false;
    try {
      await spaces.get(key);
      exists = true;
    } catch (e) {
      // OK
    }
    if (exists) {
      throw new ApiError(`A space with the identifier ${key} already exists`, 400);
    }
    await spaces.put(key, value);
    const userKey = user && user.key || 'default';
    let raw: Bytes | undefined;
    try {
      raw = await userSpaces.get(userKey);
    } catch (e) {
      // 
    }
    let info: IUserSpaces;
    if (!raw) {
      info = {
        spaces: [],
        user: userKey,
      };
    } else {
      info = this.decodeDocument(raw) as IUserSpaces;
    }
    if (!info.spaces) {
      info.spaces = [];
    }
    info.spaces.push({
      key,
      level: access,
    });
    await userSpaces.put(userKey, this.encodeDocument(info));
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: space,
      kind: WorkspaceKind,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpacesRoute(),
      users: userKey === 'default' ? undefined : [userKey],
    };
    Clients.notify(event, filter);
  }

  /**
   * Reads a space for the given user.
   * It throws when the user is not authorized to use the space.
   * 
   * @param key The key of the space to read.
   * @param user Optional user object. When set it tests whether the user has access to the space.
   * @returns The user space or undefined when not found.
   */
  async readUserSpace(key: string, user?: IUser): Promise<IUserWorkspace|undefined> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(key, userKey);
    if (!access) {
      throw new ApiError(`Not found`, 404);
    }
    let raw: Bytes;
    try {
      raw = await spaces.get(key);
    } catch (e) {
      return;
    }
    const space = this.decodeDocument(raw) as IWorkspace;
    const userSpace = { ...space, access } as IUserWorkspace;
    return userSpace;
  }

  /**
   * This method throws when the passed user has no access to the space with the corresponding message.
   * 
   * @param key Space key.
   * @param userRequired Whether the user is required. When false it passes when the user is not provided.
   * @param user The current user object
   */
  protected async checkSpaceWriteAccess(key: string, userRequired: boolean, user?: IUser): Promise<void> {
    const { spaces } = this;
    if (!spaces) {
      throw new Error(`Store not initialized.`);
    }
    if (!user && !userRequired) {
      return;
    }
    if (!user && userRequired) {
      throw new ApiError(`Not found.`, 404);
    }
    const userKey = user && user.key || 'default';
    const access  = await this.readUserSpaceAccess(key, userKey);
    if (!access) {
      throw new ApiError(`Not authorized to read this space.`, 403);
    }
    const canWrite = this.canWrite(access);
    if (!canWrite) {
      throw new ApiError(`Not authorized to write to this space.`, 403);
    }
  }

  /**
   * Writes to the user space.
   * 
   * @param space The updated space object.
   * @param key The space key
   * @param patch The patch object sent to the server. It is used to notify clients about the change.
   * @param user Optional user to check access to the space.
   */
  async updateUserSpace(key: string, space: IWorkspace, patch: JsonPatch, user?: IUser): Promise<void> {
    const { spaces } = this;
    if (!spaces) {
      throw new Error(`Store not initialized.`);
    }
    await this.checkSpaceWriteAccess(key, false, user);
    const value = this.encodeDocument(space);
    await spaces.put(key, value);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: patch,
      kind: WorkspaceKind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpaceRoute(key),
    };
    Clients.notify(event, filter);
  }

  /**
   * Adds or removes users to/from the space.
   * Only available in a multi-user environment.
   * 
   * @param key The key of the space to update
   * @param patch The list of patch operations to perform on user access to the space.
   * @param user The user that triggered the change.
   */
  async patchSpaceUsers(key: string, patch: UserAccessOperation[], user: IUser): Promise<void> {
    const { spaces, userSpaces, users } = this;
    if (!spaces || !userSpaces || !users) {
      throw new Error(`Store not initialized.`);
    }
    await this.checkSpaceWriteAccess(key, true, user);
    let raw: Bytes;
    try {
      raw = await spaces.get(key);
    } catch (e) {
      // technically won't happen because checking for write permission does that
      throw new ApiError(`Not found.`, 404);
    }

    const adding: IUserAccessAddOperation[] = [];
    const removing: IUserAccessRemoveOperation[] = [];

    patch.forEach((item) => {
      if (item.op === 'remove') {
        removing.push(item);
      } else if (item.op === 'add') {
        adding.push(item);
      }
    });

    const addingIds = adding.map(i => i.uid);
    const removingIds = removing.map(i => i.uid);
    const allIds = Array.from(new Set(addingIds.concat(removingIds)));

    // check whether all adding users are in the data store (removing is OK).
    if (adding.length) {
      const missingUsers = await this.listMissingUsers(addingIds);
      if (missingUsers.length) {
        throw new ApiError(`Some users not found in the system: ${missingUsers.join(', ')}.`, 400);
      }
    }

    const space = this.decodeDocument(raw) as IWorkspace;
    // the copy is to generate the patch to the listeners.
    const copy = this.decodeDocument(raw) as IWorkspace;
    if (!space.users) {
      space.users = [];
    }
    const { users: uList } = space;

    const spacesList = await this.readUsersSpaces(allIds, true);
    const putList: PutBatch[] = [];

    // update the space's user list. We gonna do this on the main patch array to preserve order of operations.
    patch.forEach((item) => {
      const index = uList.indexOf(item.uid);
      // I am casting this to the IUserSpaces interface as this must be here after calling `readUsersSpaces(.., true)`.
      const spaceInfo = spacesList.find(i => i.user === item.uid) as IUserSpaces;
      if (item.op === 'remove') {
        if (index >= 0) {
          uList.splice(index, 1);
        }
        const spaceIndex = spaceInfo.spaces.findIndex(i => i.key === key);
        if (spaceIndex >= 0) {
          spaceInfo.spaces.splice(spaceIndex, 1);
        }
        putList.push({
          key: item.uid,
          type: 'put',
          value: this.encodeDocument(spaceInfo),
        });
      } else if (item.op === 'add') {
        if (index < 0) {
          uList.push(item.uid);
        }
        const spaceIndex = spaceInfo.spaces.findIndex(i => i.key === key);
        if (spaceIndex >= 0) {
          // the client requested to update user's access level
          spaceInfo.spaces[spaceIndex].level = item.value;
        } else {
          // we are adding access level
          // Note, from the client notification perspective, whether we are updating or adding permissions, the client need to pull changes
          // to the space from the server anyway.
          spaceInfo.spaces.push({
            level: item.value,
            key,
          });
        }
        putList.push({
          key: item.uid,
          type: 'put',
          value: this.encodeDocument(spaceInfo),
        });
      }
    });

    // Now store the data
    await spaces.put(key, this.encodeDocument(space));
    await userSpaces.batch(putList);
    
    // JSON-patch library takes care of the difference to the object.
    const diffPatch = diff(copy, space);
    // we inform about the space change only when there was an actual change (may not be when updating permissions only).
    if (diffPatch.length) {
      const event: IBackendEvent = {
        type: 'event',
        operation: 'updated',
        data: diffPatch,
        kind: WorkspaceKind,
        id: key,
      };
      const filter: IClientFilterOptions = {
        url: RouteBuilder.buildSpaceRoute(key),
      };
      Clients.notify(event, filter);
    }

    // we need to separately notify clients about adding and removing the access.
    // we do this iterating over the original patch to preserve the order of operations
    const removeEvent: IBackendEvent = {
      type: 'event',
      operation: 'access-removed',
      kind: WorkspaceKind,
      id: key,
    };
    const addEvent: IBackendEvent = { ...removeEvent, operation: 'access-granted' };
    const baseFilter: IClientFilterOptions = {
      url: RouteBuilder.buildSpacesRoute(),
    };
    patch.forEach((item) => {
      const f = { ...baseFilter, users: [item.uid], };
      if (item.op === 'remove') {
        Clients.notify(removeEvent, f);
      } else if (item.op === 'add') {
        Clients.notify(addEvent, f);
      }
    });
  }

  /**
   * Lists projects that are embedded in a space.
   * 
   * Project keys are defined as:
   * 
   * "~" + Space Key + "~" + Project key + "~"
   * 
   * @param key The key of the space that has projects.
   * @param options Listing options
   * @param user Optional user for authorization.
   */
  async listSpaceProjects(key: string, options?: IListOptions, user?: IUser): Promise<IListResponse> {
    const { projectsIndex } = this;
    if (!projectsIndex) {
      throw new Error(`Store not initialized.`);
    }
    // check if the user has read access to the space.
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(key, userKey);
    if (!access) {
      throw new ApiError(`User is not authorized to read this space.`, 403);
    }
    const state = this.readListState(options);
    const itOpts: AbstractIteratorOptions = {
      gte: `~${key}~`,
      lte: `~${key}~~`
    };
    const iterator = projectsIndex.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let lastKey: string | undefined;
    const data: IHttpProjectListItem[] = [];
    let remaining = state.limit as number;

    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const item = this.decodeDocument(value) as IHttpProjectListItem;
        data.push(item);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
    const cursor = this.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Creates a project in a user space.
   * 
   * Project keys are defined as:
   * 
   * "~" + Space Key + "~" + Project key + "~"
   * 
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param project The project to insert.
   * @param user Optional, user that triggers the insert.
   */
  async createSpaceProject(spaceKey: string, projectKey: string, project: IHttpProject, user?: IUser): Promise<void> {
    const { projectsIndex, projectsData } = this;
    if (!projectsIndex || !projectsData) {
      throw new Error(`Store not initialized.`);
    }
    // check if the user has read access to the space.
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(spaceKey, userKey);
    if (!access) {
      throw new ApiError(`User is not authorized to read this space.`, 403);
    }
    const canWrite = this.canWrite(access);
    if (!canWrite) {
      throw new ApiError(`User is not authorized to write to this space.`, 403);
    }
    const finalKey = `~${spaceKey}~${projectKey}~`;
    
    // Project changes are only allowed through `PATCH`.
    let exists = false;
    try {
      await projectsIndex.get(finalKey);
      exists = true;
    } catch (e) {
      // OK
    }
    if (exists) {
      throw new ApiError(`A project with the identifier ${projectKey} already exists`, 400);
    }

    // first handle the project data store
    // Note, at this point there's no one to notify about the project so we skip client notification.
    await projectsData.put(finalKey, this.encodeDocument(project));

    // then handle the listing
    const item: IHttpProjectListItem = {
      key: projectKey,
      name: project.info.name || 'Unnamed project',
    };
    await projectsIndex.put(finalKey, this.encodeDocument(item));
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: item,
      kind: HttpProjectListItemKind,
    };
    // informs only clients that are listening for projects change in a space.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpaceProjectsRoute(spaceKey),
    };
    Clients.notify(event, filter);
  }

  /**
   * Reads project data from the space.
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param user Optional, user for which to check the permission.
   */
  async readSpaceProject(spaceKey: string, projectKey: string, user?: IUser): Promise<IHttpProject> {
    const { projectsData } = this;
    if (!projectsData) {
      throw new Error(`Store not initialized.`);
    }
    // check if the user has read access to the space.
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(spaceKey, userKey);
    if (!access) {
      throw new ApiError(`User is not authorized to read this space.`, 403);
    }
    const finalKey = `~${spaceKey}~${projectKey}~`;
    let raw: Bytes;
    try {
      raw = await projectsData.get(finalKey);
    } catch (e) {
      throw new ApiError(`The project ${projectKey} does not exists.`, 404);
    }
    const data = this.decodeDocument(raw) as IHttpProject;
    return data;
  }

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
  async updateSpaceProject(spaceKey: string, projectKey: string, project: IHttpProject, patch: JsonPatch, user?: IUser): Promise<void> {
    const { projectsIndex, projectsData } = this;
    if (!projectsIndex || !projectsData) {
      throw new Error(`Store not initialized.`);
    }
    // check if the user has read access to the space.
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(spaceKey, userKey);
    if (!access) {
      throw new ApiError(`User is not authorized to read this space.`, 403);
    }
    const canWrite = this.canWrite(access);
    if (!canWrite) {
      throw new ApiError(`User is not authorized to write to this space.`, 403);
    }
    const finalKey = `~${spaceKey}~${projectKey}~`;
    await projectsData.put(finalKey, this.encodeDocument(project));
    // send notification to the project listeners
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: patch,
      kind: HttpProjectKind,
      id: projectKey,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey),
    };
    Clients.notify(event, filter);

    // when the name change make changes to the index as well.
    const nameChange = patch.find(i => i.path === '/info/name');
    if (nameChange) {
      if (nameChange.op === 'add' || nameChange.op === 'replace') {
        const { value } = nameChange;
        await this.changeProjectName(spaceKey, projectKey, value);
      } else if (nameChange.op === 'remove') {
        await this.changeProjectName(spaceKey, projectKey, 'Unnamed project');
      }
    }
  }

  protected async changeProjectName(spaceKey: string, projectKey: string, value: string): Promise<void> {
    const { projectsIndex } = this;
    if (!projectsIndex) {
      throw new Error(`Store not initialized.`);
    }
    const finalKey = `~${spaceKey}~${projectKey}~`;
    let data: IHttpProjectListItem;
    try {
      const raw = await projectsIndex.get(finalKey);
      data = this.decodeDocument(raw) as IHttpProjectListItem;
    } catch (e) {
      data = {
        key: projectKey,
        name: '',
      };
    }
    data.name = value;
    await projectsIndex.put(finalKey, this.encodeDocument(data));

    const event: IBackendEvent = {
      type: 'event',
      operation: 'updated',
      data: data,
      kind: HttpProjectKind,
      id: projectKey,
    };
    // informs only clients that are listening for projects change in a space.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpaceProjectsRoute(spaceKey),
    };
    Clients.notify(event, filter);
  }

  /**
   * Deletes a project from a space.
   * @param spaceKey The user space key.
   * @param projectKey The project key
   */
  async deleteSpaceProject(spaceKey: string, projectKey: string, user?: IUser): Promise<void> {
    const { projectsIndex, projectsData, trashBin, trashBinData } = this;
    if (!projectsIndex || !projectsData || !trashBin || !trashBinData) {
      throw new Error(`Store not initialized.`);
    }
    // check if the user has read access to the space.
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(spaceKey, userKey);
    if (!access) {
      throw new ApiError(`User is not authorized to read this space.`, 403);
    }
    const canWrite = this.canWrite(access);
    if (!canWrite) {
      throw new ApiError(`User is not authorized to write to this space.`, 403);
    }
    const finalKey = `~${spaceKey}~${projectKey}~`;
    let dataRaw: Bytes;
    let indexRaw: Bytes;
    try {
      dataRaw = await projectsData.get(finalKey);
      indexRaw = await projectsIndex.get(finalKey);
    } catch (e) {
      throw new ApiError(`The project ${projectKey} does not exists.`, 404);
    }
    const time = Date.now();
    // move the data to the bin.
    const dataBinIndex: IBinListItem = {
      key: finalKey,
      deleted: time,
      kind: HttpProjectKind,
    };
    if (userKey) {
      dataBinIndex.deleteBy = userKey;
    }
    const dataBin: IBinDataItem = {
      data: dataRaw,
    };
    await trashBin.put(`~project-data${finalKey}`, this.encodeDocument(dataBinIndex));
    await trashBinData.put(`~project-data${finalKey}`, this.encodeDocument(dataBin));
    await projectsData.del(finalKey);
    const indexBinIndex: IBinListItem = {
      key: finalKey,
      deleted: time,
      kind: HttpProjectListItemKind,
    };
    if (userKey) {
      dataBinIndex.deleteBy = userKey;
    }
    const indexBin: IBinDataItem = {
      data: indexRaw,
    };
    await trashBin.put(`~project-index${finalKey}`, this.encodeDocument(indexBinIndex));
    await trashBinData.put(`~project-index${finalKey}`, this.encodeDocument(indexBin));
    await projectsData.del(finalKey);

    // The revision history may stay for now. It should be cleaned when the object is removed from the bin.
    
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: HttpProjectListItemKind,
      id: projectKey,
    };
    // informs only clients that are listening for projects change in a space.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpaceProjectsRoute(spaceKey),
    };
    Clients.notify(event, filter);
    const event2 = { ...event };
    event2.kind = HttpProjectKind;
    const filter2: IClientFilterOptions = {
      url: RouteBuilder.buildSpaceProjectRoute(spaceKey, projectKey),
    };
    Clients.notify(event2, filter2);
    Clients.closeByUrl(filter2.url as string);
  }

  /**
   * Adds a project revision information to the store.
   * Note, this does not check whether the user has access to the space.
   * 
   * @param projectKey The project key
   * @param patch The reversible patch applied to the project.
   */
  async addProjectRevision(spaceKey: string, projectKey: string, patch: JsonPatch): Promise<void> {
    const { projectRevisions } = this;
    if (!projectRevisions) {
      throw new Error(`Store not initialized.`);
    }
    const created = Date.now();
    const id = `project~${projectKey}~${created}~`;
    const info: IRevisionInfo = {
      id,
      key: projectKey,
      kind: HttpProjectKind,
      created,
      deleted: false,
      patch,
    }
    await projectRevisions.put(id, this.encodeDocument(info));
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: info,
      kind: RevisionInfoKind,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildProjectRevisionsRoute(projectKey, spaceKey),
    };
    Clients.notify(event, filter);
  }

  /**
   * Lists revisions for a project.
   * 
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param options Listing options
   * @param user Optional user for authorization.
   */
  async listProjectRevisions(spaceKey: string, projectKey: string, options?: IListOptions, user?: IUser): Promise<IListResponse> {
    const { projectRevisions } = this;
    if (!projectRevisions) {
      throw new Error(`Store not initialized.`);
    }
    // check if the user has read access to the space.
    const userKey = user && user.key;
    const access  = await this.readUserSpaceAccess(spaceKey, userKey);
    if (!access) {
      throw new ApiError(`User is not authorized to read this space.`, 403);
    }
    const state = this.readListState(options);
    const itOpts: AbstractIteratorOptions = {
      gte: `project~${projectKey}~`,
      lte: `project~${projectKey}~~`,
    };
    const iterator = projectRevisions.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let lastKey: string | undefined;
    const data: IRevisionInfo[] = [];
    let remaining = state.limit as number;

    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const item = this.decodeDocument(value) as IRevisionInfo;
        data.push(item);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
    const cursor = this.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Adds a new user to the system.
   * This is only called after a successful authentication.
   * 
   * @param userKey The user key.
   * @param user The user to store.
   */
  async addSystemUser(userKey: string, user: IUser): Promise<void> {
    const { users } = this;
    if (!users) {
      throw new Error(`Store not initialized.`);
    }
    await users.put(userKey, this.encodeDocument(user));
  }

  /**
   * Reads the user data from the store.
   * 
   * @param userKey The user key.
   */
  async readSystemUser(userKey: string): Promise<IUser | undefined> {
    const { users } = this;
    if (!users) {
      throw new Error(`Store not initialized.`);
    }
    let raw: Bytes;
    try {
      raw = await users.get(userKey);
    } catch (e) {
      return;
    }
    const data = this.decodeDocument(raw) as IUser;
    return data;
  }

  /**
   * Reads multiple system users with one query. Typically used when the UI asks for
   * user data to render "user pills" in the access control list.
   * 
   * @param userKeys The list of user keys.
   * @returns Ordered list of users defined by the `userKeys` order.
   * Note, when the user is not found an `undefined` is set at the position.
   */
  async readSystemUsers(userKeys: string[]): Promise<IListResponse> {
    const { users } = this;
    if (!users) {
      throw new Error(`Store not initialized.`);
    }
    const items = await users.getMany(userKeys);
    const data: (IUser|undefined)[] = items.map((raw) => {
      if (!raw) {
        return undefined;
      }
      return this.decodeDocument(raw) as IUser;
    });
    const result: IListResponse = {
      data,
      cursor: '',
    };
    return result;
  }

  /**
   * Lists the registered users.
   * The final list won't contain the current user.
   * The user can query for a specific data utilizing the `query` filed.
   */
  async listSystemUsers(options?: IListOptions, user?: IUser): Promise<IListResponse> {
    const { users } = this;
    if (!users) {
      throw new Error(`Store not initialized.`);
    }
    const state = this.readListState(options);
    const userKey = user && user.key;
    const iterator = users.iterator();
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let lastKey: string | undefined;
    const data: IUser[] = [];
    let remaining = state.limit as number;
    const lowerQuery = state.query ? state.query.toLowerCase() : undefined;
    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        if (userKey && key === userKey) {
          continue;
        }
        const item = this.decodeDocument(value) as IUser;
        if (lowerQuery && !this.isUserInQuery(item, lowerQuery)) {
          continue;
        }
        data.push(item);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
    const cursor = this.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Checks whether user data contains the `query`.
   * 
   * @param user The user object
   * @param lowerQuery The lowercase query
   * @returns True when the `query` is in the user name or email.
   */
  protected isUserInQuery(user: IUser, lowerQuery: string): boolean {
    const { name='', email } = user;
    if (name.toLocaleLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (Array.isArray(email)) {
      const hasEmail = email.some(i => (i.email || '').toLowerCase().includes(lowerQuery));
      if (hasEmail) {
        return hasEmail;
      }
    }
    return false;
  }

  /**
   * Permanently stores session data in the data store.
   * 
   * @param key The session identifier
   * @param value The value to store.
   */
  async setSessionData(key: string, value: unknown): Promise<void> {
    const { sessions } = this;
    if (!sessions) {
      throw new Error(`Store not initialized.`);
    }
    await sessions.put(key, this.encodeDocument(value));
  }

  /**
   * Permanently destroys session data in the data store.
   * 
   * @param key The session identifier
   */
  async deleteSessionData(key: string): Promise<void> {
    const { sessions } = this;
    if (!sessions) {
      throw new Error(`Store not initialized.`);
    }
    try {
      await sessions.del(key);
    } catch (e) {
      // ....
    }
  }

  /**
   * Reads the session data from the store.
   * 
   * @param key The session identifier
   */
  async readSessionData(key: string): Promise<unknown | undefined> {
    const { sessions } = this;
    if (!sessions) {
      throw new Error(`Store not initialized.`);
    }
    let raw: Bytes;
    try {
      raw = await sessions.get(key);
    } catch (e) {
      return;
    }
    const data = this.decodeDocument(raw);
    return data;
  }

  /**
   * Lists users that do not exist in the system
   * @param keys The list of user keys to test.
   * @returns If empty list then all users are set in the store. Returned is the list of keys of missing records.
   */
  protected async listMissingUsers(keys: string[]): Promise<string[]> {
    const { users } = this;
    if (!users) {
      throw new Error(`Store not initialized.`);
    }
    const data = await users.getMany(keys);
    const result: string[] = [];
    data.forEach((item, index) => {
      if (!item) {
        result.push(keys[index]);
      }
    });
    return result;
  }
}
