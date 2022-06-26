# Proxy service

This library additionally contains a proxy server that works with the API Client data concepts, like `HttpProject`, `AppProject`, and `HttpRequest`.

The initialization of the proxy service is optional and separated from the store logic. However, the proxy communicates with the store to read project data from it on behalf of the user.

## Setting up

TODO

## Using the proxy in the client

To use the running proxy service in a client application send a `POST` request to the `/` endpoint with the proxy configuration in the body. The schema depends on the type of proxy you request.

The schemas are defined in the [@api-client/core](https://github.com/api-client/core) library.

### Proxy authorization

The proxy requires user credentials to:

1. Limit the use of the proxy to registered users only
1. Authenticate in the store to request `HttpProject` and `AppProject` data.

The init request requires the `Bearer` token received by the client application when connecting to the store. Additionally, the authorization header must contain the second part with the base URI to the store, as the proxy service is not a part of the store logic.

An example of the authorization header:

```http
authorization: Bearer 4JtiGRiSDSJSI%3DEUifiRBkKG5E2XzMDjRfl76ZC9Ub0wnz4XsNiRVBChTYbJcE3F, http://localhost:1234/store
```

The `4JtiGRiSDSJSI%3DEUifiRBkKG5E2XzMDjRfl76ZC9Ub0wnz4XsNiRVBChTYbJcE3F` is the user token to use to authenticate the request to the store, and the `http://localhost:1234/store` is the base URI to the store. When any of these parameters are  missing the proxy returns error.

### HttpRequest proxy

To proxy an `HttpRequest` use the following schema in the request body:

```typescript
type IRequestProxyInit {
  kind: 'Core#HttpRequest';
  /**
   * The request to execute.
   */
  request: IHttpRequest;
  /**
   * The authorization data to apply.
   */
  authorization?: IRequestAuthorization[];
  /**
   * The request configuration.
   */
  config?: IRequestConfig;
  /**
   * The list of execution variables to use with the request.
   */
  variables?: Record<string, string>;
  /**
   * The certificate data to use with the request.
   */
  certificate?: HttpCertificate;
  /**
   * The request flows to execute with the request.
   */
  flows?: IHttpActionFlow[];
}
```

### HttpProject proxy

To proxy an `HttpProject` use the following schema in the request body:

```typescript
type IHttpProjectProxyInit {
  kind: 'Core#HttpProject';
  /**
   * The project key
   */
  pid: string;
  /**
   * Runner options.
   */
  options: IProjectRunnerOptions;
}
```

### AppProject proxy

To proxy an `AppProject` use the following schema in the request body:

```typescript
type IAppProjectProxyInit {
  kind: 'Core#AppProject';
  /**
   * The project key
   */
  pid: string;
  /**
   * The application that created the project.
   */
  appId: string;
  /**
   * Runner options.
   */
  options: IProjectRunnerOptions;
}
```

### Proxy example example

```http
POST / HTTP/1.1
authorization: Bearer (user token), http://localhost:1234/store
content-type: application/json
content-length: ...

{
  "kind": "Core#AppProject",
  "pid": "febbab5e-9f1b-4757-a336-ab11ac3c5969",
  "appId": "UKg3j0I3vv",
  "options": { "recursive": true }
}
```

And the response:

```http
HTTP/1.1 200 OK
vary: Origin
content-type: application/json; charset=utf-8
content-length: 1760
date: Sun, 26 Jun 2022 09:15:30 GMT
connection: close


{
  "result":{
    "started":1656234869008,
    "ended":1656234869016,
    "iterations":[
      {....}
    ],
  }
}
```

The response body was formatted for readability.

An example of use in JavaScript:

```typescript
import { IProjectExecutionLog, IProxyResult } from '@api-client/core';

// Assuming the proxy is running at: http://localhost:8080/proxy
const response = await fetch('http://localhost:8080/proxy', {
  method: 'POST',
  headers: {
    'authorization': 'Bearer (user token), http://localhost:1234/store',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ 
    kind: 'Core#AppProject', 
    pid: 'febbab5e-9f1b-4757-a336-ab11ac3c5969', 
    appId: 'UKg3j0I3vv',
    options: { recursive: true }
  }),
});
assert.equal(response.status, 200);
const info = await response.json() as IProxyResult<IProjectExecutionLog>;
```

### Reading the results

When the result is ready the schema depends on the type of the proxy used. All proxies returns the `IProxyResult` schema, defined in the [@api-client/core](https://github.com/api-client/core) library.

When executing an `HttpRequest` the result has `variables` and `result` properties. The `variables` property contains the list of resulting variables after evaluating request flows (if any). Therefore, the client application should update their variables accordingly.
The `result` property has the `IRequestLog` schema, commonly used in the API Client ecosystem.

When executing and `AppProject` or an `HttpProject` the `variables` property is not set as they are defined in each iteration of the project run. The `result` property has the `IProjectExecutionLog` log.
