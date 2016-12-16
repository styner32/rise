'use strict';

module.exports = function pingFunctions(session) {
  const lambda = session.aws.lambda,
        stackName = session.stackName,
        functionNamesToPing = [];

  session.state = 'PINGING';
  for (const name of Object.keys(session.functions)) {
    if (session.functions[name] && session.functions[name].bare) {
      continue;
    }
    functionNamesToPing.push(name);
  }

  return lambda.listFunctions({}).promise()
    .then(function(data) {
      return pingPromiseAll(lambda, stackName, functionNamesToPing, data.Functions).
        then(function() {
          session.state = 'PINGED';
          return Promise.resolve(session);
        });
    });
};

function pingPromiseAll(lambda, stackName, uploadedFunctionNames, functions) {
  const pingPromises = [];

  for (let i = 0; i < functions.length; ++i) {
    const f = functions[i].FunctionName;

    for (let i = 0; i < uploadedFunctionNames.length; ++i) {
      const funcPrefix = `${stackName}-${uploadedFunctionNames[i]}`;

      if (f.startsWith(funcPrefix)) {
        pingPromises.push(pingPromise(lambda, f));
      }
    }
  }

  return Promise.all(pingPromises);
}

function pingPromise(lambda, functionName) {
  return lambda.invoke({
    FunctionName: functionName,
    Payload: JSON.stringify({riseTest: 1})
  }).promise()
    .then(function(data) {
      if (data.StatusCode !== 200 || data.Payload !== '{"test":"ok"}') {
        return Promise.reject(new Error("functions are not deployed properly"));
      }
    });
}
