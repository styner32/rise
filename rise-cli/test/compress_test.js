'use strict';

const compressAndCompare = require('../src/aws/compressAndCompare'),
      fs = require('fs'),
      crypto = require('crypto'),
      yaml = require('js-yaml'),
      path = require('path'),
      tmp = require('tmp'),
      unzip = require('adm-zip'),
      fsReadFile = require('../src/utils/fs').fsReadFile;

describe('compressAndCompare', function() {
  let session,
      cwdOrig,
      tmpDir,
      funcFiles;

  const createFolder = function(path) {
          fs.mkdirSync(path);
          funcFiles.push(path);
        },
        writeFile = function(path, content) {
          fs.writeFileSync(path, content, { encoding: 'utf8' });
          funcFiles.push(path);
        };

  beforeEach(function() {
    cwdOrig = process.cwd();
    tmpDir = tmp.dirSync();
    funcFiles = [];

    process.chdir(tmpDir.name);

    const routesJSON = {
      paths: {
        '/': {
          get: {
            'x-rise': {
              function: 'listTasks'
            }
          },
          put: {
            'x-rise': {
              function: 'createTasks'
            }
          }
        }
      }
    };

    const profilesJSON = {
      default: {
        provider: 'aws',
        region: 'us-west-2',
        bucket: 'test-bucket'
      }
    };

    const funcsJSON = {
      default: {
        memory: 128,
        timeout: 3,
        exclude: 'CHANGELOG.*'
      },
      listTasks: {
        memory: 128,
        timeout: 1,
        exclude: 'README.*'
      },
      createTasks: null
    };

    // config yaml files
    writeFile(path.join(tmpDir.name, 'routes.yaml'), yaml.safeDump(routesJSON));
    writeFile(path.join(tmpDir.name, 'rise.yaml'), yaml.safeDump({
      profiles: profilesJSON,
      functions: funcsJSON
    }));

    // function files
    const appDir = path.join(tmpDir.name, 'functions');
    const indexFnPath = path.join(tmpDir.name, 'functions', 'listTasks');
    const createFnPath = path.join(tmpDir.name, 'functions', 'createTasks');

    createFolder(appDir);
    createFolder(indexFnPath);
    createFolder(createFnPath);
    writeFile(path.join(indexFnPath, 'index.js'), "console.log('index!');");
    writeFile(path.join(createFnPath, 'create.js'), "console.log('create!');");

    // lib functions
    const libDir = path.join(tmpDir.name, 'lib');
    createFolder(libDir);
    writeFile(path.join(libDir, 'lib.js'), "console.log('lib!');");

    // README.md
    writeFile(path.join(tmpDir.name, 'README.md'), "# README");

    // CHANGELOG.md
    writeFile(path.join(tmpDir.name, 'CHANGELOG.md'), "# No updates");

    session = {
      functions: funcsJSON,
      compressedFunctions: [],
      hasher: crypto.createHash('sha256'),
      riseJSON: {
        active_version: 'v1',
        version_hashes: {}
      }
    };
  });

  afterEach(function() {
    process.chdir(cwdOrig);
    for (let i = 0; i < session.compressedFunctions.length; ++i) {
      const p = session.compressedFunctions[i].filePath;
      fs.unlinkSync(p);
    }

    if (tmpDir) {
      for (let i = funcFiles.length - 1; i >= 0; --i) {
        const p = funcFiles[i];
        if (fs.statSync(p).isDirectory()) {
          fs.rmdirSync(p);
        } else {
          fs.unlinkSync(p);
        }
      }

      tmpDir.removeCallback();
    }
  });

  it('updates version and hash for next version', function() {
    return compressAndCompare(session)
      .then(function(session) {
        expect(session).to.exist;
        expect(session.state).to.equal('COMPRESSED');
        expect(session.version).to.equal('v2');
        expect(session.riseJSON.active_version).to.equal('v1');
        expect(session.riseJSON.version_hashes['v2']).to.not.be.null;
      });
  });

  it('compresses files for each function', function() {
    const expectedFiles = {
      listTasks: [
        "functions/listTasks/index.js",
        "routes.yaml",
        "rise.yaml",
        "index.js",
        "lib/",
        "lib/lib.js"
      ],
      createTasks: [
        "functions/createTasks/create.js",
        "routes.yaml",
        "rise.yaml",
        "index.js",
        "lib/",
        "lib/lib.js",
        "README.md"
      ]
    };

    return compressAndCompare(session)
      .then(function(session) {
        expect(session.compressedFunctions).to.have.length(2);
        for (let i = 0; i < session.compressedFunctions.length; ++i) {
          const p = session.compressedFunctions[i];
          expect(p.filePath).to.exist;
          expect(fs.statSync(p.filePath)).to.not.be.null;
          expect(p.uploadPath).to.exist;

          const entries = new unzip(p.filePath).getEntries();
          expect(entries).to.not.be.empty;

          const paths = [];
          for (let j = 0; j < entries.length; j++) {
            const content = entries[j].getData().toString();
            if (!entries[j].isDirectory && entries[j].entryName !== 'index.js') {
              expect(fsReadFile(entries[j].entryName)).to.equal(content);
            } else if (entries[j].entryName === 'index.js') {
              const expected = `
const rise = require('rise-framework');

const appModule = require('./app'),
      functionModule = require('./functions/${p.functionName}');

exports.handle = rise.wrap.amazon(functionModule, appModule, {});`;
              expect(content).to.equal(expected);
            }
            paths.push(entries[j].entryName);
          }
          expect(paths).same.members(expectedFiles[p.functionName]);
        }
      });
  });

  context("when bare is true", function() {
    beforeEach(function() {
      session.functions.listTasks.bare = true;
      session.functions.createTasks = { bare: true };
    });

    it("does not wrap", function() {
      const expectedFiles = {
        listTasks: [
          "functions/listTasks/index.js",
          "routes.yaml",
          "rise.yaml",
          "index.js",
          "lib/",
          "lib/lib.js"
        ],
        createTasks: [
          "functions/createTasks/create.js",
          "routes.yaml",
          "rise.yaml",
          "index.js",
          "lib/",
          "lib/lib.js",
          "README.md"
        ]
      };

      return compressAndCompare(session)
        .then(function(session) {
          expect(session.compressedFunctions).to.have.length(2);
          for (let i = 0; i < session.compressedFunctions.length; ++i) {
            const p = session.compressedFunctions[i];
            expect(p.filePath).to.exist;
            expect(fs.statSync(p.filePath)).to.not.be.null;
            expect(p.uploadPath).to.exist;

            const entries = new unzip(p.filePath).getEntries();
            expect(entries).to.not.be.empty;

            const paths = [];
            for (let j = 0; j < entries.length; j++) {
              const content = entries[j].getData().toString();
              if (!entries[j].isDirectory && entries[j].entryName !== 'index.js') {
                expect(fsReadFile(entries[j].entryName)).to.equal(content);
              } else if (entries[j].entryName === 'index.js') {
                const expected = `
const functionModule = require('./functions/${p.functionName}');

exports.handle = functionModule.handle;`;
                expect(content).to.equal(expected);
              }
              paths.push(entries[j].entryName);
            }
            expect(paths).same.members(expectedFiles[p.functionName]);
          }
        });
    });
  });

  context("when the checksum is same as current version", function() {
    beforeEach(function() {
      const checksum = require('../src/utils/checksum');
      return checksum('CHANGELOG.md')
        .then(function(checksumResult) {
          session.riseJSON.version_hashes['v1'] = checksumResult;
        });
    });

    it("does not continue to compress files", function() {
      return compressAndCompare(session)
        .then(function() {
          fail('this promise should not have been resolved');
        })
        .catch(function(err) {
          expect(err).to.contain('No change is present');
          expect(session.compressedFunctions).to.have.length(0);
        });
    });
  });

  context("when the checksum is not same as current version", function() {
    beforeEach(function() {
      session.riseJSON.version_hashes['v1'] = '123456';
    });

    it("does not continue to compress files", function() {
      return compressAndCompare(session)
        .then(function(session) {
          expect(session.compressedFunctions).to.have.length(2);
        });
    });
  });

  context("when there are no functions", function() {
    beforeEach(function() {
      session.functions = {};
    });

    it("returns an error", function() {
      return compressAndCompare(session)
        .then(function() {
          fail('this promise should not have been resolved');
        })
        .catch(function(err) {
          expect(err).to.contain('No functions found in rise.yaml');
        });
    });
  });

  context("when folders don't exist for functions", function() {
    beforeEach(function() {
      session.functions.thisIsNotFunc = null;
    });

    it("returns an error", function() {
      return compressAndCompare(session)
        .then(function() {
          fail('this promise should not have been resolved');
        })
        .catch(function(err) {
          expect(err).to.contain('"functions/thisIsNotFunc" is invalid or does not exist');
        });
    });
  });
});

