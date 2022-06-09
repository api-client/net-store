import { AbstractIteratorOptions } from 'abstract-leveldown';
import { IUser, IListResponse, IListOptions, IRevision, IBackendEvent, RevisionKind, ICursorOptions, RouteBuilder } from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import { SubStore } from '../SubStore.js';
import Clients, { IClientFilterOptions } from '../../routes/WsClients.js';
import { KeyGenerator } from '../KeyGenerator.js';
import { IRevisionsStore, AltType } from './AbstractRevisions.js';

/**
 * The part of the store that takes care of the project revision data.
 */
export class Revisions extends SubStore implements IRevisionsStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  /**
   * Adds a project revision information to the store.
   * Note, this does not check whether the user has access to the space.
   * 
   * It notifies WS clients about new revision.
   * 
   * @param key The key of the patched object.
   * @param patch The reversible patch applied to the object.
   */
  async add(kind: string, key: string, patch: JsonPatch, user: IUser, alt: AltType = "media"): Promise<void> {
    const date = new Date();
    const time = date.toJSON();
    const id = KeyGenerator.revisionKey(key, time, alt);
    const info: IRevision = {
      id,
      key: key,
      kind,
      created: date.getTime(),
      deleted: false,
      patch,
      modification: {
        byMe: false,
        time: Date.now(),
        user: user.key,
        name: user.name,
      },
    }
    await this.db.put(id, this.parent.encodeDocument(info));
    const users = await this.parent.file.fileUserIds(key);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'created',
      data: info,
      kind: RevisionKind,
      id,
      parent: key,
    };
    const filter: IClientFilterOptions = {
      url: `${RouteBuilder.file(key)}?alt=${alt}`,
      users,
    };
    Clients.notify(event, filter);
  }

  /**
   * Lists object revisions.
   * 
   * @param key The key of the object.
   * @param user User for authorization.
   * @param options Listing options
   */
  async list(key: string, user: IUser, alt: AltType = "media", options?: IListOptions | ICursorOptions): Promise<IListResponse<IRevision>> {
    await this.parent.file.checkAccess('reader', key, user);
    const state = await this.parent.readListState(options);
    const { limit = this.parent.defaultLimit } = state;
    const itOpts: AbstractIteratorOptions = {
      gte: `~${alt}~${key}~`,
      lte: `~${alt}~${key}~~`,
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
    const data: IRevision[] = [];
    let remaining = limit;

    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const item = this.parent.decodeDocument(value) as any;
        if (item._deleted) {
          continue;
        }
        data.push(item as IRevision);
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
    const result: IListResponse<IRevision> = {
      items: data,
      cursor,
    };
    return result;
  }
}
