// Service-worker entry point.
//
// It exists only to guarantee ordering: gx-token.js wraps fetch, so it has to
// run before anything that fetches. Pointing the manifest here instead of at
// background.js keeps background.js itself untouched.
importScripts("gx-token.js", "background.js");
