const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
let mysql = require("mysql2");
const fs = require("fs");
require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` });
const removeAccents = require("remove-accents");

console.log("[SRV]\tRunning in", process.env.NODE_ENV, "mode");

var con = mysql.createConnection({
  host: `${process.env.MYSQL_HOST}`,
  user: `${process.env.MYSQL_USER}`,
  password: `${process.env.MYSQL_PASS}`,
  database: `${process.env.MYSQL_DB}`,
});

con.connect(function (err) {
  if (err) throw err;
  console.log(
    `[SQL]\tConnected to database as ${process.env.MYSQL_USER} (${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT})`
  );
});

function execute(query, values = []) {
  return new Promise((resolve, reject) => {
    con.query(query, values, function (err, rows, fields) {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(JSON.stringify(rows)));
      }
    });
  });
}

async function getDevices() {
  const query = "SELECT * FROM devices";
  return execute(query);
}

async function getDeviceById(id) {
  const query = `SELECT * FROM devices WHERE device_id = ${id}`;
  return execute(query);
}

async function getDeviceByMac(mac) {
  const query = `SELECT * FROM devices WHERE mac = '${mac}'`;
  return execute(query);
}

async function changeDeviceStatus(mac, online) {
  const device = await getDeviceByMac(mac);
  if (device.length === 0) {
    console.log(`[MQTT]\tDevice with mac ${mac} not found`);
    addDevice(mac);
    return;
  } else {
    const query = `UPDATE devices SET online = ${online} WHERE mac = '${mac}'`;
    return execute(query);
  }
}

async function addDevice(mac) {
  const query = `INSERT INTO devices (device_name, mac, configured)
  VALUES (?, ?, ?)`;
  const values = ["New device", mac, 0];
  console.log(`[MQTT]\tAdding new device with mac ${mac}`);
  return execute(query, values);
}

// async function handleDeviceConnected(deviceId, message) {
//   try {
//     let device_info = {
//       id: deviceId,
//       mac: JSON.parse(message.toString()).mac,
//     };
//     console.log(device_info);
//     let device = await xata.Devices.read(deviceId);
//     if (!device) {
//       device = await xata.Devices.create(device_info);
//     } else {
//       device = await xata.Devices.update(deviceId, {
//         last_connected: new Date(),
//       });
//       console.log("Logged device connection");
//     }
//   } catch (e) {
//     console.log("Error handling device connection:", e);
//   }
// }
// TODO: Handle new device connection

async function updateDevice(deviceId, body) {
  if (body.location) body.location = removeAccents(body.location);
  const query = `UPDATE devices SET
    device_name = ?,
    location = ?,
    plant_1 = ?,
    plant_2 = ?,
    plant_3 = ?,
    plant_4 = ?,
    sensor_config_1 = ?,
    sensor_config_2 = ?,
    sensor_config_3 = ?,
    sensor_config_4 = ?,
    configured = 1
    WHERE device_id = ?`;
  const values = [
    body.device_name,
    body.location,
    body.plant_1,
    body.plant_2,
    body.plant_3,
    body.plant_4,
    body.sensor_config_1,
    body.sensor_config_2,
    body.sensor_config_3,
    body.sensor_config_4,
    deviceId,
  ];
  return execute(query, values);
}

async function deleteDevice(deviceId) {
  const query = `DELETE FROM devices WHERE device_id = ${deviceId}`;
  return execute(query);
}

async function getDevicesLocations() {
  const query = `SELECT DISTINCT location AS 'q' FROM devices`;
  return execute(query);
}

/* ------------------ */
/*  PLANTS FUNCTIONS  */
/* ------------------ */

async function getPlants() {
  const query = `SELECT DISTINCT
    p.*,
    r.moisture_value AS last_moisture,
    r.timestamp AS last_moisture_ts
  FROM 
    plants AS p
  LEFT JOIN (
    SELECT 
        plant_id,
        moisture_value,
        timestamp
    FROM 
        readings
    WHERE 
        (plant_id, timestamp) IN (
            SELECT 
                plant_id,
                MAX(timestamp)
            FROM 
                readings
            GROUP BY 
                plant_id
        )
  ) AS r ON p.plant_id = r.plant_id;`;
  return execute(query);
}

async function getPlantById(id) {
  if (isNaN(id)) {
    throw new Error("Invalid id");
  }
  const query = `SELECT * FROM plants WHERE plant_id = ${id} ORDER BY plant_id`;
  return execute(query);
}

async function updatePlant(plantId, body) {
  const query = `UPDATE plants SET
    plant_name = ?,
    image = ?,
    description = ?,
    lower_threshold = ?,
    upper_threshold = ?,
    reading_delay = ?,
    reading_delay_mult = ?,
    color = ?
    WHERE plant_id = ?`;
  const values = [
    body.plant_name,
    body.image,
    body.description,
    body.lower_threshold,
    body.upper_threshold,
    body.reading_delay,
    body.reading_delay_mult,
    body.color || "#7f7f7f",
    plantId,
  ];
  return execute(query, values);
}

async function getPlantAndReadingsById(id, ammount) {
  if (isNaN(id)) {
    throw new Error("Invalid id");
  }

  const plants = await execute(
    `SELECT p.*, 
    CASE
      WHEN d.plant_1 = ${id} THEN '1'
      WHEN d.plant_2 = ${id} THEN '2'
      WHEN d.plant_3 = ${id} THEN '3'
      WHEN d.plant_4 = ${id} THEN '4'
    END AS slot,
    d.device_name AS device_name,
    d.device_id as device_id,
    d.mac as device_mac
  FROM plants AS p
  LEFT JOIN devices AS d ON p.plant_id = d.plant_1 OR p.plant_id = d.plant_2 OR p.plant_id = d.plant_3 OR p.plant_id = d.plant_4
  WHERE p.plant_id = ${id}`
  );

  const readings = await execute(
    `SELECT * FROM readings WHERE plant_id = ${id} ORDER BY timestamp DESC LIMIT ${ammount}`
  );

  return {
    plant: plants,
    readings: readings,
  };
}

async function getReadings(ammount) {
  const query = `SELECT readings.*, plants.plant_name FROM readings AS readings
                 LEFT JOIN plants AS plants ON readings.plant_id = plants.plant_id
                 ORDER BY readings.timestamp DESC LIMIT ${ammount}`;
  return execute(query);
}

async function getPlantsImages() {
  const query = `SELECT image FROM plants`;
  return execute(query);
}

async function getLastPlantUpdates(plants) {
  const query = `
    SELECT DISTINCT plant_id, MAX(timestamp) AS last_read
    FROM readings
    GROUP BY plant_id
    ORDER BY last_read DESC
    LIMIT ${plants}
  `;
  return execute(query);
}

async function addPlant(body) {
  console.log(body)
  const query = `INSERT INTO plants (plant_name, image, description, species, lower_threshold, upper_threshold, reading_delay, reading_delay_mult, color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [
    body.plant_name,
    body.image || "",
    body.description,
    body.species,
    body.lower_threshold,
    body.upper_threshold,
    body.reading_delay,
    body.reading_delay_mult,
    body.color || "#7f7f7f",
  ];
  console.log("values:" + values)
  return execute(query, values);
}

