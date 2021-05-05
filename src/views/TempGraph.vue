<template>
    <div>
        <div class='info'>
            <p><img src='/gpu.png' width='36px' /></p>
            <p>{{ gpu1 }}:</p>
            <p class='dangerWarn' v-if="dangerStatus">HIGH TEMPERATURE</p>
            <p>
                <img src='/thermometer.png' style='width: 12px; position: relative; top: 10px;'/>&nbsp;{{ currentTemp }} °C 
                <img src='/fan.png' style='margin-left: 14px; width: 30px; position: relative; top: 10px;'/>&nbsp;{{currentFanSpeed}}%
                <img src='/clock.png' style='margin-left: 14px; margin-right: 3px; width: 35px; position: relative; top: 20px;'/>&nbsp;{{currentClock}} MHz
            </p>
        </div>
        <div class="graph">
            <canvas id="canvas" width="1600" height="900"></canvas>
        </div>
        <div class="operations">
            <button v-on:click="applyTempGraph">Apply</button>
            <button v-on:click="resetGraphFromDatabase">Reset</button>
        </div>
    </div>
</template>

<script>
import Chart from "chart.js"
const electron = require("electron")
const ipcRenderer = electron.ipcRenderer

export default {
    name: "TempGraph",
    data() {
        return {
            dangerStatus: false,
            gpu1: "Gpu Statistics",
            checkTempInterval: 0,
            dangerTemperature: 999,
            currentTemp: 0,
            currentFanSpeed: 0,
            currentClock: 0,
            okColor: "#3e95cd",
            errorColor: "#FF0055",
            chartObj: null,
            canvas: null,
            maxTemp: 0,
            minTemp: 0,
            step: 0,
            x_data: [],
            y_data: [],
            activePoint: null,
        }
    },
    created() {
        // First execution
        this.checkStatistics()
    },
    mounted() {
        ipcRenderer.send("getConfiguration")

        ipcRenderer.on("receiveCurrentClock", (event, data) => {
            this.currentClock = parseFloat(data).toFixed(2)
        })
        
        ipcRenderer.on("receiveCurrentTemperature", (event, data) => {
            if (parseInt(data) >= this.dangerTemperature){
                var audio = new Audio(require('./beep.mp3'));
                audio.play();
                this.dangerStatus = true;
            } else {
                this.dangerStatus = false;
            }
            this.currentTemp = data
        })

        ipcRenderer.on("receiveCurrentFan", (event, data) => {
            if (data.toFixed(0) > 0){
                this.currentFanSpeed = data.toFixed(0);
            }
        })

        ipcRenderer.on("receiveConfiguration", (event, data) => {
            this.checkTempInterval = data.checkTempInterval
            this.maxTemp = data.maxTemp
            this.minTemp = data.minTemp
            this.dangerTemperature = data.dangerTemp
            this.stepTemp = data.stepTemp
            this.x_data = JSON.parse(data.xAxisData)
            this.y_data = JSON.parse(data.yAxisData)
            this.loadGraph()

            if (parseInt(this.checkTempInterval) !== 0) {
                setInterval(() => {
                    this.checkStatistics()
                }, parseInt(this.checkTempInterval))
            }
        })
    },
    methods: {
        checkStatistics() {
            ipcRenderer.send("checkStatistics")
        },
        applyTempGraph() {
            ipcRenderer.send(
                "applyTempGraph",
                {
                    fanSpeed: JSON.stringify(this.y_data),
                    temperature: JSON.stringify(this.x_data),
                }
            )
        },
        resetGraphFromDatabase() {
            ipcRenderer.send("getConfiguration")
        },
        loadGraph() {
            this.canvas = document.getElementById("canvas")
            const ctx = this.canvas.getContext("2d")

            this.canvas.onpointerdown = this.downHandler
            this.canvas.onpointerup = this.upHandler
            this.canvas.onpointermove = null

            this.chartObj = Chart.Line(ctx, {
                data: {
                    labels: this.x_data,
                    datasets: [
                        {
                            data: this.y_data,
                            lineTension: 0,
                            label: this.gpu1,
                            borderColor: this.okColor,
                            fill: true,
                        },
                    ],
                },
                options: {
                    lineTension: 0,
                    animation: {
                        duration: 50,
                    },
                    tooltips: {
                        mode: "nearest",
                    },
                    scales: {
                        xAxes: [
                            {
                                scaleLabel: {
                                    display: true,
                                    labelString: "Temperature (°C)",
                                },
                            },
                        ],
                        yAxes: [
                            {
                                ticks: {
                                    min: this.minTemp - 5,
                                    max: this.maxTemp + 5,
                                },
                                scaleLabel: {
                                    display: true,
                                    labelString: "Fan Speed (%)",
                                },
                            },
                        ],
                    },
                },
            })
        },
        downHandler() {
            // check for data point near event location
            const points = this.chartObj.getElementAtEvent(event, {
                intersect: false,
            })
            if (points.length > 0) {
                // grab nearest point, start dragging
                this.activePoint = points[0]
                this.canvas.onpointermove = this.moveHandler
            }
        },
        upHandler() {
            // release grabbed point, stop dragging
            this.activePoint = null
            this.canvas.onpointermove = null
        },
        moveHandler(event) {
            // locate grabbed point in chart data
            if (this.activePoint != null) {
                var data = this.activePoint._chart.data
                var datasetIndex = this.activePoint._datasetIndex

                // read mouse position
                const helpers = Chart.helpers
                var position = helpers.getRelativePosition(event, this.chartObj)

                // convert mouse position to chart y axis value
                var chartArea = this.chartObj.chartArea
                var yValue = this.map(
                    position.y,
                    chartArea.bottom,
                    chartArea.top,
                    this.minTemp,
                    this.maxTemp
                )
                // update y value of active data point
                data.datasets[datasetIndex].data[
                    this.activePoint._index
                ] = yValue

                data.datasets[datasetIndex] = this.checkDataset(
                    data.datasets[datasetIndex],
                    yValue
                )
                this.chartObj.update()
            }
        },
        checkDataset(dataset, newValue) {
            // MinTemp/MaxTemp Error
            if (
                parseFloat(newValue) < this.minTemp ||
                parseFloat(newValue) > this.maxTemp
            ) {
                dataset.borderColor = this.errorColor
            } else {
                dataset.borderColor = this.okColor
            }
            return dataset
        },
        map(value, start1, stop1, start2, stop2) {
            return (
                start2 +
                (stop2 - start2) * ((value - start1) / (stop1 - start1))
            )
        },
    },
}
</script>

<style>
#app{
    color: #fff !important;
}
body{
    background: #31363b;
}
.graph {
    max-width: 800px;
    margin: 15px auto;
    background: #ccc;
    border-radius: 3px;
}
.operations{
    flex: 1;
}
.operations > button:first-child {
    margin-right: 20px;    
}
.dangerWarn {
    color: #FF0000;
    font-weight: bold;
}
button {
    padding: 8px;
}
</style>
