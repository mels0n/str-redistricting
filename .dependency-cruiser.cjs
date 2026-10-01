/**
 * Dependency rules for the day-1 code standard.
 * Reference: notes/system/code-standards.md sections 2, 3 and 7.
 *
 * These run in CI and FAIL the build. They are not advisory: mechanical
 * enforcement is what keeps the layer graph honest when agents write the code.
 *
 * Layer order, top to bottom:
 * src/client/  app > pages > widgets > features > entities > shared
 * src/server/  app > api > features > entities > shared
 * A layer may import only from layers strictly below it.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-upward-import-from-client-pages',
      comment:
        "'pages' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/client/pages/' },
      to: { path: '^src/client/(app)/' },
    },
    {
      name: 'no-upward-import-from-client-widgets',
      comment:
        "'widgets' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/client/widgets/' },
      to: { path: '^src/client/(app|pages)/' },
    },
    {
      name: 'no-upward-import-from-client-features',
      comment:
        "'features' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/client/features/' },
      to: { path: '^src/client/(app|pages|widgets)/' },
    },
    {
      name: 'no-upward-import-from-client-entities',
      comment:
        "'entities' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/client/entities/' },
      to: { path: '^src/client/(app|pages|widgets|features)/' },
    },
    {
      name: 'no-upward-import-from-client-shared',
      comment:
        "'shared' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/client/shared/' },
      to: { path: '^src/client/(app|pages|widgets|features|entities)/' },
    },
    {
      name: 'no-cross-slice-import-client',
      comment:
        'Slices on the same layer are siblings and must not import each other. ' +
        'Extract the shared part to a lower layer.',
      severity: 'error',
      from: { path: '^src/client/(pages|widgets|features|entities)/([^/]+)/' },
      to: { path: '^src/client/$1/(?!$2/)[^/]+/' },
    },
    {
      name: 'slice-public-api-only-client',
      comment:
        'Import a slice through its index (public API), never a file inside it.',
      severity: 'error',
      from: { pathNot: '^src/client/(pages|widgets|features|entities)/([^/]+)/' },
      to: {
        path: '^src/client/(pages|widgets|features|entities)/[^/]+/.+',
        pathNot: '^src/client/(pages|widgets|features|entities)/[^/]+/index\\.(ts|tsx|js|jsx)$',
      },
    },
    {
      name: 'no-upward-import-from-server-api',
      comment:
        "'api' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/server/api/' },
      to: { path: '^src/server/(app)/' },
    },
    {
      name: 'no-upward-import-from-server-features',
      comment:
        "'features' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/server/features/' },
      to: { path: '^src/server/(app|api)/' },
    },
    {
      name: 'no-upward-import-from-server-entities',
      comment:
        "'entities' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/server/entities/' },
      to: { path: '^src/server/(app|api|features)/' },
    },
    {
      name: 'no-upward-import-from-server-shared',
      comment:
        "'shared' may only import from layers below it. " +
        'Move the shared code down a layer instead of reaching up.',
      severity: 'error',
      from: { path: '^src/server/shared/' },
      to: { path: '^src/server/(app|api|features|entities)/' },
    },
    {
      name: 'no-cross-slice-import-server',
      comment:
        'Slices on the same layer are siblings and must not import each other. ' +
        'Extract the shared part to a lower layer.',
      severity: 'error',
      from: { path: '^src/server/(api|features|entities)/([^/]+)/' },
      to: { path: '^src/server/$1/(?!$2/)[^/]+/' },
    },
    {
      name: 'slice-public-api-only-server',
      comment:
        'Import a slice through its index (public API), never a file inside it.',
      severity: 'error',
      from: { pathNot: '^src/server/(api|features|entities)/([^/]+)/' },
      to: {
        path: '^src/server/(api|features|entities)/[^/]+/.+',
        pathNot: '^src/server/(api|features|entities)/[^/]+/index\\.(ts|tsx|js|jsx)$',
      },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means the layer boundary has already been crossed somewhere.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Dead module. Delete it or wire it up.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(babel|webpack|vite|astro|next)\\.config\\.(js|cjs|mjs|ts)$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '\\.(test|spec)\\.(ts|tsx|js|jsx)$' },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
