import type { Instrumentation } from "next";
import { logError } from "@/lib/log";

// Belt-and-suspenders complement to the manual logError sweep across
// app/api/**/route.ts: catches genuinely uncaught errors (middleware,
// layouts, anything outside a try/catch) so they still land in app_logs.
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  logError(`instrumentation:${context.routerKind}:${context.routeType}`, err, {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
  });
};
