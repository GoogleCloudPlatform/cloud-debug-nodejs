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

import * as acorn from 'acorn';
import * as estree from 'estree';
import * as inspector from 'inspector';
import * as path from 'path';

import {StatusMessage} from '../status-message';
import * as apiTypes from '../types/api-types';
import {Logger} from '../types/common-types';

import {DebugAgentConfig} from './config';
import * as debugapi from './debugapi';
import {FileStats, ScanStats} from './scanner';
import {MapInfoOutput, SourceMapper} from './sourcemapper';
import * as state from './state-inspector';
import * as utils from './utils';
import {V8Inspector} from './v8inspector';

export class BreakpointData {
  constructor(
      public id: string, public active: boolean,
      public apiBreakpoint: apiTypes.Breakpoint,
      public parsedCondition: estree.Node,
      public compile: null|((src: string) => string)) {}
}

export class InspectorDebugApi implements debugapi.DebugApi {
  logger: Logger;
  config: DebugAgentConfig;
  fileStats: ScanStats;
  breakpoints: {[id: string]: BreakpointData} = {};
  sourcemapper: SourceMapper;
  session: inspector.Session;
  scriptmapper: {[id: string]: any} = {};

  listeners: {[id: string]: utils.Listener} = {};
  numBreakpoints = 0;
  v8Inspector: V8Inspector;
  constructor(
      logger_: Logger, config_: DebugAgentConfig, jsFiles_: ScanStats,
      sourcemapper_: SourceMapper) {
    this.logger = logger_;
    this.config = config_;
    this.fileStats = jsFiles_;
    this.sourcemapper = sourcemapper_;
    this.session = new inspector.Session();
    this.session.connect();
    this.session.on('Debugger.scriptParsed', (script) => {
      this.scriptmapper[script.params.scriptId] = script.params;
    });
    this.session.post('Debugger.enable');
    this.session.post('Debugger.setBreakpointsActive', {active: true});
    this.session.on('Debugger.paused', (message) => {
      try {
        this.handleDebugPausedEvent(message.params);
      } catch (error) {
        console.error(error);
      }
    });
    this.v8Inspector = new V8Inspector(this.session);
  }