async function deletePlant(plantId) {
  const deleteReadingsQuery = `DELETE FROM readings WHERE plant_id = ${plantId}`;
  const deletePlantQuery = `DELETE FROM plants WHERE plant_id = ${plantId}`;
  await execute(deleteReadingsQuery);
  return execute(deletePlantQuery);
}

async function getPlantsSearch(search) {
  const query = `SELECT 
    plant_id,
    plant_name,
    species,
    image
  FROM
    plants
  WHERE
    plant_name LIKE '%${search}%' OR
    species LIKE '%${search}%' OR
    plant_id LIKE '%${search}%'
  `;
  return execute(query);
}

async function getDevicesSearch(search) {
  const query = `SELECT 
    device_id,
    device_name,
  WHERE
    device_name LIKE '%${search}%' OR
    device_id LIKE '%${search}%' OR
  FROM
    devices
  `;
  return execute(query);
}

async function addReading(plant_id, reading) {
  const query = `INSERT INTO readings (plant_id, moisture_value) VALUES (?, ?)`;
  const values = [parseInt(plant_id), parseInt(reading)];
  return execute(query, values);
}

async function getPlantInfo(search) {
  console.log("Searching for", search);
  const query = `SELECT * FROM plant_info WHERE latin_name LIKE '%${search}%' OR common_name LIKE '%${search}%' OR edible_parts LIKE '%${search}%'`;
  return execute(query);
}

