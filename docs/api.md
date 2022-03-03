# Store API

The store offers both HTTP and WebSocket API. Reading and manipulating the data is performed with a regular HTTP request to the store. Data mutation is propagated to all clients connected to a specific web socket.

Note, **authentication is only required in a multi-user environment**. When the store is not configured with authentication then all authentication options are ignored and the client has full access to the data.

## /store

An endpoint to discover the store configuration. Currently it only reports the authentication requirements.

This endpoint does not require authentication.

```http
GET /store HTTP 1/1
Host: ...

```

Response

```json
{
  "hasAuthentication": true
}
```

## /sessions

Endpoint to initialize and manage client sessions. Note, these are not used in a single-user environment.

### POST /sessions

This endpoint does not require authentication.

Initializes a new session in the store. Clients must obtain a session before making any queries to the store otherwise all requests will returns `401` status code.

There's no need to start a new session each time the client starts-up. The session token can be stored and reused again. The token is valid as long as the expiration date did not pass.

To obtain the token send an empty POST request to the session endpoint:

```http
POST /sessions HTTP 1/1
Host: ...

```

The response is the token.

```sh
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiJkZjcyN2E4OS1iZWEzLTQwZjMtOGZlMi0yNjNkYmMzZGQxMTAiLCJpYXQiOjE2NDYxMDEzNDgsImV4cCI6MTY0NjcwNjE0OCwiYXVkIjoidXJuOmFwaS1jbGllbnQiLCJpc3MiOiJ1cm46YXJjLXN0b3JlIn0.3YmrRxYQb12TrzNOUR-aP1NBw9K26rm03oZrCsCdElQ
```

By default a token has expiration date in 7 days.

## /sessions/renew

This endpoint requires authentication.

When a token is about to expire the client can exchange the token for a new one. The client cannot exchange expired token.

```http
POST /sessions HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is a new token.

```sh
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## /users/me

This endpoint requires authentication. Note, these are not used in a single-user environment.

An endpoint to get information about the current user.

```http
GET /users/me HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is a user object.

```json
{
  "key":"123456789876543210123",
  "name":"Paweł Uchida-Psztyć",
  "email":[
    {
      "email":"email@org.com",
      "verified":true
    }
  ],
  "locale":"en",
  "picture":{
    "url": "https://..."
  }
}
```

The email array, picture, and locale is only present when it was returned by the authentication server.

## /spaces

This endpoint (and sub-endpoints) requires authentication. Note, these are not used in a single-user environment.

A space is a folder (or otherwise logical location) where users can keep their HTTP projects. A space can be shared with other users. User has the same access level to projects as defined in the space for this user.

### GET /spaces

Lists user spaces.

```http
GET /spaces?cursor=... HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is the list result for spaces.

```json
{
  "data": [
    {
      "key": "8c38abfe-9828-11ec-b909-0242ac120002",
      "name": "Drafts",
      "users": [],
      "projects": [],
      "access": "read"
    }
  ],
  "cursor": "eyJsaW1pdCI6MzUsImxhc3RLZXkiOiI4YzM4YWJmZS05ODI4LTExZWMtYjkwOS0wMjQyYWMxMjAwMDIifQ=="
}
```

The endpoint supports a cursor-based pagination. You can set the `limit` and `cursor` query parameters. THe `limit` says how many results return in the page of results. The response always have the `cursor` value which should be used with next request to the pagination endpoint. When `cursor` is set the `limit` is ignored.

### POST /spaces

Creates a new space and makes the current user an owner.

```http
POST /spaces HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
content-type: application/json

{
  ... space object
}
```

The response has `204` status code, no body, and the `location` header which can be used to access the created workspace.

```http
HTTP 1/1 204 No content

Location: /spaces/[space id]
...
```

Note, this operation triggers a web socket event on the `/spaces` endpoint.

## /spaces/{space}

### GET /spaces/{space}

Reads a user space. It returns the object only when the user has access to the space.

```http
GET /spaces/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1 HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is the space object

```json
{
  "key": "6ba3d03d-1ade-4bae-9461-50c0b5dd6da1",
  "name": "Drafts",
  "users": [],
  "projects": [],
  "access": "owner"
}
```

Note, the `access` property is added by the server for this specific user. This property is otherwise ignored by the server.

Note, this operation triggers a web socket event on the `/spaces` endpoint.

### PATCH /spaces/{space}

Patches a space. It uses the JSON patch specification (RFC 6902) to construct the patch object.

```http
PATCH /spaces/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1 HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
content-type: application/json

[
  {
    "op": "replace",
    "path": "/name",
    "value": "No more drafts"
  }
]
```

The response is the reversible patch operation that can be user to restore the changed value

```json
{
  "status": "OK",
  "revert":[
    [
      { "op": "replace", "path": "/name", "value": "Drafts 4"},
      "Drafts 3",
      null
    ]
  ]
}
```

Note, this operation triggers a web socket event on the `/spaces/[space id]` endpoint.

The PATCH operation is supported by the JSON8 library.

### DELETE /spaces/{space}

Status: Not yet implemented.

Removes a space and projects located in the space from the store.

Note, data are not permanently removed from the store but marked as deleted. This way the data can be restored after an accidental delete.

```http
DELETE /spaces/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1 HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is `204` status code.

Note, this operation triggers a web socket event on the `/spaces` endpoint.

## /spaces/{space}/users

An endpoint to manage space users.

### PATCH /spaces/{space}/users

The message body is the list of patches to apply to the users. The server supports two PATCH operations: "add" and "remove". Note, these are not the same patched as defined in JSON Patch specification.

```http
PATCH /spaces/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1/users HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

[
  {
    "op": "remove",
    "uid": "user key 1"
  },
  {
    "op": "remove",
    "uid": "user key 2"
  },
  {
    "op": "add",
    "uid": "user key 3",
    "value": "read"
  },
]

```

## /spaces/{space}/projects

An endpoint that operated on a collection of projects in a space.

### GET /spaces/{space}/projects

Lists available projects in the suer space.

### POST /spaces/{space}/projects

Creates a project in the user space.

## /spaces/{space}/projects/{project}

### GET /spaces/{space}/projects/{project}

### PATCH /spaces/{space}/projects/{project}

### DELETE /spaces/{space}/projects/{project}

## /spaces/{space}/projects/{project}/revisions

### GET /spaces/{space}/projects/{project}/revisions
