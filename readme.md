# API Client's Net Store

This library is a self-contained backend store for API Client ecosystem applications. It is designed to:

- work as a local service installed with API Client applications in a single-user environment
- run in a local network allowing remote access to the application data (single-, and multi-user environment)
- run in a container as a www service (see limitations below)

## WWW Service Limitations

When running the store as a service over internet it is your responsibility to secure the application to prevent external attacks. This library only provides configuration and API to start the www service and preconfigured default storage option (LevelDB). It is up to you and your organization to create your own storage option that works for you as well as creating protection on the gateway to prevent attacks like DDoS.

## Single- and Multi-User environment

Without additional configuration the store runs in a single-user environment. There's no need to authenticate the user and access to the data is open through HTTP/socket connection. The primary use case is to install the store with API Client application alongside the application. This then acts as a local backend for the application. Replication, ACLs, and authentication is disabled in this mode.

Once the authentication configuration is provided the store turns into the multi-user mode. In this mode client has to initialize a session first, login, and obtain authentication token from the application backend. The client can only access data after presenting a valid access token issued by the backend. See the Server Client Communication section for more details.

In the multi-user environment clients (users) can:

- setup multiple spaces per user and share with other users
- create and share (via space sharing) HTTP projects
- share HTTP history

## Observing real-time changes

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

## Communication client <> store

See [docs/communication.md](docs/communication.md) for more details.

## Client authentication

See [docs/authentication.md](docs/authentication.md) for more details.

## Http proxy

See [docs/proxy.md](docs/proxy.md) for more details.

## CLI

Use the `api-store` command to start the server

```sh
api-store mode "multi-user" \
  --port 8080 \
  --auth-type "oidc" \
  --oidc-issuer-uri "https://accounts.google.com/" \
  --oidc-client-id "..." \
  --oidc-client-secret "..." \
  --oidc-redirect-base "https://..." \
  --session-secret "..."
```

## Contributions

We are excited to see your contributions, especially for authentication protocols and security of the application. Fork, change, test, and send us a PR. That's all we ask :)

## TODO

- [ ] Add an ability to store application data for synchronization.
- [ ] Allow the client application to be a redirect URI target for OAuth configuration for a device flow
