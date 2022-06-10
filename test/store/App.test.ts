import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import { 
  DefaultLogger, ProjectMock, IAppRequest, IQueryResult, IAppProject,
} from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';

const storePath = path.join('test', 'data', 'units', 'store', 'file');

describe('Unit tests', () => {
  let store: StoreLevelUp;
  const mock = new ProjectMock();

  before(async () => {
    await fs.mkdir(storePath, { recursive: true });
    store = new StoreLevelUp(new DefaultLogger(), storePath);
    await store.initialize();
  });

  after(async () => {
    await store.cleanup();
    await fs.rm(storePath, { recursive: true, force: true });
  });

  describe('StoreLevelUp', () => {
    describe('#app', () => {
      describe('query()', () => {
        const user1 = mock.user.user();
        const appId1 = 'x1b2e3';

        before(async () => {
          await store.user.add(user1.key, user1);
        });

        after(async () => {
          await store.app.requests.db.clear();
          await store.app.projects.db.clear();
          await store.user.db.clear();
        });

        it('finds requests', async () => {
          const p = mock.app.appRequest();
          p.info.name = 'testAppRequest';
          await store.app.requests.create(p, appId1, user1);
          const result = await store.app.query(appId1, user1, { query: 'testAppRequest' });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the request');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppRequest>;
          assert.deepEqual(qr.index, ['doc:info:name'], 'finds request in the name');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });

        it('finds projects', async () => {
          const p = mock.app.appProject();
          p.info.name = 'testAppProject';
          await store.app.projects.create(p, appId1, user1);
          const result = await store.app.query(appId1, user1, { query: 'testAppProject' });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the project');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppProject>;
          assert.deepEqual(qr.index, ['doc:info:name'], 'finds project in the name');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });
      });
    });
  });
});
