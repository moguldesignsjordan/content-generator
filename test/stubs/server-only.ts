// Vitest stub for the `server-only` package.
//
// `server-only` exists to make a build FAIL if a server module is imported into
// a client bundle. Under Vitest there is no client bundle and the package isn't
// resolvable, so importing a server module (lib/billing, lib/pipeline, lib/db)
// would crash on its first line. Aliasing it to this empty module lets those
// modules be unit-tested while the real guarantee, which is enforced by the
// Next.js build, stays exactly as strict.
export {};
