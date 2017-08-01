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

import * as apiTypes from '../src/types/api-types';

import * as assert from 'assert';
import * as util from 'util';
import * as _ from 'lodash'; // for _.find. Can't use ES6 yet.
import * as cp from 'child_process';
import * as semver from 'semver';
const promisifyAll = require('@google-cloud/common').util.promisifyAll;
import {Debug} from '../src/debug';
import {Debuggee} from '../src/debuggee';
import {Debugger} from '../test/debugger';

const CLUSTER_WORKERS = 3;

// TODO: Determine if this path should contain 'build'
const FILENAME = 'build/test/fixtures/fib.js';

const delay = function(delayTimeMS: number): Promise<void> {
  // TODO: Determine if the reject parameter should be used.
  return new Promise(function(resolve, _reject) {
    setTimeout(resolve, delayTimeMS);
  });
};

interface Child {
  transcript: string;
  process?: cp.ChildProcess;
}

// This test could take up to 70 seconds.
describe('@google-cloud/debug end-to-end behavior', function () {
  let api: Debugger;

  let debuggeeId: string|null;
  let projectId: string|null;
  let children: Child[] = [];

  before(function() {
    promisifyAll(Debugger);
    api = new Debugger(new Debug({}));
  });

  beforeEach(function() {
    this.timeout(10 * 1000);
    return new Promise(function(resolve, reject) {
      let numChildrenReady = 0;

      // Process a status message sent from a child process.
      // TODO: Determine if this type signature is correct
      const handler = function(c: { error: Error|null, debuggeeId: string, projectId: string}) {
        console.log(c);
        if (c.error) {
          reject(new Error('A child reported the following error: ' + c.error));
          return;
        }
        if (!debuggeeId) {
          // Cache the needed info from the first worker.
          debuggeeId = c.debuggeeId;
          projectId = c.projectId;
        } else {
          // Make sure all other workers are consistent.
          if (debuggeeId !== c.debuggeeId || projectId !== c.projectId) {
            reject(new Error('Child debuggee ID and/or project ID' +
                             'is not consistent with previous child'));
            return;
          }
        }
        numChildrenReady++;
        if (numChildrenReady === CLUSTER_WORKERS) {
          resolve();
        }
      };

      // Handle stdout/stderr output from a child process. More specifically,
      // write the child process's output to a transcript.
      // Each child has its own transcript.
      const stdoutHandler = function(index: number) {
        return function(chunk: string) {
          children[index].transcript += chunk;
        };
      };

      for (let i = 0; i < CLUSTER_WORKERS; i++) {
        // TODO: Determine how to have this not of type `any`.
        // Fork child processes that sned messages to this process with IPC.
        const child: any = { transcript: '' };
        // TODO: Fix this cast to any.
        child.process = cp.fork(FILENAME, {
          execArgv: [],
          env: process.env,
          silent: true
        } as any);
        child.process.on('message', handler);

        children.push(child);

        child.process.stdout.on('data', stdoutHandler(i));
        child.process.stderr.on('data', stdoutHandler(i));
      }
    });
  });

  afterEach(function() {
    this.timeout(5 * 1000);
    // Create a promise for each child that resolves when that child exits.
    const childExitPromises = children.map(function (child) {
      console.log(child.transcript);
      // TODO: Handle the case when child.process is undefined
      (child.process as any).kill();
      return new Promise(function(resolve, reject) {
        const timeout = setTimeout(function() {
          reject(new Error('A child process failed to exit.'));
        }, 3000);
        (child.process as any).on('exit', function() {
          clearTimeout(timeout);
          resolve();
        });
      });
    });
    // Wait until all children exit, then reset test state.
    return Promise.all(childExitPromises).then(function() {
      debuggeeId = null;
      projectId = null;
      children = [];
    });
  });

  it('should set breakpoints correctly', function() {
    this.timeout(90 * 1000);
    // Kick off promise chain by getting a list of debuggees
    // TODO: Determine how to properly specify the signature of listDebuggees
    // TODO: Determine if this is the correct signature for `then`
    return (api as any).listDebuggees(projectId).then(function(results: { [index: number]: Debuggee[] }) {
      // Check that the debuggee created in this test is among the list of
      // debuggees, then list its breakpoints

      const debuggees: Debuggee[] = results[0];

      console.log('-- List of debuggees\n',
        util.inspect(debuggees, { depth: null}));
      assert.ok(debuggees, 'should get a valid ListDebuggees response');
      const result = _.find(debuggees, function(d: Debuggee) {
        return d.id === debuggeeId;
      });
      assert.ok(result, 'should find the debuggee we just registered');
      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).listBreakpoints(debuggeeId);
      // TODO: Determine if this type signature is correct.
    }).then(function(results: { [index: number]: apiTypes.Breakpoint[]}) {
      // Delete every breakpoint

      const breakpoints: apiTypes.Breakpoint[] = results[0];

      console.log('-- List of breakpoints\n', breakpoints);

      const promises = breakpoints.map(function(breakpoint: apiTypes.Breakpoint) {
        // TODO: Determine how to properly specify the signature of listDebuggees
        return (api as any).deleteBreakpoint(debuggeeId, breakpoint.id);
      });

      return Promise.all(promises);
      // TODO: Determine if this type signature is correct
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Set a breakpoint at which the debugger should write to a log

      results.map(function(result: apiTypes.Breakpoint) {
        assert.equal(result, '');
      });
      console.log('-- deleted');

      console.log('-- setting a logpoint');
      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).setBreakpoint(debuggeeId, {
        id: 'breakpoint-1',
        location: {path: FILENAME, line: 5},
        condition: 'n === 10',
        action: 'LOG',
        expressions: ['o'],
        log_message_format: 'o is: $0'
      });
      // TODO: Determine if this type signature is correct.
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Check that the breakpoint was set, and then wait for the log to be
      // written to

      const breakpoint = results[0];

      assert.ok(breakpoint, 'should have set a breakpoint');
      assert.ok(breakpoint.id, 'breakpoint should have an id');
      assert.ok(breakpoint.location, 'breakpoint should have a location');
      // TODO: Handle the case when breakpoint.location is undefined
      assert.strictEqual((breakpoint.location as any).path, FILENAME);

      console.log('-- waiting before checking if the log was written');
      return Promise.all([breakpoint, delay(10 * 1000)]);
      // TODO: Determine if the results parameter should be used.
    }).then(function(_results: apiTypes.Breakpoint[]) {

      // Check the contents of the log, but keep the original breakpoint.

      // TODO: This is never used.  Determine if it should be used.
      //const breakpoint = results[0];

      children.forEach(function(child, index) {
        assert(child.transcript.indexOf('o is: {"a":[1,"hi",true]}') !== -1,
          'transcript in child ' + index + ' should contain value of o: ' +
          child.transcript);
      });
      return Promise.resolve();
    }).then(function() {
      // Set another breakpoint at the same location

      console.log('-- setting a breakpoint');
      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).setBreakpoint(debuggeeId, {
        id: 'breakpoint-2',
        location: {path: FILENAME, line: 5},
        expressions: ['process'], // Process for large variable
        condition: 'n === 10'
      });
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Check that the breakpoint was set, and then wait for the breakpoint to
      // be hit

      const breakpoint = results[0];

      console.log('-- resolution of setBreakpoint', breakpoint);
      assert.ok(breakpoint, 'should have set a breakpoint');
      assert.ok(breakpoint.id, 'breakpoint should have an id');
      assert.ok(breakpoint.location, 'breakpoint should have a location');
      // TODO: Handle the case when breakpoint.location is undefined
      assert.strictEqual((breakpoint.location as any).path, FILENAME);

      console.log('-- waiting before checking if breakpoint was hit');
      return Promise.all([breakpoint, delay(10 * 1000)]);
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Get the breakpoint

      const breakpoint = results[0];

      console.log('-- now checking if the breakpoint was hit');
      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).getBreakpoint(debuggeeId, breakpoint.id);
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Check that the breakpoint was hit and contains the correct information,
      // which ends the test

      const breakpoint = results[0];

      let arg;
      console.log('-- results of get breakpoint\n', breakpoint);
      assert.ok(breakpoint, 'should have a breakpoint in the response');
      assert.ok(breakpoint.isFinalState, 'breakpoint should have been hit');
      assert.ok(Array.isArray(breakpoint.stackFrames), 'should have stack ');
      const top = breakpoint.stackFrames[0];
      assert.ok(top, 'should have a top entry');
      assert.ok(top.function, 'frame should have a function property');
      assert.strictEqual(top.function, 'fib');

      if (semver.satisfies(process.version, '>=4.0')) {
        arg = _.find(top.locals, {name: 'n'});
      } else {
        arg = _.find(top.arguments, {name: 'n'});
      }
      assert.ok(arg, 'should find the n argument');
      // TODO: Handle the case when arg is undefined
      assert.strictEqual((arg as any).value, '10');
      console.log('-- checking log point was hit again');
      children.forEach(function(child) {
        const count = (child.transcript
            .match(/LOGPOINT: o is: \{"a":\[1,"hi",true\]\}/g) || []).length;
        assert.ok(count > 4);
      });

      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).deleteBreakpoint(debuggeeId, breakpoint.id);
    }).then(function() {
      // wait for 60 seconds
      console.log('-- waiting for 60 seconds');
      return delay(60 * 1000);
    }).then(function() {
      // Make sure the log point is continuing to be hit.
      console.log('-- checking log point was hit again');
      children.forEach(function(child) {
        const count = (child.transcript
            .match(/LOGPOINT: o is: \{"a":\[1,"hi",true\]\}/g) || []).length;
        assert.ok(count > 60);
      });
      console.log('-- test passed');
      return Promise.resolve();
    });
  });

  it('should throttle logs correctly', function() {
    this.timeout(15 * 1000);
    // Kick off promise chain by getting a list of debuggees
    // TODO: Determine how to properly specify the signature of listDebuggees
    // TODO: Determine if this is the correct signature for then
    return (api as any).listDebuggees(projectId).then(function(results: { [index: number]: Debuggee[] }) {
      // Check that the debuggee created in this test is among the list of
      // debuggees, then list its breakpoints

      const debuggees = results[0];

      console.log('-- List of debuggees\n',
        util.inspect(debuggees, { depth: null}));
      assert.ok(debuggees, 'should get a valid ListDebuggees response');
      // TODO: Fix this cast to any.
      const result = _.find(debuggees, function(d: any) {
        return d.id === debuggeeId;
      });
      assert.ok(result, 'should find the debuggee we just registered');

      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).listBreakpoints(debuggeeId);
    }).then(function(results: { [index: number]: apiTypes.Breakpoint[] }) {
      // Delete every breakpoint

      const breakpoints: apiTypes.Breakpoint[] = results[0];

      console.log('-- List of breakpoints\n', breakpoints);

      const promises = breakpoints.map(function(breakpoint) {
        // TODO: Determine how to properly specify the signature of listDebuggees
        return (api as any).deleteBreakpoint(debuggeeId, breakpoint.id);
      });

      return Promise.all(promises);
    }).then(function(results: Promise<void>[]) {
      // Set a breakpoint at which the debugger should write to a log

      results.map(function(result) {
        assert.equal(result, '');
      });
      console.log('-- deleted');

      console.log('-- setting a logpoint');
      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).setBreakpoint(debuggeeId, {
        id: 'breakpoint-3',
        location: {path: FILENAME, line: 5},
        condition: 'n === 10',
        action: 'LOG',
        expressions: ['o'],
        log_message_format: 'o is: $0'
      });
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Check that the breakpoint was set, and then wait for the log to be
      // written to
      const breakpoint = results[0];

      assert.ok(breakpoint, 'should have set a breakpoint');
      assert.ok(breakpoint.id, 'breakpoint should have an id');
      assert.ok(breakpoint.location, 'breakpoint should have a location');
      // TODO: Handle the case when breakpoint.location is undefined
      assert.strictEqual((breakpoint.location as any).path, FILENAME);

      console.log('-- waiting before checking if the log was written');
      return Promise.all([breakpoint, delay(10 * 1000)]);
    }).then(function(results: apiTypes.Breakpoint[]) {
      // Check that the contents of the log is correct

      const breakpoint = results[0];

      // If no throttling occurs, we expect ~20 logs since we are logging
      // 2x per second over a 10 second period.
      children.forEach(function(child) {
        const logCount = (child.transcript
            .match(/LOGPOINT: o is: \{"a":\[1,"hi",true\]\}/g) || []).length;
        // A log count of greater than 10 indicates that we did not successfully
        // pause when the rate of `maxLogsPerSecond` was reached.
        assert(logCount <= 10, 'log count is greater than 10: ' + logCount);
        // A log count of less than 3 indicates that we did not successfully
        // resume logging after `logDelaySeconds` have passed.
        assert(logCount > 2, 'log count is not greater than 2: ' + logCount);
      });

      // TODO: Determine how to properly specify the signature of listDebuggees
      return (api as any).deleteBreakpoint(debuggeeId, breakpoint.id);
    }).then(function() {
      console.log('-- test passed');
      return Promise.resolve();
    });
  });
});
