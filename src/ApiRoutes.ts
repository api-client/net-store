import Router from '@koa/router';
import { DefaultContext } from 'koa';
import { IServerConfiguration, IApplicationState } from './definitions.js';
import { BaseRoute } from './routes/BaseRoute.js';
import { SocketRoute } from './routes/SocketRoute.js';
import { SpacesWsRoute } from './routes/SpacesWsRoute.js';
import { RouteBuilder } from './routes/RouteBuilder.js';
import { SpacesHttpRoute } from './routes/SpacesHttpRoute.js';
import { SpaceHttpRoute } from './routes/SpaceHttpRoute.js';
import { SpaceWsRoute } from './routes/SpaceWsRoute.js';
import { ProjectsHttpRoute } from './routes/ProjectsHttpRoute.js';
import { ProjectHttpRoute } from './routes/ProjectHttpRoute.js';
import { ProjectsWsRoute } from './routes/ProjectsWsRoute.js';
import { ProjectWsRoute } from './routes/ProjectWsRoute.js';
import { AuthWsRoute } from './routes/AuthWsRoute.js';
import { BackendHttpRoute } from './routes/BackendHttpRoute.js';
import { SessionHttpRoute } from './routes/SessionHttpRoute.js';
import { UsersHttpRoute } from './routes/UsersHttpRoute.js';
import { StorePersistence } from './persistence/StorePersistence.js';
import { AppSession } from './session/AppSession.js';
import { BackendInfo } from './BackendInfo.js';
import { ProjectsCache } from './cache/ProjectsCache.js';

export class ApiRoutes {
  protected routes: BaseRoute[] = [];
  protected wsRoutes: SocketRoute[] = [];
  protected projectsCache = new ProjectsCache();
  /**
   * @param opts Optional server configuration options.
   */
  constructor(
      protected store: StorePersistence, 
      protected router: Router<IApplicationState, DefaultContext>, 
      protected session: AppSession,
      protected info: BackendInfo,
      protected opts: IServerConfiguration = {}
    ) {
    this.opts = opts;
    this.store = store;
    this.router = router;
    this.session = session;
  }

  async setup(): Promise<void> {
    this.projectsCache.initialize();
    // static HTTP routes. WS routes are created on demand.
    this.routes.push(new SessionHttpRoute(this.router, this.store, this.info, this.session));
    this.routes.push(new BackendHttpRoute(this.router, this.store, this.info, this.session));
    this.routes.push(new SpacesHttpRoute(this.router, this.store, this.info, this.session));
    this.routes.push(new SpaceHttpRoute(this.router, this.store, this.info, this.session));
    this.routes.push(new ProjectsHttpRoute(this.router, this.store, this.info, this.session));
    this.routes.push(new ProjectHttpRoute(this.router, this.store, this.info, this.session, this.projectsCache));
    this.routes.push(new UsersHttpRoute(this.router, this.store, this.info, this.session));
    if (this.info.testing) {
      // Note, the following is only for testing the application in CI.
      // This should never be available via the API.
      const { TestsHttpRoute } = await import('./routes/TestsHttpRoute.js');
      this.routes.push(new TestsHttpRoute(this.router, this.store, this.info, this.session));
    }
    for (const item of this.routes) {
      await item.setup();
    }
  }

  /**
   * Signals all processes to end.
   */
  async cleanup(): Promise<void> {
    this.projectsCache.cleanup();
    for (const item of this.routes) {
      await item.cleanup();
    }
    for (const item of this.wsRoutes) {
      item.shutDown();
    }
  }

  /**
   * Gets created or creates a WS server for the passed route.
   * @param url The request URL
   * @returns The created route or undefined when the route is not found
   */
  getOrCreateWs(url: string): SocketRoute | undefined {
    const { store } = this;
    if (url.startsWith('/auth/login')) {
      const route = new AuthWsRoute(store);
      this.addWsRoute(route, url);
      return route;
    }
    const spacesRoute = RouteBuilder.buildSpacesRoute();
    const isSpaces = url.startsWith(spacesRoute);
    if (!isSpaces) {
      return;
    }
    const route = this.wsRoutes.find(r => r.routeUrl === url);
    if (route) {
      return route;
    }
    
    if (url === spacesRoute) {
      const route = new SpacesWsRoute(store);
      this.addWsRoute(route, url);
      return route;
    }
    const v4reg = '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[89AB][0-9A-F]{3}-[0-9A-F]{12}';
    if (this.protectedBuildRouteRegexp(RouteBuilder.buildSpaceRoute(v4reg)).test(url)) {
      const route = new SpaceWsRoute(store);
      this.addWsRoute(route, url);
      return route;
    }
    if (this.protectedBuildRouteRegexp(RouteBuilder.buildSpaceProjectsRoute(v4reg)).test(url)) {
      const route = new ProjectsWsRoute(store);
      this.addWsRoute(route, url);
      return route;
    }
    if (this.protectedBuildRouteRegexp(RouteBuilder.buildSpaceProjectRoute(v4reg, v4reg)).test(url)) {
      const route = new ProjectWsRoute(store, this.projectsCache);
      this.addWsRoute(route, url);
      return route;
    }
  }

  protectedBuildRouteRegexp(route: string): RegExp {
    const sanitized = route.replaceAll('/', '\\/');
    const pattern = `^${sanitized}$`;
    return new RegExp(pattern, 'i');
  }

  protected addWsRoute(instance: SocketRoute, url: string): void {
    let urlValue = url;
    const queryIndex = urlValue.indexOf('?');
    if (queryIndex >= 0) {
      urlValue = urlValue.substring(0, queryIndex);
    }
    const parts = urlValue.split('/').slice(1);
    instance.route = parts;
    instance.routeUrl = urlValue;
    instance.createServer();
    instance.on('close', () => {
      const index = this.wsRoutes.indexOf(instance);
      if (index >= 0) {
        this.wsRoutes.splice(index, 1);
      }
    });
    this.wsRoutes.push(instance);
  }
}
