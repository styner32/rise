'use strict';

const http = require('http'),
      EventEmitter = require('events'),
      encodeURL = require('encodeurl'),
      cookie = require('cookie'),
      cookieSignature = require('cookie-signature'),
      headers = require('./headers');

/** Response */
class Response extends EventEmitter {
  /**
   * Do not initialize this class on your own. An instance of this class is provided to your handler as a parameter.
   * @param {Object} props
   */
  constructor(props) {
    super();
    props = props || {};

    this.__app = props.app;
    this.__req = props.req;
    this.__done = props.done;

    this.__statusCode = null;
    this.__finished = false;
    this.__headers = {};
    this.__body = '';

    this.locals = {};
  }

  /**
   * [App]{@link App} object, used to access application-wide settings.
   * @type {App}
   * @readonly
   * @see {@link App}
   */
  get app() {
    return this.__app;
  }

  get req() {
    return this.__req;
  }

  /**
   * Whether the HTTP response has already been sent
   * @type {boolean}
   * @readonly
   * @example
   * res.end();
   * res.finished // => true
   */
  get finished() {
    return this.__finished;
  }

  /**
   * HTTP response status code
   * @type {number}
   * @readonly
   * @example
   * res.status(404);
   * res.statusCode // => 404
   */
  get statusCode() {
    const status = this.__statusCode;
    return status == null ? 200 : status;
  }

  /**
   * HTTP response headers, following [Node.js convention](https://nodejs.org/api/http.html#http_message_headers)
   * @type {Object}
   * @readonly
   * @example
   * res.set('content-type', 'text/plain')
   *    .set('set-cookie', 'foo=123; Expires=Sun, 1-Jan-2017 00:00:00 GMT; Path=/; Domain=foo.com')
   *    .set('x-foo', ['bar', 'baz']);
   * res.headers
   * // => {
   * //   'content-type': 'text/plain',
   * //   'set-cookie': ['foo=123; Expires=Sun, 1-Jan-2017 00:00:00 GMT; Path=/; Domain=foo.com'],
   * //   'x-foo': 'bar, baz'
   * // }
   */
  get headers() {
    return headers.toNode(this.__headers);
  }

  /**
   * HTTP response body
   * @type {string}
   * @readonly
   * @example
   * res.send({ foo: 'bar' });
   * res.body // => '{"foo":"bar"}'
   */
  get body() {
    return this.__body;
  }

  /**
   * Sends an HTTP response with a given status code and the JSON representation of the status code as the response body.
   * @param {number} statusCode - Status code
   * @returns {Response} this
   * @example
   * res.sendStatus(200); // equivalent to res.status(200).send({ status: 'OK' });
   * res.sendStatus(403); // equivalent to res.status(403).send({ status: 'Forbidden' });
   * res.sendStatus(404); // equivalent to res.status(404).send({ status: 'Not Found' });
   * res.sendStatus(500); // equivalent to res.status(404).send({ status: 'Internal Server Error' });
   */
  sendStatus(statusCode) {
    if ((typeof statusCode !== 'string' && typeof statusCode !== 'number') ||
        (typeof statusCode === 'string' && isNaN(statusCode = parseInt(statusCode, 10)))) {
      throw new TypeError("'statusCode' must be a number");
    }

    return this.status(statusCode).send({ status: http.STATUS_CODES[statusCode] || String(statusCode) });
  }

  /**
   * Sends an HTTP response.
   * @param {(string|boolean|number|Object|Array|Buffer)} [body] - Response body
   * @returns {Response} this
   * @example
   * res.send({ some: 'json' });
   * res.send([ { foo: 1 }, { foo: 2 } ]);
   * res.send('Hello world!');
   * res.send(new Buffer('foobar'));
   * res.status(404).send({ error: 'not_found' });
   * res.status(500).send('something went wrong');
   */
  send(body) {
    switch (typeof body) {
      case 'string':
        if (!this.get('Content-Type')) {
          this.type('html');
        }
        this.__body = body;
        break;

      case 'object':
        if (body === null) { // typeof null === 'object'
          break;
        }
        if (body instanceof Buffer) {
          if (!this.get('Content-Type')) {
            this.type('bin');
          }
          this.__body = body.toString('binary');
          break;
        }
        // fall through

      case 'boolean':
      case 'number':
        if (!this.get('Content-Type')) {
          this.type('json');
        }
        this.__body = JSON.stringify(body);
        break;

      case 'undefined':
        break;

      default:
        throw new TypeError("Unsupported type for 'body'");
    }

    this.end();
    return this;
  }

