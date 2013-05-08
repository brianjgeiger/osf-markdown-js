// Released under MIT license
// Copyright (c) 2009-2010 Dominic Baggott
// Copyright (c) 2009-2010 Ash Berlin
// Copyright (c) 2011 Christoph Dorn <christoph@christophdorn.com> (http://www.christophdorn.com)

/*jshint browser:true, devel:true */

(function( expose ) {

var Markdown = expose.Markdown = function(dialect) {
  switch (typeof dialect) {
    case "undefined":
      this.dialect = Markdown.dialects.Gruber;
      break;
    case "object":
      this.dialect = dialect;
      break;
    default:
      if ( dialect in Markdown.dialects ) {
        this.dialect = Markdown.dialects[dialect];
      }
      else {
        throw new Error("Unknown Markdown dialect '" + String(dialect) + "'");
      }
      break;
  }
  this.em_state = [];
  this.strong_state = [];
  this.debug_indent = "";
};

/**
 *  parse( markdown, [dialect] ) -> JsonML
 *  - markdown (String): markdown string to parse
 *  - dialect (String | Dialect): the dialect to use, defaults to gruber
 *
 *  Parse `markdown` and return a markdown document as a Markdown.JsonML tree.
 **/
expose.parse = function( source, dialect ) {
  // dialect will default if undefined
  var md = new Markdown( dialect );
  return md.toTree( source );
};

/**
 *  toHTML( markdown, [dialect]  ) -> String
 *  toHTML( md_tree ) -> String
 *  - markdown (String): markdown string to parse
 *  - md_tree (Markdown.JsonML): parsed markdown tree
 *
 *  Take markdown (either as a string or as a JsonML tree) and run it through
 *  [[toHTMLTree]] then turn it into a well-formated HTML fragment.
 **/
expose.toHTML = function toHTML( source , dialect , options ) {
  var input = expose.toHTMLTree( source , dialect , options );

  return expose.renderJsonML( input );
};

/**
 *  toHTMLTree( markdown, [dialect] ) -> JsonML
 *  toHTMLTree( md_tree ) -> JsonML
 *  - markdown (String): markdown string to parse
 *  - dialect (String | Dialect): the dialect to use, defaults to gruber
 *  - md_tree (Markdown.JsonML): parsed markdown tree
 *
 *  Turn markdown into HTML, represented as a JsonML tree. If a string is given
 *  to this function, it is first parsed into a markdown tree by calling
 *  [[parse]].
 **/
expose.toHTMLTree = function toHTMLTree( input, dialect , options ) {
  // convert string input to an MD tree
  if ( typeof input ==="string" ) input = this.parse( input, dialect );

  // Now convert the MD tree to an HTML tree

  // remove references from the tree
  var attrs = extract_attr( input ),
      refs = {};

  if ( attrs && attrs.references ) {
    refs = attrs.references;
  }

  var html = convert_tree_to_html( input, refs , options );
  merge_text_nodes( html );
  return html;
};

// For Spidermonkey based engines
function mk_block_toSource() {
  return "Markdown.mk_block( " +
          uneval(this.toString()) +
          ", " +
          uneval(this.trailing) +
          ", " +
          uneval(this.lineNumber) +
          " )";
}

// node
function mk_block_inspect() {
  var util = require("util");
  return "Markdown.mk_block( " +
          util.inspect(this.toString()) +
          ", " +
          util.inspect(this.trailing) +
          ", " +
          util.inspect(this.lineNumber) +
          " )";

}

var mk_block = Markdown.mk_block = function(block, trail, line) {
  // Be helpful for default case in tests.
  if ( arguments.length == 1 ) trail = "\n\n";

  var s = new String(block);
  s.trailing = trail;
  // To make it clear its not just a string
  s.inspect = mk_block_inspect;
  s.toSource = mk_block_toSource;

  if ( line != undefined )
    s.lineNumber = line;

  return s;
};

function count_lines( str ) {
  var n = 0, i = -1;
  while ( ( i = str.indexOf("\n", i + 1) ) !== -1 ) n++;
  return n;
}

// Internal - split source into rough blocks
Markdown.prototype.split_blocks = function splitBlocks( input, startLine ) {
  input = input.replace(/(\r\n|\n|\r)/g, "\n");
  // [\s\S] matches _anything_ (newline or space)
  var re = /([\s\S]+?)($|\n(?:\s*\n|$)+)/g,
      blocks = [],
      m;

  var line_no = 1;

  if ( ( m = /^(\s*\n)/.exec(input) ) != null ) {
    // skip (but count) leading blank lines
    line_no += count_lines( m[0] );
    re.lastIndex = m[0].length;
  }

  while ( ( m = re.exec(input) ) !== null ) {
    blocks.push( mk_block( m[1], m[2], line_no ) );
    line_no += count_lines( m[0] );
  }

  return blocks;
};

/**
 *  Markdown#processBlock( block, next ) -> undefined | [ JsonML, ... ]
 *  - block (String): the block to process
 *  - next (Array): the following blocks
 *
 * Process `block` and return an array of JsonML nodes representing `block`.
 *
 * It does this by asking each block level function in the dialect to process
 * the block until one can. Succesful handling is indicated by returning an
 * array (with zero or more JsonML nodes), failure by a false value.
 *
 * Blocks handlers are responsible for calling [[Markdown#processInline]]
 * themselves as appropriate.
 *
 * If the blocks were split incorrectly or adjacent blocks need collapsing you
 * can adjust `next` in place using shift/splice etc.
 *
 * If any of this default behaviour is not right for the dialect, you can
 * define a `__call__` method on the dialect that will get invoked to handle
 * the block processing.
 */
Markdown.prototype.processBlock = function processBlock( block, next ) {
  var cbs = this.dialect.block,
      ord = cbs.__order__;

  if ( "__call__" in cbs ) {
    return cbs.__call__.call(this, block, next);
  }

  for ( var i = 0; i < ord.length; i++ ) {
    //D:this.debug( "Testing", ord[i] );
    var res = cbs[ ord[i] ].call( this, block, next );
    if ( res ) {
      //D:this.debug("  matched");
      if ( !isArray(res) || ( res.length > 0 && !( isArray(res[0]) ) ) )
        this.debug(ord[i], "didn't return a proper array");
      //D:this.debug( "" );
      return res;
    }
  }

  // Uhoh! no match! Should we throw an error?
  return [];
};

Markdown.prototype.processInline = function processInline( block ) {
  return this.dialect.inline.__call__.call( this, String( block ) );
};

/**
 *  Markdown#toTree( source ) -> JsonML
 *  - source (String): markdown source to parse
 *
 *  Parse `source` into a JsonML tree representing the markdown document.
 **/
// custom_tree means set this.tree to `custom_tree` and restore old value on return
Markdown.prototype.toTree = function toTree( source, custom_root ) {
  var blocks = source instanceof Array ? source : this.split_blocks( source );

  // Make tree a member variable so its easier to mess with in extensions
  var old_tree = this.tree;
  try {
    this.tree = custom_root || this.tree || [ "markdown" ];

    blocks:
    while ( blocks.length ) {
      var b = this.processBlock( blocks.shift(), blocks );

      // Reference blocks and the like won't return any content
      if ( !b.length ) continue blocks;

      this.tree.push.apply( this.tree, b );
    }
    return this.tree;
  }
  finally {
    if ( custom_root ) {
      this.tree = old_tree;
    }
  }
};

// Noop by default
Markdown.prototype.debug = function () {
  var args = Array.prototype.slice.call( arguments);
  args.unshift(this.debug_indent);
  if ( typeof print !== "undefined" )
      print.apply( print, args );
  if ( typeof console !== "undefined" && typeof console.log !== "undefined" )
      console.log.apply( null, args );
}

Markdown.prototype.loop_re_over_block = function( re, block, cb ) {
  // Dont use /g regexps with this
  var m,
      b = block.valueOf();

  while ( b.length && (m = re.exec(b) ) != null ) {
    b = b.substr( m[0].length );
    cb.call(this, m);
  }
  return b;
};

/**
 * Markdown.dialects
 *
 * Namespace of built-in dialects.
 **/
Markdown.dialects = {};

// Build default order from insertion order.
Markdown.buildBlockOrder = function(d) {
  var ord = [];
  for ( var i in d ) {
    if ( i == "__order__" || i == "__call__" ) continue;
    ord.push( i );
  }
  d.__order__ = ord;
};

// Build patterns for inline matcher
Markdown.buildInlinePatterns = function(d) {
  var patterns = [];

  for ( var i in d ) {
    // __foo__ is reserved and not a pattern
    if ( i.match( /^__.*__$/) ) continue;
    var l = i.replace( /([\\.*+?|()\[\]{}])/g, "\\$1" )
             .replace( /\n/, "\\n" );
    patterns.push( i.length == 1 ? l : "(?:" + l + ")" );
  }

  patterns = patterns.join("|");
  d.__patterns__ = patterns;
  //print("patterns:", uneval( patterns ) );

  var fn = d.__call__;
  d.__call__ = function(text, pattern) {
    if ( pattern != undefined ) {
      return fn.call(this, text, pattern);
    }
    else
    {
      return fn.call(this, text, patterns);
    }
  };
};

Markdown.DialectHelpers = {};
Markdown.DialectHelpers.inline_until_char = function( text, want ) {
  var consumed = 0,
      nodes = [];

  while ( true ) {
    if ( text.charAt( consumed ) == want ) {
      // Found the character we were looking for
      consumed++;
      return [ consumed, nodes ];
    }

    if ( consumed >= text.length ) {
      // No closing char found. Abort.
      return null;
    }

    var res = this.dialect.inline.__oneElement__.call(this, text.substr( consumed ) );
    consumed += res[ 0 ];
    // Add any returned nodes.
    nodes.push.apply( nodes, res.slice( 1 ) );
  }
}

var isArray = Array.isArray || function(obj) {
  return Object.prototype.toString.call(obj) == "[object Array]";
};

function extract_attr( jsonml ) {
  return isArray(jsonml)
      && jsonml.length > 1
      && typeof jsonml[ 1 ] === "object"
      && !( isArray(jsonml[ 1 ]) )
      ? jsonml[ 1 ]
      : undefined;
}



/**
 *  renderJsonML( jsonml[, options] ) -> String
 *  - jsonml (Array): JsonML array to render to XML
 *  - options (Object): options
 *
 *  Converts the given JsonML into well-formed XML.
 *
 *  The options currently understood are:
 *
 *  - root (Boolean): wether or not the root node should be included in the
 *    output, or just its children. The default `false` is to not include the
 *    root itself.
 */
expose.renderJsonML = function( jsonml, options ) {
  options = options || {};
  // include the root element in the rendered output?
  options.root = options.root || false;

  var content = [];

  if ( options.root ) {
    content.push( render_tree( jsonml ) );
  }
  else {
    jsonml.shift(); // get rid of the tag
    if ( jsonml.length && typeof jsonml[ 0 ] === "object" && !( jsonml[ 0 ] instanceof Array ) ) {
      jsonml.shift(); // get rid of the attributes
    }

    while ( jsonml.length ) {
      content.push( render_tree( jsonml.shift() ) );
    }
  }

  return content.join( "\n\n" );
};

function escapeHTML( text ) {
  return text.replace( /&/g, "&amp;" )
             .replace( /</g, "&lt;" )
             .replace( />/g, "&gt;" )
             .replace( /"/g, "&quot;" )
             .replace( /'/g, "&#39;" );
}

function render_tree( jsonml ) {
  // basic case
  if ( typeof jsonml === "string" ) {
    return escapeHTML( jsonml );
  }

  var tag = jsonml.shift(),
      attributes = {},
      content = [];

  if ( jsonml.length && typeof jsonml[ 0 ] === "object" && !( jsonml[ 0 ] instanceof Array ) ) {
    attributes = jsonml.shift();
  }

  while ( jsonml.length ) {
    content.push( render_tree( jsonml.shift() ) );
  }

  // edge case where tag has been removed at some point (e.g. preprocessTreeNode)
  if ( !tag ) {
    return content
  }

  var tag_attrs = "";
  for ( var a in attributes ) {
    tag_attrs += " " + a + '="' + escapeHTML( attributes[ a ] ) + '"';
  }

  // be careful about adding whitespace here for inline elements
  if ( tag == "img" || tag == "br" || tag == "hr" ) {
    return "<"+ tag + tag_attrs + "/>";
  }
  else {
    return "<"+ tag + tag_attrs + ">" + content.join( "" ) + "</" + tag + ">";
  }
}

function convert_tree_to_html( tree, references, options ) {
  var i;
  options = options || {};

  // shallow clone
  var jsonml = tree.slice( 0 );

  if ( typeof options.preprocessTreeNode === "function" ) {
      jsonml = options.preprocessTreeNode(jsonml, references);
  }

  // Clone attributes if they exist
  var attrs = extract_attr( jsonml );
  if ( attrs ) {
    jsonml[ 1 ] = {};
    for ( i in attrs ) {
      jsonml[ 1 ][ i ] = attrs[ i ];
    }
    attrs = jsonml[ 1 ];
  }

  // basic case
  if ( typeof jsonml === "string" ) {
    return jsonml;
  }

  // convert this node
  switch ( jsonml[ 0 ] ) {
    case "header":
      jsonml[ 0 ] = "h" + jsonml[ 1 ].level;
      delete jsonml[ 1 ].level;
      break;
    case "bulletlist":
      jsonml[ 0 ] = "ul";
      break;
    case "numberlist":
      jsonml[ 0 ] = "ol";
      break;
    case "listitem":
      jsonml[ 0 ] = "li";
      break;
    case "para":
      jsonml[ 0 ] = "p";
      break;
    case "markdown":
      jsonml[ 0 ] = "html";
      if ( attrs ) delete attrs.references;
      break;
    case "code_block":
      jsonml[ 0 ] = "pre";
      i = attrs ? 2 : 1;
      var code = [ "code" ];
      code.push.apply( code, jsonml.splice( i, jsonml.length - i ) );
      jsonml[ i ] = code;
      break;
    case "inlinecode":
      jsonml[ 0 ] = "code";
      break;
    case "img":
      jsonml[ 1 ].src = jsonml[ 1 ].href;
      delete jsonml[ 1 ].href;
      break;
    case "linebreak":
      jsonml[ 0 ] = "br";
    break;
    case "link":
      jsonml[ 0 ] = "a";
      break;
    case "link_ref":
      jsonml[ 0 ] = "a";

      // grab this ref and clean up the attribute node
      var ref = references[ attrs.ref ];

      // if the reference exists, make the link
      if ( ref ) {
        delete attrs.ref;

        // add in the href and title, if present
        attrs.href = ref.href;
        if ( ref.title ) {
          attrs.title = ref.title;
        }

        // get rid of the unneeded original text
        delete attrs.original;
      }
      // the reference doesn't exist, so revert to plain text
      else {
        return attrs.original;
      }
      break;
    case "img_ref":
      jsonml[ 0 ] = "img";

      // grab this ref and clean up the attribute node
      var ref = references[ attrs.ref ];

      // if the reference exists, make the link
      if ( ref ) {
        delete attrs.ref;

        // add in the href and title, if present
        attrs.src = ref.href;
        if ( ref.title ) {
          attrs.title = ref.title;
        }

        // get rid of the unneeded original text
        delete attrs.original;
      }
      // the reference doesn't exist, so revert to plain text
      else {
        return attrs.original;
      }
      break;
  }

  // convert all the children
  i = 1;

  // deal with the attribute node, if it exists
  if ( attrs ) {
    // if there are keys, skip over it
    for ( var key in jsonml[ 1 ] ) {
      i = 2;
    }
    // if there aren't, remove it
    if ( i === 1 ) {
      jsonml.splice( i, 1 );
    }
  }

  for ( ; i < jsonml.length; ++i ) {
    jsonml[ i ] = convert_tree_to_html( jsonml[ i ], references, options );
  }

  return jsonml;
}


// merges adjacent text nodes into a single node
function merge_text_nodes( jsonml ) {
  // skip the tag name and attribute hash
  var i = extract_attr( jsonml ) ? 2 : 1;

  while ( i < jsonml.length ) {
    // if it's a string check the next item too
    if ( typeof jsonml[ i ] === "string" ) {
      if ( i + 1 < jsonml.length && typeof jsonml[ i + 1 ] === "string" ) {
        // merge the second string into the first and remove it
        jsonml[ i ] += jsonml.splice( i + 1, 1 )[ 0 ];
      }
      else {
        ++i;
      }
    }
    // if it's not a string recurse
    else {
      merge_text_nodes( jsonml[ i ] );
      ++i;
    }
  }
}

} )( (function() {
  if ( typeof exports === "undefined" ) {
    window.markdown = {};
    return window.markdown;
  }
  else {
    return exports;
  }
} )() );

// Released under BSD license
// Copyright (c) 2013 Apollic Software, LLC
(function (expose) {
  var Preprocesser, forEach;

  (function (Markdown) {

    // Tent markdown flavor (https://github.com/tent/tent.io/issues/180)
    Markdown.dialects.Tent = {
      block: {
        // member name: fn(block, remaining_blocks) -> json markdown tree or undefined

        // Taken from Markdown.dialects.Gruber.block.para
        para: function para( block, next ) {
          // everything's a para!
          return [ ["para"].concat( this.processInline( block ) ) ];
        }
      },

      inline: {
        // member pattern_or_regex: (text, match, tree) -> [ length, string_or_tree ]
        // __x__ members are not patterns
        // __call__ is called by Markdown.prototype.processInline()

        /*
         * Reserved member functions:
         */

        // Taken from Markdown.dialect.Gruber.inline.__oneElement__
        __oneElement__: function oneElement( text, patterns_or_re, previous_nodes ) {
          var m,
              res,
              lastIndex = 0;

          patterns_or_re = patterns_or_re || this.dialect.inline.__patterns__;
          var re = new RegExp( "([\\s\\S]*?)(" + (patterns_or_re.source || patterns_or_re) + ")" );

          m = re.exec( text );
          if (!m) {
            // Just boring text
            return [ text.length, text ];
          }
          else if ( m[1] ) {
            // Some un-interesting text matched. Return that first
            return [ m[1].length, m[1] ];
          }

          var res;
          if ( m[2] in this.dialect.inline ) {
            res = this.dialect.inline[ m[2] ].call(
                      this,
                      text.substr( m.index ), m, previous_nodes || [] );
          }
          // Default for now to make dev easier. just slurp special and output it.
          res = res || [ m[2].length, m[2] ];
          return res;
        },

        // Taken from Markdown.dialect.Gruber.inline.__call__
        __call__: function inline( text, patterns ) {

          var out = [],
              res;

          function add(x) {
            //D:self.debug("  adding output", uneval(x));
            if ( typeof x == "string" && typeof out[out.length-1] == "string" )
              out[ out.length-1 ] += x;
            else
              out.push(x);
          }

          while ( text.length > 0 ) {
            res = this.dialect.inline.__oneElement__.call(this, text, patterns, out );
            text = text.substr( res.shift() );
            forEach(res, add )
          }

          return out;
        },

        /*
         * Pattern member functions:
         */

        // Taken from Markdown.dialects.Gruber.inline
        // These characters are intersting elsewhere, so have rules for them so that
        // chunks of plain text blocks don't include them
        "]": function () {},
        "}": function () {},
      
        // Taken from Markdown.dialects.Gruber.inline["\\"]
        // Modification: change escape chars (removed { } # + - . ! and added ~)
        "\\": function escaped( text ) {
          // [ length of input processed, node/children to add... ]
          // Only esacape: \ ` * _ [ ] ( ) * ~
          if ( text.match( /^\\[\\`\*_\[\]()\~]/ ) )
            return [ 2, text.charAt( 1 ) ];
          else
            // Not an esacpe
            return [ 1, "\\" ];
        },

        "*": function bold( text ) {
          // Inline content is possible inside `bold text`
          var res = Markdown.DialectHelpers.inline_until_char.call( this, text.substr(1), "*" );

          // Not bold
          if ( !res ) return [ 1, "*" ];

          var consumed = 1 + res[ 0 ],
              children = res[ 1 ];


          return [consumed, ["strong"].concat(children)]
        },

        "_": function italic( text ) {
          // Inline content is possible inside `bold text`
          var res = Markdown.DialectHelpers.inline_until_char.call( this, text.substr(1), "_" );

          // Not bold
          if ( !res ) return [ 1, "_" ];

          var consumed = 1 + res[ 0 ],
              children = res[ 1 ];


          return [consumed, ["em"].concat(children)]
        },

        "~": function italic( text ) {
          // Inline content is possible inside `bold text`
          var res = Markdown.DialectHelpers.inline_until_char.call( this, text.substr(1), "~" );

          // Not bold
          if ( !res ) return [ 1, "~" ];

          var consumed = 1 + res[ 0 ],
              children = res[ 1 ];


          return [consumed, ["del"].concat(children)]
        },

        // Taken from Markdown.dialects.Gruber.inline["["]
        // Modification: Only allow the most basic link syntax.
        "[": function link( text ) {

          var orig = String(text);
          // Inline content is possible inside `link text`
          var res = Markdown.DialectHelpers.inline_until_char.call( this, text.substr(1), "]" );

          // No closing ']' found. Just consume the [
          if ( !res ) return [ 1, "[" ];

          var consumed = 1 + res[ 0 ],
              children = res[ 1 ],
              link,
              attrs;

          // At this point the first [...] has been parsed. See what follows to find
          // out which kind of link we are (reference or direct url)
          text = text.substr( consumed );

          // [link text](/path/to/img.jpg)
          //                 1             <--- captures
          // This will capture up to the last paren in the block. We then pull
          // back based on if there a matching ones in the url
          //    ([here](/url/(test))
          // The parens have to be balanced

          var m = text.match( /^\(([^"']*)\)/ );
          if ( m ) {
            var url = m[1];
            consumed += m[0].length;

            var open_parens = 1; // One open that isn't in the capture
            for ( var len = 0; len < url.length; len++ ) {
              switch ( url[len] ) {
              case "(":
                open_parens++;
                break;
              case ")":
                if ( --open_parens == 0) {
                  consumed -= url.length - len;
                  url = url.substring(0, len);
                }
                break;
              }
            }

            // Process escapes only
            url = this.dialect.inline.__call__.call( this, url, /\\/ )[0];

            attrs = { href: url || "" };

            link = [ "link", attrs ].concat( children );
            return [ consumed, link ];
          }

          // Just consume the "["
          return [ 1, "[" ];
        },

        // Taken from Markdown.dialects.Gruber.inline["`"]
        // Modification: Only allow a single opening backtick
        "`": function inlineCode( text ) {
          // Always skip over the opening tick.
          var m = text.match( /(`)(([\s\S]*?)\1)/ );

          if ( m && m[2] )
            return [ m[1].length + m[2].length, [ "inlinecode", m[3] ] ];
          else {
            // No closing backtick, it's just text
            return [ 1, "`" ];
          }
        },

        // Taken from Markdown.dialects.Gruber.inline["  \n"]
        // Modification: Don't require spaces before \n
        "\n": function lineBreak( text ) {
          return [ 3, [ "linebreak" ] ];
        }

      }
    }

    Markdown.buildBlockOrder ( Markdown.dialects.Tent.block );
    Markdown.buildInlinePatterns( Markdown.dialects.Tent.inline );

  })( expose.Markdown )

  // Don't mess with Array.prototype. Its not friendly
  if ( Array.prototype.forEach ) {
    forEach = function( arr, cb, thisp ) {
      return arr.forEach( cb, thisp );
    };
  }
  else {
    forEach = function(arr, cb, thisp) {
      for (var i = 0; i < arr.length; i++) {
        cb.call(thisp || arr, arr[i], i, arr);
      }
    }
  }

  Preprocesser = function ( options ) {
    this.footnotes = options.footnotes || [];
    this.preprocessors = [this.expandFootnoteLinkHrefs].concat(options.preprocessors || []);
  }

  Preprocesser.prototype.expandFootnoteLinkHrefs = function ( jsonml ) {
    // Skip over anything that isn't a link
    if (jsonml[0] !== 'link') return jsonml;

    // Skip over links that arn't footnotes
    if (!jsonml[1] || !jsonml[1].href || !/^\d+$/.test(jsonml[1].href)) return jsonml;

    // Get href from footnodes array
    var index = parseInt(jsonml[1].href);
    jsonml[1].href = this.footnotes[index];

    // Unlink node if footnote doesn't exist
    if (!jsonml[1].href) {
      return [null].concat(jsonml.slice(2));
    }

    return jsonml;
  }

  Preprocesser.prototype.preprocessTreeNode = function ( jsonml, references ) {
    for (var i=0, _len = this.preprocessors.length; i < _len; i++) {
      var fn = this.preprocessors[i]
      if (!(typeof fn === 'function')) continue;
      jsonml = fn.call(this, jsonml, references);
    }
    return jsonml;
  }

  // Pre-process all link nodes to expand the [text](index) footnote syntax to actual links
  // and unlink non-existant footnote references.
  // Pass options.footnotes = [ href, ... ] to expand footnote links
  __toHTML__ = expose.toHTML;
  expose.toHTML = function ( source, dialect, options ) {
    options = options || {};
    if (dialect === 'Tent') {
      if (!(typeof options.preprocessTreeNode === 'function')) {
        preprocesser = new Preprocesser( options );
        options.preprocessTreeNode = function () {
          return preprocesser.preprocessTreeNode.apply(preprocesser, arguments);
        }
      }
    }
    return __toHTML__.call(null, source, dialect, options);
  }
})(function () {
  if ( typeof exports === "undefined" ) {
    return window.markdown;
  }
  else {
    exports.markdown = require('markdown').markdown;
    return exports.markdown;
  }
}())
