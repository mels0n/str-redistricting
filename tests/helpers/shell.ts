/** A minimal built shell holding every tag a share page replaces. */
export const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Home description." />
    <title>Home title</title>
    <link rel="canonical" href="https://fairmaps.melson.us/" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://fairmaps.melson.us/" />
    <meta property="og:title" content="Home title" />
    <meta property="og:description" content="Home description." />
    <meta property="og:image" content="https://fairmaps.melson.us/og-image.png" />
    <meta property="og:image:alt" content="Home alt." />
  </head>
  <body>
    <div id="str-viewer"></div>
    <script type="module" src="./assets/index-test.js"></script>
  </body>
</html>
`;