  /**
   * Sends an HTTP response with JSON body. The parameter will be converted to JSON with `JSON.stringify()` function.
   * @param {*} [body] - Data to be represented as JSON in the response body
   * @returns {Response} this
   * @example
   * res.json({ some: 'json' });
   * res.status(500).send({ error: 'something went wrong' });
   */
  json(body) {
    if (!this.get('Content-Type')) {
      this.type('json');
    }
    this.__body = JSON.stringify(body);
    this.end();
    return this;
  }

  /**
   * Sends an HTTP response with JSON body, optionally wrapped with JSONP callback.
   * The default query string param for JSONP callback name is `callback`. It can be overridden with the `jsonp callback name` setting.
   * If the callback name is not specified in the query string params, the behavior of this method is identical to [res.json()]{@link Response#json}.
   * @param {*} [body] - Data to be represented as JSON in the response body
   * @returns {Response} this
   * @example
   * // ?callback=foo
   * res.jsonp({ data: "hello world" });
   * // => foo({ "data": "hello world" });
   *
   * app.set('jsonp callback name', 'cb');
   * // ?cb=handle
   * res.status(500).jsonp({ error: 'something went wrong' });
   * // => handle({ "error": "something went wrong" });
   */
  jsonp(body) {
    const callbackQuery = (this.app && this.app.get('jsonp callback name')) || 'callback';
    let callbackName = this.req && this.req.query && this.req.query[callbackQuery];

    if (Array.isArray(callbackName)) {
      callbackName = callbackName[0];
    }

    if (!callbackName || typeof callbackName !== 'string') {
      return this.json(body);
    }

    if (!this.get('Content-Type')) {
      this.set({
        'X-Content-Type-Options': 'nosniff',
        'Content-Type': 'text/javascript; charset=utf-8'
      });
    }

    body = JSON.stringify(body).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

    this.__body = `/**/${callbackName}(${body});`;
    this.end();
    return this;
  }

  /**
   * Sets the `Location` HTTP response header to the given `url` parameter.
   * If `url` is `"back"`, it uses the value of the `Referer` in the request header unless the it is absent, in which case it will use the value `"\"`.
   * @param {string} url - URL/Path to be assigned to the `Location` header
   * @returns {Response} this
   * @example
   * res.location('/hello/world');
   * res.location('https://www.example.com/');
   * res.location('back');
   */
  location(url) {
    url = url ? String(url) : '/';

    if (url === 'back') {
      url = (this.req && this.req.headers && this.req.headers.referer) || '/';
    }

    return this.set('location', encodeURL(url));
  }

  /**
   * Sends a redirect response to the given `url`. If `status` is not specified, the default status of `302 Found` is used.
   * If `url` is `"back"`, it uses the value of the `Referer` in the request header unless the it is absent, in which case it will use the value `"\"`.
   * @param {status} [statusCode] - HTTP status code
   * @param {string} url - URL/Path to be assigned to the `Location` header
   * @returns {Response} this
   * @example
   * res.redirect('/hello/world');
   * res.redirect('https://www.example.com/');
   * res.redirect(301, '/hello/world');
   * res.redirect('back');
   */
  redirect(statusCode, url) {
    if (arguments.length === 1) {
      url = statusCode;
      statusCode = 302;
    }

    if (typeof statusCode !== 'number') {
      throw new TypeError("'statusCode' must be a number");
    }

    const location = this.location(url).get('location');
    return this.status(statusCode).send({ location });
  }

