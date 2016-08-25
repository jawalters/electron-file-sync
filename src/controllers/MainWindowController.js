(function() {
  let module = angular.module('mainWindow', []);
  const ipcRenderer = require('electron').ipcRenderer;
  //const nodeUuid = require('node-uuid');
  const storage = require('electron').remote.require('./utils/storage.js');
  //const dialog = require('electron').remote.dialog;
  const async = require('async');

  function MainWindowController($scope, $compile) {
    $scope.activeSessions = {};

    window.$ = window.jQuery = require('../bower_components/jquery/dist/jquery.min.js');

    function getSessionConfig(sessionId, callback) {
      storage.getSession({ id: sessionId }, function(err, sessionResult) {
        if (err) {
          console.log(err);
          callback(err);
        } else {
          $scope.activeSessions[sessionId] = sessionResult;
          storage.getTarget({ id: sessionResult.targetId }, function(err, targetResult) {
            if (err) {
              console.log(err);
              callback(err);
            } else {
              $scope.activeSessions[sessionId].target = targetResult;
              $scope.$apply();
              callback(null);
            }
          });
        }
      });
    }

    $scope.editSession = function(sessionId) {
      console.log('controller editSession:', sessionId);
      ipcRenderer.send('asynchronous-message', `edit-session ${ sessionId }`);
    }

    $scope.endSession = function(sessionId) {
      console.log('controller endSession:', sessionId);
      $(`#${ sessionId }`).remove();
      delete $scope.activeSessions[sessionId];
      console.log($scope.activeSessions);
    }

    ipcRenderer.on('asynchronous-message', function(event, arg) {
      if (typeof arg === 'string') {
        let tokens = arg.split(' ');
        switch (tokens[0]) {
          case 'start-session':
            let sessionId = tokens[1];

            getSessionConfig(sessionId, function(err) {
              if (err) {
                console.log(err);
              } else {
                $('#sessionContainer').append($compile(`<my-session id="${sessionId}" session-config="activeSessions['${sessionId}']" end-session="endSession" edit-session="editSession"></my-session>`)($scope));
              }
            });
            break;

          case 'target-changed':
            for (let sessionId in $scope.activeSessions) {
              if ($scope.activeSessions.hasOwnProperty(sessionId)) {
                if ($scope.activeSessions[sessionId].targetId === tokens[1]) {
                  getSessionConfig(sessionId, function(err) {
                    if (err) {
                      console.log(err);
                    }
                  });
                }
              }
            }
            break;

          case 'session-changed':
            getSessionConfig(tokens[1], function(err) {
              if (err) {
                console.log(err);
              }
            });
            break;

          default:
            break;
        }
      }
    });
  }

  module.controller('MainWindowController', MainWindowController)
        .directive('mySession', function() {
          function link(scope, element, attrs) {
            let sync = require('../utils/sync.js');

            scope.$watch('sessionConfig', function(newData, oldData) {
              //console.log('mySession - new data', newData);
              //console.log('mySession - old data', oldData);
              if ((typeof newData === 'undefined') ||
                  (newData === null) ||
                  (typeof oldData === 'undefined') ||
                  (oldData === null)) {
                return;
              }
              if (oldData === newData) {
                console.log('old data and new data are the same');
              } else {
                if ((newData.targetId !== oldData.targetId) ||
                    (newData.target.host !== oldData.target.host) ||
                    (newData.target.username !== oldData.target.username) ||
                    (newData.target.password !== oldData.target.password) ||
                    (newData.target.keyfilePath !== oldData.target.keyfilePath)) {
                  sync.init(scope.sessionConfig, function() {
                    console.log('sync initialized');
                    sync.getRemoteFileList(function(err, fileList) {
                      if (err) {
                        console.log(err);
                      } else {
                        console.log(fileList);
                      }
                    });
                  });
                } else {
                  // attn - reload the local and remote file lists?
                }
              }
            }, true);

            sync.init(scope.sessionConfig, function() {
              console.log('sync initialized');
              async.parallel(
                [
                  function(parallelCallback) {
                    sync.getLocalFileList(function(err, fileList) {
                      if (err) {
                        console.log(err);
                        parallelCallback(err);
                      } else {
                        console.log(fileList);
                        parallelCallback(null);
                      }
                    });
                  },
                  function(parallelCallback) {
                    sync.getRemoteFileList(function(err, fileList) {
                      if (err) {
                        console.log(err);
                        parallelCallback(err);
                      } else {
                        console.log(fileList);
                        parallelCallback(null);
                      }
                    });
                  }
                ]
              );
            });

            scope.push = function() {
              console.log('push');
            }

            scope.pull = function() {
              console.log('pull');
            }


          }

          return {
            restrict: 'E',
            scope: {
              sessionConfig: '=',
              endSession: '=',
              editSession: '='
            },
            link: link,
            templateUrl: '../views/my-session.html'
          };
        });
}());