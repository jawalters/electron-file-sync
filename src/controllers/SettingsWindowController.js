(function() {
  let module = angular.module('settingsWindow', []);
  const ipcRenderer = require('electron').ipcRenderer;
  const storage = require('electron').remote.require('./utils/storage.js');
  const dialog = require('electron').remote.dialog;

  function SettingsWindowController($scope) {
    $scope.settings = {};

    storage.getSettings(function(err, settings) {
      if (!err) {
        $scope.settings = settings;
        $scope.$apply();
      }
    });

    $scope.save = function() {
      storage.saveSettings($scope.settings);
      ipcRenderer.send('asynchronous-message', 'settings-saved');
    };

    $scope.cancel = function() {
      ipcRenderer.send('asynchronous-message', 'settings-cancelled');
      storage.getSettings(function(err, settings) {
        if (!err) {
          $scope.settings = settings;
          $scope.$apply();
        }
      });
    };
  }

  module.controller('SettingsWindowController', SettingsWindowController);
}());