  /**
   * Sends an HTTP response. This function is usually invoked without any arguments to quickly respond without any data. To respond with data, you should use [res.send()]{@link Response#send} or [res.json()]{@link Response#json} instead.
   * @param {string|Buffer} [data] - data to write
   * @param {string} [encoding] - encoding to use when `data` is a string
   * @param {function} [callback] - callback to be invoked after the response is sent
   * @returns {boolean} true if response is sent
   */
  end(data, encoding, callback) {
    if (typeof data === 'function') {
      callback = data;
      data = undefined;
    } else if (data != null) {
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      this.write(data, encoding);
    }

    if (this.__finished) {
      throw new Error('Response is already ended');
    }

    const statusCode = this.__statusCode != null ? this.__statusCode : 200; // allow 0
    let body = this.__body;

    if ((this.__req && this.__req.method === 'HEAD') || this.__statusCode === 204) {
      body = '';
    }

    if (typeof this.__done !== 'function') {
      return false;
    }

    this.__done(null, {
      statusCode,
      headers: this.headers,
      body
    });
    this.__finished = true;
    this.emit('finish');
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  }

  /**
   * Sets the HTTP response status code.
   * @param {number} code - HTTP status code
   * @returns {Response} this
   * @example
   * res.status(200).send({ status: 'ok' });
   */
  status(code) {
    if (typeof code !== 'number') {
      throw new TypeError("'code' must be a number");
    }
    this.__statusCode = code;
    return this;
  }

  /**
   * Sets the `Content-Type` HTTP header. Known values for the `type` parameter are `html`, `js`, `json`, and `text`. If the `type` parameter passed contains the `/` character, it sets the `Content-Type` to `type`.
   * @param {string} type - type of the response body
   * @returns {Response} this
   * @example
   * res.type('html');      // => 'text/html'
   * res.type('text/html'); // => 'text/html'
   * res.type('.html');     // => 'text/html'
   * res.type('json');      // => 'application/json'
   * res.type('png');       // => 'image/png'
   */
  type(type) {
    if (typeof type !== 'string' ||
        (typeof type === 'string' && type.length === 0)) {
      throw new TypeError("'type' must be a non-empty string");
    }

    if (!type.includes('/')) {
      if (type[0] === '.') {
        type = type.slice(1);
      }

      switch (type) {
        case 'htm':
        case 'html':
          type = 'text/html; charset=utf-8';
          break;

        case 'js':
          type = 'application/javascript; charset=utf-8';
          break;

        case 'json':
          type = 'application/json; charset=utf-8';
          break;

        case 'txt':
        case 'text':
          type = 'text/plain; charset=utf-8';
          break;

        case 'bin':
          type = 'application/octet-stream';
          break;
      }
    }

    this.set('Content-Type', type);
    return this;
  }

  /**
   * Returns the value of the HTTP response header by a given `field`. The match is not case-sensitive.
   * @param {string} field - Header field name
   * @returns {(string|string[])} value of the header
   */
  get(field) {
    if (typeof field !== 'string' ||
        (typeof field === 'string' && field.length === 0)) {
      throw new TypeError('`field` must be a non-empty string');
    }

    field = field.toLowerCase();
    const val = this.__headers[field];

    if (!Array.isArray(val)) {
      return null;
    }

    return val.length === 1 ? val[0] : val;
  }

  /**
   * Sets the HTTP response header `field` to `value`. It replaces any existing value for the given `field`. To append rather than to replace, use [res.append()]{@link Response#append}. To set multiple fields at once, pass an object.
   * @param {(string|Object)} field - Header field name or an object containing a key-value mapping of headers.
   * @param {(string|string[])} [value] - Header value or a list of values
   * @returns {Response} this
   * @example
   * res.set('Content-Type', 'text/plain');
   * res.set({
   *   'Content-Type': 'text/plain',
   *   Pragma: 'no-cache'
   * });
   * res.set('X-Foo', ['bar', 'baz']);
   */
  set(field, value) {
    if ((typeof field === 'object' && !field) ||
        (typeof field !== 'object' && typeof field !== 'string') ||
        (typeof field === 'string' && field.length === 0)) {
      throw new TypeError('`field` must be a non-empty string or an object containing a key-value mapping of headers');
    }

    if (typeof field !== 'string') {
      for (const f in field) {
        if (!field.hasOwnProperty(f)) {
          continue;
        }
        this.set(f, field[f]);
      }
      return this;
    }

    field = field.toLowerCase();

    if (Array.isArray(value)) {
      this.__headers[field] = [];
      for (const i in value) {
        this.append(field, value[i]);
      }
      return this;
    }

    this.__headers[field] = [String(value).trim()];
    return this;
  }

