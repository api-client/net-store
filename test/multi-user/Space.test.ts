/* eslint-disable import/no-named-as-default-member */
import { assert } from 'chai';
import { IWorkspace } from '@advanced-rest-client/core';
import { JsonPatch } from 'json8-patch';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';
import { IListResponse } from '../../index.js';

describe('Multi user', () => {
  describe('/spaces/space', () => {
    let baseUri: string;
    const http = new HttpHelper();

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
    });

    describe('GET /spaces/space', () => {
      let created: IWorkspace[];
      let user1Token: string;

      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        await http.post(`${baseUri}/test/generate/spaces?size=4`, {
          token: user1Token,
        });
        const result = await http.get(`${baseUri}/spaces`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has the 200 status');
        const list = JSON.parse(result.body as string) as IListResponse;
        created = list.data as IWorkspace[];
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
        await http.delete(`${baseUri}/test/reset/users`);
      });

      it('reads a space info', async () => {
        const srcSpace = created[0];
        const result = await http.get(`${baseUri}/spaces/${srcSpace.key}`, {
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IWorkspace;
        assert.deepEqual(space, srcSpace, 'returns the space');
      });

      it('returns 404 when no space', async () => {
        const result = await http.get(`${baseUri}/spaces/1234567890`, {
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found');
      });

      it('returns 401 when no credentials', async () => {
        const srcSpace = created[0];
        const result = await http.get(`${baseUri}/spaces/${srcSpace.key}`);
        assert.equal(result.status, 401, 'has 401 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'The client is not authorized to access this resource.');
      });
    });

    describe('PATCH /spaces/space', () => {
      let created: IWorkspace[];
      let other: IWorkspace[];
      let user1Token: string;

      // note: generate as many spaces as tests you perform
      // not have a "fresh" (or rather consistent) records in the data store.
      before(async () => {
        user1Token = await http.createUserToken(baseUri);
        const rawCreated = await http.post(`${baseUri}/test/generate/spaces?size=4`, {
          token: user1Token,
        });
        created = JSON.parse(rawCreated.body as string);
        const rawOther = await http.post(`${baseUri}/test/generate/spaces?size=1&owner=test`);
        other = JSON.parse(rawOther.body as string);
      });

      after(async () => {
        await http.delete(`${baseUri}/test/reset/spaces`);
      });

      it('patches the space', async () => {
        const srcSpace = created[0];
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'New name',
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/${srcSpace.key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 200, 'has 200 status code');
        const body = JSON.parse(result.body as string);
        assert.equal(body.status, 'OK', 'has the OK status');
        assert.typeOf(body.revert, 'array', 'has the revert patch');
      });

      it('patches the space in the store', async () => {
        const srcSpace = created[1];
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        await http.patch(`${baseUri}/spaces/${srcSpace.key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        const result = await http.get(`${baseUri}/spaces/${srcSpace.key}`, {
          token: user1Token,
        });
        
        assert.equal(result.status, 200, 'has 200 status code');
        const space = JSON.parse(result.body as string) as IWorkspace;
        assert.equal(space.info.name, 'Other name', 'has the applied patch');
      });

      it('returns 404 when no space', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/1234567890`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found');
      });

      it('returns 404 when accessing a workspace without access ', async () => {
        const patch: JsonPatch = [
          {
            op: 'replace',
            path: '/info/name',
            value: 'Other name',
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/${other[0].key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 404, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Not found');
      });

      it('returns 400 when invalid patch dta', async () => {
        const srcSpace = created[1];
        const patch = [
          {
            test: "hello"
          }
        ];
        const result = await http.patch(`${baseUri}/spaces/${srcSpace.key}`, {
          body: JSON.stringify(patch),
          token: user1Token,
        });
        assert.equal(result.status, 400, 'has 404 status code');
        const info = JSON.parse(result.body as string);
        assert.equal(info.message, 'Malformed patch information.');
      });
    });
  });
});
