/* KEEP THIS CODE AT THE TOP SO THAT THE BREAKPOINT LINE NUMBERS DON'T CHANGE */
'use strict';
function fib(n) {
  if (n < 2) { return n; } var o = { a: [1, 'hi', true] };
  return fib(n - 1, o) + fib(n - 2, o); // adding o to appease linter.
}
/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

process.env.GCLOUD_DEBUG_LOGLEVEL=2;

var assert = require('assert');
var util = require('util');
var _ = require('lodash'); // for _.find. Can't use ES6 yet.
var cluster = require('cluster');
var extend = require('extend');
var promisifyAll = require('@google-cloud/common').util.promisifyAll;
var Debugger = require('../debugger.js');


var debuggeeId;
var projectId;
var transcript = '';

var FILENAME = 'test-log-throttling.js';

var delay = function(delayTimeMS) {
  return new Promise(function(resolve, reject) {
    setTimeout(resolve, delayTimeMS);
  });
};

function runTest() {
  var api;
  return delay(10 * 1000).then(function() {
    // List debuggees

    // (Assign debugger API)
    var debug = require('../..')();
    promisifyAll(Debugger);
    api = new Debugger(debug);

    return api.listDebuggees(projectId);
  }).then(function(debuggees) {
    // Check that the debuggee created in this test is among the list of
    // debuggees, then list its breakpoints
    debuggees = debuggees[0];

    console.log('-- List of debuggees\n',
      util.inspect(debuggees, { depth: null}));
    assert.ok(debuggees, 'should get a valid ListDebuggees response');
    var result = _.find(debuggees, function(d) {
      return d.id === debuggeeId;
    });
    assert.ok(result, 'should find the debuggee we just registered');

    return api.listBreakpoints(debuggeeId);
  }).then(function(breakpoints) {
    // Delete every breakpoint
    breakpoints = breakpoints[0];

    console.log('-- List of breakpoints\n', breakpoints);

    var promises = breakpoints.map(function(breakpoint) {
      return api.deleteBreakpoint(debuggeeId, breakpoint.id);
    });

    return Promise.all(promises);
  }).then(function() {
    // Set a breakpoint at which the debugger should write to a log

    console.log('-- deleted');

    console.log('-- setting a logpoint');
    return api.setBreakpoint(debuggeeId, {
      id: 'breakpoint-1',
      location: {path: FILENAME, line: 5},
      condition: 'n === 10',
      action: 'LOG',
      expressions: ['o'],
      log_message_format: 'o is: $0'
    });
  }).then(function(breakpoint) {
    // Check that the breakpoint was set, and then wait for the log to be
    // written to
    breakpoint = breakpoint[0];

    assert.ok(breakpoint, 'should have set a breakpoint');
    assert.ok(breakpoint.id, 'breakpoint should have an id');
    assert.ok(breakpoint.location, 'breakpoint should have a location');
    assert.strictEqual(breakpoint.location.path, FILENAME);

    console.log('-- waiting before checking if the log was written');
    return Promise.all([breakpoint, delay(10 * 1000)]);
  }).then(function(results) {
    // Check that the contents of the log is correct

    var breakpoint = results[0];

    // If no throttling occurs, we expect ~20 logs since we are logging
    // 2x per second over a 10 second period.
    var logCount =
      transcript.split('LOGPOINT: o is: {"a":[1,"hi",true]}').length - 1;
    // A log count of greater than 10 indicates that we did not successfully
    // pause when the rate of `maxLogsPerSecond` was reached.
    assert(logCount < 10, 'log count is not less than 10: ' + logCount);
    // A log count of less than 3 indicates that we did not successfully
    // resume logging after `logDelaySeconds` have passed.
    assert(logCount > 2, 'log count is not greater than 2: ' + logCount);

    return api.deleteBreakpoint(debuggeeId, breakpoint.id);
  }).then(function() {
    console.log('-- test passed');
    return Promise.resolve();
  });
}

if (cluster.isMaster) {
  cluster.setupMaster({ silent: true });
  var handler = function(a) {
    // Cache the needed info from the first worker.
    if (!debuggeeId) {
      debuggeeId = a[0];
      projectId = a[1];
    }
  };
  var stdoutHandler = function(chunk) {
    transcript += chunk;
  };
  var worker = cluster.fork();
  worker.on('message', handler);
  worker.process.stdout.on('data', stdoutHandler);
  worker.process.stderr.on('data', stdoutHandler);
  process.on('exit', function() {
    console.log('child transcript: ', transcript);
  });
  // Run the test
  runTest().then(function () {
    process.exit(0);
  }).catch(function (e) {
    console.error(e);
    process.exit(1);
  });
} else {
  var debug = require('../..')();
  var defaultConfig = require('../../src/agent/config.js');
  var config = extend({}, defaultConfig, {
    log: {
      maxLogsPerSecond: 2,
      logDelaySeconds: 5
    }
  });
  debug.startAgent(config);
  setTimeout(function() {
    assert.ok(debug.private_, 'debuglet has initialized');
    var debuglet = debug.private_;
    var debuggee = debuglet.debuggee_;
    assert.ok(debuggee, 'should create debuggee');
    assert.ok(debuggee.project, 'debuggee should have a project');
    assert.ok(debuggee.id, 'debuggee should have registered');
    // The parent process needs to know the debuggeeId and project.
    process.send([debuggee.id, debuggee.project]);
    setInterval(fib.bind(null, 12), 500);
  }, 7000);
}