  /**
   * Appends a given `value` to the HTTP response header `field`. If the header `field` is not already set, it creates the header with the given `value`.
   * @param {(string|Object)} field - Header field name or an object containing a key-value mapping of header fields.
   * @param {(string|string[])} [value] - Header value or a list of values
   * @returns {Response} this
   * @example
   * res.append('Content-Type', 'text/plain');
   * res.append({
   *   'Content-Type': 'text/plain',
   *   Pragma: 'no-cache'
   * });
   * res.append('X-Foo', ['bar', 'baz']);
   **/
  append(field, value) {
    if ((typeof field === 'object' && !field) ||
        (typeof field !== 'object' && typeof field !== 'string') ||
        (typeof field === 'string' && field.length === 0)) {
      throw new TypeError('`field` must be a non-empty string or an object containing a key-value mapping of headers');
    }

    if (typeof field !== 'string') {
      for (const f in field) {
        if (!field.hasOwnProperty(f)) {
          continue;
        }
        this.append(f, field[f]);
      }
      return this;
    }

    field = field.toLowerCase();

    if (Array.isArray(value)) {
      for (const i in value) {
        this.append(field, value[i]);
      }
      return this;
    }

    if (Array.isArray(this.__headers[field])) {
      this.__headers[field].push(String(value).trim());
    } else {
      this.set(field, value);
    }
    return this;
  }

  /**
   * Removes the HTTP response header `field`.
   * @param {string} field - Header field name
   * @returns {Response} this
   * @example
   * res.removeHeader('Content-Type');
   */
  removeHeader(field) {
    if (typeof field !== 'string' ||
        (typeof field === 'string' && field.length === 0)) {
      throw new TypeError("'field' must be a non-empty string");
    }

    field = field.toLowerCase();
    if (Array.isArray(this.__headers[field])) {
      this.__headers[field] = undefined;
    }
    return this;
  }

  /**
   * Sets a cookie by adding a `Set-Cookie` header. The `value` paramter can either be a string or an object which can be represented as JSON.
   *
   * To clear a cookie, use [res.clearCookie()]{@link Response#clearCookie}. `undefined`, `null`, `false`, and empty string (`""`) are valid values for the `value` parameter.
   *
   * ##### Options:
   *
   * | Property   | Type                  | Default Value        | Description                                                                                    |
   * |:-----------|:----------------------|:---------------------|:-----------------------------------------------------------------------------------------------|
   * | `domain`   | string                | Not set              | Domain name where cookie is valid                                                              |
   * | `encode`   | function              | `encodeURIComponent` | Function to be used to encode value                                                            |
   * | `expires`  | Date                  | Not set              | Expiration date                                                                                |
   * | `httpOnly` | boolean               | false                | Make cookie visible only by the backend web app, and not by JavaScript                         |
   * | `maxAge`   | number                | Not set              | Number of **milliseconds** after which the cookie will be expired                              |
   * | `path`     | string                | `"/"`                | Path where cookie is valid                                                                     |
   * | `sameSite` | boolean &#124; string | false                | Disable third-party usage of cookie (allowed values: `true` / `false` / `"lax"` / `"strict"`)  |
   * | `secure`   | boolean               | false                | Makes cookie valid only with HTTPS                                                             |
   * | `signed`   | boolean               | false                | Whether cookie should be signed. The secret is derived from `cookieParser(secret)` middleware. |
   *
   * @param {string} name - Cookie name
   * @param {*} value - Cookie value
   * @param {Object} [options] - Options
   * @returns {Response} this
   * @example
   * res.cookie('remember', '1', { expires: new Date(Date.now() + 60 * 60 * 24 * 7 * 1000), httpOnly: true });
   * // If a non-string is passed, it is serialized as JSON for you.
   * res.cookie('seen', { ids: [1, 2, 3] }, { maxAge: 86400000 });
   * // The following requires a secret signing key to be passed to `cookieParser(secret)` middleware.
   * res.cookie('username', 'pete', { domain: '.example.com', path: '/', secure: true, signed: true });
   */
  cookie(name, value, options) {
    if (typeof name !== 'string' ||
        (typeof name === 'string' && name.length === 0)) {
      throw new TypeError("'name' must be a non-empty string");
    }
    const opts = options || {},
          secret = this.req && this.req.secret,
          signed = opts.signed;

    if (signed && (typeof secret !== 'string' || secret.length === 0)) {
      throw new Error('`cookieParser(secret)` required for signed cookies');
    }

    let val;

    if (typeof value === 'object') {
      val = 'j:' + JSON.stringify(value);
    } else {
      val = String(value);
    }

    if (signed) {
      val = 's:' + cookieSignature.sign(val, secret);
    }

    opts.path = opts.path || '/';

    const maxAge = parseInt(opts.maxAge, 10);
    if (isNaN(maxAge)) {
      opts.maxAge = null;
    } else {
      opts.maxAge = maxAge / 1000;
      opts.expires = new Date(Date.now() + maxAge);
    }

    return this.append('Set-Cookie', cookie.serialize(name, val, opts));
  }

