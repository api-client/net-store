import { IListResponse, IUser, IListOptions, File, IFile, WorkspaceKind } from '@api-client/core';
import { AbstractIteratorOptions, DelBatch } from 'abstract-leveldown';
import { SubStore } from '../SubStore.js';
import { ISharedStore, ISharedLink } from './AbstractShared.js';
import { KeyGenerator } from '../KeyGenerator.js';
import { validateKinds } from './Validator.js';

/**
 * The store that keeps a reference between a user and items shared with the user.
 * 
 * When a user shares an object with another user this information ends up
 * in this registry to allow iterating over shared items. No actual data is stored here
 * but a reference to the corresponding store.
 * 
 * When a user shares an object with another user, the logic adds
 * the permission object to the target object (the shared object) but to associate
 * the shared entity with a user that has the permission while listing for shared items
 * it also adds an entry in this store. The store lists the shared items and returns 
 * the associated targets.
 * 
 * Keys are built as `~` + shared type + `~` + target user key + `~` + target id + `~`.
 * 
 * The shared type is a constant that describes the object like `space` for spaces.
 * This way it is possible to list objects per user per type.
 */
export class Shared extends SubStore implements ISharedStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  async add(file: IFile, userId: string): Promise<void> {
    const key = KeyGenerator.sharedFile(file.kind, file.key, userId);
    const data: ISharedLink = {
      id: file.key,
      kind: file.kind,
      uid: userId,
    };
    if (file.parents.length) {
      const parent = file.parents[file.parents.length - 1];
      data.parent = parent;
    }
    await this.db.put(key, this.parent.encodeDocument(data));
  }

  async remove(file: IFile, userId: string): Promise<void> {
    const key = KeyGenerator.sharedFile(file.kind, file.key, userId);
    try {
      await this.db.del(key);
    } catch (e) {
      // 
    }
  }

  async list(user: IUser, kinds?: string[], options?: IListOptions): Promise<IListResponse<IFile>> {
    validateKinds(kinds);
    const state = await this.parent.readListState(options);
    let prefixes: string[] | undefined;
    if (Array.isArray(kinds) && kinds.length) {
      const targetKinds = [...kinds];
      if (!targetKinds.includes(WorkspaceKind)) {
        targetKinds.push(WorkspaceKind);
      }
      prefixes = targetKinds.map(i => `~${KeyGenerator.normalizeKind(i)}~${user.key}~`);
    }
    const { limit = this.parent.defaultLimit, parent } = state;
    const ids: string[] = [];
    let remaining = limit;
    let lastKey: string | undefined;
    const itOpts: AbstractIteratorOptions = {
      reverse: true,
    };
    const iterator = this.db.iterator(itOpts);
    if (state.lastKey) {
      iterator.seek(state.lastKey);
      // @ts-ignore
      await iterator.next();
    }
    try {
      // @ts-ignore
      for await (const [key, value] of iterator) {
        const k = key.toString() as string;
        // always set this to the last read key, even if it's not allowed for this query
        // so the next iteration won't read it again 
        lastKey = k;
        if (prefixes) {
          // filter by requested kinds
          const allowed = prefixes.some(p => k.startsWith(p));
          if (!allowed) {
            continue;
          }
        } else if (!k.includes(`~${user.key}~`)) {
          // only allow user's files.
          continue;
        }
        const obj = JSON.parse(value) as ISharedLink;
        if (obj.parent && parent && obj.parent !== parent) {
          continue;
        } else if ((!obj.parent && parent) || (!parent && obj.parent)) {
          continue;
        }
        ids.push(obj.id);
        remaining -= 1;
        if (!remaining) {
          break;
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    const cursor = await this.parent.cursor.encodeCursor(state, lastKey || state.lastKey);
    const result: IListResponse<IFile> = {
      items: [],
      cursor,
    };
    const files = await this.parent.file.db.getMany(ids);
    for (const item of files) {
      if (!item) {
        // this only can happen when the data is out of sync.
        // this should be fixed.
        this.parent.logger.warn(`Shared data out of sync. A file does not exist.`);
        continue;
      }
      const file = this.parent.decodeDocument(item) as IFile;
      const role = await this.parent.file.readFileAccess(file, user.key);
      file.permissions = await this.parent.permission.list(file.permissionIds);
      file.capabilities = File.createFileCapabilities(file, role);
      File.updateByMeMeta(file, user.key);
      result.items.push(file);
    }
    return result;
  }

  async deleteByTarget(targetKey: string): Promise<void> {
    const ops: DelBatch[] = [];
    const suffix = `~${targetKey}~`;
    const itOpts: AbstractIteratorOptions = {
      values: false,
    };
    const iterator = this.db.iterator(itOpts);
    try {
      // @ts-ignore
      for await (const [key] of iterator) {
        const k = key.toString() as string;
        if (k.endsWith(suffix)) {
          ops.push({
            key: k,
            type: 'del',
          });
        }
      }
    } catch (e) {
      this.parent.logger.error(e);
    }
    if (ops.length) {
      await this.db.batch(ops);
    }
  }
}
