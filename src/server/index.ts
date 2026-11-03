import { createServer, getServerPort } from "@devvit/web/server";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { requestContext } from "./requestContext.js";

// Devvit Web's server entry: devvit.json's "server" runs the bundle Vite builds from this file. Devvit's createServer
// gives each request its own context, which requestContext reads.
serve({ createServer, fetch: createApp(requestContext).fetch, port: getServerPort() });
