'use strict';

const Connection = require('ssh2');
const async = require('async');
const fs = require('fs');
const path = require('path');
const moment = require('moment');

let conn = new Connection();
let connectionEstablished = false;
let sftpSession;
let ignoreFileList;
let syncSession;

module.exports.init = function(session, callback) {
  if (connectionEstablished) {
    connectionEstablished = false;
    conn.end();
    conn = new Connection();
  }
  syncSession = session;

  let options = {
    host:         session.target.host,
    // attn - configurable?
    port:         22,
    username:     session.target.username,
    readyTimeout: 99999
  };

  if (session.target.keyfilePath !== null) {
    options.privateKey = fs.readFileSync(session.target.keyfilePath);
  } else {
    options.password = session.target.password;
  }

  conn.connect(options);

  conn.on('ready', function() {
    //console.log('Connection ready');
    //console.log();
    conn.sftp(function(err, sftp) {
      if (err) {
        console.log('error creating sftp:', err);
        sftpSession = null;
        callback(err);
      } else {
        sftpSession = sftp;
        connectionEstablished = true;
        callback(null);
      }
    });
  });
};

function readSyncIgnoreList(callback) {
  let contents = syncSession.fileIgnoreList;
  if (contents) {
    ignoreFileList = contents.trim().split('\n');
  }

  callback(null);
}

function isFileIgnored(filepath, ignoreList) {
  let temp;

  for (let i = 0; i < ignoreList.length; ++i) {
    temp = path.normalize(ignoreList[i]);
    temp = temp.replace(/([\/.\\])/g, '\\$1');
    temp = temp.replace(/([*])/g, '.$1');
    var myRe = new RegExp(temp, 'g');
    if (filepath.search(myRe) !== -1) {
      return true;
    }
  }

  return false;
}

function isDirectoryIgnored(directoryPath, ignoreList) {
  for (let i = 0; i < ignoreList.length; ++i) {
    if (path.join(path.basename(directoryPath) + '/') === path.normalize(ignoreList[i])) {
      return true;
    }
  }

  return false;
}

// consulting the mode flags directly seems like an unfortunate way to have to
// determine whether the object is a file or directory, but the objects returned
// by sftp.readdir do not have isFile() or isDirectory() methods, and performing
// a stat on each remote file is very expensive with a large amount of files
function isFile(modeFlags) {
  /* jshint bitwise: false */
  return ((modeFlags & 0xF000) === 0x8000);
  /* jshint bitwise: true */
}

function isDirectory(modeFlags) {
  /* jshint bitwise: false */
  return ((modeFlags & 0xF000) === 0x4000);
  /* jshint bitwise: true */
}

function getRemoteFileListByDirectory(directoryPath, callback) {
  let fileList = [];

  sftpSession.readdir(directoryPath, function(err, remoteDirList) {
    if (err) {
      console.log('sftpSession.readdir error:', err);

      callback(err);
    } else {
      let fileObj = {};
      let filePath;
      let tokens = [];

      async.eachSeries(
        remoteDirList,
        function(remoteDir, arrayCallback) {
          if (isFile(remoteDir.attrs.mode)) {
            if (!isFileIgnored(path.relative(syncSession.remotePath, directoryPath + '/' + remoteDir.filename), ignoreFileList)) {
              fileObj = {};
              filePath = path.relative(syncSession.remotePath, directoryPath + '/' + remoteDir.filename);
              tokens = filePath.split('\\');
              fileObj.filename = tokens.join('/');
              fileObj.attrs = remoteDir.attrs;
              fileObj.attrs.modifiedUnix = remoteDir.attrs.mtime;
              fileList.push(fileObj);
            }

            setImmediate(arrayCallback, null);
          } else {
            if (isDirectory(remoteDir.attrs.mode) && syncSession.recursive) {
              if (!isDirectoryIgnored(path.relative(syncSession.remotePath, directoryPath + '/' + remoteDir.filename), ignoreFileList)) {
                fileObj = {};
                filePath = path.relative(syncSession.remotePath, directoryPath + '/' + remoteDir.filename);
                tokens = filePath.split('\\');
                fileObj.filename = tokens.join('/');
                fileObj.attrs = remoteDir.attrs;
                fileObj.attrs.modifiedUnix = remoteDir.attrs.mtime;
                fileList.push(fileObj);

                getRemoteFileListByDirectory(directoryPath + '/' + remoteDir.filename, function(err, returnedFiles) {
                  Array.prototype.push.apply(fileList, returnedFiles);
                  arrayCallback(null);
                });
              } else {
                setImmediate(arrayCallback, null);
              }
            } else {
              setImmediate(arrayCallback, null);
            }
          }
        },
        function(err) {
          if (err) {
            console.log('async.eachSeries error:', err);
            callback(err);
          } else {
            callback(null, fileList);
          }
        }
      );
    }
  });
}

module.exports.getRemoteFileList = function(callback) {
  //let remoteFiles = [];

  readSyncIgnoreList(function() {
    getRemoteFileListByDirectory(syncSession.remotePath, function(err, fileList) {
      //remoteFiles = fileList;
      callback(err, fileList);
    });
  });
};

function getLocalFileListByDirectory(directoryPath, callback) {
  let fileList = [];

  fs.readdir(directoryPath, function(err, localDirList) {
    let fileObj = {};
    let filePath;
    let tokens = [];

    async.eachSeries(localDirList, function(localDir, arrayCallback) {
      fs.stat(directoryPath + '/' + localDir, function(err, stats) {
        if (err) {
          console.log('fs.stat error:', err);
          arrayCallback(err);
        } else {
          if (stats.isFile()) {
            if (!isFileIgnored(path.relative(syncSession.localPath, directoryPath + '/' + localDir), ignoreFileList)) {
              fileObj = {};
              filePath = path.relative(syncSession.localPath, directoryPath + '/' + localDir);
              tokens = filePath.split('\\');
              fileObj.filename = tokens.join('/');
              fileObj.attrs = stats;
              fileObj.attrs.modifiedUnix = moment(stats.mtime).unix();
              fileList.push(fileObj);
            }

            arrayCallback(null);
          } else {
            if (stats.isDirectory() && syncSession.recursive) {
              if (!isDirectoryIgnored(path.relative(syncSession.localPath, directoryPath + '/' + localDir), ignoreFileList)) {
                fileObj = {};
                filePath = path.relative(syncSession.localPath, directoryPath + '/' + localDir);
                tokens = filePath.split('\\');
                fileObj.filename = tokens.join('/');
                fileObj.attrs = stats;
                fileObj.attrs.modifiedUnix = moment(stats.mtime).unix();
                fileList.push(fileObj);

                getLocalFileListByDirectory(directoryPath + '/' + localDir, function(err, returnedFiles) {
                  //fileList = _.union(fileList, returnedFiles);
                  Array.prototype.push.apply(fileList, returnedFiles);
                  arrayCallback(null);
                });
              } else {
                arrayCallback(null);
              }
            } else {
              arrayCallback(null);
            }
          }
        }
      });
    },
    function(err) {
      if (err) {
        console.log('async.eachSeries error:', err);
        callback(err);
      } else {
        callback(null, fileList);
      }
    });
  });
}

module.exports.getLocalFileList = function(callback) {
  //localFiles = [];

  getLocalFileListByDirectory(syncSession.localPath, function(err, fileList) {
    //localFiles = fileList;
    callback(err, fileList);
  });
};
