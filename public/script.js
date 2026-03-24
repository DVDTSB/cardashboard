const socket = io();
const maxDataPoints = 50;

let speedData = { labels: [], values: [] };
let batteryData = { labels: [], values: [] };
let lastTime = 0;
let lapTimes = [];
let lastLapTimestamp = 0;
let speedChart, batteryChart;

const statusEl = document.getElementById('status');


function initCharts() {
    const speedCtx = document.getElementById('speedChart').getContext('2d');
    speedChart = new Chart(speedCtx, {
        type: 'line',
        data: {
            labels: speedData.labels,
            datasets: [{
                label: 'Speed',
                data: speedData.values,
                borderColor: '#00f5ff',
                backgroundColor: 'rgba(0, 245, 255, 0.1)',
                tension: 0.2,
                borderWidth: 2,
            }]
        },
        options: {
            animation: false,
            responsive: true,
            scales: { y: { min: 0, max: 300 } },
            plugins: { legend: { display: false } }
        }
    });

    const batteryCtx = document.getElementById('batteryChart').getContext('2d');
    batteryChart = new Chart(batteryCtx, {
        type: 'line',
        data: {
            labels: batteryData.labels,
            datasets: [{
                label: 'Battery',
                data: batteryData.values,
                borderColor: '#ff006e',
                backgroundColor: 'rgba(255, 0, 110, 0.1)',
                tension: 0.2,
                borderWidth: 2,
            }]
        },
        options: {
            animation: false,
            responsive: true,
            scales: { y: { min: 0, max: 100 } },
            plugins: { legend: { display: false } }
        }
    });
}


async function loadPorts() {
    try {
        const res = await fetch('/ports');
        if (!res.ok) {
            addNotification('Failed to load ports');
            return;
        }
        const ports = await res.json();
        const select = document.getElementById('portSelect');
        select.innerHTML = '';
        if (ports.length === 0) {
            const opt = document.createElement('option');
            opt.textContent = 'No ports available';
            opt.disabled = true;
            select.appendChild(opt);
        } else {
            ports.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.path;
                opt.textContent = p.path;
                select.appendChild(opt);
            });
            //gen selectam primul port
            select.value = ports[0].path;
        }
    } catch (err) {
        addNotification('Error loading ports: ' + err.message);
    }
}


async function connectSerial() {
    const path = document.getElementById('portSelect').value;
    const baudRate = 115200;
    console.log('Connecting to', path, 'at', baudRate);
    if (!path) return;

    try {
        const res = await fetch(`/connect?path=${path}&baudRate=${baudRate}`);

        console.log('Response:', res);
        if (res.ok) {
            addNotification('Serial port connected: ' + path);
        } else {
            const error = await res.json();
            addNotification('Connection failed: ' + error.error);
        }
    } catch (err) {
        addNotification('Connection failed: ' + err.message);
    }
}

// Socket event handlers
socket.on('serialData', (data) => {
    addSerialLog(data);
});

socket.on('time', ({ time }) => {
    const timeStr = new Date(time).toLocaleTimeString();
    lastTime = time;
    document.getElementById('currentTime').textContent = timeStr;
});

socket.on('lapTime', ({ lastTimeDuration }) => {
    lastLapTimestamp = lastTime;
    
    // gen ignoram daca e 0 lol
    if (lastTimeDuration > 0) {
        lapTimes.push(lastTimeDuration);
    }
    
    document.getElementById('lastLapTime').textContent = lastTimeDuration.toFixed(2) + 's';
    
    // Filter out zero values for calculations
    const validLapTimes = lapTimes.filter(time => time > 0);
    
    if (validLapTimes.length > 0) {
        const avgLapTime = validLapTimes.reduce((a, b) => a + b, 0) / validLapTimes.length;
        document.getElementById('averageLapTime').textContent = avgLapTime.toFixed(2) + 's';
        
        const fastestLapTime = Math.min(...validLapTimes);
        document.getElementById('fastestLapTime').textContent = fastestLapTime.toFixed(2) + 's';
    }
});

socket.on('speed', ({ speed, time }) => {
    const timeStr = new Date(time).toLocaleTimeString();
    speedData.labels.push(timeStr);
    speedData.values.push(speed);

    if (speedData.labels.length > maxDataPoints) {
        speedData.labels.shift();
        speedData.values.shift();
    }

    document.getElementById('speedValue').textContent = speed.toFixed(1) + ' km/h';
    if (speedChart) speedChart.update();
});

socket.on('battery', ({ battery, time }) => {
    const timeStr = new Date(time).toLocaleTimeString();
    batteryData.labels.push(timeStr);
    batteryData.values.push(battery);

    if (batteryData.labels.length > maxDataPoints) {
        batteryData.labels.shift();
        batteryData.values.shift();
    }

    document.getElementById('batteryValue').textContent = battery.toFixed(2) + 'V';
    if (batteryChart) batteryChart.update();
});

socket.on('speedSetting', ({ speedSetting }) => {
    document.getElementById('speedSetting').textContent = speedSetting;
});

socket.on('notification', ({ message, time }) => {
    addNotification(message);
});

socket.on('serialStatus', ({ connected, port: portName }) => {
    console.log('Serial status:', connected, portName);
    if (connected) {
        statusEl.textContent = 'Connected: ' + portName;
        statusEl.className = 'status connected';
    } else {
        statusEl.textContent = 'Disconnected';
        statusEl.className = 'status disconnected';
    }
});

function addNotification(msg) {
    const time = new Date().toLocaleTimeString();
    let isError = false;

    // notificare
    if (msg.startsWith('!')) {
        isError = true;
        msg = msg.substring(1); // stergem!
    }

    //ptr notificari
    const floatingDiv = document.createElement('div');
    floatingDiv.className = isError ? 'notification error' : 'notification';
    floatingDiv.innerHTML = `<div class="notification-time">${time}</div><div>${msg}</div>`;
    document.getElementById('notifications').appendChild(floatingDiv);

    // scoatem notificarea peste 3 secuunde
    setTimeout(() => {
        if (floatingDiv.parentNode) {
            floatingDiv.remove();
        }
    }, 3000);

    const listDiv = document.createElement('div');
    listDiv.className = isError ? 'notification-item error' : 'notification-item';
    listDiv.innerHTML = `<strong>${time}</strong>: ${msg}`;
    document.getElementById('notificationsList').appendChild(listDiv);
    document.getElementById('notificationsList').scrollTop = document.getElementById('notificationsList').scrollHeight;

}

function addSerialLog(data) {
    const logDiv = document.getElementById('serialLog');
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.textContent = `[${time}] ${data}`;
    logDiv.appendChild(entry);
    logDiv.scrollTop = logDiv.scrollHeight;
}

function clearSerialLog() {
    document.getElementById('serialLog').innerHTML = '';
}


function updateTime() {
    if (lastLapTimestamp > 0) {
        const elapsed = (lastTime - lastLapTimestamp) / 1000;
        document.getElementById('timeSinceLastLap').textContent = elapsed.toFixed(2) + 's';
    }
}
updateTime();
setInterval(updateTime, 1000);

//cand schimbam portul ne conectam 
document.getElementById('portSelect').addEventListener('change', connectSerial);

(async () => {
    await loadPorts();
    initCharts();
    connectSerial();
})();
