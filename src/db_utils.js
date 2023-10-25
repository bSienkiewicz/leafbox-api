const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
let mysql = require("mysql");
const fs = require('fs');
require("dotenv").config();
const removeAccents = require('remove-accents');

var con = mysql.createConnection({
  host: `${process.env.MYSQL_HOST}`,
  user: `${process.env.MYSQL_USER}`,
  password: `${process.env.MYSQL_PASS}`,
});

con.connect(function (err) {
  if (err) throw err;
  console.log(`[SQL]\tConnected to database as ${process.env.MYSQL_USER}`);
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
  const query = "SELECT * FROM db.devices";
  return execute(query);
}

async function getDeviceById(id) {
  const query = `SELECT * FROM db.devices WHERE device_id = ${id}`;
  return execute(query);
}

// async function handleDeviceConnected(deviceId, message) {
//   try {
//     let device_info = {
//       id: deviceId,
//       mac: JSON.parse(message.toString()).mac,
//     };
//     console.log(device_info);
//     let device = await xata.db.Devices.read(deviceId);
//     if (!device) {
//       device = await xata.db.Devices.create(device_info);
//     } else {
//       device = await xata.db.Devices.update(deviceId, {
//         last_connected: new Date(),
//       });
//       console.log("Logged device connection");
//     }
//   } catch (e) {
//     console.log("Error handling device connection:", e);
//   }
// }
// TODO: Handle new device connection

async function addNewDevice(body) {
  const query = `INSERT INTO db.devices (?, ?, ?, ?)`
  const values = [body.mac, body.type, body.name, 1];
  return execute(query, values);
}
async function updateDevice(deviceId, body) {
  const query = `UPDATE db.devices SET
    device_name = ?,
    location = ?,
    plant_1 = ?,
    plant_2 = ?,
    plant_3 = ?,
    plant_4 = ?,
    configured = 1
    WHERE device_id = ?`;
  const values = [
    body.device_name,
    removeAccents(body.location),
    body.plant_1,
    body.plant_2,
    body.plant_3,
    body.plant_4,
    deviceId
  ];
  return execute(query, values);
}

async function deleteDevice(deviceId) {
  const query = `DELETE FROM db.devices WHERE device_id = ${deviceId}`;
  return execute(query);
}

async function getDevicesLocations() {
  const query = `SELECT DISTINCT location AS 'q' FROM db.devices`;
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
    db.plants AS p
  LEFT JOIN (
    SELECT 
        plant_id,
        moisture_value,
        timestamp
    FROM 
        db.readings
    WHERE 
        (plant_id, timestamp) IN (
            SELECT 
                plant_id,
                MAX(timestamp)
            FROM 
                db.readings
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
  const query = `SELECT * FROM db.plants WHERE plant_id = ${id} ORDER BY plant_id`;
  return execute(query);
}

async function updatePlant(plantId, body) {
  const query = `UPDATE db.plants SET
    plant_name = ?,
    image = ?,
    description = ?,
    lower_threshold = ?,
    upper_threshold = ?,
    watering_time = ?,
    temperature_min = ?,
    color = ?
    WHERE plant_id = ?`;
  const values = [
    body.plant_name,
    body.image,
    body.description,
    body.lower_threshold,
    body.upper_threshold,
    body.watering_time,
    body.temperature_min,
    body.color || '#7f7f7f',
    plantId
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
      device.device_name AS device_name,
      device.device_id as device_id
    FROM db.plants AS p
    LEFT JOIN db.devices AS d ON p.plant_id = d.plant_1 OR p.plant_id = d.plant_2 OR p.plant_id = d.plant_3 OR p.plant_id = d.plant_4
    LEFT JOIN db.devices AS device ON d.device_id = device.device_id
    WHERE p.plant_id = ${id}`
  );

  const readings = await execute(
    `SELECT * FROM db.readings WHERE plant_id = ${id} ORDER BY timestamp DESC LIMIT ${ammount}`
  );

  return {
    plant: plants,
    readings: readings,
  };
}

async function getReadings(ammount) {
  const query = `SELECT readings.*, plants.plant_name FROM db.readings AS readings
                 LEFT JOIN db.plants AS plants ON readings.plant_id = plants.plant_id
                 ORDER BY readings.timestamp DESC LIMIT ${ammount}`;
  return execute(query);
}

async function getPlantsImages() {
  const query = `SELECT image FROM db.plants`;
  return execute(query);
}

async function getLastPlantUpdates(plants) {
  const query = `
    SELECT DISTINCT plant_id, MAX(timestamp) AS last_read
    FROM db.readings
    GROUP BY plant_id
    ORDER BY last_read DESC
    LIMIT ${plants}
  `;
  return execute(query);
}

async function addPlant(body) {
  const query = `INSERT INTO db.plants (plant_name, image, description, species, lower_threshold, upper_threshold, temperature_min, color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [
    body.plant_name,
    body.image || '',
    body.description,
    body.species,
    body.lower_threshold,
    body.upper_threshold,
    body.temperature_min,
    body.color || '#7f7f7f'
  ];
  return execute(query, values);
}

async function deletePlant(plantId) {
  const deleteReadingsQuery = `DELETE FROM db.readings WHERE plant_id = ${plantId}`;
  const deletePlantQuery = `DELETE FROM db.plants WHERE plant_id = ${plantId}`;
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
    db.plants
  WHERE
    plant_name LIKE '%${search}%' OR
    species LIKE '%${search}%' OR
    plant_id LIKE '%${search}%'
  `
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
    db.devices
  `
  return execute(query);
}

async function addReading(plant_id, reading) {
  const query = `INSERT INTO db.readings (plant_id, moisture_value) VALUES (?, ?)`;
  const values = [parseInt(plant_id), parseInt(reading)];
  return execute(query, values);
}

async function getPlantInfo(search) {
  const query = `SELECT * FROM plant_info.conditions WHERE latin_name LIKE '%${search}%' OR common_name LIKE '%${search}%' OR edible_parts LIKE '%${search}%'`;
  return execute(query);
}

/* USER FUNCTIONS */
async function loginUser(data) {
  return new Promise((resolve, reject) => {
    con.query(
      `SELECT * FROM db.users WHERE username = '${data.username}'`,
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
    const query = `INSERT INTO db.users (username, password, name) VALUES (?, ?, ?)`;
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
    con.query(`SELECT * FROM db.users`, function (err, result) {
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
    min_temperature = null,
    edible_parts = null,
  } = data;

  const query = `INSERT IGNORE INTO plant_info.conditions (latin_name, common_name, usda, hazards, edibility, medicinal, moisture, sun, temperature_min, edible_parts)
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
    min_temperature,
    edible_parts,
  ];
  
  return execute(query, values);
}

module.exports = {
  deleteDevice,
  getDevices,
  getDeviceById,
  updateDevice,
  addNewDevice,
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
  addPlantInfoToDb
};
