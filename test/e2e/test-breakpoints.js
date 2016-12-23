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
var semver = require('semver');
var promisifyAll = require('@google-cloud/common').util.promisifyAll;
var Debugger = require('../debugger.js');

var CLUSTER_WORKERS = 3;

var debuggeeId;
var projectId;
var transcript = '';

var FILENAME = 'test-breakpoints.js';

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
    // Check the contents of the log, and then delete the breakpoint

    var breakpoint = results[0];

    assert(transcript.indexOf('o is: {"a":[1,"hi",true]}') !== -1);
    return api.deleteBreakpoint(debuggeeId, breakpoint.id);
  }).then(function() {
    // Set another breakpoint at the same location

    console.log('-- setting a breakpoint');
    return api.setBreakpoint(debuggeeId, {
      id: 'breakpoint-1',
      location: {path: FILENAME, line: 5},
      expressions: ['process'], // Process for large variable
      condition: 'n === 10'
    });
  }).then(function(breakpoint) {
    // Check that the breakpoint was set, and then wait for the breakpoint to
    // be hit
    breakpoint = breakpoint[0];

    console.log('-- resolution of setBreakpoint', breakpoint);
    assert.ok(breakpoint, 'should have set a breakpoint');
    assert.ok(breakpoint.id, 'breakpoint should have an id');
    assert.ok(breakpoint.location, 'breakpoint should have a location');
    assert.strictEqual(breakpoint.location.path, FILENAME);

    console.log('-- waiting before checking if breakpoint was hit');
    return Promise.all([breakpoint, delay(10 * 1000)]);
  }).then(function(results) {
    // Get the breakpoint

    var breakpoint = results[0];

    console.log('-- now checking if the breakpoint was hit');
    return api.getBreakpoint(debuggeeId, breakpoint.id);
  }).then(function(breakpoint) {
    // Check that the breakpoint was hit and contains the correct information,
    // which ends the test
    breakpoint = breakpoint[0];

    var arg;
    console.log('-- results of get breakpoint\n', breakpoint);
    assert.ok(breakpoint, 'should have a breakpoint in the response');
    assert.ok(breakpoint.isFinalState, 'breakpoint should have been hit');
    assert.ok(Array.isArray(breakpoint.stackFrames), 'should have stack ');
    var top = breakpoint.stackFrames[0];
    assert.ok(top, 'should have a top entry');
    assert.ok(top.function, 'frame should have a function property');
    assert.strictEqual(top.function, 'fib');

    if (semver.satisfies(process.version, '>=4.0')) {
      arg = _.find(top.locals, {name: 'n'});
    } else {
      arg = _.find(top.arguments, {name: 'n'});
    }
    assert.ok(arg, 'should find the n argument');
    assert.strictEqual(arg.value, '10');
    console.log('-- checking log point was hit again');
    assert.ok(
      transcript.split('LOGPOINT: o is: {"a":[1,"hi",true]}').length > 4);
    console.log('-- test passed');
    return Promise.resolve();
  });
}

// We run the test in a cluster. We spawn a few worker children that are going
// to run the 'workload' (fib), and the master runs the tests, adding break
// and log points and making sure they work. The workers hit the break
// and log points.
if (cluster.isMaster) {
  cluster.setupMaster({ silent: true });
  var handler = function(a) {
    if (!debuggeeId) {
      // Cache the needed info from the first worker.
      debuggeeId = a[0];
      projectId = a[1];
    } else {
      // Make sure all other workers are consistent.
      assert.equal(debuggeeId, a[0]);
      assert.equal(projectId, a[1]);
    }
  };
  var stdoutHandler = function(chunk) {
    transcript += chunk;
  };
  for (var i = 0; i < CLUSTER_WORKERS; i++) {
    var worker = cluster.fork();
    worker.on('message', handler);
    worker.process.stdout.on('data', stdoutHandler);
    worker.process.stderr.on('data', stdoutHandler);
  }
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
  debug.startAgent();

  // Given the debug agent some time to start and then notify the cluster
  // master.
  setTimeout(function() {
    assert.ok(debug.private_, 'debuglet has initialized');
    var debuglet = debug.private_;
    var debuggee = debuglet.debuggee_;
    assert.ok(debuggee, 'should create debuggee');
    assert.ok(debuggee.project, 'debuggee should have a project');
    assert.ok(debuggee.id, 'debuggee should have registered');
    // The parent process needs to know the debuggeeId and project.
    process.send([debuggee.id, debuggee.project]);
    setInterval(fib.bind(null, 12), 2000);
  }, 7000);

}
