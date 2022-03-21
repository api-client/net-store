import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import sinon from 'sinon';
import { DefaultLogger, ProjectMock, IHttpProjectListItem, Workspace, HttpProject, IBackendEvent, HttpProjectListItemKind, RouteBuilder } from '@api-client/core';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';
import { DataHelper } from './DataHelper.js';
import { ApiError } from '../../src/ApiError.js';
import Clients, { IClientFilterOptions } from '../../src/routes/WsClients.js';

const storePath = path.join('test', 'data', 'units', 'store', 'project');

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
    describe('#project', () => {
      describe('add()', () => {
        const user1 = mock.user.user();
        const user2 = mock.user.user();
        const user3 = mock.user.user();
        const user4 = mock.user.user();
        const user5 = mock.user.user();
        let space1Id: string;

        before(async () => {
          await store.user.add(user1.key, user1);
          await store.user.add(user2.key, user2);
          await store.user.add(user3.key, user3);
          await store.user.add(user4.key, user4);
          await store.user.add(user5.key, user5);
          const space1 = Workspace.fromName('test1');
          space1Id = space1.key;
          await store.space.add(space1Id, space1.toJSON(), user1, 'owner');
          // add user #3 read access to the space
          await store.space.patchUsers(space1Id, [{ op: 'add', uid: user3.key, value: 'read' }], user1);
          // add user #4 comment access to the space
          await store.space.patchUsers(space1Id, [{ op: 'add', uid: user4.key, value: 'comment' }], user1);
          // add user #5 write access to the space
          await store.space.patchUsers(space1Id, [{ op: 'add', uid: user5.key, value: 'write' }], user1);
        });

        after(async () => {
          await DataHelper.clearAllProjects(store);
          await store.user.db.clear();
          await store.space.db.clear();
        });

        it('creates a new project', async () => {
          const project = HttpProject.fromName('test').toJSON();
          await store.project.add(space1Id, project.key, project, user1);
          const readResult = await store.project.read(space1Id, project.key, user1);
          assert.deepEqual(readResult, project);
        });

        it('throws when re-creating the same project', async () => {
          const project = HttpProject.fromName('test').toJSON();
          await store.project.add(space1Id, project.key, project, user1);
          let error: ApiError | undefined;
          try {
            await store.project.add(space1Id, project.key, project, user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `A project with the identifier ${project.key} already exists.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when has no access to the space', async () => {
          const project = HttpProject.fromName('test').toJSON();
          let error: ApiError | undefined;
          try {
            await store.project.add(space1Id, project.key, project, user2);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when the user has a read access to the space', async () => {
          const project = HttpProject.fromName('test').toJSON();
          let error: ApiError | undefined;
          try {
            await store.project.add(space1Id, project.key, project, user3);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('throws when the user has a comment access to the space', async () => {
          const project = HttpProject.fromName('test').toJSON();
          let error: ApiError | undefined;
          try {
            await store.project.add(space1Id, project.key, project, user4);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Insufficient permissions to access this resource.`);
            assert.equal(error.code, 403);
          }
        });

        it('creates a new project by a user with the write access', async () => {
          const project = HttpProject.fromName('test').toJSON();
          await store.project.add(space1Id, project.key, project, user5);
          const readResult = await store.project.read(space1Id, project.key, user5);
          assert.deepEqual(readResult, project);
        });

        it('adds the index object with the add operation', async () => {
          const project = HttpProject.fromName('test').toJSON();
          const finalKey = KeyGenerator.projectKey(space1Id, project.key);
          await store.project.add(space1Id, project.key, project, user1);
          const readResult = await store.project.index.get(finalKey);
          const index = JSON.parse(readResult.toString()) as IHttpProjectListItem;
          assert.equal(index.key, project.key, 'has the key');
          assert.equal(index.name, 'test', 'has the name');
          assert.typeOf(index.updated, 'number', 'has the updated');
        });

        it('informs the WS client', async () => {
          const spy = sinon.spy(Clients, 'notify');
          const project = HttpProject.fromName('test').toJSON();
          try {
            await store.project.add(space1Id, project.key, project, user1);
          } finally {
            // @ts-ignore
            Clients.notify.restore();
          }
          assert.isTrue(spy.calledOnce, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'created');
          assert.typeOf(event.data, 'object');
          assert.equal(event.kind, HttpProjectListItemKind);
          const apiPath = RouteBuilder.space(space1Id);
          assert.equal(filter.url, apiPath);
        });
      });
    });
  });
});
