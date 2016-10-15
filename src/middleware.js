'use strict';

class Stack {
  constructor() {
    this._stack = [];
    this._currIndex = 0;
    this._logStream = process.stderr;
  }

  _defaultErrorHandler(err, req, res) {
    this._logStream.write((err instanceof Error && typeof err.stack === 'string' ? err.stack : String(err)) + "\n");

    if (!res.finished) {
      res.status(500).send({ error: 'Internal Server Error' });
    }
  }

  push(middleware) {
    if (typeof middleware !== 'function') {
      throw new TypeError("'middleware' must be a function");
    }
    this._stack.push(middleware);
    return this;
  }

  run(req, res, err) {
    const stack = this._stack,
          fn = stack[this._currIndex];

    if (!fn) {
      return;
    }

    const nextFn = (err) => {
      if (err != null) {
        const stack = this._stack;
        let fn;

        do {
          this._currIndex++;
          fn = stack[this._currIndex];
          if (!fn) {
            this._defaultErrorHandler(err, req, res);
            return;
          }
        } while (fn.length < 4);
      } else {
        this._currIndex++;
      }

      this.run(req, res, err);
    };

    try {
      if (fn.length < 4) {
        fn(req, res, nextFn);
      } else {
        fn(err, req, res, nextFn);
      }
    } catch (err) {
      nextFn(err);
    }
  }
}

module.exports = {
  Stack
};
