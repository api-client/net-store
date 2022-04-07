# Patch Operation

The store does not allow to change the entire file metadata or its contents. All changes have to be performed via the `PATCH` operation. This system uses JSON patch specification when working witch patches.

## Patch Flow

When a file or a content of the file changes, the client prepares a patch information for the change. The JSON patch is defined in the [RFC6902](https://datatracker.ietf.org/doc/html/rfc6902). Usually the client creates a copy of the object, changes original object's properties, and uses one of the JSON patch libraries to generate a diff (the patch).
Next, the client sends the diff with the `PATCH` operation to the `/files/[file key]` endpoint. When patching the contents of a file then the client must add the `alt=media` query parameter.

## Examples

## Patching File

```http
PATCH /files/43ae90cc-6391-4c49-ae19-2cfc51e19c24 HTTP 1/1
Host: ...
Authorization: Bearer ...
Content-Type: application/json
Content-length: ...

[
  { "op": "replace", "path": "/baz", "value": "boo" },
  { "op": "add", "path": "/hello", "value": ["world"] },
  { "op": "remove", "path": "/foo" }
]

```

## Patching Contents

```http
PATCH /files/43ae90cc-6391-4c49-ae19-2cfc51e19c24?alt=media HTTP 1/1
Host: ...
Authorization: Bearer ...
Content-Type: application/json
Content-length: ...

[
  { "op": "replace", "path": "/baz", "value": "boo" },
  { "op": "add", "path": "/hello", "value": ["world"] },
  { "op": "remove", "path": "/foo" }
]

```

The result of the patch operation is the so-called reverse patch. This is the patch operation that can be user to reverse changes made to the object using the same JSON patch algorithm.
