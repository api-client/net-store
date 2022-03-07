# Authentication

To access the store the client has to present a valid JWT with authentication information. This is the same for single- and multi-user mode, however, details of implementation changes in the two modes.

Note, the description below is for the default OpenID Connect authentication method supported out of the box by the store. Custom implementations may have different flow.

## Setting up the session

The client makes a request to the `Sessions` endpoint to setup a session. This should be done once and the returned token can be stored by the application for the future use. When the token is lost or expired a new session has to be established (including authentication).

```http
POST /sessions HTTP 1/1
Host: ...

```

Note, this request has no body. POST is to follow HTTP semantics.

The returned value is the session token the client must use in the further communication with the store.
Client can now store the token in a local storage for future use.
Additionally, the response may contain the `expires` header that informs the client when the header expires. Clients should renew he token before that time. If the header is not set the session does not expire.

## Checking the session token

When the client obtained the session token from the store or restored the token from a local store, it should check whether the token is valid by making a request to the `Users` endpoint.

```http
GET /users/me HTTP 1/1
Host: ...

```

In the `single-user` mode the token is always authenticated and the endpoint returns the profile information for the default user.

In the `multi-user` mode the response can be either 404 when the token is invalid, missing, etc or the 200 response with the user profile information returned by the identity provider (by default the store supports the OpenID Connect protocol).

If this endpoint returns 200 status code then the token is valid and authenticated, and the client may continue using the API without further steps (except for the token expiration logic).

## Authenticating the user

If the `/users/me` returned a status from the 4xx group, then user authentication is required.
This happens in a multi step-process.

1. The client has to establish authentication session
1. The client registers a web socket client to listen for the user authentication result
1. The client opens the link returned by the auth session endpoint in a web browser
1. The client waits for the authentication result sent via the web socket.

When the user opens the web browser there's no way to send the authorization header to the server to associate the existing client session with the user. Hence the requirement of establishing the auth session first.

The web socket is required to inform the client that the user has authenticated the application. The browser connects directly to the store's www server and not the client.

On the protocol level the following happens.

Create auth session:

```http
POST /auth/login HTTP 1/1
Host: ...
Authorization: Bearer ....

```

The response is:

```http
HTTP 1/1 204 Created
Location: /auth/login?state=yyyy
```

The client uses the `location` header to construct the full URL to the authentication endpoint and opens the web browser with the provided URL.

At the same time the client opens a web socket to the auth endpoint with the user token in the query string.

```http
ws://localhost:8080/auth/login?token=xxxxx
```

The client waits for the `{"status":"OK"}` or `{"status":"ERROR","message":"xxx"}` message. If the status is "OK" then the token is authenticated and the user can use the token with API calls. Otherwise the user is not authenticated and the client cannot use the API.

## Refreshing the token

While the token is still active, the easiest way is to issue an authenticated request to the `/sessions/renew` endpoint. The response is the renewed token. The response also may include the `expires` header which contains
the date when the token expires.

```http
POST /sessions/renew HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is a new token.

```sh
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

When the token already expired or is invalid then the whole authentication flow has to be repeated again.

## Configuring authentication

Note, authorization is performed on a resource level (e.g. when reading the resource).

Out-of-the-box the store supports OpenID Connect configuration. You can use your Google Workspace (or whatever it is called this year) accounts with the store. This also works with Microsoft, SalesForce, Octa, and others.

If you want to use different way of authenticating the user (Kerberos, etc) you unfortunately have to implement it yourself. However, we created interfaces to help you build a skeleton of your application and to plug it into to Server. Contributions are very welcome so others can use the same module.

An example configuration can be as follows:

```typescript
const port = 8080;
const basePath = '/v1';
const baseUri = `http://localhost:${port}${basePath}`;

const server = new Server(myStore, {
  router: {
    prefix: basePath,
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
