# Sessions

The store implements its own session store and mechanism for sessions.

At glance, the application generates a session from the `POST /sessions` operation.
During this operation a session id (sid) is generated and packed into a JWT (JSON Web Token). The `sid` is used with the session processor to store session data. The application is not aware which `sid` belongs to which client. The client application has the JWT with the session key encoded in it.

When the client makes a request and presents the token to the backend this token is decoded and the request can be associated with the session data.

A special case is the authentication. OAuth session is started by the browser which has no knowledge about the application token. Therefore clients are required to initialize authentication session (`POST /auth/login`) and use the path returned in the `location` header to start the authentication flow. The returned path has the state parameter that is used to associate the session with the browser session. After returning from the OAuth 2 server the same state is used to recognize the session object and to update the session with user id.

The session is persistent in the store. It is safe to close the store and run it again. Eventually all data is restored.
For performance, the session factory has a cache object that holds all used session information. Mutations are committed to the store. If the cached value is missing then the service requests the data from the store.

```plain
|--------|         |-----------------------|
| Client |  ---->  |  JWT with packed SID  |
|--------|         |-----------------------|
    │
    │
    │
    │ Authorization: Bearer [JWT]
    │
    ˅
|----------|       |--------------|  SID  |-----------------|
|  Server  | --->  |  Unpack JWT  | --->  |  Session cache  | ---> Session data.
|----------|       |--------------|       |-----------------|

```
