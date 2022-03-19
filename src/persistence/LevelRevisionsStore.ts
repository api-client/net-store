import { AbstractIteratorOptions } from 'abstract-leveldown';
import { IUser, IListResponse, IListOptions, IRevisionInfo, IBackendEvent, HttpProjectKind, RevisionInfoKind, ICursorOptions } from '@api-client/core';
import { JsonPatch } from 'json8-patch';
import { SubStore } from './SubStore.js';
import Clients, { IClientFilterOptions } from '../routes/WsClients.js';
import { RouteBuilder } from '../routes/RouteBuilder.js';
import { KeyGenerator } from './KeyGenerator.js';
import { IRevisionsStore } from './StorePersistence.js';

/**
 * The part of the store that takes care of the project revision data.
 */
export class LevelRevisionsStore extends SubStore implements IRevisionsStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Adds a project revision information to the store.
   * Note, this does not check whether the user has access to the space.
   * 
   * It notifies WS clients about new revision.
   * 
   * @param projectKey The project key
   * @param patch The reversible patch applied to the project.
   */
  async addProject(spaceKey: string, projectKey: string, patch: JsonPatch): Promise<void> {
    const date = new Date();
    const time = date.toJSON();
    const id = KeyGenerator.projectRevisionKey(projectKey, time);
    const info: IRevisionInfo = {
      id,
      key: projectKey,
      kind: HttpProjectKind,
      created: date.getTime(),
      deleted: false,
      patch,
    }
    await this.db.put(id, this.parent.encodeDocument(info));
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
  async listProject(spaceKey: string, projectKey: string, user: IUser, options?: IListOptions | ICursorOptions): Promise<IListResponse> {
    await this.parent.checkProjectAccess('read', spaceKey, projectKey, user);
    const state = await this.parent.readListState(options);
    const { limit = this.parent.defaultLimit } = state;
    const itOpts: AbstractIteratorOptions = {
      gte: `~project~${projectKey}~`,
      lte: `~project~${projectKey}~~`,
      // newest at the top
      reverse: true,
    };
    const iterator = this.db.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    let lastKey: string | undefined;
    const data: IRevisionInfo[] = [];
    let remaining = limit;

    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const item = this.parent.decodeDocument(value) as any;
        if (item._deleted) {
          continue;
        }
        data.push(item as IRevisionInfo);
        lastKey = key;
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    // // sorts from the latests to oldest
    // data.sort(({ created: a = 0 }, { created: b = 0 }) => b - a);
    const cursor = await this.parent.cursor.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse = {
      data,
      cursor,
    };
    return result;
  }
}
