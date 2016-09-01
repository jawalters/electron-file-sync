(function() {
  let module = angular.module('mainWindow', ['treeControl']);
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
        .directive('mySession', function($timeout) {
          function link(scope, element, attrs) {
            let sync = require('../utils/sync.js');

            let localFilterFiles = new Set();
            let remoteFilterFiles = new Set();

            scope.$watch('sessionConfig', function(newData, oldData) {
              if ((typeof newData === 'undefined') ||
                  (newData === null) ||
                  (typeof oldData === 'undefined') ||
                  (oldData === null)) {
                return;
              }
              if (oldData !== newData) {
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
                  getFileLists();
                }
              }
            }, true);

            scope.status = 'Connecting...';
            scope.showProgress = false;

            scope.treeOptions = {
              multiSelection: true,
              nodeChildren: "children",
              dirSelectable: true,
              injectClasses: {
                ul: "a1",
                li: "a2",
                liSelected: "a7",
                iExpanded: "a3",
                iCollapsed: "a4",
                iLeaf: "a5",
                label: "a6",
                labelSelected: "a8"
              }
            };

            scope.selectLocalFilterFile = function(node, selected) {
              if (selected) {
                localFilterFiles.add(node.filename);
              } else {
                localFilterFiles.delete(node.filename);
              }
            };

            scope.selectRemoteFilterFile = function(node, selected) {
              if (selected) {
                remoteFilterFiles.add(node.filename);
              } else {
                remoteFilterFiles.delete(node.filename);
              }
            };

            function getFileLists() {
              async.parallel(
                [
                  function(parallelCallback) {
                    sync.getLocalFileList(function(err, fileList) {
                      if (err) {
                        console.log(err);
                        parallelCallback(err);
                      } else {
                        scope.localFileList = fileList;
                        scope.$apply();
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
                        scope.remoteFileList = fileList;
                        scope.$apply();
                        parallelCallback(null);
                      }
                    });
                  }
                ]
              );
            }

            sync.init(scope.sessionConfig, function() {
              console.log('sync initialized');
              scope.status = 'Ready';
              scope.$apply();

              getFileLists();
            });

            scope.selectAll = function() {
              for (let i = 0; i < scope.files.length; ++i) {
                scope.files[i].send = scope.selectall;
              }
            };

            scope.getListOfFilesToPush = function() {
              scope.push = true;

              sync.generateListOfFilesToPush(localFilterFiles, function(err, filesToPush) {
                scope.selectall = true;

                scope.files = filesToPush;
                for (let i = 0; i < scope.files.length; ++i) {
                  scope.files[i].send = true;
                }
                scope.$apply();
              });
            };

            scope.pushFiles = function(files) {
              let filesToPush = files.filter(function(file) {
                return file.send;
              });

              scope.showProgress = true;
              scope.progress = 0;
              scope.progressStyle = { width: '0%' };
              sync.pushFiles(
                filesToPush,
                function(filename, totalTransferred, total) {
                  scope.status = `Transferring ${ filename }`;
                  scope.progress = Math.floor((totalTransferred / total) * 100);
                  scope.progressStyle = { width: `${ scope.progress }%` };
                  scope.$apply();
                },
                function() {
                  $timeout(function() {
                    scope.status = 'Transfer complete';
                    scope.progress = 100;
                    scope.progressStyle = { width: '100%' };
                  }, 500);

                  $timeout(function() {
                    scope.status = 'Ready';
                    scope.showProgress = false;
                  }, 5000);

                  sync.getRemoteFileList(function(err, fileList) {
                    if (err) {
                      console.log(err);
                    } else {
                      scope.remoteFileList = fileList;
                      scope.$apply();
                    }
                  });
                }
              );
            };

            scope.getListOfFilesToPull = function() {
              scope.push = false;

              sync.generateListOfFilesToPull(remoteFilterFiles, function(err, filesToPull) {
                scope.selectall = true;

                scope.files = filesToPull;
                for (let i = 0; i < scope.files.length; ++i) {
                  scope.files[i].send = true;
                }
                scope.$apply();
              });
            };

            scope.pullFiles = function(files) {
              let filesToPull = files.filter(function(file) {
                return file.send;
              });

              scope.showProgress = true;
              scope.progress = 0;
              scope.progressStyle = { width: '0%' };
              sync.pullFiles(
                filesToPull,
                function(filename, totalTransferred, total) {
                  scope.status = `Transferring ${ filename }`;
                  scope.progress = Math.floor((totalTransferred / total) * 100);
                  scope.progressStyle = { width: `${ scope.progress }%` };
                  scope.$apply();
                },
                function() {
                  $timeout(function() {
                    scope.status = 'Transfer complete';
                    scope.progress = 100;
                    scope.progressStyle = { width: '100%' };
                  }, 500);

                  $timeout(function() {
                    scope.status = 'Ready';
                    scope.showProgress = false;
                  }, 5000);

                  sync.getLocalFileList(function(err, fileList) {
                    if (err) {
                      console.log(err);
                    } else {
                      scope.localFileList = fileList;
                      scope.$apply();
                    }
                  });
                }
              );
            };

            $timeout(function() {
              document.getElementById(`${ scope.sessionConfig.id }_refresh`).addEventListener('click', function() {
                getFileLists();
              });
            });
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