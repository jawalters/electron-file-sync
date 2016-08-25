(function() {
  let module = angular.module('targetWindow', []);
  const ipcRenderer = require('electron').ipcRenderer;
  const nodeUuid = require('node-uuid');
  const storage = require('electron').remote.require('./utils/storage.js');
  const dialog = require('electron').remote.dialog;

  function TargetWindowController($scope) {
    $scope.target = {};

    ipcRenderer.on('asynchronous-message', function(event, arg) {
      if (typeof arg === 'string') {
        switch (arg) {
          case 'new target':
            $scope.heading = 'Create Target';
            $scope.target.id = nodeUuid.v1();
            $scope.target.name = '';
            $scope.target.host = '';
            $scope.target.username = '';
            $scope.target.password = '';
            $scope.target.keyfilePath = '';
            $scope.$apply();
            break;

          default:
            storage.getTarget({ id: arg }, function(err, target) {
              if (err) {
                console.log(err);
              } else {
                if (target) {
                  $scope.heading = 'Edit Target';
                  $scope.target.id = target.id;
                  $scope.target.name = target.name;
                  $scope.target.host = target.host;
                  $scope.target.username = target.username;
                  $scope.target.password = target.password;
                  $scope.target.keyfilePath = target.keyfilePath;
                  $scope.$apply();
                }
              }
            });
            break;
        }
      }
    });

    $scope.browseForKeyfile = function() {
      dialog.showOpenDialog({
        title: 'Choose a Keyfile',
        buttonLabel: 'Confirm',
        properties: ['openFile']
      }, function(file) {
        if (file) {
          if (Array.isArray(file)) {
            $scope.target.keyfilePath = file[0];
          } else {
            $scope.target.keyfilePath = file;
          }

          $scope.$apply();
        }
      });
    }

    $scope.save = function() {
      storage.saveTarget($scope.target);
      ipcRenderer.send('asynchronous-message', `target-saved ${ $scope.target.id }`);
      $scope.target = {};
    }

    $scope.cancel = function() {
      ipcRenderer.send('asynchronous-message', 'target-cancelled');
      $scope.target = {};
    }
  }

  module.controller('TargetWindowController', TargetWindowController);
}());