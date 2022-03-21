import { LevelUp } from 'levelup';
import { LevelDownIterator, Bytes } from 'leveldown';
import { AbstractLevelDOWN, AbstractIteratorOptions } from 'abstract-leveldown';
import sub from 'subleveldown';
import { 
  IUser, IListResponse, IListOptions, IHttpProjectListItem, IHttpProject, IBackendEvent,
  HttpProjectListItemKind, HttpProjectKind, AccessControlLevel, ICursorOptions, RouteBuilder,
} from '@api-client/core';
import { JsonPatch } from 'json8-patch';
import { StoreLevelUp } from './StoreLevelUp.js';
import { SubStore } from './SubStore.js';
import { KeyGenerator } from './KeyGenerator.js';
import { ApiError } from '../ApiError.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { IProjectsStore } from './StorePersistence.js';

/**
 * @deprecated This must be moved to the list options.
 */
interface IApiListingOptions {
  /**
   * Whether to include the deleted items to the list.
   * Deleted items have the `_deleted` property.
   */
  includeDeleted?: boolean;
}

/**
 * The part of the store that takes care of the project data.
 */
export class LevelProjectStore extends SubStore implements IProjectsStore {
  /**
   * The store that only keeps projects fisting for the UI.
   * Each entry corresponds to an entry in the `data` store.
   */
  index: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  /**
   * The store that keeps the HTTP projects data.
   */
  data: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;

  constructor(protected parent: StoreLevelUp, db: LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>) {
    super(parent, db);
    this.index = sub<string, any>(db, 'index') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
    this.data = sub<string, any>(db, 'data') as LevelUp<AbstractLevelDOWN<Bytes, Bytes>, LevelDownIterator>;
  }
  
  async cleanup(): Promise<void> {
    await this.index.close();
    await this.data.close();
    await this.db.close();
  }

  /**
   * Lists projects that are embedded in a space.
   * 
   * Project keys are defined as:
   * 
   * "~" + Space Key + "~" + Project key + "~"
   * 
   * @param key The key of the space that has projects.
   * @param user User for authorization.
   * @param options Listing options
   */
  async list(key: string, user: IUser, options?: IListOptions | ICursorOptions): Promise<IListResponse> {
    await this.parent.checkSpaceAccess('read', key, user);
    const state = await this.parent.readListState(options);
    const { limit = this.parent.defaultLimit } = state;
    const itOpts: AbstractIteratorOptions = {
      gte: `~${key}~`,
      lte: `~${key}~~`,
      // newest on top.
      reverse: true,
    };
    const iterator = this.index.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let lastKey: string | undefined;
    const data: IHttpProjectListItem[] = [];
    let remaining = limit;

    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const item = this.parent.decodeDocument(value) as any;
        if (item._deleted) {
          continue;
        }
        data.push(item  as IHttpProjectListItem);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    // sorts the results by the updated time, newest on top.
    data.sort(({ updated: a = 0 }, { updated: b = 0 }) => b - a);
    const cursor = await this.parent.cursor.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }

