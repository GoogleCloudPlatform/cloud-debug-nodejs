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
import * as semver from 'semver';

import {Logger} from '../../types/common';
import * as stackdriver from '../../types/stackdriver';
import {DebugAgentConfig} from '../config';
import {ScanStats} from '../io/scanner';
import {SourceMapper} from '../io/sourcemapper';
import * as processInfo from '../../process-info';

export interface DebugApi {
  set(breakpoint: stackdriver.Breakpoint, cb: (err: Error|null) => void): void;
  clear(breakpoint: stackdriver.Breakpoint, cb: (err: Error|null) => void):
      void;
  wait(breakpoint: stackdriver.Breakpoint, callback: (err?: Error) => void):
      void;
  log(breakpoint: stackdriver.Breakpoint,
      print: (format: string, exps: string[]) => void,
      shouldStop: () => boolean): void;
  disconnect(): void;
  numBreakpoints_(): number;
  numListeners_(): number;
}

interface DebugApiConstructor {
  new(logger: Logger, config: DebugAgentConfig, jsFiles: ScanStats,
      sourcemapper: SourceMapper): DebugApi;
}

export const MODULE_WRAP_PREFIX_LENGTH =
    require('module').wrap('☃').indexOf('☃');

let singleton: DebugApi;

export function create(
    logger: Logger, config: DebugAgentConfig, jsFiles: ScanStats,
    sourcemapper: SourceMapper): DebugApi {
  if (singleton && !config.forceNewAgent_) {
    return singleton;
  } else if (singleton) {
    singleton.disconnect();
  }

  let debugApiConstructor: DebugApiConstructor;

  const node8Above = semver.satisfies(processInfo.nodeVersion(), '>=8');
  const useInspector = processInfo.useInspectorProtocol();

  if (node8Above && useInspector) {
    const inspectorapi = require('./inspector-debugapi');
    debugApiConstructor = inspectorapi.InspectorDebugApi;
  } else {
    const v8debugapi = require('./legacy-debugapi');
    debugApiConstructor = v8debugapi.V8DebugApi;
  }

  singleton = new debugApiConstructor(logger, config, jsFiles, sourcemapper);
  return singleton;
}
