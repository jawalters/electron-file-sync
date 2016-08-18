const electron = require('electron');

const storage = require('./common/storage.js');

const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const Menu = electron.Menu;
const ipcMain = electron.ipcMain;
const MenuItem = electron.MenuItem;
const dialog = electron.dialog;

let mainWindow;
let targetWindow;
let sessionWindow;

let template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'New Target',
        accelerator: (process.platform === 'darwin') ? 'Command+T' : undefined,
        click: function() {
          targetWindow.webContents.send('asynchronous-message', 'new target');
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
        type: 'separator'
      },
      {
        label: 'New Session',
        accelerator: (process.platform === 'darwin') ? 'Command+S' : undefined,
        click: function() {
          sessionWindow.webContents.send('asynchronous-message', 'new session');
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
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: (process.platform === 'darwin') ? 'Command+Q' : undefined,
        click: function() {
          app.quit();
        }
      }
    ]
  }
];

function createMainWindow() {
  mainWindow = new BrowserWindow({ width: 800, height: 600 });

  mainWindow.loadURL(`file://${__dirname}/views/main.html`);

  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function() {
    mainWindow = null;
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTargetWindow() {
  targetWindow = new BrowserWindow({ width: 700, height: 500, frame: false, show: false });

  targetWindow.loadURL(`file://${__dirname}/views/target.html`);

  targetWindow.webContents.openDevTools();

  targetWindow.on('closed', function() {
    targetWindow = null;
  });

  targetWindow.setMenu(null);
}

function createSessionWindow() {
  sessionWindow = new BrowserWindow({ width: 700, height: 500, frame: false, show: false });

  sessionWindow.loadURL(`file://${__dirname}/views/session.html`);

  sessionWindow.webContents.openDevTools();

  sessionWindow.on('closed', function() {
    sessionWindow = null;
  });

  sessionWindow.setMenu(null);
}

app.on('ready', function() {
  storage.init('file-sync.db', function() {
    loadTargetMenus(function() {
      loadSessionMenus(function() {
        createMainWindow();
        createTargetWindow();
        createSessionWindow();
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
});

function loadTargetMenus(callback) {
  storage.getTargets(function(err, targets) {
    if (err) {
      console.log(err);
      callback(err);
    } else {
      if (targets.length) {
        template[0].submenu[1].submenu = [];
        template[0].submenu[2].submenu = [];

        targets.forEach(function(item) {
          template[0].submenu[1].submenu.push({
            label: item.name,
            click: function() {
              targetWindow.webContents.send('asynchronous-message', item.id);
              targetWindow.show();
            }
          });

          template[0].submenu[2].submenu.push({
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
                console.log(index);
              });
            }
          });
        });

        template[0].submenu[1].enabled = true;
        template[0].submenu[2].enabled = true;
      } else {
        if (template[0].submenu[1].submenu) {
          delete template[0].submenu[1].submenu;
        }

        if (template[0].submenu[2].submenu) {
          delete template[0].submenu[2].submenu;
        }

        template[0].submenu[1].enabled = false;
        template[0].submenu[2].enabled = false;
      }

      Menu.setApplicationMenu(Menu.buildFromTemplate(template));

      callback(null);
    }
  });
}

function loadSessionMenus(callback) {
  storage.getSessions(function(err, sessions) {
    if (err) {
      console.log(err);
      callback(err);
    } else {
      if (sessions.length) {
        template[0].submenu[5].submenu = [];
        template[0].submenu[6].submenu = [];

        sessions.forEach(function(item) {
          template[0].submenu[5].submenu.push({
            label: item.name,
            click: function() {
              sessionWindow.webContents.send('asynchronous-message', item.id);
              sessionWindow.show();
            }
          });

          template[0].submenu[6].submenu.push({
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
                console.log(index);
              });
            }
          });
        });

        template[0].submenu[5].enabled = true;
        template[0].submenu[6].enabled = true;
      } else {
        if (template[0].submenu[5].submenu) {
          delete template[0].submenu[5].submenu;
        }

        if (template[0].submenu[6].submenu) {
          delete template[0].submenu[6].submenu;
        }

        template[0].submenu[5].enabled = false;
        template[0].submenu[6].enabled = false;
      }

      Menu.setApplicationMenu(Menu.buildFromTemplate(template));

      callback(null);
    }
  });
}

ipcMain.on('asynchronous-message', function(event, arg) {
  if (typeof arg === 'string') {
    switch (arg) {
      case 'target saved':
        loadTargetMenus(function() {});
        targetWindow.hide();
        break;

      case 'target cancelled':
        targetWindow.hide();
        break;

      case 'session saved':
        loadSessionMenus(function() {});
        sessionWindow.hide();
        break;

      case 'session cancelled':
        sessionWindow.hide();
        break;

      default:
        break;
    }
  }
});
