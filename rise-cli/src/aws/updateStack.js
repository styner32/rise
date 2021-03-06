'use strict';

const path = require('path'),
      titlecase = require('../utils/stringHelper'),
      log = require('../utils/log'),
      fsReadFile = require('../utils/fs').fsReadFile,
      getS3Trigger = require('./triggers/s3'),
      getCloudWatchEventTrigger = require('./triggers/cloudWatchEvent'),
      getCloudWatchLogsTrigger = require('./triggers/cloudWatchLogs'),
      getStreamTrigger = require('./triggers/stream'),
      getSNSTrigger = require('./triggers/sns');

module.exports = function updateStack(session) {
  const stackName = session.stackName,
        bucketName = session.bucketName,
        functions = session.functions,
        version = session.version,
        uploadedFunctions = session.compressedFunctions,
        routes = session.routes,
        region = session.region;

  session.aws.cfTemplate = getBaseTemplate(stackName);
  session.aws.cfTemplate.Resources = Object.assign({}, session.aws.cfTemplate.Resources, getFunctionResources(bucketName, version, functions, uploadedFunctions));
  session.aws.cfTemplate.Resources = Object.assign({}, session.aws.cfTemplate.Resources, getAPIResources(routes));

  const roleResource = session.aws.cfTemplate.Resources['RiseRole'];
  session.aws.cfTemplate.Resources = Object.assign(session.aws.cfTemplate.Resources, getTriggerResources(functions, region, roleResource));

  session.state = 'UPDATING';
  return session.aws.cf.updateStack({
    StackName: session.stackName,
    TemplateBody: JSON.stringify(session.aws.cfTemplate, null, 2),
    Capabilities: ['CAPABILITY_IAM']
  }).promise()
    .then(function() {
      return waitForUpdate(session);
    })
    .catch(function(err) {
      if (err.message) {
        if (err.message.indexOf('No updates are to be performed') !== -1) {
          log.info('No updates on updating stack. Proceed to the next step');
          return Promise.resolve(session);
        } else if (session.state !== 'UPDATING' && err.message.indexOf('Resource is not in the state stackUpdateComplete') !== -1) {
          // If a user cancelled deploying, it might get "ResourceNotReady: Resource is not in the state stackUpdateComplete"
          // Since it is rolling back
          // We need to share a deployment state globally and ignore the error when it is on canceling
          return Promise.resolve(session);
        }
      }
      return Promise.reject(err);
    });
};

function waitForUpdate(session) {
  const cf = session.aws.cf;

  log.info(`Updating stack [${session.stackName}]...`);
  return cf.waitFor('stackUpdateComplete', { StackName: session.stackName }).promise()
    .then(() => {
      log.info(`Updated stack [${session.stackName}]...`);
      session.state = 'UPDATED';
      return Promise.resolve(session);
    });
}

function getBaseTemplate(stackName) {
  const content = fsReadFile(path.join(__dirname, 'cf-base.json'));
  const cfTemplate = JSON.parse(content);

  const cfRestAPIContent = fsReadFile(path.join(__dirname, 'cf-restapi.json'));
  const cfRestAPIJSON = JSON.parse(cfRestAPIContent.replace('$NAME', `${stackName} API`));
  cfTemplate.Resources.RiseAPI = cfRestAPIJSON;

  return cfTemplate;
}

function getFunctionResources(bucketName, version, functions, uploadedFunctions) {
  const cfFunctionContent = fsReadFile(path.join(__dirname, 'cf-lambda-function.json'));
  const cfFunctionVersionContent = fsReadFile(path.join(__dirname, 'cf-lambda-version.json'));
  const cfFuncPermissionContent = fsReadFile(path.join(__dirname, 'cf-lambda-permission.json'));
  const resources = {};

  const defaultSetting = functions.default || {
    timeout: 3,
    memory: 128
  };

  for (let i = 0; i < uploadedFunctions.length; ++i) {
    const uploadedFunction = uploadedFunctions[i],
          funcName = uploadedFunction.functionName,
          func = functions[funcName];

    let timeout = defaultSetting.timeout,
        memorySize = defaultSetting.memory;

    if (func) {
      timeout = func.timeout != null ? func.timeout : timeout;
      memorySize = func.memory != null ? func.memory : memorySize;
    }

    resources[funcName] = JSON.parse(
      cfFunctionContent
      .replace('$HANDLER', 'index')
      .replace('$S3KEY', uploadedFunction.uploadPath)
      .replace('$S3BUCKET', bucketName)
      .replace('$TIMEOUT', timeout)
      .replace('$MEMORY_SIZE', memorySize)
    );

    resources[`${funcName}Version`] = JSON.parse(
      cfFunctionVersionContent.replace('$FUNCTION_NAME', funcName)
    );

    resources[`${funcName}Permission`] = JSON.parse(
      cfFuncPermissionContent.replace('$FUNCTION_NAME', funcName)
    );
  }

  return resources;
}

