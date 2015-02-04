# osf-markdown-js [![Build Status](https://travis-ci.org/brianjgeiger/osf-markdown-js.png?branch=master)](https://travis-ci.org/tent/tent-markdown-js)

[Open Science Framework](https://osf.io) Dialect for [markdown-js](https://github.com/evilstreak/markdown-js). Right now this is just a test to explore how hard it is to make a plugin for markdown-js.

## Installation

    npm install osf-markdown

## Usage

### Node

```js
var markdown = require( "osf-markdown" ).markdown;
console.log( markdown.toHTML( "Hello *World*! #firstwords", "Tent", { footnotes: [], hashtagURITemplate: 'http://example.com/search?hashtag={hashtag}' } ) );
```

```html
<p>Hello <strong>World</strong>! <a href="http://example.com/search?hashtag=firstwords" rel="hashtag">#firstwords</a></p>
```

### Browser

```html
<!DOCTYPE html>
<html>
  <body>
    <textarea id="text-input" oninput="this.editor.update()"
              rows="6" cols="60">^[You](0), Type _Tent_ **Markdown** here.</textarea>
    <div id="preview"> </div>
    <script src="lib/osf-markdown.js"></script>
    <script>
      function Editor(input, preview) {
        this.update = function () {
          preview.innerHTML = markdown.toHTML(input.value, 'Tent', { footnotes: ["https://entity.example.org"] });
        };
        input.editor = this;
        this.update();
      }
      var $ = function (id) { return document.getElementById(id); };
      new Editor($("text-input"), $("preview"));
    </script>
  </body>
</html>
```

The above example is adapted from [markdown-js](https://github.com/evilstreak/markdown-js).

Simply put,

```javascript
  var source = "^[Example Mention](0), *Bold*, _Italic_, ~Strikethrough~, [Regular link](https://tent.io)...",
      entity_uris = ["https://entity.example.org"];
  window.markdown.toHTML( source, 'Tent', { footnotes: entity_uris } )
```

where `entity_uris` is an `Array` of entity uris with indices mapping to integer links in the markdown source.

### Preprocessers

The jsonml may be manipulated using preprocessors before it is translated into html.

```javascript
addAttributeToLinks = function ( jsonml ) {
  // Skip over anything that isn't a link
  if (jsonml[0] !== 'link') return jsonml;

  jsonml[1]['data-my-attribute'] = 'Hello World';

  return jsonml;
}

var markdown = require( "tent-markdown" ).markdown;
console.log( markdown.toHTML( "https://example.com", "Tent", { preprocessors: [addAttributeToLinks] } ) );
```

```html
<p><a href="https://example.com" data-my-attribute="Hello World">https://example.com</a></p>
```

## Contributing

1. Fork it
2. Create your feature branch (`git checkout -b my-new-feature`)
3. Commit your changes (`git commit -am 'Add some feature'`)
4. Push to the branch (`git push origin my-new-feature`)
5. Create new Pull Request
