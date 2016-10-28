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

// NOTE: this file is on the critical path for the startup of the user's
// application. The path-length here needs to be minimal.

var logger = require('@google/cloud-diagnostics-common').logger;
var Debuglet = require('./lib/debuglet.js');
var path = require('path');
var _ = require('lodash');

var initConfig = function(config_) {
  var config = (config_ && config_.debug) || config_ || {};

  if (process.env.hasOwnProperty('GCLOUD_DIAGNOSTICS_CONFIG')) {
    var c = require(path.resolve(process.env.GCLOUD_DIAGNOSTICS_CONFIG));
    if (c && c.debug) {
      _.defaultsDeep(config, c.debug);
    }
  }
  var defaults = require('./config.js').debug;
  _.defaultsDeep(config, defaults);
  if (process.env.hasOwnProperty('GCLOUD_DEBUG_LOGLEVEL')) {
    config.logLevel = process.env.GCLOUD_DEBUG_LOGLEVEL;
  }
  if (process.env.hasOwnProperty('GCLOUD_DEBUG_DISABLE')) {
    config.enabled = false;
  }
  if (process.env.hasOwnProperty('GCLOUD_DEBUG_REPO_APP_PATH')) {
    config.appPathRelativeToRepository =
      process.env.GCLOUD_DEBUG_REPO_APP_PATH;
  }
  if (process.env.hasOwnProperty('GAE_MODULE_NAME')) {
    config.serviceName = process.env.GAE_MODULE_NAME;
  }
  if (process.env.hasOwnProperty('GAE_MODULE_VERSION')) {
    config.serviceVersion = process.env.GAE_MODULE_VERSION;
  }
  return config;
};

module.exports = {
  start: start,
  hasStarted: hasStarted
};

var started_ = false;
var log_;

function hasStarted() {
  return started_;
}

function start(config_) {
  if (started_) {
    return log_.error('The cloud-debug agent has already been started.');
  }

  var config = initConfig(config_);
  log_ = logger.create(config.logLevel, '@google/cloud-debug');
  if (config.enabled) {
    var debuglet = new Debuglet(config, log_);
    debuglet.start();
    module.exports.private_ = debuglet;
    started_ = true;
  }
}

setTimeout(function() {
  if (!started_){
    start();
    log_.error('The cloud-debug agent has been automatically started.  ' +
      'This action will be deprecated in the future.');
  }
}, 1000);