  /**
   * Clears the cookie by the given `name`.
   * @param {string} name - Cookie name
   * @param {object} [options] - Options. See options parameter for [res.cookie()]{@link Response#cookie}.
   * @returns {Response} this
   * @example
   * res.cookie('remember', '1', { path: '/' });
   * res.clearCookie('remember', { path: '/' });
   */
  clearCookie(name, options) {
    return this.cookie(name, '', Object.assign({ path: '/', expires: new Date(1) }, options));
  }

  /**
   * Set status code and response headers. Exists only for compatibility with http.IncomingResponse. You should use [res.status()]{@link Response#status} and [res.headers()]{@link Response#headers} instead.
   * @param {number} statusCode - status code
   * @param {string} statusMessage - unused
   * @param {Object} headers - headers
   * @returns {boolean} returns true if successful
   * @deprecated
   * @ignore
   */
  writeHead(statusCode, statusMessage, headers) {
    this.status(statusCode).set(headers);
  }

  /**
   * Write data to response body. Exists only for compatibility with http.IncomingResponse. You should use [res.send()]{@link Response#send} instead.
   * @param {string|Buffer} [chunk] - data to write
   * @param {string} [encoding] - encoding to use when `data` is a string
   * @param {function} [callback] - callback to be invoked after data is written
   * @returns {boolean} true if successful
   * @deprecated
   * @ignore
   */
  write(chunk, encoding, callback) {
    if (typeof chunk !== 'string' && !(chunk instanceof Buffer)) {
      throw new TypeError("'chunk' must be a string or a Buffer");
    }
    encoding = encoding || 'utf8';
    this.__body += new Buffer(chunk, encoding).toString('utf8');

    if (typeof callback === 'function') {
      callback();
    }
    return true;
  }

  /**
   * Exists only for compatibility with http.IncomingResponse
   * @returns {boolean} true if response is sent
   * @deprecated
   * @ignore
   */
  get headersSent() {
    return this.__finished;
  }

  /**
   * Exists only for compatibility with http.IncomingResponse
   * @returns {boolean} always true
   * @deprecated
   * @ignore
   */
  get sendDate() {
    return true;
  }

  /**
   * Exists only for compatibility with http.IncomingResponse
   * @returns {undefined}
   * @deprecated
   * @ignore
   */
  get statusMessage() {}

  /**
   * Exists only for compatibility with http.IncomingResponse
   * @returns {Response} this
   * @deprecated
   * @ignore
   */
  setTimeout() {
    return this;
  }

  /**
   * Exists only for compatibility with http.IncomingResponse
   * @returns {undefined}
   * @deprecated
   * @ignore
   */
  addTrailers() {}

  /**
   * Exists only for compatibility with http.IncomingResponse
   * @returns {undefined}
   * @deprecated
   * @ignore
   */
  writeContinue() {}
}

Response.prototype.header = Response.prototype.set;
Response.prototype.setHeader = Response.prototype.set;
Response.prototype.getHeader = Response.prototype.get;

module.exports = Response;