/* USER FUNCTIONS */
async function loginUser(data) {
  return new Promise((resolve, reject) => {
    con.query(
      `SELECT * FROM users WHERE username = '${data.username}'`,
      async function (err, result) {
        if (err) {
          reject(err);
        } else {
          if (result.length === 0) {
            reject({ code: 404, message: "User not found" });
          } else {
            const user = result[0];
            const match = await bcrypt.compare(data.password, user.password);
            if (match) {
              const data = {
                token: jwt.sign(
                  { user_id: user.user_id, user_name: user.name },
                  "leafbox"
                ),
                user: user.name,
              };
              resolve(data);
            } else {
              reject({ code: 401, message: "Incorrect password" });
            }
          }
        }
      }
    );
  }).catch((err) => {
    console.error("Error logging in user:", err);
    throw err;
  });
}

async function registerUser(data) {
  try {
    const query = `INSERT INTO users (username, password, name) VALUES (?, ?, ?)`;
    const values = [data.username, data.password, data.name];
    const result = await execute(query, values);
    return result;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
      throw "Duplicate entry";
    } else {
      console.error("Error registering user:", err);
      throw err;
    }
  }
}

async function checkIfAnyUserRegistered() {
  return new Promise((resolve, reject) => {
    con.query(`SELECT * FROM users`, function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result.length > 0);
      }
    });
  });
}

async function addPlantInfoToDb(data) {
  const {
    latin_name,
    common_name = null,
    usda_hardiness = null,
    known_hazards = null,
    edibility_rating = null,
    medicinal_rating = null,
    moisture = null,
    sun = null,
    edible_parts = null,
  } = data;

  const query = `INSERT IGNORE INTO conditions (latin_name, common_name, usda, hazards, edibility, medicinal, moisture, sun, temperature_min, edible_parts)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [
    latin_name,
    common_name,
    usda_hardiness,
    known_hazards,
    edibility_rating,
    medicinal_rating,
    moisture,
    sun,
    temperature_min,
    edible_parts,
  ];

  return execute(query, values);
}

async function device_getConfig(mac) {
  const device = await execute(`SELECT * FROM devices WHERE mac = "${mac}"`);
  const slots = [1, 2, 3, 4];
  let result = {};

  if(device.length === 0) {
    addDevice(mac);
    return null;
  }
  for (let slot of slots) {
    const plantId = device[0][`plant_${slot}`];
    if (plantId) {
      const plant = await execute(`SELECT * FROM plants WHERE plant_id = ${plantId}`);
      const lastReading = await execute(`SELECT MAX(timestamp) as last_reading FROM readings WHERE plant_id = ${plantId}`);
      
      result[slot] = {
        moistureMin: device[0][`sensor_config_${slot}`].split("|")[0],
        moistureMax: device[0][`sensor_config_${slot}`].split("|")[1],
        lowerTreshold: plant[0].lower_threshold,
        upperTreshold: plant[0].upper_threshold,
        plantId: plant[0].plant_id,
        lastReading: lastReading[0].last_reading,
        readingDelay: plant[0].reading_delay,
        readingDelayMult: plant[0].reading_delay_mult
      };
    }
  }

  return result;
}

module.exports = {
  deleteDevice,
  getDevices,
  getDeviceById,
  getDeviceByMac,
  updateDevice,
  getDevicesLocations,
  getPlants,
  getReadings,
  getPlantsImages,
  getPlantById,
  getPlantsSearch,
  getDevicesSearch,
  updatePlant,
  getLastPlantUpdates,
  getPlantAndReadingsById,
  addPlant,
  deletePlant,
  addReading,
  loginUser,
  getPlantInfo,
  registerUser,
  checkIfAnyUserRegistered,
  addPlantInfoToDb,
  changeDeviceStatus,
  device_getConfig,
  execute,
};