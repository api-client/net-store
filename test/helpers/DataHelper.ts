import { 
  IHttpHistory, ProjectMock, IHttpHistoryListInit, IWorkspace, Workspace,
  IHttpProject, HttpProject, IRevisionInfo, HttpProjectKind, IHttpProjectListItem,
  Permission, PermissionRole, PermissionType, IUser,
} from '@api-client/core';
import { PutBatch } from 'abstract-leveldown';
import { DataStoreType, StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { ISharedLink } from '../../src/persistence/LevelSharedStore.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';

const mock = new ProjectMock();

const roles: PermissionRole[] = ["reader", "commenter", "writer", "owner"];
const types: PermissionType[] = ["anyone", "group", "user"];

export interface ISharedSpacesInit {
  size?: number;
  owner?: string;
  target?: string;
  type?: PermissionType;
  role?: PermissionRole;
}

export class DataHelper {
  static async clearAllHistory(store: StoreLevelUp): Promise<void> {
    await store.history.data.clear();
    await store.history.space.clear();
    await store.history.project.clear();
    await store.history.request.clear();
    await store.history.app.clear();
  }

  static async clearAllProjects(store: StoreLevelUp): Promise<void> {
    await store.project.data.clear();
    await store.project.index.clear();
  }

  static async clearSpaces(store: StoreLevelUp): Promise<void> {
    await store.space.db.clear();
  }

  static async clearRevisions(store: StoreLevelUp): Promise<void> {
    await store.revisions.db.clear();
  }

  static async clearBin(store: StoreLevelUp): Promise<void> {
    await store.bin.db.clear();
  }

  static async addHistory(store: DataStoreType, size=25, opts?: IHttpHistoryListInit): Promise<IHttpHistory[]> {
    const list = mock.history.httpHistoryList(size, opts);
    await this.insertHistory(store, list);
    return list;
  }

  static async insertHistory(store: DataStoreType, list: IHttpHistory[]): Promise<string[]> {
    const ids: string[] = [];
    const data: PutBatch[] = list.map((item) => {
      const date = new Date(item.created);
      const time = date.toJSON();
      if (!item.user) {
        item.user = mock.types.uuid();
      }
      const dataKey = KeyGenerator.historyDataKey(time, item.user as string);
      const encodedKey = Buffer.from(dataKey).toString('base64url');
      item.key = encodedKey;
      ids.push(dataKey);
      return {
        key: dataKey,
        type: 'put',
        value: JSON.stringify(item),
      }
    });
    await store.batch(data);
    return ids;
  }

  static getHistoryEncodedKey(item: IHttpHistory): string {
    const date = new Date(item.created);
    const time = date.toJSON();
    const dataKey = KeyGenerator.historyDataKey(time, item.user as string);
    return Buffer.from(dataKey).toString('base64url');
  }

  static async insertSpaceHistory(store: DataStoreType, history: IHttpHistory[]): Promise<void> {
    const data: PutBatch[] = [];
    history.forEach((item) => {
      if (item.space) {
        const date = new Date(item.created);
        const time = date.toJSON();
        const spaceKey = KeyGenerator.historySpaceKey(time, item.space, item.user as string);
        const dataKey = KeyGenerator.historyDataKey(time, item.user as string);
        data.push({
          key: spaceKey,
          type: 'put',
          value: dataKey,
        });
      }
    });
    if (data.length) {
      await store.batch(data);
    }
  }

  static async insertProjectHistory(store: DataStoreType, history: IHttpHistory[]): Promise<void> {
    const data: PutBatch[] = [];
    history.forEach((item) => {
      if (item.project) {
        const date = new Date(item.created);
        const time = date.toJSON();
        const projectKey = KeyGenerator.historyProjectKey(time, item.project, item.user as string);
        const dataKey = KeyGenerator.historyDataKey(time, item.user as string);
        data.push({
          key: projectKey,
          type: 'put',
          value: dataKey,
        });
      }
    });
    if (data.length) {
      await store.batch(data);
    }
  }

  static async insertRequestHistory(store: DataStoreType, history: IHttpHistory[]): Promise<void> {
    const data: PutBatch[] = [];
    history.forEach((item) => {
      if (item.request) {
        const date = new Date(item.created);
        const time = date.toJSON();
        const requestKey = KeyGenerator.historyRequestKey(time, item.request, item.user as string);
        const dataKey = KeyGenerator.historyDataKey(time, item.user as string);
        data.push({
          key: requestKey,
          type: 'put',
          value: dataKey,
        });
      }
    });
    if (data.length) {
      await store.batch(data);
    }
  }

  static async insertAppHistory(store: DataStoreType, history: IHttpHistory[]): Promise<void> {
    const data: PutBatch[] = [];
    history.forEach((item) => {
      if (item.app) {
        const date = new Date(item.created);
        const time = date.toJSON();
        const appKey = KeyGenerator.historyAppKey(time, item.app, item.user as string);
        const dataKey = KeyGenerator.historyDataKey(time, item.user as string);
        data.push({
          key: appKey,
          type: 'put',
          value: dataKey,
        });
      }
    });
    if (data.length) {
      await store.batch(data);
    }
  }

  static async generateSpaces(store: StoreLevelUp, size=25, owner?: string): Promise<IWorkspace[]> {
    const data: PutBatch[] = [];
    const result: IWorkspace[] = [];
    for (let i = 0; i < size; i++) {
      const name = mock.lorem.word();
      const workspace = Workspace.fromName(name, owner);
      result.push(workspace.toJSON());
      data.push({
        type: 'put',
        key: workspace.key,
        value: JSON.stringify(workspace),
      });
    }
    await store.space.db.batch(data);
    return result;
  }

  static async generateProjects(store: StoreLevelUp, spaceKey: string, size=25): Promise<IHttpProject[]> {
    const data: PutBatch[] = [];
    const index: PutBatch[] = [];
    const result: IHttpProject[] = [];
    for (let i = 0; i < size; i++) {
      const name = mock.lorem.word();
      const project = HttpProject.fromName(name);
      const finalKey = `~${spaceKey}~${project.key}~`;
      result.push(project.toJSON());
      data.push({
        type: 'put',
        key: finalKey,
        value: JSON.stringify(project),
      });
      const item: IHttpProjectListItem = {
        key: project.key,
        name: project.info.name || 'Unnamed project',
        updated: Date.now(),
      };
      index.push({
        type: 'put',
        key: finalKey,
        value: JSON.stringify(item),
      });
    }
    await store.project.index.batch(index);
    await store.project.data.batch(data);

    return result;
  }

  static async generateRevisions(store: StoreLevelUp, projectKey: string, size=25): Promise<void> {
    const data: PutBatch[] = [];
    const result: IRevisionInfo[] = [];
    let created = Date.now();
    for (let i = 0; i < size; i++) {
      created += mock.types.number({ min: 1, max: 10000 });
      const id = `~project~${projectKey}~${created}~`;
      const patch: any = {
        op: 'replace',
        path: '/info/name',
        value: mock.lorem.word(),
      };
      const info: IRevisionInfo = {
        id,
        key: projectKey,
        kind: HttpProjectKind,
        created,
        deleted: false,
        patch,
      };
      result.push(info);
      data.push({
        type: 'put',
        key: id,
        value: JSON.stringify(info),
      });
    }
    await store.revisions.db.batch(data);
  }

  static async generateSharedSpaces(store: StoreLevelUp, opts: ISharedSpacesInit = {}): Promise<IWorkspace[]> {
    const { size = 25, owner, target, type, role } = opts;
    const spacesData: PutBatch[] = [];
    const permissionData: PutBatch[] = [];
    const sharedData: PutBatch[] = [];
    const result: IWorkspace[] = [];
    for (let i = 0; i < size; i++) {
      const name = mock.lorem.word();
      const workspace = Workspace.fromName(name, owner);

      const tid = target || mock.types.uuid();
      const permission = Permission.fromValues({
        addingUser: owner || mock.types.uuid(),
        type: type || mock.random.pickOne(types),
        role: role || mock.random.pickOne(roles),
        owner: tid,
      }).toJSON();
      workspace.permissionIds.push(permission.key);
      workspace.permissions.push(permission);

      const shared: ISharedLink = {
        id: workspace.key,
        uid: tid,
      };

      result.push(workspace.toJSON());
      spacesData.push({
        type: 'put',
        key: workspace.key,
        value: JSON.stringify(workspace),
      });
      permissionData.push({
        type: 'put',
        key: permission.key,
        value: JSON.stringify(permission),
      });
      sharedData.push({
        type: 'put',
        key: KeyGenerator.sharedSpace(workspace.key, tid),
        value: JSON.stringify(shared),
      });
    }
    await store.space.db.batch(spacesData);
    await store.permission.db.batch(permissionData);
    await store.shared.db.batch(sharedData);
    return result;
  }

  static async generateUsers(store: StoreLevelUp, size = 5): Promise<IUser[]> {
    const result: IUser[] = [];
    const data: PutBatch[] = [];
    for (let i = 0; i < size; i++) {
      const user = mock.user.user();
      result.push(user);
      data.push({
        key: user.key,
        type: 'put',
        value: JSON.stringify(user),
      });
    }
    await store.user.db.batch(data);
    return result;
  }
}
