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
var GoogleAuth = require('google-auth-library');
var _ = require('lodash'); // for _.find. Can't use ES6 yet.
var Q = require('q');
var cluster = require('cluster');
var semver = require('semver');

var DEBUG_API = 'https://clouddebugger.googleapis.com/v2/debugger';
var SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/cloud_debugger',
  ];
var CLUSTER_WORKERS = 3;

var debuggee;
var project;
var transcript = '';

var FILENAME = 'test-breakpoints.js';

function apiRequest(authClient, url, method, body) {
  method = method || 'GET';

  var deferred = Q.defer();
  authClient.request({
    url: url,
    method: method,
    json: true,
    body: body
  }, function(err, body, response) {
    if (err) {
      deferred.reject(err);
    } else {
      deferred.resolve(body);
    }
  });
  return deferred.promise;
}

function runTest() {
  Q.delay(10 * 1000).then(function() {
    // Get our own credentials because we need an extra scope
    var auth = new GoogleAuth();
    auth.getApplicationDefault(function(err, authClient) {
      if (err) {
        console.log(err);
        return;
      }

      // Inject scopes if they have not been injected by the environment
      if (authClient.createScopedRequired &&
          authClient.createScopedRequired()) {
        authClient = authClient.createScoped(SCOPES);
      }

      function listDebuggees(project) {
        return apiRequest(authClient, DEBUG_API + '/debuggees?project=' +
          project);
      }

      function listBreakpoints(debuggee) {
        return apiRequest(authClient, DEBUG_API + '/debuggees/' + debuggee +
          '/breakpoints');
      }

      function deleteBreakpoint(debuggee, breakpoint) {
        return apiRequest(authClient, DEBUG_API + '/debuggees/' + debuggee +
          '/breakpoints/' + breakpoint.id, 'DELETE');
      }

      function setBreakpoint(debuggee, body) {
        return apiRequest(authClient, DEBUG_API + '/debuggees/' + debuggee +
          '/breakpoints/set', 'POST', body);
      }

      function getBreakpoint(debuggee, breakpoint) {
        return apiRequest(authClient, DEBUG_API + '/debuggees/' + debuggee +
          '/breakpoints/' + breakpoint.id);
      }

      listDebuggees(project)
      .then(function(body) {
        console.log('-- List of debuggees\n',
          util.inspect(body, { depth: null}));
        assert.ok(body, 'should get a valid ListDebuggees response');
        assert.ok(body.debuggees, 'should have a debuggees property');
        var result = _.find(body.debuggees, function(d) {
          return d.id === debuggee;
        });
        assert.ok(result, 'should find the debuggee we just registered');
        return debuggee;
      })
      .then(listBreakpoints)
      .then(function(body) {
        console.log('-- List of breakpoints\n', body);
        body.breakpoints = body.breakpoints || [];

        var promises = body.breakpoints.map(function(breakpoint) {
          return deleteBreakpoint(debuggee, breakpoint);
        });

        var deleteAll = Q.all(promises);

        return deleteAll;
      })
      .then(function(deleteResults) {
        console.log('-- delete results', deleteResults);
        return debuggee;
      })
      .then(function(debuggee) {
        // Set a breakpoint
        console.log('-- setting a logpoint');
        var promise = setBreakpoint(debuggee, {
          id: 'breakpoint-1',
          location: {path: FILENAME, line: 5},
          condition: 'n === 10',
          action: 'LOG',
          expressions: ['o'],
          log_message_format: 'o is: $0'
        });
        // I don't know what I am doing. There is a better way to write the
        // following using promises.
        var result = promise.then(function(body) {
          console.log('-- resolution of setBreakpoint', body);
          assert.ok(body.breakpoint, 'should have set a breakpoint');
          var breakpoint = body.breakpoint;
          assert.ok(breakpoint.id, 'breakpoint should have an id');
          assert.ok(breakpoint.location, 'breakpoint should have a location');
          assert.strictEqual(breakpoint.location.path, FILENAME);
          return { debuggee: debuggee, breakpoint: breakpoint };
        });
        return result;
      })
      .then(function(result) {
        assert.ok(result.breakpoint);
        assert.ok(result.debuggee);
        console.log('-- waiting a bit before running fib');
        return Q.delay(10 * 1000).then(function() { return result; });
      })
      .then(function(result) {
        console.log('-- waiting before checking if the log was written');
        return Q.delay(10 * 1000).then(function() { return result; });
      })
      .then(function(result) {
        assert(transcript.indexOf('o is: {"a":[1,"hi",true]}') !== -1);
        deleteBreakpoint(result.debuggee, result.breakpoint).then();
        return result.debuggee;
      })
      .then(function(debuggee) {
        // Set a breakpoint
        console.log('-- setting a breakpoint');
        var promise = setBreakpoint(debuggee, {
          id: 'breakpoint-1',
          location: {path: FILENAME, line: 5},
          expressions: ['process'], // Process for large variable
          condition: 'n === 10'
        });
        // I don't know what I am doing. There is a better way to write the
        // following using promises.
        var result = promise.then(function(body) {
          console.log('-- resolution of setBreakpoint', body);
          assert.ok(body.breakpoint, 'should have set a breakpoint');
          var breakpoint = body.breakpoint;
          assert.ok(breakpoint.id, 'breakpoint should have an id');
          assert.ok(breakpoint.location, 'breakpoint should have a location');
          assert.strictEqual(breakpoint.location.path, FILENAME);
          return { debuggee: debuggee, breakpoint: breakpoint };
        });
        return result;
      })
      .then(function(result) {
        assert.ok(result.breakpoint);
        assert.ok(result.debuggee);
        console.log('-- waiting a bit before running fib');
        return Q.delay(10 * 1000).then(function() { return result; });
      })
      .then(function(result) {
        console.log('-- waiting before checking if the breakpoint was hit');
        return Q.delay(10 * 1000).then(function() { return result; });
      })
      .then(function(result) {
        console.log('-- now checking if the breakpoint was hit');
        var promise = getBreakpoint(result.debuggee, result.breakpoint);
        return promise;
      })
      .then(function(body) {
        var arg;
        console.log('-- results of get breakpoint\n', body);
        assert.ok(body.breakpoint, 'should have a breakpoint in the response');
        var hit = body.breakpoint;
        assert.ok(hit.isFinalState, 'breakpoint should have been hit');
        assert.ok(Array.isArray(hit.stackFrames), 'should have stack ');
        var top = hit.stackFrames[0];
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
        console.log('Test passed');
        process.exit(0);
      })
      .catch(function(e) {
        console.error(e);
        process.exit(1);
      });
    });
  }).catch(function(e) {
    console.error(e);
    process.exit(1);
  });
}

// We run the test in a cluster. We spawn a few worker children that are going
// to run the 'workload' (fib), and the master runs the tests, adding break
// and log points and making sure they work. The workers hit the break
// and log points.
if (cluster.isMaster) {
  cluster.setupMaster({ silent: true });
  var handler = function(a) {
    if (!debuggee) {
      // Cache the needed info from the first worker.
      debuggee = a[0];
      project = a[1];
    } else {
      // Make sure all other workers are consistent.
      assert.equal(debuggee, a[0]);
      assert.equal(project, a[1]);
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
  runTest();
} else {
  var debug = require('../..')();
  debug.startAgent();

  // Given the debug agent some time to start and then notify the cluster
  // master.
  setTimeout(function() {
    assert.ok(debug.private_, 'debuglet has initialized');
    var debuglet = debug.private_;
    assert.ok(debuglet.debugletApi_, 'debuglet api is active');
    var api = debuglet.debugletApi_;
    assert.ok(api.uid_, 'debuglet provided unique id');
    assert.ok(api.debuggeeId_, 'debuglet has registered');
    // The parent process needs to know the debuggeeId and project.
    process.send([api.debuggeeId_, api.project_]);
    setInterval(fib.bind(null, 12), 2000);
  }, 7000);

}
