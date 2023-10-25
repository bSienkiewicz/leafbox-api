const mqtt = require("mqtt");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const db = require("./db_utils");
const os = require("os");
const osu = require("node-os-utils");
dotenv.config();

const wss = new WebSocket.Server({ port: 5566 });

async function sendServerInfo() {
  const RAMtotal = Math.round(os.totalmem() / 1024 / 1024);
  const RAMfree = Math.round(os.freemem() / 1024 / 1024);
  const CPUusage = await osu.cpu.usage();

  wss.clients.forEach(function each(client) {
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
              usage: CPUusage
            },
          },
        })
      );
    }
  });
}

setInterval(sendServerInfo, 3000);

wss.on("connection", function connection(ws) {
  console.log("[WSS]\tClient connected");
  sendServerInfo();

  ws.on("message", function incoming(message) {
    console.log("received: %s", message);
    ws.send("[WSS]\tMessage received: " + message);
  });
});

const clientMQTT = mqtt.connect(`mqtt://${process.env.MQTT_HOST}`, {
  port: process.env.MQTT_PORT,
});

clientMQTT.on("connect", function () {
  clientMQTT.subscribe("esp/#", function (err) {
    if (!err) {
      console.log("[MQTT]\tConnected to MQTT broker");
      clientMQTT.publish("esp/device", "Server connected");
    }
  });
});

clientMQTT.on("message", function (topic, message, packet) {
  if (packet.retain) return;
  console.log("[MQTT]\tReceived '" + message + "' on '" + topic + "'");

  let topicArray = topic.split("/");
  if (topicArray[0] === "esp" && topicArray[1] === "device") {
    const deviceId = topicArray[2];
  }
  if (topicArray[0] === "esp" && topicArray[3] === "moisture") {
    const plant_id = topicArray[2];
    // console.log("plant_id: " + plant_id + " moisture: " + message)
    db.addReading(plant_id, message);
    wss.clients.forEach(function each(client) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            topic : "moisture",
            data : {
              plant_id: plant_id,
              moisture_value: message,
              timestamp: new Date(),
            }
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