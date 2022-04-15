import { assert } from 'chai';
import fs from 'fs/promises';
import path from 'path';
import sinon from 'sinon';
import { ApiError, DefaultLogger, ProjectMock, IHttpProject, HttpProject, IBackendEvent, RouteBuilder, HttpProjectKind, IPatchInfo, IPatchRevision } from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import { StoreLevelUp } from '../../src/persistence/StoreLevelUp.js';
import { KeyGenerator } from '../../src/persistence/KeyGenerator.js';
import { DataHelper } from '../helpers/DataHelper.js';
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
        after(async () => {
          await store.project.db.clear();
        });

        it('creates a new project', async () => {
          const project = HttpProject.fromName('test');
          await store.project.add(project.key, project.toJSON());
          const readResult = await store.project.read(project.key);
          assert.deepEqual(readResult, project.toJSON());
        });

        it('throws when re-creating the same project', async () => {
          const project = HttpProject.fromName('test');
          await store.project.add(project.key, project.toJSON());
          let error: ApiError | undefined;
          try {
            await store.project.add(project.key, project.toJSON());
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `A project with the identifier ${project.key} already exists.`);
            assert.equal(error.code, 400);
          }
        });
      });

      describe('read()', () => {
        let project: IHttpProject;
        before(async () => {
          const data = HttpProject.fromName('test');
          project = data.toJSON();
          await store.project.add(project.key, project);
        });

        it('reads the project', async () => {
          const result = await store.project.read(project.key);
          assert.deepEqual(result, project);
        });

        it('throws when no content', async () => {
          let error: ApiError | undefined;
          try {
            await store.project.read('unknown');
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });
      });

      describe('delete()', () => {
        const user1 = mock.user.user();
        let project: IHttpProject;
        before(async () => {
          await store.user.add(user1.key, user1);
        });

        after(async () => {
          await store.project.db.clear();
          await store.user.db.clear();
          await store.bin.db.clear();
          await store.file.db.clear();
        });

        beforeEach(async () => {
          const data = HttpProject.fromName('test');
          project = data.toJSON();
          await DataHelper.addProject(store, data, user1);
        });

        it('marks the project as deleted', async () => {
          await store.project.delete(project.key, user1);
          const data = await store.project.read(project.key) as any;
          assert.isTrue(data._deleted);
        });

        it('adds the project to the bin', async () => {
          await store.project.delete(project.key, user1);
          const deletedKey = KeyGenerator.deletedProjectKey(project.key);
          const raw = await store.bin.db.get(deletedKey);
          assert.ok(raw);
        });

        it('throws when no content', async () => {
          let error: ApiError | undefined;
          try {
            await store.project.delete('unknown', user1);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('informs the WS client', async () => {
          const spy = sinon.spy(Clients, 'notify');
          try {
            await store.project.delete(project.key, user1);
          } finally {
            spy.restore();
          }
          assert.isTrue(spy.calledOnce, 'Calls the notify function');
          const event = spy.args[0][0] as IBackendEvent;
          const filter = spy.args[0][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'deleted');
          assert.equal(event.kind, HttpProjectKind);
          const apiPath = `${RouteBuilder.file(project.key)}?alt=media`;
          assert.equal(filter.url, apiPath);
        });
      });

      describe('applyPatch()', () => {
        const user = mock.user.user();
        let project: IHttpProject;
        before(async () => {
          await store.user.add(user.key, user);
        });

        after(async () => {
          await store.project.db.clear();
          await store.user.db.clear();
          await store.file.db.clear();
          await store.revisions.db.clear();
        });

        beforeEach(async () => {
          const data = HttpProject.fromName('test');
          project = data.toJSON();
          await DataHelper.addProject(store, data, user);
        });

        it('returns the patch info', async () => {
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          const result = await store.project.applyPatch(project.key, info, user);
          assert.typeOf(result, 'object', 'returns the info object');
          assert.equal(result.app, 'x1', 'returns the passed app');
          assert.equal(result.appVersion, '1', 'returns the passed appVersion');
          assert.equal(result.id, '123', 'returns the passed id');
          assert.deepEqual(result.patch, patch, 'returns the passed patch');
          assert.typeOf(result.revert, 'array', 'has the revert info');
        });

        it('persists the data', async () => {
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'Other name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          await store.project.applyPatch(project.key, info, user);
          const result = await store.project.read(project.key);
          assert.equal(result.info.name, 'Other name', 'has the applied patch');
        });

        it('throws when no content', async () => {
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          let error: ApiError | undefined;
          try {
            await store.project.applyPatch('unknown', info, user);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Not found.`);
            assert.equal(error.code, 404);
          }
        });

        it('throws when no app property', async () => {
          const patch: JsonPatch = [{ op: 'replace', path: '/info/name', value: 'New name' }];
          const info: IPatchInfo = {
            // @ts-ignore
            app: undefined,
            appVersion: '1',
            id: '123',
            patch,
          };
          let error: ApiError | undefined;
          try {
            await store.project.applyPatch(project.key, info, user);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Invalid patch schema. Missing "app" property.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when no app property', async () => {
          const patch: JsonPatch = [{ op: 'replace', path: '/info/name', value: 'New name' }];
          const info: IPatchInfo = {
            app: 'x1',
            // @ts-ignore
            appVersion: undefined,
            id: '123',
            patch,
          };
          let error: ApiError | undefined;
          try {
            await store.project.applyPatch(project.key, info, user);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Invalid patch schema. Missing "appVersion" property.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when no app property', async () => {
          const patch: JsonPatch = [{ op: 'replace', path: '/info/name', value: 'New name' }];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            // @ts-ignore
            id: undefined,
            patch,
          };
          let error: ApiError | undefined;
          try {
            await store.project.applyPatch(project.key, info, user);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Invalid patch schema. Missing "id" property.`);
            assert.equal(error.code, 400);
          }
        });

        it('throws when invalid patch', async () => {
          let error: ApiError | undefined;
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            // @ts-ignore
            patch: {},
          };
          try {
            await store.project.applyPatch(project.key, info, user);
          } catch (e) {
            error = e as ApiError;
          }
          assert.ok(error, 'has the error');
          if (error) {
            assert.equal(error.message, `Malformed patch information.`);
            assert.equal(error.code, 400);
          }
        });

        [
          '/_deleted', '/key', '/kind'
        ].forEach((key) => {
          it(`throws when patching ${key}`, async () => {
            let error: ApiError | undefined;
            const info: IPatchInfo = {
              app: 'x1',
              appVersion: '1',
              id: '123',
              patch: [{ op: 'replace', path: key, value: 'test' }],
            };
            try {
              await store.project.applyPatch(project.key, info, user);
            } catch (e) {
              error = e as ApiError;
            }
            assert.ok(error, 'has the error');
            if (error) {
              assert.equal(error.message, `Invalid patch path: ${key}.`);
              assert.equal(error.code, 400);
            }
          });
        });

        it('adds a revision', async () => {
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          await store.project.applyPatch(project.key, info, user);
          const list = await store.revisions.list(project.key, user);
          const { data } = list;
          assert.lengthOf(data, 1, 'has the revision');
        });

        it('informs the WS client', async () => {
          const spy = sinon.spy(Clients, 'notify');
          const patch: JsonPatch = [
            {
              op: 'replace',
              path: '/info/name',
              value: 'New name',
            }
          ];
          const info: IPatchInfo = {
            app: 'x1',
            appVersion: '1',
            id: '123',
            patch,
          };
          try {
            await store.project.applyPatch(project.key, info, user);
          } finally {
            spy.restore();
          }
          // revision + delete
          assert.equal(spy.callCount, 2, 'Calls the notify function');
          const event = spy.args[1][0] as IBackendEvent;
          const filter = spy.args[1][1] as IClientFilterOptions;
          assert.equal(event.type, 'event');
          assert.equal(event.operation, 'patch');
          assert.equal(event.kind, HttpProjectKind);
          assert.equal(event.id, project.key);

          const data = event.data as IPatchRevision;

          assert.typeOf(data, 'object', 'returns the info object');
          assert.equal(data.app, 'x1', 'returns the passed app');
          assert.equal(data.appVersion, '1', 'returns the passed appVersion');
          assert.equal(data.id, '123', 'returns the passed id');
          assert.deepEqual(data.patch, patch, 'returns the passed patch');
          assert.typeOf(data.revert, 'array', 'has the revert info');

          const apiPath = `${RouteBuilder.file(project.key)}?alt=media`;
          assert.equal(filter.url, apiPath);
        });
      });
    });
  });
});
