/* eslint-disable import/no-named-as-default-member */
import chai, { assert } from 'chai';
import { 
  StoreSdk, IAppProject, IQueryResult, IAppRequest,
} from '@api-client/core';
import chaiAsPromised from 'chai-as-promised';
import getConfig from '../helpers/getSetup.js';
import HttpHelper from '../helpers/HttpHelper.js';

chai.use(chaiAsPromised);

describe('http', () => {
  let baseUri: string;
  const http = new HttpHelper();

  describe('Multi-user', () => {
    let sdk: StoreSdk;

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.multiUserBaseUri;
      sdk = new StoreSdk(cnf.multiUserBaseUri);
      sdk.silent = true;
    });

    describe('/app/{appId}/query', () => {
      describe('GET', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';

        let data1: IAppProject[];
        let data2: IAppRequest[];
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          const r1 = await http.post(`${baseUri}/test/generate/app/projects?size=3&app=${appId1}`, { token: user1Token });
          const r2 = await http.post(`${baseUri}/test/generate/app/requests?size=3&isoKey=true&app=${appId1}`, { token: user1Token });
          sdk.token = user1Token;

          data1 = JSON.parse(r1.body as string) as IAppProject[];
          data2 = JSON.parse(r2.body as string) as IAppRequest[];
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/projects`);
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        // 
        // Note, the detailed tests are performed in the unit tests.
        // These tests the API communication only.
        // 

        it('finds projects', async () => {
          const p = data1[0];
          const result = await sdk.app.query(appId1, { query: p.info.name });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the project');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppProject>;
          assert.include(qr.index, 'doc:info:name', 'has the index');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });

        it('finds requests', async () => {
          const p = data2[0];
          const result = await sdk.app.query(appId1, { query: p.info.name });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the request');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppRequest>;
          assert.include(qr.index, 'doc:info:name', 'finds request in the name');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });
      });
    });
  });

  describe('Single-user', () => {
    let sdk: StoreSdk;

    before(async () => {
      const cnf = await getConfig();
      baseUri = cnf.singleUserBaseUri;
      sdk = new StoreSdk(cnf.singleUserBaseUri);
      sdk.silent = true;
    });

    describe('/app/{appId}/query', () => {
      describe('GET', () => {
        let user1Token: string;
        const appId1 = 'x1b2e3';

        let data1: IAppProject[];
        let data2: IAppRequest[];
  
        before(async () => {
          user1Token = await http.createUserToken(baseUri);
          const r1 = await http.post(`${baseUri}/test/generate/app/projects?size=3&app=${appId1}`, { token: user1Token });
          const r2 = await http.post(`${baseUri}/test/generate/app/requests?size=3&isoKey=true&app=${appId1}`, { token: user1Token });
          sdk.token = user1Token;

          data1 = JSON.parse(r1.body as string) as IAppProject[];
          data2 = JSON.parse(r2.body as string) as IAppRequest[];
        });
  
        after(async () => {
          await http.delete(`${baseUri}/test/reset/app/projects`);
          await http.delete(`${baseUri}/test/reset/app/requests`);
          await http.delete(`${baseUri}/test/reset/users`);
          await http.delete(`${baseUri}/test/reset/sessions`);
        });

        // 
        // Note, the detailed tests are performed in the unit tests.
        // These tests the API communication only.
        // 

        it('finds projects', async () => {
          const p = data1[0];
          const result = await sdk.app.query(appId1, { query: p.info.name });

          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the project');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppProject>;
          assert.include(qr.index, 'doc:info:name', 'has the index');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });

        it('finds requests', async () => {
          const p = data2[0];
          const result = await sdk.app.query(appId1, { query: p.info.name });
          
          assert.typeOf(result, 'object', 'returns an object');
          assert.typeOf(result.items, 'array', 'has the items');
          assert.isAtLeast(result.items.length, 1, 'has the request');
          const qr = result.items.find(i => i.doc.key === p.key) as IQueryResult<IAppRequest>;
          assert.include(qr.index, 'doc:info:name', 'finds request in the name');
          assert.deepEqual(qr.doc, p, 'returns the document');
        });
      });
    });
  });
});
