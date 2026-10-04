// Service-worker entry point.
//
// Order matters: gx-token.js wraps fetch, so it runs before anything that
// fetches; gx-linkedin.js replaces the LinkedIn page reader for LinkedIn's new
// layout and gx-collect.js wraps self.runFullSync and the tab calls, so both
// run after background.js (which loads sync-core.js) has defined them.
// Pointing the manifest here keeps background.js and sync-core.js untouched.
importScripts("gx-token.js", "background.js", "gx-linkedin.js", "gx-collect.js");
