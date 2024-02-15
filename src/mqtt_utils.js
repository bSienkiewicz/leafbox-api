const mqtt = require("mqtt");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const db = require("./db_utils");
const os = require("os");
const osu = require("node-os-utils");
dotenv.config();

const ws = new WebSocket.Server({ port: 5566 });

async function sendServerInfo() {
  const RAMtotal = Math.round(os.totalmem() / 1024 / 1024);
  const RAMfree = Math.round(os.freemem() / 1024 / 1024);
  const CPUusage = await osu.cpu.usage();

  ws.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          topic: "status",
          data: {
            ram: {
              total: RAMtotal,
              free: RAMfree,
            },
            cpu: {
              usage: CPUusage,
            },
          },
        })
      );
    }
  });
}

setInterval(sendServerInfo, 3000);

ws.on("connection", function connection(socket) {
  console.log("[WSS]\tClient connected");
  sendServerInfo();

  socket.on("message", function incoming(message) {
    console.log("received: %s", message);
    try {
      const messageJSON = JSON.parse(message);
      if (messageJSON.topic === "command") {
        console.log(messageJSON);
        sendMQTT(
          `esp/device/command`,
          JSON.stringify({
            type: messageJSON.data.type,
            mac: messageJSON.data.mac,
            data: messageJSON.data.data,
          })
        );
      }
      if (messageJSON.topic === "calibration") {
        console.log("Sending calibration");
        sendMQTT(
          `esp/device/calibration`,
          JSON.stringify({
            type: "calibration",
            mac: messageJSON.data.mac,
            data: {
              step: messageJSON.data.step,
              plant: messageJSON.data.plant,
            },
          })
        );
      }
    } catch (err) {
      console.log(err);
    }
  });
});

const clientMQTT = mqtt.connect(`mqtt://${process.env.MQTT_HOST}`, {
  port: process.env.MQTT_PORT,
});

clientMQTT.on("connect", function () {
  clientMQTT.subscribe("esp/#", function (err) {
    if (!err) {
      console.log("[MQTT]\tConnected to MQTT broker");
    }
  });
});

clientMQTT.on("message", async function (topic, message, packet) {
  if (packet.retain) return;
  console.log("[MQTT]\tReceived '" + message + "' on '" + topic + "'");

  let topicArray = topic.split("/");
  if (topicArray[0] === "esp" && topicArray[1] === "status") {
    const messageJSON = JSON.parse(message);
    db.changeDeviceStatus(messageJSON.mac, messageJSON.online);
  }
  if (topicArray[0] === "esp" && topicArray[3] === "moisture") {
    console.log("Adding moisture reading");
    const plant_id = topicArray[2];
    db.addReading(plant_id, message);
    ws.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            topic: "moisture",
            data: {
              plant_id: plant_id,
              moisture_value: message,
              timestamp: new Date(),
            },
          })
        );
      }
    });
  }
  if (topicArray[0] === "esp" && topicArray[3] === "temperature") {
    console.log("Adding temperature reading");
    const id = topicArray[2];
    db.addTemperatureReading(id, message);
    ws.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            topic: "temperature",
            data: {
              device_id: id,
              temperature_value: message,
              timestamp: new Date(),
            },
          })
        );
      }
    });
  }
  if (
    topicArray[0] === "esp" &&
    topicArray[1] === "device" &&
    topicArray[2] === "config" &&
    topicArray[3] === "request"
  ) {
    console.log("Providing config");
    provideConfig(message.toString());
  }
  if (
    topicArray[0] === "esp" &&
    topicArray[1] === "device" &&
    topicArray[2] === "calibration"
  ) {
    const messageJSON = JSON.parse(message);
    const device = await db.getDeviceByMac(messageJSON.mac);
    ws.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            topic: "calibration",
            data: {
              deviceId: device[0].device_id,
              socket: messageJSON.socket,
              values: messageJSON.values,
            },
          })
        );
      }
    });
  }
});

clientMQTT.on("error", function (err) {
  console.log("Błąd połączenia z brokerem MQTT:", err);
});

clientMQTT.on("reconnect", function () {
  console.log("Próba ponownego połączenia z brokerem MQTT...");
});

clientMQTT.on("close", function () {
  console.log("Połączenie z brokerem MQTT zostało zamknięte");
});

const sendMQTT = (topic, message, retain = false) => {
  clientMQTT.publish(topic, message, { retain: retain });
};

const provideConfig = (mac) => {
  db.device_getConfig(mac).then((result) => {
    console.log("[MQTT]\tProviding config for " + mac);
    let message = {
      type: "config",
      mac: mac,
      id: result.deviceId,
      data: result.config,
    };
    sendMQTT(`esp/device/command`, JSON.stringify(message));
  });
};

module.exports = {
  sendMQTT,
  provideConfig,
};

/*

{
  "1": {
    "moistureMin": 1496,
    "moistureMax": 1042,
    "lowerTreshold": 30,
    "upperTreshold": 100,
    "wateringTime": 2
  },
}
  
  */
