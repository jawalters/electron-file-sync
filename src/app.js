const electron = require('electron');

const storage = require('./utils/storage.js');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Menu = electron.Menu;
const ipcMain = electron.ipcMain;
const MenuItem = electron.MenuItem;
const dialog = electron.dialog;

let mainWindow;
let targetWindow;
let sessionWindow;
let settingsWindow;

let activeSessions = {};

let template = [
  {
    label: 'Targets',
    submenu: [
      {
        label: 'Create Target',
        accelerator: 'CmdOrCtrl+T',
        click: function() {
          targetWindow.webContents.send('asynchronous-message', {
            command: 'createTarget'
          });
          targetWindow.show();
        }
      },
      {
        label: 'Edit Target',
        enabled: false
      },
      {
        label: 'Delete Target',
        enabled: false
      },
      {
        label: 'Clone Target',
        enabled: false
      }
    ]
  },
  {
    label: 'Sessions',
    submenu: [
      {
        label: 'Create Session',
        accelerator: 'CmdOrCtrl+S',
        click: function() {
          sessionWindow.webContents.send('asynchronous-message', {
            command: 'createSession'
          });
          sessionWindow.show();
        }
      },
      {
        label: 'Edit Session',
        enabled: false
      },
      {
        label: 'Delete Session',
        enabled: false
      },
      {
        label: 'Clone Session',
        enabled: false
      },
      {
        type: 'separator'
      },
      {
        label: 'Start Session',
        enabled: false
      }
    ]
  }
];

