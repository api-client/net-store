# Server Client Communication

In a single-user environment all API access is open and authentication or a session is not required. Below is the description of the steps required to perform to start an authenticated session in a multi-user environment.

Regardless of the protocol used to communicate with the store (HTTP/S, socket, web socket) the client must obey the following rules to be able to communicate with the store.

1. The client initializes the session in the store (POST /sessions).
1. The store returns a token for the client with the expiration time configured in the store settings. The client uses this token in all further communication with the store
1. The client checks whether the user is authenticated for this token (GET /users/me).
    1. If the user is not authenticated then `401` status is returned with the location of the login form. Use this location to open a browser window and authenticate the user
    1. The client connects a web-socket to `/auth/status?token=...` and awaits for the status.
    1. If the user is authenticated it returns user information object
1. The client uses the API with the same token.
1. The client stores the token locally for future use (sessions are persistent in the Store.)
1. The client refresh the token by creating a new token (POST /sessions/renew)

## Example communication

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
|  (via a web socket) /auth/status?token=..   |
| ==========================================> |
|            (via a web socket)               |
|             { status: 'OK' }                |
| <========================================== |
﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏﹏
|          GET /xxxx                          |
|          Authorization: Bearer xxx          |
| ==========================================> |
```
