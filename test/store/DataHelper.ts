import { IHttpHistory, ProjectMock, IHttpHistoryListInit } from '@api-client/core';
import { PutBatch } from 'abstract-leveldown';
import { DataStoreType, StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';

const mock = new ProjectMock();

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
}
