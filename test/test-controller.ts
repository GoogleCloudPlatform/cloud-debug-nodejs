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
import * as nock from 'nock';
import request from './auth-request';
import {Debuggee} from '../src/debuggee';
import {Debug} from '../src/debug';

// the tests in this file rely on the GCLOUD_PROJECT environment variable
// not being set
delete process.env.GCLOUD_PROJECT;

import {Controller} from '../src/controller';
var fakeDebug = {
  request: request
};

var url = 'https://clouddebugger.googleapis.com';
var api = '/v2/controller';

nock.disableNetConnect();

describe('Controller API', function() {

  describe('register', function() {
    it('should get a debuggeeId', function(done) {
      var scope =
          nock(url)
              .post(api + '/debuggees/register')
              .reply(200,
                     {debuggee: {id: 'fake-debuggee'}, activePeriodSec: 600});
      var debuggee = new Debuggee({
        project: 'fake-project',
        uniquifier: 'fake-id',
        description: 'unit test',
        // TODO: Determine if statusMessage should be optional.
        statusMessage: null
      });
      // TODO: Fix fakeDebug to actually implement Debug.
      var controller = new Controller(fakeDebug as any as Debug);
      controller.register(debuggee, function(err, result) {
        assert(!err, 'not expecting an error');
        assert.equal(result.debuggee.id, 'fake-debuggee');
        scope.done();
        done();
      });
    });

    it('should not return an error when the debuggee isDisabled',
       function(done) {
         var scope = nock(url)
                         .post(api + '/debuggees/register')
                         .reply(200, {
                           debuggee: {id: 'fake-debuggee', isDisabled: true},
                           activePeriodSec: 600,
                         });
         var debuggee = new Debuggee({
           project: 'fake-project',
           uniquifier: 'fake-id',
           description: 'unit test',
           // TODO: Determine if statusMessage should be optional.
          statusMessage: null
         });
        // TODO: Fix fakeDebug to actually implement Debug.
         var controller = new Controller(fakeDebug as any as Debug);
         controller.register(debuggee, function(err, result) {
           // TODO: Fix this incorrect method signature.
           (assert as any).ifError(err, 'not expecting an error');
           assert.equal(result.debuggee.id, 'fake-debuggee');
           assert.ok(result.debuggee.isDisabled);
           scope.done();
           done();
         });
       });

  });

  describe('listBreakpoints', function() {

    // register before each test
    before(function(done) {
      nock(url)
        .post(api + '/debuggees/register')
        .reply(200, {
          debuggee: { id: 'fake-debuggee' },
          activePeriodSec: 600
        });
      var debuggee = new Debuggee({
        project: 'fake-project',
        uniquifier: 'fake-id',
        description: 'unit test',
        // TODO: Determine if statusMessage should be optional.
        statusMessage: null
      });
      // TODO: Fix fakeDebug to actually implement Debug.
      var controller = new Controller(fakeDebug as any as Debug);
      controller.register(debuggee, function(err/*, result*/) {
        assert.ifError(err);
        done();
      });
    });

    it('should deal with a missing breakpoints response', function(done) {
      var scope = nock(url)
        .get(api + '/debuggees/fake-debuggee/breakpoints?successOnTimeout=true')
        .reply(200, { kind: 'whatever' });

      var debuggee = { id: 'fake-debuggee' };
      // TODO: Fix fakeDebug to actually implement Debug.
      var controller = new Controller(fakeDebug as any as Debug);
      // TODO: Fix debuggee to actually implement Debuggee
      controller.listBreakpoints(debuggee as Debuggee, function(err, response, result) {
        assert(!err, 'not expecting an error');
        assert(!result.breakpoints, 'should not have a breakpoints property');
        scope.done();
        done();
      });
    });

    describe('invalid responses', function() {
      var tests = [ '', 'JSON, this is not', []];
      tests.forEach(function(invalidResponse, index) {
        it('should pass test ' + index, function(done) {
          var scope = nock(url)
            .get(api + '/debuggees/fake-debuggee/breakpoints?successOnTimeout=true')
            .reply(200, invalidResponse);
          var debuggee = { id: 'fake-debuggee' };
          // TODO: Fix fakeDebug to actually implement Debug.
          var controller = new Controller(fakeDebug as any as Debug);
          // TODO: Fix debuggee to actually implement Debuggee
          controller.listBreakpoints(debuggee as Debuggee, function(err, response, result) {
            assert(!err, 'not expecting an error');
            assert(!result.breakpoints, 'should not have breakpoints property');
            scope.done();
            done();
          });
        });
      });
    });

    it('should throw error on http errors', function(done) {
      var scope = nock(url)
        .get(api + '/debuggees/fake-debuggee/breakpoints?successOnTimeout=true')
        .reply(403);
      var debuggee = { id: 'fake-debuggee' };
      // TODO: Fix fakeDebug to actually implement Debug.
      var controller = new Controller(fakeDebug as any as Debug);
      // TODO: Fix debuggee to actually implement Debuggee
      controller.listBreakpoints(debuggee as Debuggee, function(err, response, result) {
        assert(err instanceof Error, 'expecting an error');
        assert(!result, 'should not have a result');
        scope.done();
        done();
      });
    });

    it('should work with waitTokens', function(done) {
      var scope = nock(url)
        .get(api + '/debuggees/fake-debuggee/breakpoints?successOnTimeout=true')
        .reply(200, {
          waitExpired: true
        });
      var debuggee = { id: 'fake-debuggee' };
      // TODO: Fix fakeDebug to actually implement Debug.
      var controller = new Controller(fakeDebug as any as Debug);
      // TODO: Fix debuggee to actually implement Debuggee
      controller.listBreakpoints(debuggee as Debuggee, function(err, response, result) {
        // TODO: Fix this incorrect method signature.
        (assert as any).ifError(err, 'not expecting an error');
        // TODO: Fix this error that states `body` is not a property
        //       of `ServerResponse`.
        assert((response as any).body.waitExpired, 'should have expired set');
        scope.done();
        done();
      });
    });

    var testsBreakpoints = [
      [],
      [{id: 'breakpoint-0',
       location: { path: 'foo.js', line: 18 }}]
    ];
    testsBreakpoints.forEach(function(breakpoints, index) {
      it('should pass test ' + index, function(done) {
        var scope = nock(url)
          .get(api + '/debuggees/fake-debuggee/breakpoints?successOnTimeout=true')
          .reply(200, {
            breakpoints: breakpoints
          });
        var debuggee = { id: 'fake-debuggee' };
        // TODO: Fix fakeDebug to actually implement Debug.
        var controller = new Controller(fakeDebug as any as Debug);
        // TODO: Fix debuggee to actually implement Debuggee
        controller.listBreakpoints(debuggee as Debuggee, function(err, response, result) {
          assert(!err, 'not expecting an error');
          assert(result.breakpoints, 'should have a breakpoints property');
          var bps = result.breakpoints;
          assert.deepEqual(bps, breakpoints, 'breakpoints mismatch');
          scope.done();
          done();
        });
      });
    });
  });

  describe('updateBreakpoint', function() {
    it('should PUT to server when a breakpoint is updated', function(done) {
      var breakpoint = {id: 'breakpoint-0', location: {path: 'foo.js', line: 99}};
      var scope = nock(url)
        .put(api + '/debuggees/fake-debuggee/breakpoints/breakpoint-0', {
          debuggeeId: 'fake-debuggee',
          breakpoint: breakpoint
          })
        .reply(200, { kind: 'debugletcontroller#updateActiveBreakpointResponse'});
      var debuggee = { id: 'fake-debuggee' };
      // TODO: Fix fakeDebug to actually implement Debug.
      var controller = new Controller(fakeDebug as any as Debug);
      // TODO: Fix debuggee to actually implement Debuggee
      // TODO: Fix breakpoint to actually Breakpoint
      controller.updateBreakpoint(debuggee as Debuggee, breakpoint as apiTypes.Breakpoint,
        function(err, result) {
          assert(!err, 'not expecting an error');
          assert.equal(result.kind, 'debugletcontroller#updateActiveBreakpointResponse');
          scope.done();
          done();
        });
    });
  });



});
