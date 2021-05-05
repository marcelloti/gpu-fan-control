"use strict"

import { app, protocol, BrowserWindow, ipcMain, Menu, Tray } from "electron"
import { createProtocol } from "vue-cli-plugin-electron-builder/lib"
import installExtension, { VUEJS_DEVTOOLS } from "electron-devtools-installer"
var sqlite3 = require("sqlite3").verbose()

var currentFanSpeed = -1;

// INITIAL DATABASE STRUCTURE
var db = new sqlite3.Database("data.db")
db.serialize(function () {
    db.run(
        "CREATE TABLE if not exists GRAPHCONFIG " +
            "(checkTempInterval NUMBER, minTemp NUMBER, maxTemp NUMBER, dangerTemp NUMBER, stepTemp NUMBER, xAxisData TEXT, yAxisData TEXT)",
        (error) => {
            if (error) {
                console.log(error)
                return
            }
            db.all("select * from GRAPHCONFIG", (error, rows) => {
                if (error) {
                    console.error(error)
                }
                if (rows.length === 0) {
                    db.run(
                        "insert into GRAPHCONFIG (checkTempInterval, minTemp, maxTemp, dangerTemp, stepTemp, xAxisData, yAxisData) " +
                            "values (?,?,?,?,?,?,?)",
                        [
                            5000,
                            26,
                            78,
                            78,
                            5,
                            "[26,30,35,40,45,50,55,60,65,70,75,78]",
                            "[60,60,60,66,72,75,77,78,78,78,78,78]",
                        ],
                        (error) => {
                            if (error) {
                                console.log(error)
                                return
                            }
                        }
                    )
                }
            })
        }
    )
})

const isDevelopment = process.env.NODE_ENV !== "production"
const { exec } = require("child_process")
// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { secure: true, standard: true } },
])

let win
let tray

let winStatus = 'visible';

function toggleWindowDisplay(win){
    if (winStatus === 'visible'){
        winStatus = 'hidden';
        win.hide();
    } else {
        winStatus = 'visible';
        win.show();
    }
}

async function createWindow() {
    // Create the browser window.
    win = new BrowserWindow({
        width: 850,
        height: 690,
        webPreferences: {
            // Required for Spectron testing
            enableRemoteModule: true,

            contextIsolation: false,

            // Use pluginOptions.nodeIntegration, leave this alone
            // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html#node-integration for more info
            nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
        },
        icon:'./public/logo.png'
    })

    tray = new Tray('./public/logo.png')
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Show/Hide', type: 'normal', click: () => toggleWindowDisplay(win)
        }
    ])
    tray.setToolTip('This is my application.')
    tray.setContextMenu(contextMenu)

    win.on('minimize',function(event){
        event.preventDefault();
        toggleWindowDisplay(win);
    });

    win.setMenu(null);
   
    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL)        
        win.setResizable(true);
        win.webContents.openDevTools();
    } else {
        win.setResizable(false);
        createProtocol("app")
        // Load the index.html when not in development
        win.loadURL("app://./index.html")
    }
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
        app.quit()
    }
})

app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
    if (isDevelopment && !process.env.IS_TEST) {
        // Install Vue Devtools
        try {
            await installExtension(VUEJS_DEVTOOLS)
        } catch (e) {
            console.error("Vue Devtools failed to install:", e.toString())
        }
    }
    createWindow()
})

async function execShell(cmd) {
    function shellPromise(cmd) {
        return new Promise(function (resolve, reject) {
            try {
                const ls = exec(cmd)
                ls.stdout.on("data", (data) => {
                    resolve(data)
                })

                ls.stderr.on("data", function (data) {
                    reject(data)
                })
            } catch (err) {
                reject(err)
            }
        })
    }

    const cmdReturn = await shellPromise(cmd)

    return cmdReturn
}

async function changeFanSpeed(fanNumber, newSpeed) {
    execShell(
        `nvidia-settings -a '[fan:${fanNumber}]/GPUTargetFanSpeed=${parseInt(
            newSpeed
        )}'`
    )

    currentFanSpeed = newSpeed;
}

async function getCurrentTemp() {
    // With nvidia-smi
    /*const temperature = await execShell(
        `nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader`
    )*/

    // Without nvidia-smi
    const temperature = await execShell(
        `nvidia-settings -q gpucoretemp -t | head -n 1`
    );

    return temperature;
}

async function getCurrentClock() {
    // Without nvidia-smi
    const clock = await execShell(
        `nvidia-settings -tq GPUCurrentClockFreqs | sed -e ':.*' | head -n 1`
    );

    return clock;
}

async function sendTemp() {
    const temperature = await getCurrentTemp()

    win.send("receiveCurrentTemperature", temperature);
}

async function sendClock() {
    const clock = await getCurrentClock()

    win.send("receiveCurrentClock", clock);
}

async function sendFanSpeed() {
    win.send("receiveCurrentFan", currentFanSpeed);
}

async function updateDatabaseConfiguration(parsedData) {
    let checkTempInterval = 5000;
    let minTemp = 26;
    let maxTemp = 78;
    let dangerTemp = 65;
    let stepTemp = 5;
    let xAxisData = parsedData.temperature;
    let yAxisData = parsedData.fanSpeed;
 
    db.run(
        `update GRAPHCONFIG set checkTempInterval = ${checkTempInterval}, `+
        `minTemp = ${minTemp}, maxTemp = ${maxTemp}, dangerTemp = ${dangerTemp}, stepTemp = ${stepTemp}, `+
        `xAxisData = '${xAxisData}', yAxisData = '${yAxisData}'`,
        (error) => {
            if (error) {
                console.error(error)
                return;
            }
        }
    )
}

async function updateFanSpeedByConfig(parsedData){
    const currentTemperature = await getCurrentTemp();

    let temperatures = JSON.parse(parsedData.temperature);
    let fanSpeeds = JSON.parse(parsedData.fanSpeed);

    let expectedTemperatureIndex = -1;

    temperatures.forEach((expectedTemp, index) => {
        if (currentTemperature >= expectedTemp) {
            expectedTemperatureIndex=index;
        }
    });

    if (expectedTemperatureIndex === -1){
        return;
    }

    let newFanSpeed = -1;
    fanSpeeds.forEach((fanSpeedToBeSetted, index) => {
        if (index === expectedTemperatureIndex){
            newFanSpeed = fanSpeedToBeSetted;
        }
    })

    if (newFanSpeed === -1){
        return;
    }
    
    changeFanSpeed(0, newFanSpeed);
}

async function applyTempGraph(parsedData){
    updateDatabaseConfiguration(parsedData);

    updateFanSpeedByConfig(parsedData);
}

ipcMain.on("checkStatistics", (event) => {
    db.all("select * from GRAPHCONFIG", (error, rows) => {
        if (error) {
            console.error(error);
        }

        sendClock();
        sendTemp();
        sendFanSpeed();

        let parsedData = {
            temperature: rows[0].xAxisData,
            fanSpeed: rows[0].yAxisData,
        }

        updateFanSpeedByConfig(parsedData);
    })
})

ipcMain.on("getConfiguration", (event) => {
    db.all("select * from GRAPHCONFIG", (error, rows) => {
        if (error) {
            console.error(error);
        }
        win.send("receiveConfiguration", rows[0]);
    })
})

ipcMain.on("applyTempGraph", (event, data) => {
    applyTempGraph(data);
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
    if (process.platform === "win32") {
        process.on("message", (data) => {
            if (data === "graceful-exit") {
                app.quit();
            }
        })
    } else {
        process.on("SIGTERM", () => {
            app.quit();
        })
    }
}