  /**
   * Lists all indexes of a project in a space.
   * This does not perform any authorization checks before accessing the data. SHould only be used internally.
   * @param key The user space key
   */
  async allIndexes(key: string, opts: IApiListingOptions = {}): Promise<IHttpProjectListItem[]> {
    const result: IHttpProjectListItem[] = [];
    const itOpts: AbstractIteratorOptions = {
      gte: `~${key}~`,
      lte: `~${key}~~`,
      reverse: true,
      keys: false,
    };
    const iterator = this.index.iterator(itOpts);
    try {
      // @ts-ignore
      for await (const [, value] of iterator) {
        const item = this.parent.decodeDocument(value) as any;
        if (item._deleted && !opts.includeDeleted) {
          continue;
        }
        result.push(item  as IHttpProjectListItem);
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
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
  async add(spaceKey: string, projectKey: string, project: IHttpProject, user: IUser): Promise<void> {
    await this.parent.checkSpaceAccess('write', spaceKey, user);
    const finalKey = KeyGenerator.projectKey(spaceKey, projectKey);
    // Project changes are only allowed through `PATCH`.
    let exists = false;
    try {
      await this.index.get(finalKey);
      exists = true;
    } catch (e) {
      // OK
    }
    if (exists) {
      throw new ApiError(`A project with the identifier ${projectKey} already exists.`, 400);
    }

    // first handle the project data store
    // Note, at this point there's no one to notify about the project so we skip client notification.
    await this.data.put(finalKey, this.parent.encodeDocument(project));

    // then handle the listing
    const item: IHttpProjectListItem = {
      key: projectKey,
      name: project.info.name || 'Unnamed project',
      updated: Date.now(),
    };
    
    await this.index.put(finalKey, this.parent.encodeDocument(item));
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: item,
      kind: HttpProjectListItemKind,
    };
    // informs only clients that are listening for projects change in a space.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.space(spaceKey),
    };
    Clients.notify(event, filter);
  }

  /**
   * Reads project data from the space.
   * @param spaceKey The user space key.
   * @param projectKey The project key
   * @param user Optional, user for which to check the permission.
   */
  async read(spaceKey: string, projectKey: string, user: IUser): Promise<IHttpProject> {
    // check if the user has read access to the space.
    await this.parent.checkProjectAccess('read', spaceKey, projectKey, user);
    const finalKey = KeyGenerator.projectKey(spaceKey, projectKey);
    let raw: Bytes;
    try {
      raw = await this.data.get(finalKey);
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    const data = this.parent.decodeDocument(raw) as IHttpProject;
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
  async update(spaceKey: string, projectKey: string, project: IHttpProject, patch: JsonPatch, user: IUser): Promise<void> {
    await this.parent.checkProjectAccess('write', spaceKey, projectKey, user);
    const finalKey = KeyGenerator.projectKey(spaceKey, projectKey);
    await this.data.put(finalKey, this.parent.encodeDocument(project));
    // send notification to the project listeners
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: patch,
      kind: HttpProjectKind,
      id: projectKey,
    };
    const filter: IClientFilterOptions = {
      url: RouteBuilder.spaceProject(spaceKey, projectKey),
    };
    Clients.notify(event, filter);

    // when the name change make changes to the index as well.
    const nameChange = patch.find(i => i.path === '/info/name');
    if (nameChange) {
      if (nameChange.op === 'add' || nameChange.op === 'replace') {
        const { value } = nameChange;
        await this.changeName(spaceKey, projectKey, value);
      } else if (nameChange.op === 'remove') {
        await this.changeName(spaceKey, projectKey, 'Unnamed project');
      }
    } else {
      await this.updateTime(projectKey, finalKey);
    }
  }

  protected async updateTime(projectKey: string, indexKey: string): Promise<void> {
    let data: IHttpProjectListItem;
    try {
      const raw = await this.index.get(indexKey);
      data = this.parent.decodeDocument(raw) as IHttpProjectListItem;
    } catch (e) {
      data = {
        key: projectKey,
        name: '',
        updated: 0,
      };
    }
    data.updated = Date.now();
    await this.index.put(indexKey, this.parent.encodeDocument(data));
  }

  protected async changeName(spaceKey: string, projectKey: string, value: string): Promise<void> {
    const finalKey = KeyGenerator.projectKey(spaceKey, projectKey);
    let data: IHttpProjectListItem;
    try {
      const raw = await this.index.get(finalKey);
      data = this.parent.decodeDocument(raw) as IHttpProjectListItem;
    } catch (e) {
      data = {
        key: projectKey,
        name: '',
        updated: 0,
      };
    }
    data.name = value;
    data.updated = Date.now();
    await this.index.put(finalKey, this.parent.encodeDocument(data));
    const event: IBackendEvent = {
      type: 'event',
      operation: 'updated',
      data: data,
      kind: HttpProjectListItemKind,
      id: projectKey,
    };
    // informs only clients that are listening for projects change in a space.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.space(spaceKey),
    };
    Clients.notify(event, filter);
  }

  /**
   * Deletes a project from a space.
   * 
   * In the object data store, the delete operation should be performed by performing the 
   * `put()` operation with a flag determining that the record is deleted. This allows for smooth 
   * replication of the data store.
   * 
   * This logic puts the `_deleted` boolean flag to the deleted entity. Iterators aggregating
   * the data (lists, gets, puts, etc) take this property into the account and treat a record 
   * with this property as it was never read.
   * 
   * Potentially, the _deleted object can stay in the DB forever and be restored anytime.
   * Currently there is no mechanism to permanently remove the data from the store through this API.
   * Future releases may have options to either schedule a cleaning tasks or a configuration 
   * option to clean the data store after set period of time.
   * 
   * Additionally, this implementation uses the `bin` store where it keeps records of all deleted items.
   * This way it is easy to check whether an entity was deleted without retrieving the original 
   * object and deserializing it. It could also be used to list deleted items more efficiently 
   * than iterating over the main store.
   * 
   * @param spaceKey The user space key.
   * @param projectKey The project key
   */
  async delete(spaceKey: string, projectKey: string, user: IUser): Promise<void> {
    await this.parent.checkProjectAccess('write', spaceKey, projectKey, user);
    const finalKey = KeyGenerator.projectKey(spaceKey, projectKey);
    
    // 1. update project data to include the _deleted flag
    // 2. update project index to include the _deleted flag
    // 3. Inset project to the bin store.

    let dataRaw: Bytes;
    let indexRaw: Bytes;
    try {
      dataRaw = await this.data.get(finalKey);
      indexRaw = await this.index.get(finalKey);
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    const data = this.parent.decodeDocument(dataRaw) as any;
    const index = this.parent.decodeDocument(indexRaw) as any;
    data._deleted = true;
    index._deleted = true;
    const deletedKey = KeyGenerator.deletedProjectKey(spaceKey, projectKey);

    // persist the data
    await this.parent.bin.add(deletedKey, user);
    await this.data.put(finalKey, this.parent.encodeDocument(data));
    await this.index.put(finalKey, this.parent.encodeDocument(index));

    // The revision history may stay for now. 
    // It should be cleaned when the object is removed from the bin.
    
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: HttpProjectListItemKind,
      id: projectKey,
    };
    // informs only clients that are listening for changes on the space.
    const filter: IClientFilterOptions = {
      url: RouteBuilder.space(spaceKey),
    };
    Clients.notify(event, filter);
    const event2 = { ...event };
    event2.kind = HttpProjectKind;
    const filter2: IClientFilterOptions = {
      url: RouteBuilder.spaceProject(spaceKey, projectKey),
    };
    Clients.notify(event2, filter2);
    Clients.closeByUrl(filter2.url as string);
  }

  /**
   * Similar to `checkSpaceAccess()` but it check for the access to a project.
   * Since projects inherit access from the parent space it is mostly the same logic as in `checkSpaceAccess()` but it also tests whether the
   * project was deleted.
   * 
   * @param minimumLevel The minimum access level required for this operation.
   * @param user The user object. When not set on the session this always throws an error.
   */
  async checkAccess(minimumLevel: AccessControlLevel, space: string, project: string, user: IUser): Promise<AccessControlLevel> {
    // check if the user has read access to the space.
    const access = await this.parent.checkSpaceAccess(minimumLevel, space, user);
    const projectDeleted = await this.parent.bin.isProjectDeleted(space, project);
    // TODO: this should check whether the project actually belongs to the project
    // To do so we would have to have a store that keeps information about that relationship
    if (projectDeleted) {
      throw new ApiError(`Not found.`, 404);
    }
    return access;
  }
}
