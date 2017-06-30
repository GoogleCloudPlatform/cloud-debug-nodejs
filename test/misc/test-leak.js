'use strict';

var v8debugapi = require('../build/src/v8debugapi.js');
var Logger = require('../build/src/logger.js');
var config = require('../config.js').default;
var assert = require('assert');
var util = require('util');
var logger = new Logger(config.logLevel);

assert.ok(v8debugapi.init(logger, config));

var iters = 0;

function test() {
  iters++;
  
  var bp = {
    id: 'fake-breakpoint',
    location: { path: __filename, line: 4}
  };
  v8debugapi.set(bp);
  v8debugapi.clear(bp);

  if (iters % 100 === 0) {
    console.log(iters + ' ' + util.inspect(process.memoryUsage()));
  }

  // infinite loop
  setImmediate(test);
}

test();






