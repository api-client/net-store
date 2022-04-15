import { Bytes } from 'leveldown';
import { IUser, IHttpProject, IBackendEvent, RouteBuilder, HttpProjectKind, ApiError, IPatchInfo, IPatchRevision } from '@api-client/core';
import { Patch } from '@api-client/json';
import { SubStore } from '../SubStore.js';
import { KeyGenerator } from '../KeyGenerator.js';
import { IProjectsStore } from './AbstractProject.js';
import Clients, { IClientFilterOptions } from '../../routes/WsClients.js';
import { validatePatch } from '../../lib/Patch.js';

export class Project extends SubStore implements IProjectsStore {
  async cleanup(): Promise<void> {
    await this.db.close();
  }

  async add(key: string, project: IHttpProject): Promise<void> {
    // Project changes are only allowed through `PATCH`.
    let exists = false;
    try {
      await this.db.get(key);
      exists = true;
    } catch (e) {
      // OK
    }
    if (exists) {
      throw new ApiError(`A project with the identifier ${key} already exists.`, 400);
    }
    await this.db.put(key, this.parent.encodeDocument(project));
  }
  
  async read(key: string): Promise<IHttpProject> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    return this.parent.decodeDocument(raw) as IHttpProject;
  }
  
  async delete(key: string, user: IUser): Promise<void> {
    let raw: Bytes;
    try {
      raw = await this.db.get(key);
    } catch (e) {
      throw new ApiError(`Not found.`, 404);
    }
    const data = this.parent.decodeDocument(raw) as any;
    data._deleted = true;
    const deletedKey = KeyGenerator.deletedProjectKey(key);

    // persist the data
    await this.parent.bin.add(deletedKey, user);
    await this.db.put(key, this.parent.encodeDocument(data));

    // notify clients
    const users = await this.parent.file.fileUserIds(key);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'deleted',
      kind: HttpProjectKind,
      id: key,
    };
    const filter: IClientFilterOptions = {
      url: `${RouteBuilder.file(key)}?alt=media`,
      users,
    };
    Clients.notify(event, filter);
  }

  async applyPatch(key: string, info: IPatchInfo, user: IUser): Promise<IPatchRevision> {
    validatePatch(info);
    const prohibited: string[] = ['/_deleted', '/key', '/kind'];
    const invalid = info.patch.find(p => {
      return prohibited.some(path => p.path.startsWith(path));
    });
    if (invalid) {
      throw new ApiError(`Invalid patch path: ${invalid.path}.`, 400);
    }
    const file = await this.read(key);
    const ar = Patch.apply(file, info.patch, { reversible: true });
    const result: IPatchRevision = {
      ...info,
      revert: ar.revert,
    };

    await this.db.put(key, this.parent.encodeDocument(ar.doc));
    await this.parent.revisions.add(file.kind, key, ar.revert, user);

    const users = await this.parent.file.fileUserIds(key);
    const event: IBackendEvent = {
      type: 'event',
      operation: 'patch',
      data: result,
      kind: file.kind,
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
