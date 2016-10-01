'use strict';

const fs         = require('fs'),
      path       = require('path'),
      AWS        = require('aws-sdk'),
      ConsoleLog = require('../utils/consoleLog').ConsoleLog,
      LoadYAML   = require('../utils/yaml').LoadYAML,
      YAML       = require('js-yaml');

module.exports.updateAPIs = function(cf, stackName, cfTemplate) {
  return new Promise((resolve, reject) => {
    const version = '0.0.2' // FIXME: hardcode it for now.
    let cfRestAPIContent = fsReadFile(path.join(__dirname, 'cf-restapi.json'));

    const s3Key = 'api-' + version + '.yaml';
    cfRestAPIContent = cfRestAPIContent.replace('$S3KEY', s3Key);
    const cfRestAPIJSON = JSON.parse(cfRestAPIContent);
    cfTemplate.Resources.NFXApi = cfRestAPIJSON;

    console.log(cfRestAPIJSON);
    const req = cf.updateStack({
      StackName: stackName,
      TemplateBody: JSON.stringify(cfTemplate),
      Capabilities: ['CAPABILITY_IAM'],
    });

    ConsoleLog('info', 'Updating api template...');
    req.on('success', function(resp) {
      ConsoleLog('info', `Deploying functions...`);
      cf.waitFor('stackUpdateComplete', { StackName: stackName }, function(err, data) {
        if (err) {
          reject(err);
          return;
        }

        ConsoleLog('info', "Successfully updated API.");
        resolve(cfTemplate);
      });
    });

    req.on('error', function(err, data) {
      reject(err.message);
    });

    req.send();
  });
}

function fsReadFile(path) {
  try {
    return fs.readFileSync(path, { encoding: 'utf8' });
  } catch (err) {
    return false;
  }
}
