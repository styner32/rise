#!/usr/bin/env node

'use strict';

const path = require('path'),
      program = require('commander'),
      deploy = require('../src/deploy'),
      rollback = require('../src/rollback'),
      newProject = require('../src/new'),
      generate = require('../src/generate'),
      logs = require('../src/logs'),
      pkgJSON = require(path.join(__dirname, '..', 'package.json'));

program
  .version(pkgJSON.version)
  .usage('[command]');

program
  .command('new <stackName>')
  .description('setup provider credential')
  .option('-r, --region <region>', 'AWS region')
  .option('-b, --bucket-name <bucketName>', 'AWS bucket name')
  .action((stackName, options) => {
    newProject(stackName, options);
  });

program
  .command('generate <functionName>')
  .description('scaffold a function.')
  .action((functionName) => {
    generate(functionName);
  });

program
  .command('deploy')
  .description('deploy a project')
  .action(() => {
    const session = require('../src/session').init();
    deploy(session);
  });

program
  .command('rollback <version>')
  .description('rollback to the specified version')
  .action((version) => {
    const session = require('../src/session').init();
    rollback(session, version);
  });

program
  .command('logs [functionName]')
  .description('output logs of a function')
  .option('-f, --follow', 'Follow log output (i.e. tail function log)')
  .option('--since [since]', 'Show logs since this timestamp')
  .action((functionName, options) => {
    const session = require('../src/session').init();
    logs(session, functionName, options);
  });

program.parse(process.argv);

if (process.argv.length === 2) {
  program.outputHelp();
}
