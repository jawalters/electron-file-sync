(function() {
  const loki = require('lokijs');
  const ipcRenderer = require('electron').ipcRenderer;

  let db = null;
  let targets;
  let sessions;

  module.exports.init = function(dbPath, callback) {
    db = new loki(dbPath);

    db.loadDatabase({}, function(err) {
      if (err) {
        db.addCollection('targets');
        db.addCollection('sessions');
        db.saveDatabase();

        targets = db.getCollection('targets');
        sessions = db.getCollection('sessions');
      } else {
        targets = db.getCollection('targets');
        sessions = db.getCollection('sessions');
      }

      callback(null);
    });
  }

  module.exports.saveTarget = function(newTarget) {
    let target = targets.findOne({ id: newTarget.id });
    if (target) {
      target.name = newTarget.name;
      target.host = newTarget.host;
      target.username = newTarget.username;
      target.password = newTarget.password;
      target.keyfilePath = newTarget.keyfilePath;

      targets.update(target);
    } else {
      targets.insert(newTarget);
    }

    db.saveDatabase();
  }

  module.exports.getTargets = function(callback) {
    callback(null, targets.find({}));
  }

  module.exports.getTarget = function(query, callback) {
    callback(null, targets.findOne(query));
  }

  module.exports.deleteTarget = function(query, callback) {
    let target = targets.findOne(query);
    if (target) {
      targets.remove(target);
      db.saveDatabase();
    }

    callback(null);
  }

  module.exports.saveSession = function(session) {
    sessions.insert(session);
    db.saveDatabase();
  }

  module.exports.getSessions = function(callback) {
    callback(null, sessions.find({}));
  }

  module.exports.getSession = function(query, callback) {
    callback(null, sessions.findOne(query));
  }
}());
