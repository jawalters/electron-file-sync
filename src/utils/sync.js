'use strict';

const Connection = require('ssh2');
const async = require('async');
const fs = require('fs');
const path = require('path');
const moment = require('moment');
const mkdirp = require('mkdirp');

function init(session, callback) {
  let self = this;
  if (self.connectionEstablished) {
    self.connectionEstablished = false;
    self.conn.end();
    self.conn = new Connection();
  }
  self.syncSession = session;

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

  self.conn.connect(options);

  self.conn.on('ready', function() {
    self.conn.sftp(function(err, sftp) {
      if (err) {
        console.log('error creating sftp:', err);
        self.sftpSession = null;
        callback(err);
      } else {
        self.sftpSession = sftp;
        self.connectionEstablished = true;
        callback(null);
      }
    });
  });
}

function readSyncIgnoreList(callback) {
  let self = this;
  let ignoreFileList = [];
  let contents = self.syncSession.fileIgnoreList;

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

function getRemoteFileListByDirectory(directoryPath, ignoreFileList, nested, callback) {
  let self = this;
  let fileList = [];

  self.sftpSession.readdir(directoryPath, function(err, remoteDirList) {
    if (err) {
      console.log('sftpSession.readdir error:', err);

      callback(err);
    } else {
      let filePath;
      let tokens = [];

      async.each(
        remoteDirList,
        function(remoteDir, arrayCallback) {
          if (isFile(remoteDir.attrs.mode)) {
            if (!isFileIgnored(path.relative(self.syncSession.remotePath, directoryPath + '/' + remoteDir.filename), ignoreFileList)) {
              let fileObj = {};
              filePath = path.relative(self.syncSession.remotePath, directoryPath + '/' + remoteDir.filename);
              tokens = filePath.split('\\');
              fileObj.filename = tokens.join('/');
              fileObj.shortname = remoteDir.filename;
              fileObj.attrs = remoteDir.attrs;
              fileObj.attrs.modifiedUnix = remoteDir.attrs.mtime;
              fileList.push(fileObj);
            }

            setImmediate(arrayCallback, null);
          } else {
            if (isDirectory(remoteDir.attrs.mode) && self.syncSession.recursive) {
              if (!isDirectoryIgnored(path.relative(self.syncSession.remotePath, directoryPath + '/' + remoteDir.filename), ignoreFileList)) {
                let fileObj = {};
                filePath = path.relative(self.syncSession.remotePath, directoryPath + '/' + remoteDir.filename);
                tokens = filePath.split('\\');
                fileObj.filename = tokens.join('/');
                fileObj.shortname = remoteDir.filename;
                fileObj.attrs = remoteDir.attrs;
                fileObj.attrs.modifiedUnix = remoteDir.attrs.mtime;
                fileList.push(fileObj);

                getRemoteFileListByDirectory.call(self, directoryPath + '/' + remoteDir.filename, ignoreFileList, nested, function(err, returnedFiles) {
                  if (nested) {
                    fileObj.children = returnedFiles;
                  } else {
                    Array.prototype.push.apply(fileList, returnedFiles);
                  }
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
            fileList.sort(function(file1, file2) {
              let file1name = file1.filename.toUpperCase();
              let file2name = file2.filename.toUpperCase();

              if (file1name < file2name) {
                return -1;
              }
              if (file2name < file1name) {
                return 1;
              }
              return 0;
            });
            callback(null, fileList);
          }
        }
      );
    }
  });
}

function getRemoteFileList(callback) {
  let self = this;

  readSyncIgnoreList.call(self, function(err, ignoreFileList) {
    if (err) {
      callback(err);
    } else {
      getRemoteFileListByDirectory.call(self, self.syncSession.remotePath, ignoreFileList, true, callback);
    }
  });
}

function getLocalFileListByDirectory(directoryPath, ignoreFileList, nested, callback) {
  let self = this;
  let fileList = [];

  fs.readdir(directoryPath, function(err, localDirList) {
    let fileObj = {};
    let filePath;
    let tokens = [];

    // attn - On average, eachSeries seems to be more efficient when retrieving
    //        both the local and remote lists in parallel.  I'm not sure how this
    //        can be, as each is faster when retrieving just the local file list.
    async.eachSeries(localDirList, function(localDir, arrayCallback) {
      fs.stat(directoryPath + '/' + localDir, function(err, stats) {
        if (err) {
          console.log('fs.stat error:', err);
          arrayCallback(err);
        } else {
          if (stats.isFile()) {
            if (!isFileIgnored(path.relative(self.syncSession.localPath, directoryPath + '/' + localDir), ignoreFileList)) {
              fileObj = {};
              filePath = path.relative(self.syncSession.localPath, directoryPath + '/' + localDir);
              tokens = filePath.split('\\');
              fileObj.filename = tokens.join('/');
              fileObj.shortname = localDir;
              fileObj.attrs = stats;
              fileObj.attrs.modifiedUnix = moment(stats.mtime).unix();
              fileList.push(fileObj);
            }

            arrayCallback(null);
          } else {
            if (stats.isDirectory() && self.syncSession.recursive) {
              if (!isDirectoryIgnored(path.relative(self.syncSession.localPath, directoryPath + '/' + localDir), ignoreFileList)) {
                fileObj = {};
                filePath = path.relative(self.syncSession.localPath, directoryPath + '/' + localDir);
                tokens = filePath.split('\\');
                fileObj.filename = tokens.join('/');
                fileObj.shortname = localDir;
                fileObj.attrs = stats;
                fileObj.attrs.modifiedUnix = moment(stats.mtime).unix();
                fileList.push(fileObj);

                getLocalFileListByDirectory.call(self, directoryPath + '/' + localDir, ignoreFileList, nested, function(err, returnedFiles) {
                  if (nested) {
                    fileObj.children = returnedFiles;
                  } else {
                    Array.prototype.push.apply(fileList, returnedFiles);
                  }
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
        fileList.sort(function(file1, file2) {
          let file1name = file1.filename.toUpperCase();
          let file2name = file2.filename.toUpperCase();

          if (file1name < file2name) {
            return -1;
          }
          if (file2name < file1name) {
            return 1;
          }
          return 0;
        });
        callback(null, fileList);
      }
    });
  });
}

function getLocalFileList(callback) {
  let self = this;

  readSyncIgnoreList.call(self, function(err, ignoreFileList) {
    if (err) {
      callback(err);
    } else {
      getLocalFileListByDirectory.call(self, self.syncSession.localPath, ignoreFileList, true, callback);
    }
  });
}

function generateListOfFilesToPush(filterFiles, callback) {
  let self = this;

  async.auto({
    getIgnoreFileList: function(autoCallback) {
      readSyncIgnoreList.call(self, autoCallback);
    },
    getLocalFileList: ['getIgnoreFileList', function(results, autoCallback) {
      getLocalFileListByDirectory.call(self, self.syncSession.localPath, results.getIgnoreFileList, false, autoCallback);
    }],
    getRemoteFileList: ['getIgnoreFileList', function(results, autoCallback) {
      getRemoteFileListByDirectory.call(self, self.syncSession.remotePath, results.getIgnoreFileList, false, autoCallback);
    }],
    getListOfFilesToPush: ['getLocalFileList', 'getRemoteFileList', function(results, autoCallback) {
      let bFound;
      let filesToPush = [];

      for (let i = 0; i < results.getLocalFileList.length; ++i) {
        if ((filterFiles.size === 0) || filterFiles.has(results.getLocalFileList[i].filename)) {
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
}

function setRemoteFileModificationTime(filename, modTime, callback) {
  let self = this;

  self.sftpSession.utimes(self.syncSession.remotePath + '/' + filename,
                          modTime,
                          modTime,
                          callback);
}

function pushFiles(filesToPush, stepFunction, callback) {
  let self = this;

  if (filesToPush.length) {
    let total = filesToPush.reduce(function(previousValue, file) {
      return previousValue + file.attrs.size;
    }, 0);
    let bytesTransferred = 0;

    //async.eachSeries(filesToPush, function(file, arrayCallback) {
    async.eachLimit(filesToPush, 20, function(file, arrayCallback) {
      if (file.attrs.isFile()) {
        self.sftpSession.fastPut(
          self.syncSession.localPath + '/' + file.filename,
          self.syncSession.remotePath + '/' + file.filename,
          {
            step: function(bytesTransferredForFile, chunk, totalForFile) {
              bytesTransferred += chunk;
              stepFunction(file.filename, bytesTransferred, total);
            }
          },
          function() {
            setRemoteFileModificationTime.call(self, file.filename, file.attrs.mtime, arrayCallback);
          });
      } else {
        if (file.attrs.isDirectory()) {
          self.sftpSession.mkdir(
            self.syncSession.remotePath + '/' + file.filename,
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
}

function generateListOfFilesToPull(filterFiles, callback) {
  let self = this;

  async.auto({
    getIgnoreFileList: function(autoCallback) {
      readSyncIgnoreList.call(self, autoCallback);
    },
    getLocalFileList: ['getIgnoreFileList', function(results, autoCallback) {
      getLocalFileListByDirectory.call(self, self.syncSession.localPath, results.getIgnoreFileList, false, autoCallback);
    }],
    getRemoteFileList: ['getIgnoreFileList', function(results, autoCallback) {
      getRemoteFileListByDirectory.call(self, self.syncSession.remotePath, results.getIgnoreFileList, false, autoCallback);
    }],
    getListOfFilesToPull: ['getLocalFileList', 'getRemoteFileList', function(results, autoCallback) {
      let bFound;
      let filesToPull = [];

      for (let i = 0; i < results.getRemoteFileList.length; ++i) {
        if ((filterFiles.size === 0) || filterFiles.has(results.getRemoteFileList[i].filename)) {
          bFound = false;

          for (let j = 0; j < results.getLocalFileList.length; ++j) {
            if (results.getRemoteFileList[i].filename === results.getLocalFileList[j].filename) {
              bFound = true;

              if (isFile(results.getRemoteFileList[i].attrs.mode)) {
                if (results.getRemoteFileList[i].attrs.modifiedUnix > results.getLocalFileList[j].attrs.modifiedUnix) {
                  filesToPull.push(results.getRemoteFileList[i]);
                }
              }

              break;
            }
          }

          if (bFound === false) {
            filesToPull.push(results.getRemoteFileList[i]);
          }
        }
      }

      autoCallback(null, filesToPull);
    }]
  },
  function(err, results) {
    if (err) {
      callback(err);
    } else {
      callback(null, results.getListOfFilesToPull);
    }
  });
}

function setLocalFileModificationTime(filename, modTime, callback) {
  let self = this;

  fs.utimes(self.syncSession.localPath + '/' + filename,
            modTime,
            modTime,
            callback);
}

function pullFiles(filesToPull, stepFunction, callback) {
  let self = this;

  if (filesToPull.length) {
    let total = filesToPull.reduce(function(previousValue, file) {
      return previousValue + file.attrs.size;
    }, 0);
    let bytesTransferred = 0;

    //async.eachSeries(filesToPull, function(file, arrayCallback) {
    async.eachLimit(filesToPull, 20, function(file, arrayCallback) {
      if (isFile(file.attrs.mode)) {
        self.sftpSession.fastGet(
          self.syncSession.remotePath + '/' + file.filename,
          self.syncSession.localPath + '/' + file.filename,
          {
            step: function(bytesTransferredForFile, chunk, totalForFile) {
              bytesTransferred += chunk;
              stepFunction(file.filename, bytesTransferred, total);
            }
          },
          function() {
            setLocalFileModificationTime.call(self, file.filename, file.attrs.mtime, arrayCallback);
          });
      } else {
        if (isDirectory(file.attrs.mode)) {
          fs.mkdirSync(self.syncSession.localPath + '/' + file.filename);
        }

        arrayCallback(null);
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
}

function pullFileForDiff(fileToPull, tempFolder, callback) {
  let self = this;

  function pullFile(file, tf, cb) {
    self.sftpSession.fastGet(
      self.syncSession.remotePath + '/' + file,
      path.join(tf, file),
      cb
    );
  }

  fs.stat(path.join(tempFolder, path.dirname(fileToPull)), function(err, stats) {
    if (err) {
      mkdirp(path.join(tempFolder, path.dirname(fileToPull)), function(err) {
        if (err) {
          callback(err);
        } else {
          pullFile(fileToPull, tempFolder, callback);
        }
      });
    } else {
      pullFile(fileToPull, tempFolder, callback);
    }
  });
}

function Sync() {
  this.conn = new Connection();
  this.connectionEstablished = false;
  this.sftpSession;
  this.syncSession;

  this.init = init;
  this.getRemoteFileList = getRemoteFileList;
  this.getLocalFileList = getLocalFileList;
  this.generateListOfFilesToPush = generateListOfFilesToPush;
  this.pushFiles = pushFiles;
  this.generateListOfFilesToPull = generateListOfFilesToPull;
  this.pullFiles = pullFiles;
  this.pullFileForDiff = pullFileForDiff;

  return this;
}

module.exports = Sync;
