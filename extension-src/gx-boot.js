// Service-worker entry point.
//
// Order matters: gx-token.js wraps fetch, so it runs before anything that
// fetches; gx-collect.js wraps self.runFullSync and the tab calls, so it runs
// after background.js (which loads sync-core.js) has defined them. Pointing
// the manifest here keeps background.js and sync-core.js themselves untouched.
importScripts("gx-token.js", "background.js", "gx-collect.js");
