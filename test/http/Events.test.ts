import { assert } from 'chai';
import { 
  Workspace, AccessOperation, HttpProject, IUser, StoreSdk, IFile, IWorkspace,
  IHttpProject, RevisionKind, HttpProjectKind, ProjectMock, HttpHistoryKind,
  IHttpHistoryBulkAdd,
} from '@api-client/core';
import { JsonPatch } from '@api-client/json';
import HttpHelper from '../helpers/HttpHelper.js';
import getConfig from '../helpers/getSetup.js';
import { UserFileApp } from './UserFileApp.js';

describe('Events', () => {
  let baseUri: string;
  let baseUriWs: string;
  let sdk: StoreSdk;
  const http = new HttpHelper();
  const mock = new ProjectMock();

  before(async () => {
    const cnf = await getConfig();
    baseUri = cnf.multiUserBaseUri;
    baseUriWs = cnf.multiUserWsBaseUri;
    sdk = new StoreSdk(cnf.multiUserBaseUri);
    sdk.silent = true;
  });

  describe('Filesystem synchronization', () => {
    let user1Token: string;
    let user2Token: string;
    let user3Token: string;
    let user1: IUser;
    let user2: IUser;
    let app1: UserFileApp;
    let app2: UserFileApp;
    let app3: UserFileApp;

    before(async () => {
      user1Token = await http.createUserToken(baseUri);
      user2Token = await http.createUserToken(baseUri);
      user3Token = await http.createUserToken(baseUri);
      sdk.token = user1Token;
      user1 = await sdk.user.me();
      user2 = await sdk.user.me({ token: user2Token });

      app1 = new UserFileApp(user1Token, baseUri, baseUriWs);
      app2 = new UserFileApp(user2Token, baseUri, baseUriWs);
      app3 = new UserFileApp(user3Token, baseUri, baseUriWs);
      await app1.initFiles();
      await app2.initFiles();
      await app3.initFiles();
      await app1.setupSpace();
      await app2.setupSpace();
      await app3.setupSpace();
    });

    after(async () => {
      await app1.finalize();
      await app2.finalize();
      await app3.finalize();

      await http.delete(`${baseUri}/test/reset/files`);
      await http.delete(`${baseUri}/test/reset/projects`);
      await http.delete(`${baseUri}/test/reset/revisions`);
      await http.delete(`${baseUri}/test/reset/users`);
      await http.delete(`${baseUri}/test/reset/sessions`);
    });

    // these tests operates on a shared state for app1 and app2.
    // Each next test assumes the state result from the previous step.
    // (this could be done in a single and very log test but 
    // for readability I decided to split it into sever tests)

    let s1: IWorkspace;
    let s2: IWorkspace;
    let s3: IWorkspace;
    let p1: IHttpProject;
    let p2: IHttpProject;

    it('handles meta create', async () => {
      // create a space for user 1.
      s1 = Workspace.fromName('s1', user1.key).toJSON();
      await sdk.file.create(s1);

      assert.isTrue(app1.hasFile(s1.key), 'app1 has the created space file');
      assert.isFalse(app2.hasFiles(), 'app2 has no files');
    });

    it('handles meta patch', async () => {
      // patch space 1
      const patch: JsonPatch = [
        {
          op: 'replace',
          path: '/info/name',
          value: 'Updated s1',
        }
      ];
      await sdk.file.patch(s1.key, patch, false);
      const u1File = app1.getFile(s1.key) as IFile;
      assert.equal(u1File.info.name, 'Updated s1', 'app1 has patched file');
      assert.isFalse(app2.hasFiles(), 'app2 has no files');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('handles media create', async () => {
      // add a project 1 to the s1 space
      p1 = HttpProject.fromName('p1').toJSON();
      await sdk.file.create(p1, { parent: s1.key });

      assert.isFalse(app1.hasFile(p1.key), 'app1 has the created project file (still in the root)');
      assert.isFalse(app2.hasFiles(), 'app2 has no files');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('handles space share', async () => {
      // share space 1 with user 2
      const records: AccessOperation[] = [{
        op: 'add',
        id: user2.key,
        value: 'reader',
        type: 'user',
      }];
      await sdk.file.patchUsers(s1.key, records);
      const u1File = app1.getFile(s1.key) as IFile;
      assert.lengthOf(u1File.permissionIds, 1, 'app1 has the updated permission');
      await app2.updateComplete;
      assert.isTrue(app2.hasFile(s1.key), 'app2 read the file');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('handles meta patch with shared users', async () => {
      // patch space 1 again
      const patch: JsonPatch = [
        {
          op: 'replace',
          path: '/info/name',
          value: 'New s1',
        }
      ];
      await sdk.file.patch(s1.key, patch, false);
      const u1File = app1.getFile(s1.key) as IFile;
      assert.equal(u1File.info.name, 'New s1', 'app1 has patched file');
      let u2File = app2.getFile(s1.key) as IFile;
      assert.equal(u2File.info.name, 'New s1', 'app2 has patched file');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('switches parent to a space', async () => {
      // switch both apps to space 1
      await app1.setupSpace(s1.key);
      await app2.setupSpace(s1.key);
    });

    it('handles space create when in the parent space', async () => {
      // create a sub-space in space 1
      s2 = Workspace.fromName('s2', user1.key).toJSON();
      await sdk.file.create(s2, { parent: s1.key });
      assert.isTrue(app1.hasFile(s2.key), 'app1 has the created sub-space file');
      assert.isTrue(app2.hasFile(s2.key), 'app2 has the created sub-space file');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('handles project create when in the parent space', async () => {
      // create a project in space 2
      // user 1 stays in space 1, user 2 goes to space 2
      await app2.setupSpace(s2.key);

      p2 = HttpProject.fromName('p2').toJSON();
      await sdk.file.create(p2, { parent: s2.key });

      assert.isFalse(app1.hasFile(p2.key), 'app1 has no file which is not in the same space');
      assert.isTrue(app2.hasFile(p2.key), 'app2 has the project file');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('restores app2 parent state', async () => {
      await app2.setupSpace(s1.key);
    });

    it('shared target receives an event event when in a different space', async () => {
      // user 1 creates a space in the root and shares it with user 2 while the user 2 in in space 1.
      s3 = Workspace.fromName('s3', user1.key).toJSON();
      await sdk.file.create(s3);

      const records: AccessOperation[] = [{
        op: 'add',
        id: user2.key,
        value: 'owner',
        type: 'user',
      }];
      await sdk.file.patchUsers(s3.key, records);

      assert.isFalse(app2.hasFile(s3.key), 'app2 has no file from another space');
      const pathEvent = app2.messages[app2.messages.length - 1];
      const accessEvent = app2.messages[app2.messages.length - 2];
      assert.equal(pathEvent.operation, 'patch', 'app2 got the patch event');
      assert.equal(pathEvent.id, s3.key, 'app2 got the patch event for the space');
      assert.equal(accessEvent.operation, 'access-granted', 'app2 got the access-granted event');
      assert.equal(accessEvent.id, s3.key, 'app2 got the access-granted event for the space');

      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('removes the space from the files when removing an access', async () => {
      assert.isTrue(app2.hasFile(s2.key));
      const records: AccessOperation[] = [{
        op: 'remove',
        id: user2.key,
        type: 'user',
      }];
      await sdk.file.patchUsers(s2.key, records);
      assert.isFalse(app2.hasFile(s2.key));

      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('removes the space from the files when removing the space', async () => {
      await app1.setupSpace(s1.key);
      await app2.setupSpace(s1.key);

      await sdk.file.delete(s2.key);
      
      assert.isFalse(app1.hasFile(s2.key), 'app1 has no file');
      assert.isFalse(app2.hasFile(s2.key), 'app2 has no file');
      assert.isFalse(app3.hasFiles(), 'app3 has no files');
      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });
  });

  describe('Patching a project', () => {
    let user1Token: string;
    let user2Token: string;
    let user3Token: string;
    let user2: IUser;
    let app1: UserFileApp;
    let app2: UserFileApp;
    let app3: UserFileApp;
    let p1: IHttpProject;

    before(async () => {
      user1Token = await http.createUserToken(baseUri);
      user2Token = await http.createUserToken(baseUri);
      user3Token = await http.createUserToken(baseUri);
      sdk.token = user1Token;
      user2 = await sdk.user.me({ token: user2Token });

      app1 = new UserFileApp(user1Token, baseUri, baseUriWs);
      app2 = new UserFileApp(user2Token, baseUri, baseUriWs);
      app3 = new UserFileApp(user3Token, baseUri, baseUriWs);
      
      p1 = HttpProject.fromName('p1').toJSON();
      await sdk.file.create(p1);

      const records: AccessOperation[] = [{
        op: 'add',
        id: user2.key,
        value: 'reader',
        type: 'user',
      }];
      await sdk.file.patchUsers(p1.key, records);

      await app1.setupSpace();
      await app2.setupSpace();
      await app3.setupSpace();

      await app1.initFileContentsClient(p1.key);
      await app2.initFileContentsClient(p1.key);
      await app3.initFiles();
    });

    after(async () => {
      await app1.finalize();
      await app2.finalize();
      await app3.finalize();

      await http.delete(`${baseUri}/test/reset/files`);
      await http.delete(`${baseUri}/test/reset/projects`);
      await http.delete(`${baseUri}/test/reset/revisions`);
      await http.delete(`${baseUri}/test/reset/users`);
      await http.delete(`${baseUri}/test/reset/sessions`);
    });

    it('receives a revision event on a media', async () => {
      const patch: JsonPatch = [
        {
          op: 'replace',
          path: '/info/name',
          value: 'New p1',
        }
      ];
      await sdk.file.patch(p1.key, patch, true);

      // there are two events: the revision and path on the file
      const [app1ev] = app1.messages;
      const [app2ev] = app2.messages;
      
      assert.equal(app1ev.operation, 'created', 'app1 has the created event');
      assert.equal(app1ev.kind, RevisionKind, 'app1 has the revision created event');
      
      assert.equal(app2ev.operation, 'created', 'app2 has the created event');
      assert.equal(app2ev.kind, RevisionKind, 'app1 has the revision created event');

      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });

    it('receives a patch event on a media', async () => {
      const patch: JsonPatch = [
        {
          op: 'replace',
          path: '/info/name',
          value: 'Other p1',
        }
      ];
      await sdk.file.patch(p1.key, patch, true);

      // there are two events: the revision and path on the file
      const [, app1ev] = app1.messages;
      const [, app2ev] = app2.messages;
      
      assert.equal(app1ev.operation, 'patch', 'app1 has the patch event');
      assert.equal(app1ev.kind, HttpProjectKind, 'app1 has the patch event kind');
      
      assert.equal(app2ev.operation, 'patch', 'app2 has the patch event');
      assert.equal(app2ev.kind, HttpProjectKind, 'app1 has the patch event kind');

      assert.isFalse(app3.hasMessages(), 'app3 has no messages');
    });
  });

  describe('History events', () => {
    let user1Token: string;
    let user2Token: string;
    let user3Token: string;
    let user1: IUser;
    let user2: IUser;
    let app1: UserFileApp;
    let app2: UserFileApp;
    let app3: UserFileApp;
    let s1: IWorkspace;
    let p1: IHttpProject;

    before(async () => {
      user1Token = await http.createUserToken(baseUri);
      user2Token = await http.createUserToken(baseUri);
      user3Token = await http.createUserToken(baseUri);
      sdk.token = user1Token;
      user1 = await sdk.user.me();
      user2 = await sdk.user.me({ token: user2Token });

      app1 = new UserFileApp(user1Token, baseUri, baseUriWs);
      app2 = new UserFileApp(user2Token, baseUri, baseUriWs);
      app3 = new UserFileApp(user3Token, baseUri, baseUriWs);

      s1 = Workspace.fromName('s1', user1.key).toJSON();
      await sdk.file.create(s1);
      
      p1 = HttpProject.fromName('p1').toJSON();
      await sdk.file.create(p1, { parent: s1.key });

      const records: AccessOperation[] = [{
        op: 'add',
        id: user2.key,
        value: 'reader',
        type: 'user',
      }];
      await sdk.file.patchUsers(s1.key, records);

      await app1.setupSpace();
      await app2.setupSpace();
      await app3.setupSpace();

      await app1.initHistoryClient();
      await app2.initHistoryClient();
      await app3.initHistoryClient();
    });

    after(async () => {
      await app1.finalize();
      await app2.finalize();
      await app3.finalize();

      await http.delete(`${baseUri}/test/reset/files`);
      await http.delete(`${baseUri}/test/reset/projects`);
      await http.delete(`${baseUri}/test/reset/revisions`);
      await http.delete(`${baseUri}/test/reset/users`);
      await http.delete(`${baseUri}/test/reset/sessions`);
    });

    it('receives events when creating an app history', async () => {
      const item = mock.history.httpHistory({ app: 'test-app' });
      const id = await sdk.history.create(item);

      const [event] = app1.messages;
      assert.ok(event, 'app1 has the event');
      assert.equal(event.kind, HttpHistoryKind, 'is the history kind event');
      assert.equal(event.id, id, 'is the same as created history');
      assert.deepEqual(app2.messages, [], 'app2 has no messages');
      assert.deepEqual(app3.messages, [], 'app3 has no messages');
    });

    it('receives events when creating a space history', async () => {
      app1.reset();
      app2.reset();
      app3.reset();

      const item = mock.history.httpHistory({ space: s1.key });
      const id = await sdk.history.create(item);

      const [event1] = app1.messages;
      assert.ok(event1, 'app1 has the event');
      assert.equal(event1.kind, HttpHistoryKind, 'is the history kind event');
      assert.equal(event1.id, id, 'is the same as created history');
      
      const [event2] = app2.messages;
      assert.ok(event2, 'app2 has the event');
      assert.equal(event2.kind, HttpHistoryKind, 'is the history kind event');
      assert.equal(event2.id, id, 'is the same as created history');
      
      assert.deepEqual(app3.messages, [], 'app3 has no messages');
    });

    it('receives events when creating a project history', async () => {
      app1.reset();
      app2.reset();
      app3.reset();

      const item = mock.history.httpHistory({ project: p1.key });
      const id = await sdk.history.create(item);

      const [event1] = app1.messages;
      assert.ok(event1, 'app1 has the event');
      assert.equal(event1.kind, HttpHistoryKind, 'is the history kind event');
      assert.equal(event1.id, id, 'is the same as created history');
      
      const [event2] = app2.messages;
      assert.ok(event2, 'app2 has the event');
      assert.equal(event2.kind, HttpHistoryKind, 'is the history kind event');
      assert.equal(event2.id, id, 'is the same as created history');
      
      assert.deepEqual(app3.messages, [], 'app3 has no messages');
    });

    it('receives events when creating an app history in bulk', async () => {
      app1.reset();
      app2.reset();
      app3.reset();

      const log1 = mock.projectRequest.log();
      const log2 = mock.projectRequest.log();
      const item: IHttpHistoryBulkAdd = {
        app: 'test-app',
        log: [log1, log2],
      };
      const [id1, id2] = await sdk.history.createBulk(item);

      assert.lengthOf(app1.messages, 2, 'app1 receives 2 events');
      const [event1, event2] = app1.messages;
      assert.ok(event1, 'app1 has event #1');
      assert.equal(event1.kind, HttpHistoryKind, 'event #1 is the history kind event');
      assert.equal(event1.id, id1, 'event #1 is the same as created history');
      assert.ok(event2, 'app1 has event #2');
      assert.equal(event2.kind, HttpHistoryKind, 'event #2 is the history kind event');
      assert.equal(event2.id, id2, 'event #2 is the same as created history');

      assert.deepEqual(app2.messages, [], 'app2 has no messages');
      assert.deepEqual(app3.messages, [], 'app3 has no messages');
    });

    it('receives events when creating a space history in bulk', async () => {
      app1.reset();
      app2.reset();
      app3.reset();

      const log1 = mock.projectRequest.log();
      const log2 = mock.projectRequest.log();
      const item: IHttpHistoryBulkAdd = {
        space: s1.key,
        log: [log1, log2],
      };
      const [id1, id2] = await sdk.history.createBulk(item);

      assert.lengthOf(app1.messages, 2, 'app1 receives 2 events');
      const [event1, event2] = app1.messages;
      assert.ok(event1, 'app1 has event #1');
      assert.equal(event1.kind, HttpHistoryKind, 'event #1 is the history kind event');
      assert.equal(event1.id, id1, 'event #1 is the same as created history');
      assert.ok(event2, 'app1 has event #2');
      assert.equal(event2.kind, HttpHistoryKind, 'event #2 is the history kind event');
      assert.equal(event2.id, id2, 'event #2 is the same as created history');
      
      assert.lengthOf(app2.messages, 2, 'app2 receives 2 events');
      const [event3, event4] = app2.messages;
      assert.ok(event3, 'app1 has event #3');
      assert.equal(event3.kind, HttpHistoryKind, 'event #3 is the history kind event');
      assert.equal(event3.id, id1, 'event #3 is the same as created history');
      assert.ok(event4, 'app1 has event #4');
      assert.equal(event4.kind, HttpHistoryKind, 'event #4 is the history kind event');
      assert.equal(event4.id, id2, 'event #4 is the same as created history');
      
      assert.deepEqual(app3.messages, [], 'app3 has no messages');
    });
  });
});
