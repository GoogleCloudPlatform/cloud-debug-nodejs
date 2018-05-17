/**
 * Copyright 2017 Google Inc. All Rights Reserved.
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
import * as stackdriver from '../src/types/stackdriver';
import * as debugapi from '../src/agent/v8/debugapi';
import * as extend from 'extend';
import {defaultConfig} from '../src/agent/config';
import * as scanner from '../src/agent/io/scanner';
import * as SourceMapper from '../src/agent/io/sourcemapper';
import {Common, LoggerOptions} from '../src/types/common';
import * as assert from 'assert';
import {StatusMessage} from '../src/client/stackdriver/status-message';
import * as utils from '../src/agent/util/utils';

const code = require('./test-expression-side-effect-code.js');

const common: Common = require('@google-cloud/common');

const itWithInspector = utils.satisfies(process.version, '>=10') ? it : it.skip;

describe('evaluating expressions', () => {
  let api: debugapi.DebugApi;
  const config = extend({}, defaultConfig, {
    forceNewAgent_: true
  });

  before(function(done) {
    const logger = new common.logger({
      level: common.logger.LEVELS[config.logLevel],
      tag: 'test-expression-side-effect'
    });
    scanner.scan(true, config.workingDirectory, /\.js$/)
      .then(function (fileStats) {
        const jsStats = fileStats.selectStats(/\.js$/);
        const mapFiles = fileStats.selectFiles(/\.map$/, process.cwd());
        SourceMapper.create(mapFiles, function (err, mapper) {
          assert(!err);
          assert(mapper);
          api = debugapi.create(logger, config, jsStats, mapper!);
          done();
        });
      });
  });

  itWithInspector('should evaluate expressions without side effects', (done) => {
    // this test makes sure that the necessary environment variables to enable
    // asserts are present during testing. Use run-tests.sh, or export
    // CLOUD_DEBUG_ASSERTIONS=1 to make sure this test passes.
    const bp: stackdriver.Breakpoint = {
      id: 'fake-id-123',
      location: { path: 'build/test/test-expression-side-effect-code.js', line: 16 },
      expressions: [ 'item.getPrice()']
    } as stackdriver.Breakpoint;

    api.set(bp, function(err) {
      assert.ifError(err);
      api.wait(bp, function(err) {
        assert.ifError(err);
        const watch = bp.evaluatedExpressions[0];
        assert.equal((watch as any).value, '2');
        api.clear(bp, function(err) {
          assert.ifError(err);
          done();
        });
      })
      process.nextTick(function() {code.foo();});
    })
  });

  itWithInspector('should not evaluate expressions with side effects', (done) => {
    // this test makes sure that the necessary environment variables to enable
    // asserts are present during testing. Use run-tests.sh, or export
    // CLOUD_DEBUG_ASSERTIONS=1 to make sure this test passes.
    const bp: stackdriver.Breakpoint = {
      id: 'fake-id-123',
      location: { path: 'build/test/test-expression-side-effect-code.js', line: 16 },
      expressions: [ 'item.increasePriceByOne()']
    } as stackdriver.Breakpoint;

    api.set(bp, function(err) {
      assert.ifError(err);
      api.wait(bp, function(err) {
        assert.ifError(err);
        const watch = bp.evaluatedExpressions[0];
        assert(((watch as any).status as StatusMessage).isError);
        api.clear(bp, function(err) {
          assert.ifError(err);
          done();
        });
      })
      process.nextTick(function() {code.foo();});
    })
  });

  itWithInspector('should not evaluate process.title', (done) => {
    // this test makes sure that the necessary environment variables to enable
    // asserts are present during testing. Use run-tests.sh, or export
    // CLOUD_DEBUG_ASSERTIONS=1 to make sure this test passes.
    const bp: stackdriver.Breakpoint = {
      id: 'fake-id-123',
      location: { path: 'build/test/test-expression-side-effect-code.js', line: 16 },
      expressions: [ 'process']
    } as stackdriver.Breakpoint;

    api.set(bp, function(err) {
      assert.ifError(err);
      api.wait(bp, function(err) {
        assert.ifError(err);
        const varIndex = (bp.evaluatedExpressions[0] as any).varTableIndex;
        assert(varIndex);
        const members = (bp.variableTable[varIndex] as any).members;
        assert(members);
        for (let entry of members) {
          if ((entry as any).name === 'title') {
            assert((entry as any).value === undefined);
          }
        }

        api.clear(bp, function(err) {
          assert.ifError(err);
          done();
        });
      })
      process.nextTick(function() {code.foo();});
    })
  });
});
