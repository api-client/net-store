import { Bytes } from 'leveldown';
import { IUser, IBackendEvent, RouteBuilder, ApiError, IPatchInfo, IPatchRevision } from '@api-client/core';
import { Patch } from '@api-client/json';
import { SubStore } from '../SubStore.js';
import { KeyGenerator } from '../KeyGenerator.js';
import { IAbstractMedia, IStoredMedia, IMediaReadOptions } from './AbstractMedia.js';
import Clients, { IClientFilterOptions } from '../../routes/WsClients.js';
import { validatePatch } from '../../lib/Patch.js';

/**
 * A media is the contents of a File.
 * Keys are the same as for a file but kept in a different namespace.
 */
export class Media extends SubStore implements IAbstractMedia {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  async set(key: string, contents: unknown, mime: string, allowOverwrite: boolean = true): Promise<void> {
    if (allowOverwrite === false) {
      let exists = false;
      try {
        await this.db.get(key);
        exists = true;
      } catch (e) {
        // OK
      }
      if (exists) {
        const err = new ApiError(`A file with the identifier ${key} already exists.`, 400);
        err.detail = 'To update this file use the PATCH request. We do not allow overwriting the entire file contents.';
        throw err;
      }
    }
    const data: IStoredMedia = {
      value: contents,
      mime,
    }
    await this.db.put(key, this.parent.encodeDocument(data));
  }

  async read(key: string, opts: IMediaReadOptions = {}): Promise<IStoredMedia> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      const err = new ApiError(`Not found.`, 404);
      err.detail = 'The file was not found in the store or you have no read access to the file.';
      throw err;
    }
    const data = this.parent.decodeDocument(raw) as IStoredMedia;
    if (!opts.deleted && data.deleted) {
      const err = new ApiError(`Not found.`, 404);
      err.detail = 'The file was removed. Restore the file from the bin before reading it.';
      throw err;
    }
    return data;
  }

  async delete(key: string, kind: string, user: IUser): Promise<void> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      const err = new ApiError(`Not found.`, 404);
      err.detail = 'The file was not found in the store or you have no owner access to the file.';
      throw err;
    }
    const data = this.parent.decodeDocument(raw) as IStoredMedia;
    data.deleted = true;
    const deletedKey = KeyGenerator.deletedKey(kind, key);

    // persist the data
    await this.parent.bin.add(deletedKey, user);
    await this.db.put(key, this.parent.encodeDocument(data));

    // notify clients
    const users = await this.parent.file.fileUserIds(key);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      url: `${RouteBuilder.file(key)}?alt=media`,
      users,
    };
    Clients.notify(event, filter);
  }

  async applyPatch(key: string, kind: string, info: IPatchInfo, user: IUser): Promise<IPatchRevision> {
    validatePatch(info);
    const prohibited: string[] = ['/key', '/kind'];
    const invalid = info.patch.find(p => {
      return prohibited.some(path => p.path.startsWith(path));
    });
    if (invalid) {
      const err = new ApiError(`Invalid patch path: ${invalid.path}.`, 400);
      err.detail = 'Certain properties are restricted from patching like "key" or "kind".';
      throw err;
    }

    const data = await this.read(key);
    const ar = Patch.apply(data.value, info.patch, { reversible: true });
    data.value = ar.doc;

    await this.db.put(key, this.parent.encodeDocument(data));
    // revisions uses the File kinds
    await this.parent.revisions.add(kind, key, ar.revert, user);

    const result: IPatchRevision = {
      ...info,
      revert: ar.revert,
    };
    const users = await this.parent.file.fileUserIds(key);
    // when informing WS clients we prefer to use the media kind, if any. 
    const mediaKind = (data.value as any).kind || kind;
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: result,
      kind: mediaKind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      url: `${RouteBuilder.file(key)}?alt=media`,
      users,
    };
    Clients.notify(event, filter);
    return result;
  }
}