function getAPIResources(routes) {
  const resourceTemplate = fsReadFile(path.join(__dirname, 'cf-api-resource.json')),
        methodTemplate = fsReadFile(path.join(__dirname, 'cf-api-method.json')),
        corsMethodTemplate = fsReadFile(path.join(__dirname, 'cf-api-cors.json')),
        paths = routes.paths,
        pathTree = {
          name: 'RiseAPIResource',
          isRoot: true,
          children: {}
        };

  let defaultSetting = {};
  if (routes['x-rise'] && routes['x-rise'].default) {
    defaultSetting = routes['x-rise'].default;
  }

  let result = {};
  for (const p in paths) {
    let trimedPath = p;
    if (trimedPath[0] === '/') {
      trimedPath = trimedPath.substr(1);
    }

    if (trimedPath[trimedPath.length - 1] === '/') {
      trimedPath = trimedPath.substr(0, p.length - 1);
    }

    const tokens = trimedPath.split('/');
    const methods = paths[p];

    let parent = pathTree;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const name = parent.name + titlecase(token.replace(/[\{\}]/g, ''));

      // This is when the path is '/'
      // We are not sure that '/' comes first.
      if (token === '') {
        result = Object.assign({}, result, createAPIMethod(methodTemplate, corsMethodTemplate, parent, defaultSetting, methods));
        continue;
      }

      if (!parent.children[token]) {
        parent.children[token] = { name, isRoot: false, children: {} };
        result = Object.assign({}, result, createAPIResource(resourceTemplate, parent, name, token));
      }

      // When it is last token, it creates methods for the api resource
      if (i === (tokens.length - 1)) {
        result = Object.assign({}, result, createAPIMethod(methodTemplate, corsMethodTemplate, parent.children[token], defaultSetting, methods));
      }

      parent = parent.children[token];
    }
  }

  return result;
}

function createAPIResource(resourceTemplate, parent, name, p) {
  const result = {};
  const methodJSON = JSON.parse(resourceTemplate.replace('$LAST_PATH', p));
  if (parent.isRoot) {
    methodJSON.Properties.ParentId = { 'Fn::GetAtt': ['RiseAPI', 'RootResourceId'] };
  } else {
    methodJSON.Properties.ParentId = { Ref: parent.name };
  }

  result[name] = methodJSON;
  return result;
}

function createAPIMethod(methodTemplate, corsMethodTemplate, res, defaultSetting, methods) {
  const result = {};
  const corsMethods = [];

  for (const m in methods) {
    const methodResourceName = res.name + m.toUpperCase();
    const method = methods[m];
    const methodJSON = JSON.parse(methodTemplate
      .replace('$METHOD', m.toUpperCase())
      .replace('$FUNCTION_NAME', method['x-rise'].function)
    );

    if (res.isRoot) {
      methodJSON.Properties.ResourceId = { 'Fn::GetAtt': ['RiseAPI', 'RootResourceId'] };
    } else {
      methodJSON.Properties.ResourceId = { Ref: res.name };
    }
    result[methodResourceName] = methodJSON;

    let cors;
    if (method['x-rise'].cors != null) {
      cors = method['x-rise'].cors;
    } else {
      cors = defaultSetting.cors;
    }

    if (cors) {
      corsMethods.push(m.toUpperCase());
    }
  }

  if (corsMethods.length > 0) {
    corsMethods.push('OPTIONS');
    const methodResourceName = `${res.name}OPTIONS`;
    const methodJSON = JSON.parse(corsMethodTemplate.replace(/\$CORS_METHODS/g, corsMethods.join(',')));
    if (res.isRoot) {
      methodJSON.Properties.ResourceId = { 'Fn::GetAtt': ['RiseAPI', 'RootResourceId'] };
    } else {
      methodJSON.Properties.ResourceId = { Ref: res.name };
    }
    result[methodResourceName] = methodJSON;
  }

  return result;
}


function getTriggerResources(functions, region, roleResource) {
  const resources = {},
        defaultSetting = functions.default || {};

  for (const funcName in functions) {
    if (funcName === 'default') {
      continue;
    }

    let triggers = defaultSetting.triggers;
    if (functions[funcName] != null) {
      triggers = functions[funcName].triggers;
    }

    if (triggers) {
      for (const i in triggers) {
        const triggerName = Object.keys(triggers[i])[0];
        const trigger = triggers[i][triggerName];
        switch(triggerName) {
          case 's3':
            Object.assign(resources, getS3Trigger(trigger, funcName));
            break;
          case 'cloudwatch_events':
            Object.assign(resources, getCloudWatchEventTrigger(trigger, funcName));
            break;
          case 'cloudwatch_logs':
            Object.assign(resources, getCloudWatchLogsTrigger(trigger, funcName, region));
            break;
          case 'stream':
            Object.assign(resources, getStreamTrigger(trigger, funcName, roleResource));
            break;
          case 'sns':
            Object.assign(resources, getSNSTrigger(trigger, funcName));
            break;
          default:
            log.error(`Unknown trigger ${triggerName}.`);
            break;
        }
      }
    }
  }

  return resources;
}
