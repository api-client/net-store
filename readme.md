# Advanced REST Client's Net Store

> Work in progress

This library is a self-contained backend store for ARC's applications. It is designed to:

- work as a local service installed with ARC / API Client applications in a single-user environment
- run in a local network allowing remote access to the application data (single-, and multi-user environment)
- run in a container as a www service (see limitations below)

## WWW Service Limitations

When running the store as a service over internet it is your responsibility to secure the application to prevent external attacks. This library only provides configuration and API to start the www service and preconfigured default storage option (LevelDB). It is up to you and your organization to create your own storage option that works for you as well as creating protection on the gateway to prevent attacks like DDoS.

## Single- and Multi-User environment

Without additional configuration the store runs in a single-user environment. There's no need to authenticate the user and access to the data is open through HTTP/socket connection. The primary use case is to install the store with ARC application alongside the application. This then acts as a local backend for the application. Replication, ACLs, and authentication is disabled in this mode.

Once the authentication configuration is provided the store turns into the multi-user mode. In this mode client has to initialize a session first, login, and obtain authentication token from the application backend. The client can only access data after presenting a valid access token issued by the backend. See the Server Client Communication section for more details.

In the multi-user environment clients (users) can:

- setup multiple spaces per user and share with other users
- create and share (via space sharing) HTTP projects
- share HTTP history

## Server Client Communication

In a single-user environment all API access is open and authentication or a session is not required. Below is the description of the steps required to perform to start an authenticated session in a multi-user environment.

Regardless of the protocol used to communicate with the store (HTTP/S, socket, web socket) the client must obey the following rules to be able to communicate with the store.

1. The client initializes the session in the store (POST /sessions).
1. The store returns a token for the client with the expiration time configured in the store settings. The client uses this token in all further communication with the store
1. The client checks whether the user is authenticated for this token (GET /users/me).
    1. If the user is not authenticated then 401 is returned with the location of the login form. Use this location to open a browser window and authenticate the user
    1. The client connects a web-socket to `/auth/status` with the authentication header and awaits for response.
    1. If the user is authenticated it returns user information object
1. The client uses the API with the same token.
1. The client stores the token locally for future use (sessions are persistent in the Store.)
1. The client refresh the expiration date of the token by creating a new token (POST /sessions/renew)

### Example communication

```plain
|--------|                           |--------|
| Client |                           | Server |
|--------|                           |--------|
|                                             |
|           POST /sessions (no body)          |
| ==========================================> |
|                                             |
|        Unauthenticated token in body        |
| <========================================== |
|                                             |
|          GET /users/me                      |
|          Authorization: Bearer xxx          |
| ==========================================> |
|                                             |
|        HTTP 1.1 401 Unauthorized            |
|        Location: /auth/login                |
| <========================================== |
﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏

|       (via a browser) /auth/login           |
| ==========================================> |
|     (via a web socket) /auth/status         |
|        Authorization: Bearer xxx            |
| ==========================================> |
|            (via a web socket)               |
|             { status: 'OK' }                |
| <========================================== |
﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏
|          GET /xxxx                          |
|          Authorization: Bearer xxx          |
| ==========================================> |
```

## Configuring authentication

Note, authorization is performed on a resource level (e.g. when reading the resource).

Out-of-the-box the store supports OpenID Connect configuration. You can use your Google Workspace (or whatever it is called this year) accounts with the store. This also works with Microsoft, SalesForce, Octa, and others.

If you want to use different way of authenticating the user (Kerberos, etc) you unfortunately have to implement it yourself. However, we created interfaces to help you build a skeleton of your application and to plug it into to Server. Contributions are very welcome so others can use the same module.

An example configuration can be as follows:

```typescript
const port = 8080;
const pasePath = '/v1';
const baseUri = `http://localhost:${port}${pasePath}`;

const server = new Server(myStore, {
  router: {
    prefix: pasePath,
  },
  authentication: {
    enabled: true,
    type: 'oidc',
    secret: 'N8GNxYsVZC', // random chars, use any online generator
    config: {
      issuerUri: 'https://accounts.google.com/',
      clientId: 'your-client-id.apps.googleusercontent.com', // get it from the Google Cloud Console
      clientSecret: 'VmBtai0wzwveE6ys8VZO', // not a real secret, generated random chars.
      redirectBaseUri: baseUri, // important! Use your domain and register it with Google Cloud Console as the redirect URL as baseUri + '/auth/callback'
    }
  }
});
```

To configure own implementation of authentication, create a class that extends the `src/authentication/Authentication.ts` class and pass the reference to as in the `authentication` property.

```typescript
// auth.ts
import { Authentication } from '@advanced-rest-client/net-store';
import { IUser } from '@advanced-rest-client/core';

export default class Auth extends Authentication {
  /**
   * A function that checks whether the current request is authenticated.
   * If so it returns the User object.
   * 
   * It throws when the authentication is invalid or expired.
   * It returns an empty object when no authentication mechanism was provided.
   * 
   * @param request The client request.
   */
  async authenticate(request: http.IncomingMessage): Promise<IUser | undefined> {
    // ...
  }

  getAuthLocation(): string {
    return '/auth/login';
  }
  ...
}


// index.ts
import { Server } from '@advanced-rest-client/net-store';
import Auth from './auth.js';

const server = new Server(myStore, {
  authentication: Auth,
});
```

## Observing real-time changed

The server exposes several endpoints for web sockets. Clients can crate a WebSocket connection to the server to observer changes to the interesting resources:

- `/auth/login` - for the default OIDC auth provider, it sends a message when the user got authenticated (or an error when not)
- `/spaces` - events related to changes in the list of user spaces.
- `/spaces/[space id]` - events related to changes to a specific space
- `/spaces/[space id]/projects` - events related to changes to the list of projects in a space
- `/spaces/[space id]/projects/[project id]` - events related to changes to a project in a space

Because the WebSocket does not allow to set headers when making a connection the client must authenticate by adding the `token` query parameter to the request URL. This token is read and processed by the authentication library.

```sh
ws://localhost:8080/v1/spaces?token=...
```

If the token is not set when making the connection on the websocket then the connection will be refused and closed.

## REST API

See [docs/api.md](docs/api.md) for API details.

## Contributions

We are excited to see your contributions, especially for authentication protocols and security of the application. Fork, change, test, and send us a PR. That's all we ask :)
