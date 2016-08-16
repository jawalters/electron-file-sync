(function() {
  let module = angular.module('sessionWindow', []);
  const ipcRenderer = require('electron').ipcRenderer;
  const nodeUuid = require('node-uuid');
  const storage = require('electron').remote.require('./common/storage.js');
  const dialog = require('electron').remote.dialog;

  function SessionWindowController($scope) {
    $scope.session = {};

    ipcRenderer.on('asynchronous-message', function(event, arg) {
      if (typeof arg === 'string') {
        switch (arg) {
          case 'new session':
            $scope.heading = 'Create Session';
            $scope.session.id = nodeUuid.v1();
            $scope.session.name = '';
            $scope.session.targetId = '';
            $scope.session.localPath = '';
            $scope.session.remotePath = '';
            $scope.session.recursive = false;
            storage.getTargets(function(err, targets) {
              if (!err) {
                $scope.targets = targets;
                $scope.$apply();
              }
            });
            break;

          default:
            storage.getSession({ id: arg }, function(err, session) {
              if (err) {
                console.log(err);
              } else {
                if (session) {
                  $scope.heading = 'Edit Session';
                  $scope.session.id = session.id;
                  $scope.session.name = session.name;
                  $scope.session.targetId = session.targetId;
                  $scope.session.localPath = session.localPath;
                  $scope.session.remotePath = session.remotePath;
                  $scope.session.recursive = session.recursive;
                  storage.getTargets(function(err, targets) {
                    if (!err) {
                      $scope.targets = targets;
                      $scope.$apply();
                    }
                  });
                }
              }
            });
            break;
        }
      }
    });

    $scope.save = function() {
      storage.saveSession($scope.session);
      ipcRenderer.send('asynchronous-message', 'session saved');
      $scope.session = {};
    }

    $scope.cancel = function() {
      ipcRenderer.send('asynchronous-message', 'session cancelled');
      $scope.session = {};
    }
  }

  module.controller('SessionWindowController', SessionWindowController);
}());