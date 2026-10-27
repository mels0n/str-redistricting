// Vercel Web Analytics reads window.vaq when its script loads. This hook sends only each page's path: never its query
// (where other sites add click and campaign IDs) or its fragment. It loads just before the counter on every built page.
(function () {
  var pathOnly = function (event) {
    var url = new URL(event.url);
    return Object.assign({}, event, { url: url.origin + url.pathname });
  };
  if (typeof window.va === 'function') window.va('beforeSend', pathOnly);
  else (window.vaq = window.vaq || []).push(['beforeSend', pathOnly]);
})();
