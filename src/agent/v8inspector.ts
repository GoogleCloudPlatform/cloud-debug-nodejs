/**
 * Copyright 2014 Google Inc. All Rights Reserved.
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
import * as inspector from 'inspector';

export class V8Inspector {
  private session: inspector.Session;
  constructor(session: inspector.Session) {
    this.session = session;
  }
  setBreakpointByUrl(
      lineNumber: number, url?: string, urlRegex?: string,
      columnNumber?: number, condition?: string) {
    let result: any = {};
    this.session.post(
        'Debugger.setBreakpointByUrl', {
          lineNumber: lineNumber,
          url: url,
          urlRegex: urlRegex,
          columnNumber: columnNumber,
          condition: condition
        },
        (error: Error|null, response: any) => {
          if (error) result.error = error;
          result.response = response;
        });
    return result;
  }

  removeBreakpoint(breakpointId: string) {
    this.session.post(
        'Debugger.removeBreakpoint', {breakpointId: breakpointId});
  }

  evaluateOnCallFrame(
      callFrameId: string, expression: string, objectGroup?: string,
      includeCommandLineAPI?: boolean, silent?: boolean,
      returnByValue?: boolean, generatePreview?: boolean,
      throwOnSideEffect?: boolean) {
    let result: any = {};
    this.session.post(
        'Debugger.evaluateOnCallFrame', {
          callFrameId: callFrameId,
          expression: expression,
          objectGroup: objectGroup,
          includeCommandLineAPI: includeCommandLineAPI,
          silent: silent,
          returnByValue: returnByValue,
          generatePreview: generatePreview,
          throwOnSideEffect: throwOnSideEffect
        },
        (error: Error|null, response: any) => {
          if (error) console.log('ebva', error);

          if (error) result.error = error;
          result.response = response;
        });
    return result;
  }

  getProperties(
      objectId: string, ownProperties?: boolean,
      accessorPropertiesOnly?: boolean, generatePreview?: boolean) {
    let result: any = {};
    this.session.post(
        'Runtime.getProperties', {
          objectId: objectId,
          ownProperties: ownProperties,
          accessorPropertiesOnly: accessorPropertiesOnly,
          generatePreview: generatePreview
        },
        (error: Error|null, response: any) => {
          if (error) console.log('getproper', error);
          if (error) result.error = error;
          result.response = response;
        });
    return result;
  }
}
