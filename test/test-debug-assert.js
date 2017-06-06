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
'use strict';

const realAssert = require('assert');

describe('debug-assert', () => {
  const debugAssert = require('../src/agent/debug-assert.js');

  it('should fire assertions when enabled', () => {
    realAssert.throws(() => {
      const assert = debugAssert(true);
      assert.equal(1, 2);
    });
  });

  describe('disabled', () => {
    const assert = debugAssert(false);

    it('should not fire assertions when disabled', () => {
      assert.equal(1, 2);
    });

    it('should cover the full assert API', () => {
      Object.keys(realAssert).forEach((key) => {
        realAssert.equal(typeof assert[key], 'function');
      });
    });
  });
});