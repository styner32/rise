'use strict';

const getFunctionPhysicalResourceNames = require('../src/aws/getFunctionPhysicalResourceNames');

describe('getFunctionPhysicalResourceNames', function() {
  let session,
      functionName,
      stackName,
      describeStackResourceFn;

  beforeEach(function() {
    functionName = 'appIndex';
    stackName = 'foo-bar';
    describeStackResourceFn = spyWithPromise(function(resolve, reject) { // eslint-disable-line no-unused-vars
      resolve({
        StackResourceDetail: {
          PhysicalResourceId: 'resourceid'
        }
      });
    });

    session = {
      stackName,
      aws: {
        cf: {
          describeStackResource: describeStackResourceFn
        }
      }
    };
  });

  context('when a resource exists', function() {
    it('calls describeStackResource with resourceName', function() {
      return getFunctionPhysicalResourceNames(session, [functionName])
        .then(function(physicalResourceId) {
          expect(physicalResourceId).to.not.be.null;
          expect(physicalResourceId[0].physicalResourceName).to.equal('resourceid');
          expect(physicalResourceId[0].resourceName).to.equal('appIndex');
          expect(describeStackResourceFn).to.have.been.calledOnce;
          expect(describeStackResourceFn).to.have.been.calledWith({
            LogicalResourceId: functionName,
            StackName: stackName
          });
        });
    });
  });

  context('when a resource does not exist', function() {
    beforeEach(function() {
      describeStackResourceFn = spyWithPromise(function(resolve, reject) { // eslint-disable-line no-unused-vars
        reject({ message: 'does not exist' });
      });

      session.aws.cf.describeStackResource = describeStackResourceFn;
    });

    it('returns an error', function() {
      return getFunctionPhysicalResourceNames(session, [functionName])
        .then(function() {
          fail('unexpected then');
        })
        .catch(function(err) {
          expect(err).to.not.be.null;
          expect(describeStackResourceFn).to.have.been.calledOnce;
          expect(describeStackResourceFn).to.have.been.calledWith({
            LogicalResourceId: functionName,
            StackName: stackName
          });
        });
    });
  });
});
