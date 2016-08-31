'use strict';

const Connection = require('ssh2');
const async = require('async');
const fs = require('fs');
const path = require('path');
const moment = require('moment');

let conn = new Connection();
let connectionEstablished = false;
let sftpSession;
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

  if (session.target.keyfilePath !== '') {
    options.privateKey = fs.readFileSync(session.target.keyfilePath);
  } else {
    options.password = session.target.password;
  }

  conn.connect(options);

  conn.on('ready', function() {
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
  let ignoreFileList = [];
  let contents = syncSession.fileIgnoreList;

  if (contents) {
    ignoreFileList = contents.trim().split('\n');
  }

  callback(null, ignoreFileList);
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

function getRemoteFileListByDirectory(directoryPath, ignoreFileList, callback) {
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
  readSyncIgnoreList(function(err, ignoreFileList) {
    if (err) {
      callback(err);
    } else {
      getRemoteFileListByDirectory(syncSession.remotePath, ignoreFileList, callback);
    }
  });
};

function getLocalFileListByDirectory(directoryPath, ignoreFileList, callback) {
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
  readSyncIgnoreList(function(err, ignoreFileList) {
    if (err) {
      callback(err);
    } else {
      getLocalFileListByDirectory(syncSession.localPath, ignoreFileList, callback);
    }
  });
};

module.exports.generateListOfFilesToPush = function(filterFiles, callback) {
  async.auto({
    getIgnoreFileList: function(autoCallback) {
      readSyncIgnoreList(autoCallback);
    },
    getLocalFileList: ['getIgnoreFileList', function(results, autoCallback) {
      getLocalFileListByDirectory(syncSession.localPath, results.getIgnoreFileList, autoCallback);
    }],
    getRemoteFileList: ['getIgnoreFileList', function(results, autoCallback) {
      getRemoteFileListByDirectory(syncSession.remotePath, results.getIgnoreFileList, autoCallback);
    }],
    getListOfFilesToPush: ['getLocalFileList', 'getRemoteFileList', function(results, autoCallback) {
      let bFound;
      let filesToPush = [];

      for (let i = 0; i < results.getLocalFileList.length; ++i) {
        if ((filterFiles.length === 0) || (filterFiles.indexOf(results.getLocalFileList[i].filename) !== -1)) {
          bFound = false;

          for (let j = 0; j < results.getRemoteFileList.length; ++j) {
            if (results.getLocalFileList[i].filename === results.getRemoteFileList[j].filename) {
              bFound = true;

              if (results.getLocalFileList[i].attrs.isFile()) {
                if (results.getLocalFileList[i].attrs.modifiedUnix > results.getRemoteFileList[j].attrs.modifiedUnix) {
                  filesToPush.push(results.getLocalFileList[i]);
                }
              }

              break;
            }
          }

          if (bFound === false) {
            filesToPush.push(results.getLocalFileList[i]);
          }
        }
      }

      autoCallback(null, filesToPush);
    }]
  },
  function(err, results) {
    if (err) {
      callback(err);
    } else {
      callback(null, results.getListOfFilesToPush);
    }
  });
};

function setRemoteFileModificationTime(filename, modTime, callback) {
  sftpSession.utimes(syncSession.remotePath + '/' + filename,
                     modTime,
                     modTime,
                     callback);
}

module.exports.pushFiles = function(filesToPush, stepFunction, callback) {
  if (filesToPush.length) {
    let total = filesToPush.reduce(function(previousValue, file) {
      return previousValue + file.attrs.size;
    }, 0);
    let bytesTransferred = 0;

    async.eachSeries(filesToPush, function(file, arrayCallback) {
      if (file.attrs.isFile()) {
        sftpSession.fastPut(
          syncSession.localPath + '/' + file.filename,
          syncSession.remotePath + '/' + file.filename,
          {
            step: function(bytesTransferredForFile, chunk, totalForFile) {
              bytesTransferred += chunk;
              stepFunction(file.filename, bytesTransferred, total);
            }
          },
          function() {
            setRemoteFileModificationTime(file.filename, file.attrs.mtime, arrayCallback);
          });
      } else {
        if (file.attrs.isDirectory()) {
          sftpSession.mkdir(
            syncSession.remotePath + '/' + file.filename,
            function() {
              arrayCallback(null);
            });
        } else {
          arrayCallback(null);
        }
      }
    },
    function(err) {
      if (err) {
        console.log('async.eachSeries error:', err);
        callback(err);
      } else {
        callback(null);
      }
    });
  } else {
    callback(null);
  }
};

// function generateListOfFilesToPull(localFilesList, remoteFilesList, args, callback) {
//   let i;
//   let j;
//   let bFound;
//   let filesToPull = [];

//   //console.log('Files to pull: ');

//   for (i = 0; i < remoteFilesList.length; ++i) {
//     if ((args.length === 0) || (args.indexOf(remoteFilesList[i].filename) !== -1)) {
//       bFound = false;

//       for (j = 0; j < localFilesList.length; ++j) {
//         if (remoteFilesList[i].filename === localFilesList[j].filename) {
//           bFound = true;

//           if (isFile(remoteFilesList[i].attrs.mode)) {
//             if (remoteFilesList[i].attrs.modifiedUnix > localFilesList[j].attrs.modifiedUnix) {
//               //displayFileInfo(localFilesList[j], remoteFilesList[i], filesToPull.length);

//               filesToPull.push(remoteFilesList[i].filename);
//             }
//           }

//           break;
//         }
//       }

//       if (bFound === false) {
//         //displayFileInfo(localFilesList[j], remoteFilesList[i], filesToPull.length);

//         filesToPull.push(remoteFilesList[i].filename);
//       }
//     }
//   }

  /*if (filesToPull.length) {
    console.log();
  } else {
    console.log('  No files to pull');
    console.log();
  }*/

//   callback(null, filesToPull);
// }

// function setLocalFileModificationTime(filename, callback) {
//   for (let i = 0; i < remoteFiles.length; ++i) {
//     if (remoteFiles[i].filename === filename) {
//       fs.utimes(syncSession.localPath + '/' + filename,
//                 remoteFiles[i].attrs.mtime,
//                 remoteFiles[i].attrs.mtime,
//                 callback);
//       return;
//     }
//   }

//   callback(null);
// }

// function pullFiles(filesToPull, callback) {
//   if (filesToPull.length) {
//     console.log('Pulling file(s)');

//     async.eachSeries(filesToPull, function(file, arrayCallback) {
//       console.log('  Pulling %s', file);

//       for (let i = 0; i < remoteFiles.length; ++i) {
//         if (remoteFiles[i].filename === file) {
//           if (isFile(remoteFiles[i].attrs.mode)) {
//             sftpSession.fastGet(syncSession.remotePath + '/' + file,
//                                 syncSession.localPath + '/' + file,
//                                 function() {
//                                   setLocalFileModificationTime(file, arrayCallback);
//                                 });
//           } else {
//             if (isDirectory(remoteFiles[i].attrs.mode)) {
//               fs.mkdirSync(cfgLocalPath + '/' + file);
//             }

//             arrayCallback(null);
//           }

//           break;
//         }
//       }
//     },
//     function(err) {
//       if (err) {
//         console.log('async.eachSeries error:', err);
//         callback(err);
//       } else {
//         callback(null);
//       }
//     });
//   } else {
//     callback(null);
//   }
// }
