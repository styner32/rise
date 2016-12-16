'use strict';

const pingFunctions = require('../src/aws/pingFunctions');

describe('pingFunctions', function() {
  let session,
      listFunctionsFn,
      invokeFn;

  beforeEach(function() {
    listFunctionsFn = spyWithPromise(function(resolve, reject) { // eslint-disable-line no-unused-vars
      resolve({
        Functions: [
          { FunctionName: "foo-stack-AppIndex-123456" },
          { FunctionName: "foo-stack-AppCreate-789012" }
        ]
      });
    });

    invokeFn = spyWithPromise(function(resolve, reject) { // eslint-disable-line no-unused-vars
      resolve({ StatusCode: 200, Payload: '{"test":"ok"}' });
    });

    session = {
      stackName: 'foo-stack',
      functions: {
        AppIndex: null,
        AppCreate: {
          memory: 128
        }
      },
      aws: {
        lambda: {
          listFunctions: listFunctionsFn,
          invoke: invokeFn
        }
      }
    };
  });

  it('pings deployed functions', function() {
    return pingFunctions(session)
      .then(function(session) {
        expect(session).to.not.be.null;
        expect(listFunctionsFn).to.have.been.calledOnce;
        expect(listFunctionsFn).to.have.been.calledWith({});
        expect(invokeFn).to.have.been.calledTwice;
        expect(invokeFn).to.have.been.calledWith({
          FunctionName: 'foo-stack-AppIndex-123456',
          Payload: JSON.stringify({riseTest: 1})
        });
        expect(invokeFn).to.have.been.calledWith({
          FunctionName: 'foo-stack-AppCreate-789012',
          Payload: JSON.stringify({riseTest: 1})
        });
      });
  });

  context('when bare is true', function() {
    beforeEach(function() {
      session.functions.AppIndex = { bare: true };
    });

    it('does not ping', function() {
      return pingFunctions(session)
      .then(function(session) {
        expect(session).to.not.be.null;
        expect(listFunctionsFn).to.have.been.calledOnce;
        expect(listFunctionsFn).to.have.been.calledWith({});
        expect(invokeFn).to.have.been.calledOnce;
        expect(invokeFn).to.have.been.calledWith({
          FunctionName: 'foo-stack-AppCreate-789012',
          Payload: JSON.stringify({riseTest: 1})
        });
      });
    });
  });
});
