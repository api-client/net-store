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
POST /sessions/renew HTTP 1/1
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

## /files

This endpoint (and sub-endpoints) requires authentication unless working in a single-user environment.

A file is an abstract concept of a metadata associated with the content of the file (in most cases). When creating an object like HttpProject the store also creates a file alongside. While the clients uses files for all kinds of listings the contents of the file can be requested by adding the `alt=media` query parameter. A user space has no contents and only exists to organize user files. Only spaces can contain other files.

### GET /files

Lists user files

```http
GET /files?cursor=... HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is the list of files in the root or parent space.

```json
{
  "data": [
    {
      "key": "8c38abfe-9828-11ec-b909-0242ac120002",
      "kind": "Core#Space",
      ...
    }
  ],
  "cursor": "eyJsaW1pdCI6MzUsImxhc3RLZXkiOiI4YzM4YWJmZS05ODI4LTExZWMtYjkwOS0wMjQyYWMxMjAwMDIifQ=="
}
```

The endpoint supports a cursor-based pagination. You can set the `limit` and `cursor` query parameters. THe `limit` says how many results return in the page of results. The response always have the `cursor` value which should be used with next request to the pagination endpoint. When `cursor` is set the `limit` is ignored.

### POST /files

Creates a new file and makes the current user an owner.

```http
POST /files HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
content-type: application/json

{
  ... file object
}
```

The response has `204` status code, no body, and the `location` header which can be used to access the created workspace.

```http
HTTP 1/1 204 No content

Location: /files/[file id]
...
```

Usually, the body of the request of the contents of the target object (the media). The space creates a corresponding File entry for the contents. Exception here is a user space which file schema is directly passed to the body of the request.

Note, this operation triggers a web socket event on the `/files` endpoint.

## /files/{file}

### GET /files/{file}

Reads a file metadata. It returns the object only when the user has access to the file.

```http
GET /files/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1 HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is the space object

```json
{
  "key": "8c38abfe-9828-11ec-b909-0242ac120002",
  "kind": "Core#Space",
  ...
}
```

### GET /files/{file}?alt=meta

Reads a file contents. It returns the object only when the user has access to the file.

```http
GET /files/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1?alt=meta HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is the contents of the file

```json
{
  "key": "8c38abfe-9828-11ec-b909-0242ac120002",
  "kind": "Core#HttpProject",
  ...
}
```

### PATCH /files/{file}

Patches a file metadata. It uses the JSON patch specification (RFC 6902) to construct the patch object.

```http
PATCH /files/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1 HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
content-type: application/json

[
  {
    "op": "replace",
    "path": "/info/name",
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

Note, this operation triggers a web socket event on the `/files` endpoint.

The PATCH operation is supported by the `@api-client/json` library.

### PATCH /files/{file}?alt=media

Patches a file contents. It works the same as `PATCH /files/{file}` but the patch is applied to the contents and not the metadata.

### DELETE /files/{file}

Removes a file amd its contents from the store.

Note, data are not permanently removed from the store but marked as deleted. This way the data can be restored after an accidental delete or synchronized with another store.

```http
DELETE /files/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1 HTTP 1/1
Host: ...
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

```

The response is `204` status code.

Note, this operation triggers a web socket event on the `/files` endpoint.

## /files/{file}/users

An endpoint to list users that have access to the file.

### PATCH /files/{file}/users

The message body is the list of patches to apply to the users. The server supports two PATCH operations: "add" and "remove". Note, these are not the same patched as defined in JSON Patch specification.

```http
PATCH /files/6ba3d03d-1ade-4bae-9461-50c0b5dd6da1/users HTTP 1/1
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
