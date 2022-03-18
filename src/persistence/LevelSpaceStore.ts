/* eslint-disable import/no-named-as-default */
import { LevelUp } from 'levelup';
import { LevelDownIterator, Bytes } from 'leveldown';
import sub from 'subleveldown';
import { AbstractLevelDOWN, PutBatch } from 'abstract-leveldown';
import { 
  IUser, IBackendEvent, IListResponse, IUserSpaces, AccessControlLevel, IListOptions, IAccessControl,
  Workspace, IWorkspace, IUserWorkspace, WorkspaceKind, HttpProjectKind, UserAccessOperation,
  IUserAccessAddOperation, IUserAccessRemoveOperation, ISpaceUser,
} from '@api-client/core';
import { JsonPatch, diff } from 'json8-patch';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { RouteBuilder } from '../routes/RouteBuilder.js';
import { SubStore } from './SubStore.js';
import { ArcLevelUp } from './ArcLevelUp.js';
import { ApiError } from '../ApiError.js';
import { KeyGenerator } from './KeyGenerator.js';
import { ISpaceStore } from './StorePersistence.js';

/**
 * The part of the store that takes care of the user spaces data.
 */
export class LevelSpaceStore extends SubStore implements ISpaceStore {
  /**
   * The data store for user spaces.
   */
  spaces: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * Each key is the User id. The value is the access list to the workspaces the user has access to.
   */
  userSpaces: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  
  constructor(protected parent: ArcLevelUp, db: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>) {
    super(parent, db);
    this.spaces = sub<Bytes, Bytes>(db, 'data') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.userSpaces = sub<Bytes, Bytes>(db, 'user-ref') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  }

  async cleanup(): Promise<void> {
    await this.spaces.close();
    await this.userSpaces.close();
    await this.db.close();
  }
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
   * Reads the `IUserSpaces` from the document that keeps track of which spaces the user has access to.
   * 
   * @param userKey The user id to get the info from.
   */
  async readUserSpaces(userKey: string): Promise<IUserSpaces | undefined> {
    const { userSpaces } = this;
    let raw: Bytes | undefined;
    try {
      raw = await userSpaces.get(userKey);
    } catch (e) {
      return;
    }
    return this.parent.decodeDocument(raw) as IUserSpaces;
  }
  /**
   * Reads user spaces information for multiple users.
   * 
   * @param users The list of user keys.
   * @returns The ordered list of user spaces. When the user does not exist it returns `undefined` at that index.
   */
  async readUsersSpaces(users: string[], fillEmpty: false): Promise<(IUserSpaces | undefined)[]>;
  /**
   * Reads user spaces information for multiple users.
   * 
   * @param users The list of user keys.
   * @returns The ordered list of user spaces. When the user does not exist it creates a new record at that index.
   */
  async readUsersSpaces(users: string[], fillEmpty: true): Promise<IUserSpaces[]>;

