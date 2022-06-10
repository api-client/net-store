import { 
  IHttpHistory, ProjectMock, IHttpHistoryListInit, IWorkspace, Workspace,
  IRevision, HttpProjectKind, Project, HttpProject,
  Permission, PermissionRole, PermissionType, IUser, IHttpProject, IAppProject, IAppRequest
} from '@api-client/core';
import { PutBatch } from 'abstract-leveldown';
import { DataStoreType, StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { ISharedLink } from '../../src/persistence/level/AbstractShared.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';
import { IFileAddOptions } from '../../src/persistence/level/AbstractFiles.js';
import { IAppProjectInit, IAppRequestInit } from '@api-client/core/build/src/mocking/lib/App.js';

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

  static async clearFiles(store: StoreLevelUp): Promise<void> {
    await store.file.db.clear();
  }

  static async clearRevisions(store: StoreLevelUp): Promise<void> {
    await store.revisions.db.clear();
  }

  static async clearBin(store: StoreLevelUp): Promise<void> {
    await store.bin.db.clear();
  }

  static async addProject(store: StoreLevelUp, project: HttpProject, user: IUser, parent?: string): Promise<void> {
    const opts: IFileAddOptions = {};
    if (parent) {
      opts.parent = parent;
    }
    const file = Project.fromProject(project).toJSON();
    await store.file.add(file.key, file, user, opts);
    await store.media.set(project.key, project.toJSON(), 'application/json');
  }

  static async addHistory(store: DataStoreType, size=25, opts?: IHttpHistoryListInit): Promise<IHttpHistory[]> {
    const list = await mock.history.httpHistoryList(size, opts);
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

  static async generateSpaces(store: StoreLevelUp, owner: string, size=25): Promise<IWorkspace[]> {
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
    await store.file.db.batch(data);
    return result;
  }

  static async generateProjects(store: StoreLevelUp, owner: string, size=25, parent?: string): Promise<IHttpProject[]> {
    const files: PutBatch[] = [];
    const media: PutBatch[] = [];
    const result: IHttpProject[] = [];
    for (let i = 0; i < size; i++) {
      const name = mock.lorem.word();
      const project = HttpProject.fromName(name);
      const file = Project.fromProject(project).toJSON();
      file.owner = owner;
      if (parent) {
        file.parents = [parent];
      }
      result.push(project.toJSON());
      files.push({
        type: 'put',
        key: project.key,
        value: JSON.stringify(file),
      });
      media.push({
        type: 'put',
        key: project.key,
        value: JSON.stringify({
          value: project,
          mime: 'application/json',
        }),
      });
    }
    await store.media.db.batch(media);
    await store.file.db.batch(files);

    return result;
  }

  static async generateRevisions(store: StoreLevelUp, projectKey: string, size=25): Promise<void> {
    const data: PutBatch[] = [];
    const result: IRevision[] = [];
    let created = Date.now();
    for (let i = 0; i < size; i++) {
      created += mock.types.number({ min: 1, max: 10000 });
      const id = `~media~${projectKey}~${created}~`;
      const patch: any = {
        op: 'replace',
        path: '/info/name',
        value: mock.lorem.word(),
      };
      const info: IRevision = {
        id,
        key: projectKey,
        kind: HttpProjectKind,
        created,
        deleted: false,
        patch,
        modification: {
          time: created,
          byMe: false,
          user: mock.types.uuid(),
        },
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
      const workspace = Workspace.fromName(name, owner).toJSON();

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
        kind: workspace.kind,
        uid: tid,
      };

      result.push(workspace);
      spacesData.push({
        type: 'put',
        key: workspace.key,
        value: JSON.stringify({ ...workspace, permissions: []}),
      });
      permissionData.push({
        type: 'put',
        key: permission.key,
        value: JSON.stringify(permission),
      });
      sharedData.push({
        type: 'put',
        key: KeyGenerator.sharedFile(workspace.kind, workspace.key, tid),
        value: JSON.stringify(shared),
      });
    }
    
    await store.file.db.batch(spacesData);
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

  static async generateAppProjects(store: StoreLevelUp, app: string, user: IUser, size?: number, init?: IAppProjectInit): Promise<IAppProject[]> {
    const projects = mock.app.appProjects(size, init);
    await store.app.projects.createBatch(projects, app, user);
    return projects;
  }

  static async generateAppRequests(store: StoreLevelUp, app: string, user: IUser, size?: number, init?: IAppRequestInit): Promise<IAppRequest[]> {
    const requests = mock.app.appRequests(size, init);
    await store.app.requests.createBatch(requests, app, user);
    return requests;
  }
}
