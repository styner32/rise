'use strict';

const uploadFunctions = require('../src/aws/uploadFunctions'),
      path = require('path'),
      fs = require('fs'),
      fsStat = require('../src/utils/fs').fsStat,
      tmp = require('tmp');

describe('uploadFunctions', function() {
  let session,
      tmpDir,
      tempFileName1,
      tempFileName2,
      funcFilePath1,
      funcFilePath2,
      putObjectFn,
      putObjectErrFn;

  beforeEach(function() {
    tmpDir = tmp.dirSync();
    tempFileName1 = 'AppIndex-1235622a-1234-1234-8383-4afbbd30619c.zip';
    tempFileName2 = 'AppFoo-1238888a-1999-9999-8383-4afbbd30619c.zip';
    funcFilePath1 = path.join(tmpDir.name, tempFileName1);
    funcFilePath2 = path.join(tmpDir.name, tempFileName2);
    putObjectFn = spyWithPromise(function(resolve, reject) { // eslint-disable-line no-unused-vars
      resolve();
    });
    putObjectErrFn = spyWithPromise(function(resolve, reject) { // eslint-disable-line no-unused-vars
      reject();
    });

    fs.writeFileSync(funcFilePath1, 'zip content');
    fs.writeFileSync(funcFilePath2, 'zip content');

    session = {
      state: '',
      compressedFunctions: [{
        functionPath: '/',
        functionName: 'AppIndex',
        tempFileName1,
        filePath: funcFilePath1
      }, {
        functionPath: '/foo',
        functionName: 'AppFoo',
        tempFileName2,
        filePath: funcFilePath2
      }],
      aws: {
        s3: {
          putObject: putObjectFn
        }
      }
    };
  });

  context('when upload success', function() {
    it('updates state to UPLOADING', function() {
      return uploadFunctions(session)
        .then(function(session) {
          expect(session.state).to.equal('UPLOADED');
        });
    });

    it('cleans up temp function zip file', function() {
      return uploadFunctions(session)
        .then(function(/* session */) {
          expect(fsStat(funcFilePath1)).to.equal(false);
          expect(fsStat(funcFilePath2)).to.equal(false);
        });
    });
  });

  context('when upload failed', function() {
    beforeEach(function() {
      session.aws.s3.putObject = putObjectErrFn;
    });

    it('updates state to UPLOAD_FAILED', function() {
      return uploadFunctions(session)
        .then(function() {
          fail('this promise should not have been resolved');
        })
        .catch(function() {
          expect(session.state).to.equal('UPLOAD_FAILED');
        });
    });

    it('cleans up temp function zip file', function() {
      return uploadFunctions(session)
        .then(function() {
          fail('this promise should not have been resolved');
        })
        .catch(function() {
          expect(fsStat(funcFilePath1)).to.equal(false);
          expect(fsStat(funcFilePath2)).to.equal(false);
        });
    });
  });
});
