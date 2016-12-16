'use strict';

const fs = require('fs'),
      os = require('os'),
      path = require('path'),
      uuid = require('uuid'),
      archiver = require('archiver'),
      log = require('../utils/log'),
      checksum = require('../utils/checksum'),
      fsStat = require('../utils/fs').fsStat;

const riseIndexJSTemplate = `
const rise = require('rise-framework');

const appModule = require('./app'),
      functionModule = require('./#{FUNCTION_PATH}');

exports.handle = rise.wrap.amazon(functionModule, appModule, {});`,
      riseBareIndexJSTemplate = `
const functionModule = require('./#{FUNCTION_PATH}');

exports.handle = functionModule.handle;`;

module.exports = function compressAndCompare(session) {
  if (!session.functions || Object.keys(session.functions).length === 0) {
    return Promise.reject("No functions found in rise.yaml.");
  }

  const funcNames = Object.keys(session.functions),
        defaultFuncSetting = session.functions.default;

  let globalExcludePattern = null;

  if (defaultFuncSetting && typeof defaultFuncSetting.exclude === 'string') {
    globalExcludePattern = defaultFuncSetting.exclude;
  }

  session.state = 'VERIFYING';
  return checksum(globalExcludePattern)
    .then((checksumHex) => {
      const activeVersion = session.riseJSON.active_version,
            activeVersionHash = session.riseJSON.version_hashes[session.riseJSON.active_version],
            compressPromises = [];

      if (activeVersionHash === checksumHex) {
        for (let i = 0; i < session.compressedFunctions.length; ++i) {
          fs.unlinkSync(session.compressedFunctions[i].filePath);
        }
        return Promise.reject("No change is present");
      }

      if (!activeVersion) {
        log.info('Deploying the first version');
        session.version = 'v1';
      } else {
        session.previousVersion = activeVersion;
        session.version = `v${(parseInt(activeVersion.substr(1) || 0) + 1)}`;
        log.info(`Current active version is "${activeVersion}". Uploading "${session.version}"...`);
      }

      session.riseJSON.version_hashes[session.version] = checksumHex;

      for (let i = 0; i < funcNames.length; ++i) {
        const funcName = funcNames[i],
              excludePatterns = [];

        if (funcName === 'default') {
          continue;
        }

        if (globalExcludePattern != null) {
          excludePatterns.push(globalExcludePattern);
        }

        if (session.functions[funcName] && typeof session.functions[funcName].exclude === 'string') {
          excludePatterns.push(session.functions[funcName].exclude);
        }

        let bare = false;
        if (session.functions[funcName] && typeof session.functions[funcName].bare === 'boolean') {
          bare = session.functions[funcName].bare;
        }

        session.state = 'COMPRESSING';
        compressPromises.push(compress(session, funcName, excludePatterns, bare));
      }

      return Promise.all(compressPromises);
    })
    .then(() => {
      for (let i = 0; i < session.compressedFunctions.length; ++i) {
        const fileName = session.compressedFunctions[i].fileName,
              uploadPath = `versions/${session.version}/functions/${fileName}`;

        session.compressedFunctions[i].uploadPath = uploadPath;
      }

      session.state = 'COMPRESSED';
      return Promise.resolve(session);
    });
};

function compress(session, functionName, excludePatterns, bare) {
  return new Promise((resolve, reject) => {
    process.nextTick(function() {
      log.info(`Compressing ${functionName}...`);

      const functionPath = path.join('functions', functionName),
            stat = fsStat(functionPath);

      if (!stat || !stat.isDirectory()) {
        reject(`"${functionPath}" is invalid or does not exist`);
        return;
      }

      const zipArchive = archiver.create('zip'),
            fileName = `${functionName}-${uuid.v4()}.zip`,
            tempFileName = path.join(os.tmpdir(), fileName),
            output = fs.createWriteStream(tempFileName);

      output.on('close', function() {
        log.info(`Compressed ${functionName}.`);
        resolve();
      });

      zipArchive.on('error', function(err) {
        reject(err);
      });

      session.compressedFunctions.push({
        functionName,
        fileName,
        filePath: tempFileName
      });

      zipArchive.pipe(output);
      zipArchive.directory(functionPath);
      zipArchive.glob("**/*", { ignore: excludePatterns.concat(['functions/**']) });

      let indexJS;
      if (bare) {
        indexJS = riseBareIndexJSTemplate.replace(/\#\{FUNCTION_PATH\}/, functionPath);
      } else {
        indexJS = riseIndexJSTemplate.replace(/\#\{FUNCTION_PATH\}/, functionPath);
      }

      zipArchive.append(indexJS, { name: 'index.js' });
      zipArchive.finalize();
    });
  });
}
