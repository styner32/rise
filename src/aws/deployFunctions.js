'use strict';

const fs         = require('fs'),
      path       = require('path'),
      ConsoleLog = require('../utils/consoleLog').ConsoleLog;

module.exports.DeployFunctions = function(cf, stackName, functions, bucketName) {
  return new Promise((resolve, reject) => {
    const cfBaseContent = fsReadFile(path.join(__dirname, 'cf-base.json'));
    const cfBaseContentJSON = JSON.parse(cfBaseContent);
    let cfFunctionContent = fsReadFile(path.join(__dirname, 'cf-lambda-function.json'));
    let cfFunctionVersionContent = fsReadFile(path.join(__dirname, 'cf-lambda-version.json'));
    let cfFunctionArnOutputContent = fsReadFile(path.join(__dirname, 'cf-lambda-arn-output.json'));

    const funcPaths = Object.keys(functions);
    const version = '0.0.2' // FIXME: hardcode it for now.
    for ( var i = 0; i < funcPaths.length; i++) {
      const funcPath = funcPaths[i];
      const funcName = funcPath.replace(path.sep, '');
      const s3Key = funcName + '-' + version + '.zip';
      const func = functions[funcPath];

      if (funcPath === 'default') {
        continue;
      }

      cfFunctionContent = cfFunctionContent.replace('$HANDLER', func.handler);
      cfFunctionContent = cfFunctionContent.replace('$S3KEY', s3Key);
      cfFunctionContent = cfFunctionContent.replace('$TIMEOUT', func.timeout);
      cfBaseContentJSON.Resources[funcName] = JSON.parse(cfFunctionContent);

      // FIXME: VERSION is not update, update ${funcName}Version to create a new version
      cfFunctionVersionContent = cfFunctionVersionContent.replace('$FUNCTION_NAME', funcName);
      cfBaseContentJSON.Resources[`${funcName}Version`] = JSON.parse(cfFunctionVersionContent);

      cfFunctionArnOutputContent = cfFunctionArnOutputContent.replace('$FUNCTION_NAME', funcName);
      cfBaseContentJSON.Outputs[funcName] = JSON.parse(cfFunctionArnOutputContent);
    }

    const req = cf.updateStack({
      StackName: stackName,
      TemplateBody: JSON.stringify(cfBaseContentJSON),
      Capabilities: ['CAPABILITY_IAM'],
    });

    req.on('success', function(resp) {
      ConsoleLog('info', `Deploying functions...`);
      cf.waitFor('stackUpdateComplete', { StackName: stackName }, function(err, data) {
        if (err) {
          reject(err);
          return;
        }

        ConsoleLog('info', `Successfully deployed functions.`);
        resolve({
          cfTemplate: cfBaseContentJSON,
          bucketName: bucketName,
          outputs: data.Stacks[0].Outputs
        });
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
