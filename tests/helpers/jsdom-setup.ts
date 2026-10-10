// jsdom implements neither scrollIntoView nor scrolling, and the pages call it from animation frames that can fire
// after a test has ended. A no-op keeps those calls from becoming unhandled errors; tests that care replace it with a spy.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
