(function() {
  let module = angular.module('mainWindow', ['treeControl']);
  const ipcRenderer = require('electron').ipcRenderer;
  //const nodeUuid = require('node-uuid');
  const storage = require('electron').remote.require('./utils/storage.js');
  //const dialog = require('electron').remote.dialog;
  const async = require('async');

  function MainWindowController($scope, $compile) {
    $scope.activeSessions = {};
    let activeSessionArr = [];

    window.$ = window.jQuery = require('../node_modules/jquery/dist/jquery.min.js');

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
      let index = activeSessionArr.indexOf(sessionId);
      let count = activeSessionArr.length;
      let rows = Math.ceil(count / 2);

      $(`#${sessionId}`).remove();

      for (let i = Math.ceil((index + 1) / 2); i < rows; ++i) {
        $(`#${activeSessionArr[i * 2]}`).appendTo(`#row${i}`);
      }

      if ((count % 2) === 1) {
        $(`#row${rows}`).remove();
      }

      delete $scope.activeSessions[sessionId];
      activeSessionArr.splice(index, 1);
      ipcRenderer.send('asynchronous-message', `session-ended ${ sessionId }`);
    }

    function addActiveSession(sessionId, scope) {
      activeSessionArr.push(sessionId);
      if ((activeSessionArr.length % 2) === 1) {
        $('#sessionContainer').append(`<div id="row${Math.ceil(activeSessionArr.length / 2)}" class="row"></div>`);
      }

      $(`#row${Math.ceil(activeSessionArr.length / 2)}`).append($compile(`<my-session id="${sessionId}" session-config="activeSessions['${sessionId}']" end-session="endSession" edit-session="editSession"></my-session>`)($scope));
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
                addActiveSession(sessionId);
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
            let sync = new (require('../utils/sync.js'))();
            const ipcRenderer = require('electron').ipcRenderer;
            const cp = require('child_process');
            const path = require('path');
            const rimraf = require('rimraf');

            let state;

            scope.localFilterList = [];
            let localFilterFiles = new Set();

            scope.remoteFilterList = [];
            let remoteFilterFiles = new Set();

            ipcRenderer.on('asynchronous-reply', function(event, arg) {
              if ((typeof arg === 'object') && (arg.sessionId === scope.sessionConfig.id)) {
                switch (arg.command) {
                  case 'diff':
                    storage.getSettings(function(err, settings) {
                      if (err) {
                        console.log(err);
                      } else {
                        let tempFolder = settings.tempFolder.replace(/%appdir%/g, process.cwd());
                        sync.pullFileForDiff(arg.filename, tempFolder, function(err) {
                          if (err) {
                            // attn - show in UI
                            console.log(err);
                          } else {
                            let localFilePath = path.join(scope.sessionConfig.localPath, arg.filename);
                            let remoteFilePath = path.join(tempFolder, arg.filename);
                            let command = settings.diffToolInvocation;
                            command = command.replace(/%file%/g, arg.filename);
                            command = command.replace(/%localfile%/g, path.normalize(localFilePath));
                            command = command.replace(/%remotefile%/g, path.normalize(remoteFilePath));
                            cp.exec(command, function(err) {
                              if (err) {
                                console.log(err);
                              } else {
                                if (settings.clearTempFolder) {
                                  rimraf(tempFolder, function(err) {
                                    if (err) {
                                      console.log(err);
                                    }
                                  });
                                }
                              }
                            });
                          }
                        });
                      }
                    });
                    break;

                  default:
                    break;
                }
              }
            });

            function setState(newState) {
              state = newState;

              switch (state) {
                case 'connecting':
                  scope.status = 'Connecting...';
                  scope.showProgress = false;
                  scope.showSpinner = true;
                  scope.$applyAsync();
                  break;

                case 'retrieving-file-lists':
                  scope.status = 'Retrieving file lists...';
                  scope.showProgress = false;
                  scope.showSpinner = true;
                  scope.$applyAsync();
                  break;

                case 'ready':
                  scope.status = 'Ready';
                  scope.showProgress = false;
                  scope.showSpinner = false;
                  scope.$applyAsync();
                  break;

                case 'generating-transfer-list':
                  scope.status = 'Generating list of files to transfer...';
                  scope.showProgress = false;
                  scope.showSpinner = true;
                  scope.$applyAsync();
                  break;

                case 'transferring':
                  scope.status = 'Transferring';
                  scope.showProgress = true;
                  scope.showSpinner = true;
                  scope.$applyAsync();
                  break;

                default:
                  break;
              }
            }

            function setTempStatus(tempStatus, duration) {
              scope.status = tempStatus;

              $timeout(function() {
                setState(state);
              }, duration);
            }

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

            setState('connecting');

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

            scope.rightClickFile = function(node, selected) {
              ipcRenderer.send('asynchronous-message', `right-click ${node.filename} ${scope.sessionConfig.id}`);
            };

            scope.clearLocalFilterList = function() {
              scope.localFilterList = [];
              localFilterFiles.clear();
            };

            scope.selectRemoteFilterFile = function(node, selected) {
              if (selected) {
                remoteFilterFiles.add(node.filename);
              } else {
                remoteFilterFiles.delete(node.filename);
              }
            };

            scope.clearRemoteFilterList = function() {
              scope.remoteFilterList = [];
              remoteFilterFiles.clear();
            };

            function getFileLists() {
              setState('retrieving-file-lists');

              console.time('retrieve-file-list-time');

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
                ],
                function() {
                  setState('ready');
                  console.timeEnd('retrieve-file-list-time');
                }
              );
            }

            sync.init(scope.sessionConfig, function() {
              console.log('sync initialized');

              getFileLists();
            });

            scope.selectAll = function() {
              for (let i = 0; i < scope.files.length; ++i) {
                scope.files[i].send = scope.selectall;
              }
            };

            scope.getListOfFilesToPush = function() {
              setState('generating-transfer-list');

              scope.push = true;

              sync.generateListOfFilesToPush(localFilterFiles, function(err, filesToPush) {
                scope.selectall = true;

                setState('ready');

                if (filesToPush.length) {
                  scope.files = filesToPush;
                  for (let i = 0; i < scope.files.length; ++i) {
                    scope.files[i].send = true;
                  }

                  $(`#${ scope.sessionConfig.id }_modal`).modal('show');
                } else {
                  setTempStatus('No files to transfer', 5000);
                }
              });
            };

            scope.pushFiles = function(files) {
              let filesToPush = files.filter(function(file) {
                return file.send;
              });

              //scope.showProgress = true;
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
                  setState('retrieving-file-lists');
                  setTempStatus('Transfer complete', 5000);

                  sync.getRemoteFileList(function(err, fileList) {
                    if (err) {
                      console.log(err);
                    } else {
                      setState('ready');
                      scope.remoteFileList = fileList;
                      scope.$apply();
                    }
                  });
                }
              );
            };

            scope.getListOfFilesToPull = function() {
              setState('generating-transfer-list');

              scope.push = false;

              sync.generateListOfFilesToPull(remoteFilterFiles, function(err, filesToPull) {
                scope.selectall = true;

                setState('ready');

                if (filesToPull.length) {
                  scope.files = filesToPull;
                  for (let i = 0; i < scope.files.length; ++i) {
                    scope.files[i].send = true;
                  }

                  $(`#${ scope.sessionConfig.id }_modal`).modal('show');
                } else {
                  setTempStatus('No files to transfer', 5000);
                }
              });
            };

            scope.pullFiles = function(files) {
              setState('transferring');

              let filesToPull = files.filter(function(file) {
                return file.send;
              });

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
                  setState('retrieving-file-lists');
                  setTempStatus('Transfer complete', 5000);

                  sync.getLocalFileList(function(err, fileList) {
                    if (err) {
                      console.log(err);
                    } else {
                      setState('ready');
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