  /**
   * Reads user spaces information for multiple users.
   * @param users The list of user keys.
   * @param fillEmpty When set it creates an empty object when does not exist.
   */
  async readUsersSpaces(users: string[], fillEmpty = false): Promise<(IUserSpaces | undefined)[]> {
    const { userSpaces } = this;
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
      return this.parent.decodeDocument(item) as IUserSpaces;
    });
    return result;
  }

  /**
   * Reads from the data store the access the user has to a space.
   * 
   * @param spaceKey The space key to check the access to.
   * @param userKey The current user key
   * @returns The access level for the space or undefined when the user has no access to it.
   */
  async readSpaceAccess(spaceKey: string, userKey: string): Promise<AccessControlLevel | undefined> {
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
   * @param user The current user
   * @param options Listing options.
   */
  async list(user: IUser, options?: IListOptions): Promise<IListResponse> {
    const { spaces } = this;
    let allowedSpaces: IAccessControl[] | undefined;
    const userKey = user && user.key;
    let info = await this.readUserSpaces(userKey);
    if (!info) {
      // the user has no spaces. We gonna create a default one for the user.
      const space = this.defaultSpace(userKey);
      await this.add(space.key, space, user, 'owner');
      info = await this.readUserSpaces(userKey);
      if (!info) {
        throw new Error(`Unable to create a default space.`);
      }
      allowedSpaces = info.spaces;
    } else {
      allowedSpaces = info.spaces;
    }

    const state = this.parent.readListState(options);
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
        if (obj._deleted) {
          continue;
        }
        data.push({ ...obj, access });
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    const cursor = this.parent.encodeCursor(state, lastKey || state.lastKey);
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
   * @param key Workspace key.
   * @param space The user space definition.
   * @param user The current user
   */
  async add(key: string, space: IWorkspace, user: IUser, access: AccessControlLevel = 'read'): Promise<void> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    const value = this.parent.encodeDocument(space);
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
      info = this.parent.decodeDocument(raw) as IUserSpaces;
    }
    if (!info.spaces) {
      info.spaces = [];
    }
    info.spaces.push({
      key,
      level: access,
    });
    await userSpaces.put(userKey, this.parent.encodeDocument(info));
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
  async read(key: string, user: IUser): Promise<IUserWorkspace|undefined> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    const access = await this.checkAccess('read', key, user);
    let raw: Bytes;
    try {
      raw = await spaces.get(key);
    } catch (e) {
      return;
    }
    const space = this.parent.decodeDocument(raw) as IWorkspace;
    const userSpace = { ...space, access } as IUserWorkspace;
    return userSpace;
  }

  /**
   * Writes to the user space.
   * 
   * @param space The updated space object.
   * @param key The space key
   * @param patch The patch object sent to the server. It is used to notify clients about the change.
   * @param user Optional user to check access to the space.
   */
  async update(key: string, space: IWorkspace, patch: JsonPatch, user: IUser): Promise<void> {
    const { spaces } = this;
    if (!spaces) {
      throw new Error(`Store not initialized.`);
    }
    await this.checkAccess('write', key, user);
    const value = this.parent.encodeDocument(space);
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
   * Deletes the space from the system
   * @param key The space key
   * @param user The current user
   */
  async delete(key: string, user: IUser): Promise<void> {
    const { spaces } = this;
    if (!spaces) {
      throw new Error(`Store not initialized.`);
    }
    const access = await this.checkAccess('write', key, user);

    // 1. update the space to include the _deleted flag
    // 2. Inset the space key to the bin store.

    let dataRaw: Bytes;
    try {
      dataRaw = await spaces.get(key);
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    const data = this.parent.decodeDocument(dataRaw) as any;
    if (user && access !== 'owner') {
      const space = data as IWorkspace;
      if (space.owner !== user.key) {
        throw new ApiError(`Unauthorized to delete the space.`, 403)
      }
    }

    data._deleted = true;
    const deletedKey = KeyGenerator.deletedSpaceKey(key);

    // persist the data
    await this.parent.bin.add(deletedKey, user);
    await spaces.put(key, this.parent.encodeDocument(data));

    // inform clients the space is deleted
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: WorkspaceKind,
      id: key,
    };
    // informs spaces list clients about the delete.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.buildSpacesRoute(),
    };
    Clients.notify(event, filter);
    // Disconnect clients connected to the space.
    Clients.closeByUrl(RouteBuilder.buildSpaceRoute(key));
    // Disconnect clients connected to the space projects.
    Clients.closeByUrl(RouteBuilder.buildSpaceProjectsRoute(key));
    
    // now, inform space projects listeners that the project is also deleted
    const list = await this.parent.project.allIndexes(key);
    list.forEach((project) => {
      const event2 = { 
        type: 'event',
        operation: 'deleted',
        kind: HttpProjectKind,
        id: project.key,
      };
      const url = RouteBuilder.buildSpaceProjectRoute(key, project.key);
      const filter2: IClientFilterOptions = {
        url,
      };
      Clients.notify(event2, filter2);
      Clients.closeByUrl(url);
    });
  }

  /**
   * Adds or removes users to/from the space.
   * Only available in a multi-user environment.
   * 
   * @param key The key of the space to update
   * @param patch The list of patch operations to perform on user access to the space.
   * @param user The user that triggered the change.
   */
  async patchUsers(key: string, patch: UserAccessOperation[], user: IUser): Promise<void> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    await this.checkAccess('write', key, user);
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
      const missingUsers = await this.parent.user.listMissing(addingIds);
      if (missingUsers.length) {
        throw new ApiError(`Some users not found in the system: ${missingUsers.join(', ')}.`, 400);
      }
    }

    const space = this.parent.decodeDocument(raw) as IWorkspace;
    // the copy is to generate the patch to the listeners.
    const copy = this.parent.decodeDocument(raw) as IWorkspace;
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
          value: this.parent.encodeDocument(spaceInfo),
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
          value: this.parent.encodeDocument(spaceInfo),
        });
      }
    });

    // Now store the data
    await spaces.put(key, this.parent.encodeDocument(space));
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
   * Lists users allowed in the space.
   * @param key The key of the space to update
   * @param user The user that requested the list
   */
  async listUsers(key: string, user: IUser): Promise<IListResponse> {
    const { spaces, userSpaces } = this;
    if (!spaces || !userSpaces) {
      throw new Error(`Store not initialized.`);
    }
    const data: ISpaceUser[] = [];
    const result: IListResponse = {
      data,
    };
    await this.checkAccess('read', key, user);
    let raw: Bytes;
    try {
      raw = await spaces.get(key);
    } catch (e) {
      // technically won't happen because checking for write permission does that
      throw new ApiError(`Not found.`, 404);
    }
    const space = this.parent.decodeDocument(raw) as IWorkspace;
    if (!space.users) {
      return result;
    }
    const { users: uList } = space;
    const spacesList = await this.readUsersSpaces(uList, true);
    const requested: Record<string, AccessControlLevel> = {};
    spacesList.forEach((info) => {
      const accessInfo = info.spaces.find((i) => i.key === key);
      if (!accessInfo || space.owner === info.user) {
        // don't list an owner here.
        return;
      }
      requested[info.user] = accessInfo.level;
    });
    const userKeys = Object.keys(requested);
    const userResults = await this.parent.user.db.getMany(userKeys);
    userKeys.forEach((key, index) => {
      const value = userResults[index];
      if (!value) {
        return;
      }
      const level = requested[key];
      const userObject = this.parent.decodeDocument(value) as IUser;
      data.push({ ...userObject, level });
    });
    return result;
  }

  /**
   * Checks whether the user has read or write access to the space.
   * 
   * It throws errors when the user has no access or when the user has no access to the resource.
   * 
   * @param minimumLevel The minimum access level required for this operation.
   * @param key The user space key.
   * @param user The user object. When not set on the session this always throws an error.
   */
  async checkAccess(minimumLevel: AccessControlLevel, key: string, user: IUser): Promise<AccessControlLevel> {
    if (!user) {
      throw new ApiError(`Authentication required.`, 401)
    }
    const levels: AccessControlLevel[] = ["read", "comment", "write", "owner", "admin"];
    const { spaces } = this;
    if (!spaces) {
      throw new Error(`Store not initialized.`);
    }
    const isDeleted = await this.parent.bin.isSpaceDeleted(key);
    if (isDeleted) {
      throw new ApiError(`Not found.`, 404);
    }
    const access  = await this.parent.space.readSpaceAccess(key, user.key);
    if (!access) {
      // no access is like 404.
      throw new ApiError(`Not found.`, 404);
      // throw new ApiError(`Not authorized to read this space.`, 403);
    }
    const currentAccessIndex = levels.indexOf(access);
    const requestedAccessIndex = levels.indexOf(minimumLevel);
    // the current must be at least at the index of requested.
    if (currentAccessIndex < requestedAccessIndex) {
      throw new ApiError(`Insufficient permissions to access this resource.`, 403);
    }
    return access;
  }
}