  set(breakpoint: apiTypes.Breakpoint, cb: (err: Error|null) => void): void {
    if (!breakpoint ||
        typeof breakpoint.id === 'undefined' ||  // 0 is a valid id
        !breakpoint.location || !breakpoint.location.path ||
        !breakpoint.location.line) {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.UNSPECIFIED,
          utils.messages.INVALID_BREAKPOINT);
    }
    const baseScriptPath = path.normalize(breakpoint.location.path);
    if (!this.sourcemapper.hasMappingInfo(baseScriptPath)) {
      if (!baseScriptPath.endsWith('js')) {
        return utils.setErrorStatusAndCallback(
            cb, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
            utils.messages.COULD_NOT_FIND_OUTPUT_FILE);
      }

      this.setInternal(breakpoint, null /* mapInfo */, null /* compile */, cb);
    } else {
      const line = breakpoint.location.line;
      const column = 0;
      const mapInfo =
          this.sourcemapper.mappingInfo(baseScriptPath, line, column);

      const compile = utils.getBreakpointCompiler(breakpoint);
      if (breakpoint.condition && compile) {
        try {
          breakpoint.condition = compile(breakpoint.condition);
        } catch (e) {
          this.logger.info(
              'Unable to compile condition >> ' + breakpoint.condition + ' <<');
          return utils.setErrorStatusAndCallback(
              cb, breakpoint, StatusMessage.BREAKPOINT_CONDITION,
              utils.messages.ERROR_COMPILING_CONDITION);
        }
      }
      this.setInternal(breakpoint, mapInfo, compile, cb);
    }
  }

  clear(breakpoint: apiTypes.Breakpoint, cb: (err: Error|null) => void): void {
    if (typeof breakpoint.id === 'undefined') {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.BREAKPOINT_CONDITION,
          utils.messages.V8_BREAKPOINT_CLEAR_ERROR);
    }
    const breakpointData = this.breakpoints[breakpoint.id];
    if (!breakpointData) {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.BREAKPOINT_CONDITION,
          utils.messages.V8_BREAKPOINT_CLEAR_ERROR);
    }
    const id = breakpoint.id;
    let result = this.v8Inspector.removeBreakpoint(breakpointData.id);
    let breakpointId = this.breakpoints[id].id;
    delete this.breakpoints[id];
    delete this.listeners[breakpointId];
    this.numBreakpoints--;
    setImmediate(function() {
      if (result.error) {
        cb(result.error);
      }
      cb(null);
    });
  }

  wait(breakpoint: apiTypes.Breakpoint, callback: (err?: Error) => void): void {
    // TODO: Address the case whree `breakpoint.id` is `null`.
    const bp = this.breakpoints[breakpoint.id as string];
    const listener =
        this.onBreakpointHit.bind(this, breakpoint, (err: Error) => {
          this.listeners[bp.id].enabled = false;
          // This method is called from the debug event listener, which
          // swallows all exception. We defer the callback to make sure
          // the user errors aren't silenced.
          setImmediate(function() {
            callback(err);
          });
        });
    this.listeners[bp.id] = {enabled: true, listener: listener};
  }

  log(breakpoint: apiTypes.Breakpoint,
      print: (format: string, exps: string[]) => void,
      shouldStop: () => boolean): void {
    // TODO: Address the case whree `breakpoint.id` is `null`.
    const bpId = this.breakpoints[breakpoint.id as string].id;
    let logsThisSecond = 0;
    let timesliceEnd = Date.now() + 1000;
    // TODO: Determine why the Error argument is not used.
    const listener =
        this.onBreakpointHit.bind(this, breakpoint, (_err: Error) => {
          const currTime = Date.now();
          if (currTime > timesliceEnd) {
            logsThisSecond = 0;
            timesliceEnd = currTime + 1000;
          }
          print(
              // TODO: Address the case where `breakpoint.logMessageFormat` is
              // `null`.
              breakpoint.logMessageFormat as string,
              // TODO: Determine how to remove the `as` cast below
              breakpoint.evaluatedExpressions.map(
                  JSON.stringify as (ob: any) => string));
          logsThisSecond++;
          if (shouldStop()) {
            this.listeners[bpId].enabled = false;
          } else {
            if (logsThisSecond >= this.config.log.maxLogsPerSecond) {
              this.listeners[bpId].enabled = false;
              setTimeout(() => {
                // listeners[num] may have been deleted by `clear` during the
                // async hop. Make sure it is valid before setting a property
                // on it.
                if (!shouldStop() && this.listeners[bpId]) {
                  this.listeners[bpId].enabled = true;
                }
              }, this.config.log.logDelaySeconds * 1000);
            }
          }
        });
    this.listeners[bpId] = {enabled: true, listener: listener};
  }

  disconnect(): void {
    this.session.disconnect();
  }

  numBreakpoints_(): number {
    return Object.keys(this.breakpoints).length;
  }

  numListeners_(): number {
    return Object.keys(this.listeners).length;
  }

  /**
   * Internal breakpoint set function. At this point we have looked up source
   * maps (if necessary), and scriptPath happens to be a JavaScript path.
   *
   * @param {!Breakpoint} breakpoint Debug API Breakpoint object
   * @param {!MapInfoOutput|null} mapInfo A map that has a "file" attribute for
   *    the path of the output file associated with the given input file
   * @param {function(string)=} compile optional compile function that can be
   *    be used to compile source expressions to JavaScript
   * @param {function(?Error)} cb error-back style callback
   */
  // TODO: Fix the documented types to match the function's input types
  setInternal(
      breakpoint: apiTypes.Breakpoint, mapInfo: MapInfoOutput|null,
      compile: ((src: string) => string)|null,
      cb: (err: Error|null) => void): void {
    // Parse and validate conditions and watch expressions for correctness and
    // immutability
    let ast: any = null;
    if (breakpoint.condition) {
      try {
        // We parse as ES6; even though the underlying V8 version may only
        // support a subset. This should be fine as the objective of the parse
        // is to heuristically find side-effects. V8 will raise errors later
        // if the syntax is invalid. It would have been nice if V8 had made
        // the parser API available us :(.
        ast = acorn.parse(
            breakpoint.condition, {sourceType: 'script', ecmaVersion: 6});
        const validator = require('./validator.js');
        if (!validator.isValid(ast)) {
          return utils.setErrorStatusAndCallback(
              cb, breakpoint, StatusMessage.BREAKPOINT_CONDITION,
              utils.messages.DISALLOWED_EXPRESSION);
        }
      } catch (e) {
        const message = utils.messages.SYNTAX_ERROR_IN_CONDITION + e.message;
        return utils.setErrorStatusAndCallback(
            cb, breakpoint, StatusMessage.BREAKPOINT_CONDITION, message);
      }
    }

    // Presently it is not possible to precisely disambiguate the script
    // path from the path provided by the debug server. The issue is that we
    // don't know the repository root relative to the root filesystem or
    // relative to the working-directory of the process. We want to make sure
    // that we are setting the breakpoint that the user intended instead of a
    // breakpoint in a file that happens to have the same name but is in a
    // different directory. Until this is addressed between the server and the
    // debuglet, we are going to assume that repository root === the starting
    // working directory.
    let matchingScript;
    // TODO: Address the case where `breakpoint.location` is `null`.
    const scripts = utils.findScripts(
        mapInfo ? mapInfo.file :
                  path.normalize(
                      (breakpoint.location as apiTypes.SourceLocation).path),
        this.config, this.fileStats);
    if (scripts.length === 0) {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
          utils.messages.SOURCE_FILE_NOT_FOUND);
    } else if (scripts.length === 1) {
      // Found the script
      matchingScript = scripts[0];
    } else {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
          utils.messages.SOURCE_FILE_AMBIGUOUS);
    }

    // TODO: Address the case where `breakpoint.location` is `null`.
    // TODO: Address the case where `fileStats[matchingScript]` is `null`.
    if ((breakpoint.location as apiTypes.SourceLocation).line >=
        (this.fileStats[matchingScript] as FileStats).lines) {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
          utils.messages.INVALID_LINE_NUMBER + matchingScript + ':' +
              (breakpoint.location as apiTypes.SourceLocation).line +
              '. Loaded script contained ' +
              (this.fileStats[matchingScript] as FileStats).lines +
              ' lines. Please ensure' +
              ' that the snapshot was set in the same code version as the' +
              ' deployed source.');
    }

    // The breakpoint protobuf message presently doesn't have a column
    // property but it may have one in the future.
    // TODO: Address the case where `breakpoint.location` is `null`.
    let column = mapInfo && mapInfo.column ?
        mapInfo.column :
        ((breakpoint.location as apiTypes.SourceLocation).column || 1);
    const line = mapInfo ?
        mapInfo.line :
        (breakpoint.location as apiTypes.SourceLocation).line;
    // We need to special case breakpoints on the first line. Since Node.js
    // wraps modules with a function expression, we adjust
    // to deal with that.
    if (line === 1) {
      column += debugapi.MODULE_WRAP_PREFIX_LENGTH - 1;
    }
    let condition;
    if (breakpoint.condition) condition = breakpoint.condition;
    let res = this.v8Inspector.setBreakpointByUrl(
        line - 1, matchingScript, undefined, column - 1, condition);
    if (res.error || !res.response) {
      return utils.setErrorStatusAndCallback(
          cb, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
          utils.messages.V8_BREAKPOINT_ERROR);
    }
    this.breakpoints[breakpoint.id as string] = new BreakpointData(
        res.response.breakpointId, true, breakpoint, ast as estree.Program,
        compile);
    this.numBreakpoints++;
    setImmediate(function() {
      cb(null);
    });  // success.
  }

  onBreakpointHit(
      breakpoint: apiTypes.Breakpoint, callback: (err: Error|null) => void,
      callFrames: inspector.Debugger.CallFrame[]): void {
    // TODO: Address the situation where `breakpoint.id` is `null`.
    const bp = this.breakpoints[breakpoint.id as string];
    if (!bp.active) {
      // Breakpoint exists, but not active. We never disable breakpoints, so
      // this is theoretically not possible. Perhaps this is possible if there
      // is a second debugger present? Regardless, report the error.
      return utils.setErrorStatusAndCallback(
          callback, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
          utils.messages.V8_BREAKPOINT_DISABLED);
    }
    // Breakpoint Hit
    const start = process.hrtime();
    try {
      this.captureBreakpointData(breakpoint, callFrames);
    } catch (err) {
      return utils.setErrorStatusAndCallback(
          callback, breakpoint, StatusMessage.BREAKPOINT_SOURCE_LOCATION,
          utils.messages.CAPTURE_BREAKPOINT_DATA + err);
    }
    const end = process.hrtime(start);
    this.logger.info(utils.formatInterval('capture time: ', end));
    callback(null);
  }

  captureBreakpointData(
      breakpoint: apiTypes.Breakpoint,
      callFrames: inspector.Debugger.CallFrame[]): void {
    const expressionErrors: Array<apiTypes.Variable|null> = [];
    const that = this;
    // TODO: Address the case where `breakpoint.id` is `null`.
    if (breakpoint.expressions &&
        this.breakpoints[breakpoint.id as string].compile) {
      for (let i = 0; i < breakpoint.expressions.length; i++) {
        try {
          // TODO: Address the case where `breakpoint.id` is `null`.
          breakpoint.expressions[i] =
              // TODO: Address the case where `compile` is `null`.
              (this.breakpoints[breakpoint.id as string].compile as
                   (text: string) => string)(breakpoint.expressions[i]);
        } catch (e) {
          this.logger.info(
              'Unable to compile watch expression >> ' +
              breakpoint.expressions[i] + ' <<');
          expressionErrors.push({
            name: breakpoint.expressions[i],
            status: new StatusMessage(
                StatusMessage.VARIABLE_VALUE, 'Error Compiling Expression',
                true)
          });
          breakpoint.expressions.splice(i, 1);
        }
      }
    }
    if (breakpoint.action === 'LOG') {
      // TODO: This doesn't work with compiled languages if there is an error
      // compiling one of the expressions in the loop above.
      if (!breakpoint.expressions) {
        breakpoint.evaluatedExpressions = [];
      } else {
        const frame = callFrames[0];
        const evaluatedExpressions = breakpoint.expressions.map(function(exp) {
          const result = state.evaluate(exp, frame, that.v8Inspector);
          // TODO: Address the case where `result.mirror` is `undefined`.
          return result.error ?
              result.error :
              (result.object as inspector.Runtime.RemoteObject).value();
        });
        breakpoint.evaluatedExpressions = evaluatedExpressions;
      }
    } else {
      const captured = state.capture(
          callFrames, breakpoint, this.config, this.scriptmapper,
          this.v8Inspector);
      if (breakpoint.location) {
        breakpoint.location.line = callFrames[0].location.lineNumber + 1;
      }
      breakpoint.stackFrames = captured.stackFrames;
      // TODO: This suggests the Status type and Variable type are the same.
      //       Determine if that is the case.
      breakpoint.variableTable = captured.variableTable as apiTypes.Variable[];
      breakpoint.evaluatedExpressions =
          expressionErrors.concat(captured.evaluatedExpressions);
    }
  }

  handleDebugPausedEvent(params: inspector.Debugger.PausedEventDataType) {
    try {
      if (!params.hitBreakpoints) return;
      const bpId: string = params.hitBreakpoints[0];
      if (this.listeners[bpId].enabled) {
        this.logger.info('>>>breakpoint hit<<< number: ' + bpId);
        this.listeners[bpId].listener(params.callFrames);
      }
    } catch (e) {
      this.logger.warn('Internal V8 error on breakpoint event: ' + e);
    }
  }
}