function createMainWindow() {
  mainWindow = new BrowserWindow({ width: 1600, height: 900 });

  mainWindow.loadURL(`file://${ __dirname }/views/main.html`);

  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function() {
    mainWindow = null;
    app.quit();
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTargetWindow() {
  targetWindow = new BrowserWindow({ width: 700, height: 500, frame: false, show: false });

  targetWindow.loadURL(`file://${ __dirname }/views/target.html`);

  targetWindow.webContents.openDevTools();

  targetWindow.on('closed', function() {
    targetWindow = null;
  });

  targetWindow.setMenu(null);
}

function createSessionWindow() {
  sessionWindow = new BrowserWindow({ width: 700, height: 500, frame: false, show: false });

  sessionWindow.loadURL(`file://${ __dirname }/views/session.html`);

  sessionWindow.webContents.openDevTools();

  sessionWindow.on('closed', function() {
    sessionWindow = null;
  });

  sessionWindow.setMenu(null);
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({ width: 700, height: 500, frame: false, show: false });

  settingsWindow.loadURL(`file://${ __dirname }/views/settings.html`);

  settingsWindow.webContents.openDevTools();

  settingsWindow.on('closed', function() {
    settingsWindow = null;
  });

  settingsWindow.setMenu(null);
}

app.on('ready', function() {
  storage.init('file-sync.db', function() {
    loadMenu();
    loadTargetMenus(function() {
      loadSessionMenus(function() {
        createMainWindow();
        createTargetWindow();
        createSessionWindow();
        createSettingsWindow();
      });
    });
  });
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function() {
  if (mainWindow === null) {
    createMainWindow();
  }

  if (targetWindow === null) {
    createTargetWindow();
  }

  if (sessionWindow === null) {
    createSessionWindow();
  }

  if (settingsWindow === null) {
    createSettingsWindow();
  }
});

function loadTargetMenus(callback) {
  const targetsTemplateIndex = 1;
  const editIndex = 1;
  const deleteIndex = 2;
  const cloneIndex = 3;

  storage.getTargets(function(err, targets) {
    if (err) {
      console.log(err);
      callback(err);
    } else {
      if (targets.length) {
        template[targetsTemplateIndex].submenu[editIndex].submenu = [];
        template[targetsTemplateIndex].submenu[deleteIndex].submenu = [];
        template[targetsTemplateIndex].submenu[cloneIndex].submenu = [];

        targets.forEach(function(item) {
          template[targetsTemplateIndex].submenu[editIndex].submenu.push({
            label: item.name,
            click: function() {
              targetWindow.webContents.send('asynchronous-message', {
                command:  'editTarget',
                targetId: item.id
              });
              targetWindow.show();
            }
          });

          template[targetsTemplateIndex].submenu[deleteIndex].submenu.push({
            label: item.name,
            click: function() {
              const options = {
                type: 'info',
                title: 'Delete Confirmation',
                message: `Are you sure you want to delete the target '${ item.name }'?`,
                buttons: ['No', 'Yes']
              };
              dialog.showMessageBox(options, function(index) {
                if (index) {
                  storage.deleteTarget({ id: item.id }, function() {
                    loadTargetMenus(function() {});
                  });
                }
              });
            }
          });

          template[targetsTemplateIndex].submenu[cloneIndex].submenu.push({
            label: item.name,
            click: function() {
              targetWindow.webContents.send('asynchronous-message', {
                command:  'cloneTarget',
                targetId: item.id
              });
              targetWindow.show();
            }
          });
        });

        template[targetsTemplateIndex].submenu[editIndex].enabled = true;
        template[targetsTemplateIndex].submenu[deleteIndex].enabled = true;
        template[targetsTemplateIndex].submenu[cloneIndex].enabled = true;
      } else {
        if (template[targetsTemplateIndex].submenu[editIndex].submenu) {
          delete template[targetsTemplateIndex].submenu[editIndex].submenu;
        }

        if (template[targetsTemplateIndex].submenu[deleteIndex].submenu) {
          delete template[targetsTemplateIndex].submenu[deleteIndex].submenu;
        }

        if (template[targetsTemplateIndex].submenu[cloneIndex].submenu) {
          delete template[targetsTemplateIndex].submenu[cloneIndex].submenu;
        }

        template[targetsTemplateIndex].submenu[editIndex].enabled = false;
        template[targetsTemplateIndex].submenu[deleteIndex].enabled = false;
        template[targetsTemplateIndex].submenu[cloneIndex].enabled = false;
      }

      Menu.setApplicationMenu(Menu.buildFromTemplate(template));

      callback(null);
    }
  });
}

function loadSessionMenus(callback) {
  const sessionsTemplateIndex = 2;
  const editIndex = 1;
  const deleteIndex = 2;
  const cloneIndex = 3;
  const startSessionIndex = 5;

  storage.getSessions(function(err, sessions) {
    if (err) {
      console.log(err);
      callback(err);
    } else {
      if (sessions.length) {
        template[sessionsTemplateIndex].submenu[editIndex].submenu = [];
        template[sessionsTemplateIndex].submenu[deleteIndex].submenu = [];
        template[sessionsTemplateIndex].submenu[cloneIndex].submenu = [];
        template[sessionsTemplateIndex].submenu[startSessionIndex].submenu = [];

        sessions.forEach(function(item, index) {
          let sessionIndex = index;

          template[sessionsTemplateIndex].submenu[editIndex].submenu.push({
            label: item.name,
            click: function() {
              sessionWindow.webContents.send('asynchronous-message', {
                command:   'editSession',
                sessionId: item.id
              });
              sessionWindow.show();
            }
          });

          template[sessionsTemplateIndex].submenu[deleteIndex].submenu.push({
            label: item.name,
            click: function() {
              const options = {
                type: 'info',
                title: 'Delete Confirmation',
                message: `Are you sure you want to delete the session '${ item.name }'?`,
                buttons: ['No', 'Yes']
              };
              dialog.showMessageBox(options, function(index) {
                if (index) {
                  storage.deleteSession({ id: item.id }, function() {
                    loadSessionMenus(function() {});
                  });
                }
              });
            }
          });

          template[sessionsTemplateIndex].submenu[cloneIndex].submenu.push({
            label: item.name,
            click: function() {
              sessionWindow.webContents.send('asynchronous-message', {
                command:   'cloneSession',
                sessionId: item.id
              });
              sessionWindow.show();
            }
          });

          template[sessionsTemplateIndex].submenu[startSessionIndex].submenu.push({
            label: item.name,
            click: function() {
              mainWindow.webContents.send('asynchronous-message', `start-session ${ item.id }`);
              activeSessions[item.id] = true;
              loadSessionMenus(function() { });
            },
            enabled: !activeSessions[item.id]
          });
        });

        template[sessionsTemplateIndex].submenu[editIndex].enabled = true;
        template[sessionsTemplateIndex].submenu[deleteIndex].enabled = true;
        template[sessionsTemplateIndex].submenu[cloneIndex].enabled = true;
        template[sessionsTemplateIndex].submenu[startSessionIndex].enabled = true;
      } else {
        if (template[sessionsTemplateIndex].submenu[editIndex].submenu) {
          delete template[sessionsTemplateIndex].submenu[editIndex].submenu;
        }

        if (template[sessionsTemplateIndex].submenu[deleteIndex].submenu) {
          delete template[sessionsTemplateIndex].submenu[deleteIndex].submenu;
        }

        if (template[sessionsTemplateIndex].submenu[cloneIndex].submenu) {
          delete template[sessionsTemplateIndex].submenu[cloneIndex].submenu;
        }

        if (template[sessionsTemplateIndex].submenu[startSessionIndex].submenu) {
          delete template[sessionsTemplateIndex].submenu[startSessionIndex].submenu;
        }

        template[sessionsTemplateIndex].submenu[editIndex].enabled = false;
        template[sessionsTemplateIndex].submenu[deleteIndex].enabled = false;
        template[sessionsTemplateIndex].submenu[cloneIndex].enabled = false;
        template[sessionsTemplateIndex].submenu[startSessionIndex].enabled = false;
      }

      Menu.setApplicationMenu(Menu.buildFromTemplate(template));

      callback(null);
    }
  });
}

function loadMenu() {
  if (process.platform === 'darwin') {
    const name = electron.app.getName();
    template.unshift(
      {
        label: 'File',
        submenu: [
          {
            label: `About ${ name }`,
            role: 'about'
          },
          {
            type: 'separator'
          },
          {
            label: 'Settings',
            click: function() {
              settingsWindow.show();
            }
          },
          {
            type: 'separator'
          },
          {
            label: 'Quit',
            accelerator: 'CmdOrCtrl+Q',
            click: function() {
              app.quit();
            }
          }
        ]
      }
    );
  } else {
    template.unshift(
      {
        label: 'File',
        submenu: [
          {
            label: 'Settings',
            click: function() {
              settingsWindow.show();
            }
          },
          {
            type: 'separator'
          },
          {
            label: 'Quit',
            accelerator: 'CmdOrCtrl+Q',
            click: function() {
              app.quit();
            }
          }
        ]
      }
    );
  }
}

ipcMain.on('asynchronous-message', function(event, arg) {
  if (typeof arg === 'string') {
    let tokens = arg.split(' ');
    switch (tokens[0]) {
      case 'target-saved':
        loadTargetMenus(function() {});
        targetWindow.hide();
        mainWindow.webContents.send('asynchronous-message', `target-changed ${ tokens[1] }`);
        break;

      case 'target-cancelled':
        targetWindow.hide();
        break;

      case 'session-saved':
        loadSessionMenus(function() {});
        sessionWindow.hide();
        mainWindow.webContents.send('asynchronous-message', `session-changed ${ tokens[1] }`);
        break;

      case 'session-cancelled':
        sessionWindow.hide();
        break;

      case 'edit-session':
        sessionWindow.webContents.send('asynchronous-message', tokens[1]);
        sessionWindow.show();
        break;

      case 'session-ended':
        delete activeSessions[tokens[1]];
        loadSessionMenus(function() { });
        break;

      case 'settings-saved':
        settingsWindow.hide();
        break;

      case 'settings-cancelled':
        settingsWindow.hide();
        break;

      case 'right-click':
        const menu = new Menu();
        menu.append(new MenuItem({
          label: `Diff ${tokens[1]}`,
          click: function() {
            event.sender.send('asynchronous-reply', {
              command:   'diff',
              filename:  tokens[1],
              sessionId: tokens[2]
            });
          }
        }));
        const win = BrowserWindow.fromWebContents(event.sender);
        menu.popup(win);
        break;

      default:
        break;
    }
  }
});
