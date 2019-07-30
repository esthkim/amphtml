/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

/**
 * @fileoverview
 * This script builds the AMP runtime for production and runs the bundle size
 * check.
 * This is run during the CI stage = build; job = dist.
 */

const colors = require('ansi-colors');
const experimentsConfig = require('../global-configs/experiments-config.json');
const {
  printChangeSummary,
  processAndUploadDistOutput,
  startTimer,
  stopTimer,
  stopTimedJob,
  timedExecWithError,
  timedExecOrDie: timedExecOrDieBase,
  uploadDistOutput,
  uploadDistExperimentOutput,
} = require('./utils');
const {determineBuildTargets} = require('./build-targets');
const {isTravisPullRequestBuild} = require('../travis');
const {runYarnChecks} = require('./yarn-checks');
const {signalDistUpload} = require('../tasks/pr-deploy-bot-utils');

const FILENAME = 'dist-bundle-size.js';
const FILELOGPREFIX = colors.bold(colors.yellow(`${FILENAME}:`));
const timedExecOrDie = (cmd, unusedFileName) =>
  timedExecOrDieBase(cmd, FILENAME);

function buildAndUploadExperiments_() {
  Object.keys(experimentsConfig).forEach(experiment => {
    const config = experimentsConfig[experiment];
    timedExecOrDie('gulp clean');
    timedExecOrDie('gulp update-packages');
    timedExecOrDie(config.command);
    uploadDistExperimentOutput(FILENAME, config.name);
  });
}

async function main() {
  const startTime = startTimer(FILENAME, FILENAME);
  if (!runYarnChecks(FILENAME)) {
    stopTimedJob(FILENAME, startTime);
    return;
  }

  if (!isTravisPullRequestBuild()) {
    timedExecOrDie('gulp update-packages');
    timedExecOrDie('gulp dist --fortesting');
    timedExecOrDie('gulp bundle-size --on_push_build');
    uploadDistOutput(FILENAME);
    //buildAndUploadExperiments_();
  } else {
    printChangeSummary(FILENAME);
    //TODO(estherkim): move this to push build before merging
    buildAndUploadExperiments_();
    const buildTargets = determineBuildTargets(FILENAME);
    if (
      buildTargets.has('RUNTIME') ||
      buildTargets.has('FLAG_CONFIG') ||
      buildTargets.has('INTEGRATION_TEST') ||
      buildTargets.has('E2E_TEST') ||
      buildTargets.has('VISUAL_DIFF') ||
      buildTargets.has('UNIT_TEST')
    ) {
      timedExecOrDie('gulp update-packages');

      const process = timedExecWithError('gulp dist --fortesting', FILENAME);
      if (process.error) {
        await signalDistUpload('errored');
        stopTimedJob(FILENAME, startTime);
        return;
      }

      timedExecOrDie('gulp bundle-size --on_pr_build');
      await processAndUploadDistOutput(FILENAME);
    } else {
      timedExecOrDie('gulp bundle-size --on_skipped_build');
      await signalDistUpload('skipped');

      console.log(
        `${FILELOGPREFIX} Skipping`,
        colors.cyan('Dist, Bundle Size'),
        'because this commit does not affect the runtime, flag configs,',
        'integration tests, end-to-end tests, or visual diff tests.'
      );
    }
  }

  stopTimer(FILENAME, FILENAME, startTime);
}

main();
