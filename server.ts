import express from 'express';
import http from 'http';
import fs from 'fs';
import { Server } from 'socket.io';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static('public'));

let port: SerialPort | null = null;
let parser: ReadlineParser | null = null;
let lastConfig: { path: string, baudRate: number } | null = null;
let currentLogFile: string | null = null;
let currentLapLogFile: string | null = null;

let lastTime = 0;
let lastLapTime = 0;
let lapTimes: number[] = [];
let currentSpeedSetting = 0;

if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}


app.get('/ports', async (req, res) => {
    const ports = await SerialPort.list();
    res.json(ports);
});

app.get('/connect', async (req, res) => {
    try {
        const { path, baudRate } = req.query;
        if (!path || !baudRate || typeof path !== 'string' || typeof baudRate !== 'string') {
            res.status(400).json({ error: 'Invalid parameters' });
            return;
        }
        lastConfig = { path, baudRate: parseInt(baudRate) };

        connectSerial(path, parseInt(baudRate));
        res.sendStatus(200);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

function connectSerial(path: string, baudRate: number) {
    if (port && port.isOpen) {
        port.close();
        io.emit('serialStatus', { connected: false, port: path });
    }
    try {

        port = new SerialPort({ path, baudRate });
        parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

        port.on('open', () => {
            const sessionTime = new Date().toISOString().replace(/[:.]/g, '-');
            currentLogFile = `logs/serial_${sessionTime}.log`;
            currentLapLogFile = `logs/laps_${sessionTime}.log`;
            io.emit('serialStatus', { connected: true, port: path });
        });

        port.on('error', (err) => {
            io.emit('serialStatus', { connected: false, port: path });
            addNotification(`Serial port error: ${err.message}`);
        });

        parser.on('error', (err) => {
            addNotification(`Parser error: ${err.message}`);
        });

        port.on('close', () => {
            io.emit('serialStatus', { connected: false, port: path });
            addNotification('Serial port closed');
            setTimeout(() => {
                if (lastConfig) {
                    connectSerial(lastConfig.path, lastConfig.baudRate);
                }
            }, 2000);
        });

        parser.on('data', (line: string) => {
            const raw_data = line.trim();

            io.emit('serialData', raw_data);

            const timestamp = new Date().toISOString();
            const logLine = `${timestamp} - ${raw_data}\n`;
            if (currentLogFile) {
                fs.appendFile(currentLogFile, logLine, (err) => {
                    if (err) console.error('Error writing to log file:', err);
                });
            }

            if (raw_data.startsWith('t')) { //time update
                const timeStr = raw_data.substring(1).trim();
                const time = parseInt(timeStr);
                lastTime = time;
                if (!isNaN(time)) {
                    io.emit('time', { time });
                }
                return;
            }

            if (raw_data.startsWith('l')) { //lap time
                lapTimes.push(lastTime);
                lastLapTime = lastTime;
                // @ts-ignore
                let lastTimeDuration = lapTimes.length > 1 ? lapTimes[lapTimes.length - 1] - lapTimes[lapTimes.length - 2] : 0;
                lastTimeDuration = lastTimeDuration/1000; // convert to seconds
                io.emit('lapTime', { lastTimeDuration });
                addNotification(`Lap ${lapTimes.length} completed in (Duration: ${lastTimeDuration.toFixed(2)}s)`, lastTime);

                // Log lap duration
                if (lastTimeDuration > 0 && currentLapLogFile) {
                    const timestamp = new Date().toISOString();
                    const lapLogLine = `${timestamp} - Lap ${lapTimes.length}: ${lastTimeDuration.toFixed(2)}s\n`;
                    fs.appendFile(currentLapLogFile, lapLogLine, (err) => {
                        if (err) console.error('Error writing to lap log file:', err);
                    });
                }

                return;
            }

            if (raw_data.startsWith('!')) { //notification
                addNotification(raw_data.substring(1), lastTime);
                return;
            }

            if (raw_data.startsWith('r')) { //speed 
                const rpmStr = raw_data.substring(1).trim();
                const rpm = parseFloat(rpmStr);
                const speed = rpmToSpeed(rpm);
                if (!isNaN(rpm)) io.emit('speed', { speed, time: lastTime });
                return;
            }

            if (raw_data.startsWith('b')) { //Battery update
                const batteryStr = raw_data.substring(1).trim();
                const battery = parseFloat(batteryStr);
                if (!isNaN(battery)) io.emit('battery', { battery, time: lastTime });
                return;
            }

            if (raw_data.startsWith('s')) { //speed setting
                const speedSettingStr = raw_data.substring(1).trim();
                const speedSetting = parseInt(speedSettingStr);
                if (!isNaN(speedSetting)) {
                    currentSpeedSetting = speedSetting;
                    io.emit('speedSetting', { speedSetting });
                    addNotification(`Speed setting updated: ${speedSetting}`, lastTime);
                }
                return;
            }

        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        io.emit('serialStatus', { connected: false, error: message });
        addNotification(`Failed to connect: ${message}`);
    }
}

function addNotification(message: string, time: number = Date.now()) {
    io.emit('notification', { message, time });
}

function rpmToSpeed(rpm: number): number {
    const diameter = 0.5; //m
    const circumference = Math.PI * diameter;
    let speed = (rpm * circumference) / 60; // m/s
    speed = speed * 3.6; // convert to km/h
    return speed;
}


server.listen(3000, () => console.log('http://localhost:3000'));
