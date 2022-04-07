# Web Socket Events

The store allows a client to listen for events via a web socket. The client can use a web browser and a native WS client or in the node environment the client can use the `ws` library.

## File Changes

Path: `/files`

Files stored in the store (spaces, projects, more to come) can be accessed and manipulated via the REST API. Mutations to a file are propagated via a web socket connected to the `/files` endpoint. When a file mutates (created, updated, deletes, added permissions, removed permission) it lists all users that have access to the file and informs only the specific connected clients.

File changes only relate to file metadata. A user `Workspace` exist only as a metadata, just like the schema for a `Project`. However, `HttpProject` is a media for `Project` and changes to the media (contents of the file) are not propagated through this endpoint.

After connecting to this endpoint, the client gets the following events

- a file was created (only an owner is notified)
- a file metadata were updated (the owner and users with access to the file are notified)
- a files was deleted (the owner and users with access to the file are notified). Note, listeners to the "media" endpoint are also getting this event.
- a permission was granted to the file (the owner, users with existing access, new user). Changing a permission dispatches the same event.
- a permission was removed to the file (the owner, users with existing access, removed user)

## Media Changes

Media is the contents of the file. In the system it is recognized by adding the `alt=media` query parameter to the request.

Path: `/files/[file key]?alt=media`

These events are dispatched when the contents of a file change. It is unrelated to the metadata (the file).

After connecting to this endpoint, the client gets the following events

- the content was updated (the owner and users with access to the file are notified)
- a revision was added (the owner and users with access to the file are notified)
- the content was deleted - dispatched the same way as the file delete event, at the same time. This is a convenient way to observe when the file was deleted without listening for all file events

## Examples

### File Created

Path: `/file`

```json
{
  "type": "event",
  "operation": "created",
  "data": { "metadata contents" },
  "kind": "the kind of the created file",
  "id": "file key"
}
```

### File Updated

Path: `/file`

```json
{
  "type": "event",
  "operation": "patch",
  "data": { "JSON patch object (reversible)" },
  "kind": "the kind of the updated file",
  "id": "file key"
}
```

### File Deleted

Path: `/file`

```json
{
  "type": "event",
  "operation": "deleted",
  "kind": "the kind of the deleted file",
  "id": "file key"
}
```

### File Access Granted

Path: `/file`

```json
{
  "type": "event",
  "operation": "access-granted",
  "kind": "file kind",
  "data": { "the created permission object" },
  "id": "file key"
}
```

Note, when a permission is granted it also mutates the file. This dispatches the event on the file change with the mutation record (a JSON patch).

### File Access Removed

Path: `/file`

```json
{
  "type": "event",
  "operation": "access-removed",
  "kind": "file kind",
  "id": "file key"
}
```

### Contents Updated

Path: `/file/[file key]?alt=media`

This event is not associated with the file change event.

```json
{
  "type": "event",
  "operation": "patch",
  "data": ["JSON patch object (reversible)"],
  "kind": "the kind of the updated contents",
  "id": "contents key (the same as the associated file)"
}
```

### Added Contents Revision

Path: `/file/[file key]?alt=media`

This event is not associated with the file change event.

```json
{
  "type": "event",
  "operation": "creates",
  "data": { "the revision object" },
  "kind": "Core#Revision",
  "id": "revision key",
  "parent": "contents key (the same as the associated file)"
}
```

### Contents Deleted

Path: `/file/[file key]?alt=media`

```json
{
  "type": "event",
  "operation": "deleted",
  "kind": "the kind of the deleted contents",
  "id": "contents key (the same as the associated file)"
}
```
