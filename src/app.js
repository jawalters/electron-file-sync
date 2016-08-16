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

app.on('ready', function() {
  storage.init('file-sync.db', function() {
    loadMenus();

    createMainWindow();
    createTargetWindow();
  });
});

function createTargetWindow() {
  targetWindow = new BrowserWindow({ width: 700, height: 500, frame: false, show: false });

  targetWindow.loadURL(`file://${__dirname}/views/target.html`);

  targetWindow.webContents.openDevTools();

  targetWindow.on('closed', function() {
    targetWindow = null;
  });

  targetWindow.setMenu(null);
}

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
});

function loadMenus() {
  storage.getTargets(function(err, targets) {
    if (err) {
      console.log(err);
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
                    loadMenus();
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
    }
  });
}

ipcMain.on('asynchronous-message', function(event, arg) {
  console.log('async message', arg);
  if (typeof arg === 'string') {
    switch (arg) {
      case 'target saved':
        loadMenus();
        targetWindow.hide();
        break;

      case 'target cancelled':
        targetWindow.hide();
        break;

      default:
        break;
    }
  }
});
