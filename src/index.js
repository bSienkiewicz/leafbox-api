const express = require("express");
const cors = require("cors");
const db = require("./db_utils");
const bodyParser = require("body-parser");
const cheerio = require("cheerio");
const axios = require("axios");
const Vibrant = require("node-vibrant");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const clientMQTT = require("./mqtt_utils");

const pfafURL = "https://pfaf.org/user/Plant.aspx?LatinName=";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static('uploads'));
const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/",
    filename: (req, file, cb) => {
      console.log("[SRV]\tUPLOADING IMAGE...");
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      cb(null, `${Date.now()}${ext}`);
    },
  }),
});

const fs = require("fs");

const removeUnusedImages = async () => {
  const imagesUsed = await db.getPlantsImages();
  const paths = imagesUsed.map((image) => image.image).filter((path) => path);
  const uploadDir = "uploads/";
  fs.readdir(uploadDir, (err, files) => {
    let removed = 0;
    if (err) throw err;
    for (const file of files) {
      if (!paths.includes(file)) {
        removed++;
        fs.unlink(path.join(uploadDir, file), (err) => {
          if (err) throw err;
        });
      }
    }
    console.log(`[SRV]\tRemoved ${removed} unused images`);
  });
};

removeUnusedImages();
setInterval(removeUnusedImages, 10 * 60 * 1000);

app.get("/api/weather", async function (req, res) {
  const locations = await db.getDevicesLocations();
  const data = { locations };
  const endpoint = `http://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHERAPI_KEY}&q=bulk&days=2`;
  try {
    const response = await axios.post(endpoint, data, {
      headers: { "Content-Type": "application/json" },
    });
    res.status(200).send(response.data);
  } catch (error) {
    console.error(error);
  }
});

app.get("/api/devices", async function (req, res) {
  db.getDevices().then((devices) => {
    res.send(devices);
  });
});

app.get("/api/devices/:id", async function (req, res) {
  const device = await db.getDeviceById(req.params.id);
  res.status(200).send(device);
});

app.put("/api/devices/:id", async function (req, res) {
  const response = await db.updateDevice(req.params.id, req.body);
  await db.getDeviceById(req.params.id).then((device) => {
    clientMQTT.provideConfig(device[0].mac);
  });
  res.status(200).send(response);
});

app.delete("/api/devices/:id", async function (req, res) {
  const device = await db.deleteDevice(req.params.id);
  res.status(200).send(device);
});

app.get("/api/plants", async function (req, res) {
  const search = req.query.search;
  if (search) {
    db.getPlantsSearch(search)
      .then((plants) => {
        res.status(200).send(plants);
      })
      .catch((err) => {
        console.error(err);
        res.status(500).send({ code: 500, message: "Internal server error" });
      });
  } else {
    db.getPlants().then((plants) => {
      res.send(plants);
    });
  }
});

app.put("/api/plants/:id", async function (req, res) {
  await db.updatePlant(req.params.id, req.body);
  if (req.body.device_id) {
    const device = await db.getDeviceById(req.body.device_id);
    if (device) {
      await db.device_getConfig(device[0].mac).then((config) => {
        clientMQTT.provideConfig(device[0].mac);
        console.log(config)
      });
    } else {
      console.log(`No device found with id: ${req.body.device_id}`);
    }
  }
  res.status(200).send({ code: 200, message: "Plant updated" });
});

app.get("/api/plants/:id", async function (req, res) {
  try {
    const plant = await db.getPlantById(req.params.id);
    res.json(plant);
  } catch (error) {
    res.status(404).json({ status: 404, message: "Plant not found" });
  }
});

app.get("/api/plants/lookup/:search", async function (req, res) {
  const search = req.params.search;
  try {
    const results = await db.getPlantInfo(search);
    res.status(200).send(results);
  } catch (error) {
    res.status(404).json({ status: 404, message: "Plant not found" });
  }
});

app.get("/api/plants/:id/readings/:ammount", async function (req, res) {
  try {
    const plant = await db.getPlantAndReadingsById(
      req.params.id,
      req.params.ammount
    );
    res.status(200).send(plant);
  } catch (error) {
    res.status(404).json({ status: 404, message: "Plant not found" });
  }
});

app.post("/api/plants", async function (req, res) {
  const plant = await db.addPlant(req.body);
  res.status(200).send(plant);
});

app.delete("/api/plants/:id", async function (req, res) {
  const plantId = req.params.id;
  try {
    await db.deletePlant(plantId);
    res
      .status(200)
      .json({ message: `Plant with id ${plantId} deleted successfully` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete plant" });
  }
});

app.post("/api/reading", async function (req, res) {
  res.send("XD");
});

app.get("/api/send", function (req, res) {
  clientMQTT.publish("device/led", "1", { retain: true });
  res.send("Message sent");
});

app.get("/api/plants", async function (req, res) {
  if (!req.query) return;
  const search = req.query.search;
  db.getDevicesSearch(search)
    .then((devices) => {
      res.status(200).send(devices);
    })
    .catch((err) => {
      console.error(err);
      res.status(500).send({ code: 500, message: "Internal server error" });
    });
});

app.get("/api/plants/updates/:ammount", async function (req, res) {
  const ammount = req.params.ammount;
  const updates = await db.getLastPlantUpdates(ammount);
  res.status(200).send(updates);
});

app.get("/api/readings/:ammount", async function (req, res) {
  const ammount = req.params.ammount;
  const updates = await db.getReadings(ammount);
  res.status(200).send(updates);
});

app.get("/api/config/:mac", async function (req, res) {
  console.log("Providing config for:", decodeURIComponent(req.params.mac));
  const config = await db.device_getConfig(decodeURIComponent(req.params.mac));
  if (!config) {
    res.status(404).send({ error: "Device not found" });
  } else {
    res.status(200).send(config);
  }
});

app.post("/api/login", function (req, res) {
  db.loginUser(req.body)
    .then((data) => {
      console.log("User logged in:", data.user);
      res.status(200).send({ token: data.token, user: data.user });
    })
    .catch((err) => {
      console.error("Error logging in user:", err);
      res.status(err.code || 500).send({ error: err.message });
    });
});

app.post("/api/register", function (req, res) {
  db.registerUser(req.body)
    .then((result) => {
      res.status(200).send({ code: 200, message: "User registered" });
    })
    .catch((err) => {
      console.error(err);
      if (err === "Duplicate entry") {
        res.status(409).send({ code: 409, message: "Username already exists" });
      } else {
        res.status(500).send({ code: 500, message: "Internal server error" });
      }
    });
});

app.get("/api/registered", function (req, res) {
  db.checkIfAnyUserRegistered().then((r) => {
    res.send(r);
  });
});

app.post("/api/validate", function (req, res) {
  const token = req.body.token.value;
  try {
    const decoded = jwt.verify(token, "leafbox");
    res.status(200).send(decoded);
  } catch (err) {
    console.error(err);
    res.status(401).send("Invalid token");
  }
});

app.post("/upload", upload.single("image"), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const palette = await Vibrant.from(`${file.path}`).getPalette();
  const dominantColor = palette.Vibrant ? palette.Vibrant.hex : "#FFFFFF";

  console.log(`[SRV]\tFile uploaded successfully: ${file.filename}`);
  res.status(200).send({ image: file.filename, color: dominantColor });
});

app.get("/image/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const dirname = path.resolve();
    const fullfilepath = path.join(dirname, "uploads/" + filename);
    return res.sendFile(fullfilepath);
  } catch (error) {
    console.error(error);
    res.status(404).send("Image not found");
  }
});

app.get("/api/echo", function (req, res) {
  res.send("echo");
});

app.use(function (req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(function (req, res, next) {
  res.status(404).json({ error: `Not found: ${req.originalUrl}` });
});

app.listen(5000, function () {
  console.log("[SRV]\tAPI on http://localhost:5000");
});

// app.get("/api/plants/lookup/:species", async function (req, res) {
//   const moistureLevels = {
//     "Well Drained Soil": { min: 20, max: 40 },
//     "Moist Soil": { min: 40, max: 60 },
//     "Wet Soil": { min: 60, max: 80 },
//   };
//   const temperatureThresholds = {
//     Tender: 10,
//     "Half Hardy": 0,
//     "Frost Hardy": -5,
//     "Fully Hardy": -15,
//   };
//   function calculateMinTemperature(conditions) {
//     let minTemperature = Infinity;

//     conditions.forEach((condition) => {
//       const threshold = temperatureThresholds[condition];
//       if (threshold !== undefined && threshold < minTemperature) {
//         minTemperature = threshold;
//       }
//     });

//     return minTemperature !== Infinity ? minTemperature : null;
//   }
//   function calculateMoistureThresholds(conditions) {
//     let minThreshold = null;
//     let maxThreshold = null;

//     conditions.forEach((condition) => {
//       const moistureRange = moistureLevels[condition];
//       if (moistureRange) {
//         if (minThreshold === null || moistureRange.min < minThreshold) {
//           minThreshold = moistureRange.min;
//         }
//         if (maxThreshold === null || moistureRange.max > maxThreshold) {
//           maxThreshold = moistureRange.max;
//         }
//       }
//     });

//     return { min: minThreshold, max: maxThreshold };
//   }
//   axios(pfafURL + req.params.species)
//     .then((response) => {
//       const html = response.data;
//       const $ = cheerio.load(html);
//       let conditions = [];
//       const plantInfo = $(".table-striped tr")
//         .get()
//         .reduce((acc, el) => {
//           const tds = $(el).find("td");
//           const name = $(tds[0])
//             .text()
//             .replace(/(\r\n|\n|\r)/gm, "")
//             .replace(/\s+/g, " ")
//             .trim()
//             .replace(" ", "_")
//             .toLowerCase();
//           let value = $(tds[1])
//             .text()
//             .replace(/(\r\n|\n|\r)/gm, "")
//             .replace(/\s+/g, " ")
//             .trim();

//           // Check if the value is in the (x of y) format
//           const regex = /\((\d) of (\d)\)/;
//           const match = value.match(regex);
//           if (match) {
//             value = parseInt(match[1], 10);
//           }

//           acc[name] = value;
//           return acc;
//         }, {});

//       const plantInfoTr = $("#ContentPlaceHolder1_tblIcons tbody tr td");

//       plantInfoTr.each((i, el) => {
//         const image = $(el).find("img");
//         const condition = image.attr("title");
//         conditions.push(condition);
//       });

//       if (plantInfo.common_name && plantInfo.common_name.includes(",")) {
//         plantInfo.common_name = plantInfo.common_name.split(",")[0].trim();
//       }

//       if (conditions.length > 0) {
//         plantInfo.conditions = conditions;
//         // const thresholds = calculateMoistureThresholds(conditions);
//         // plantInfo.thresholds = thresholds;
//         plantInfo.min_temperature = calculateMinTemperature(conditions);

//         conditions.forEach((condition) => {
//           if (condition.includes("shade")) {
//             plantInfo.sun = condition;
//           } else if (condition.includes("sun")) {
//             plantInfo.sun = condition;
//           }

//           if (condition.includes("Drained") || condition.includes("Moist") || condition.includes("Wet")) {
//             plantInfo.moisture = "";
//             switch (condition) {
//               case "Well Drained Soil":
//                 plantInfo.moisture += "D"
//                 break;
//               case "Moist Soil":
//                 plantInfo.moisture += "M"
//                 break;
//               case "Wet Soil":
//                 plantInfo.moisture += "W"
//                 break;
//             }
//           }
//         });
//       }

//       const latin_name = req.params.species;
//       const latin_name_clean = latin_name.replace(/_/g, " ");
//       plantInfo.latin_name = latin_name_clean;

//       const edibleParts = [];
//       const ediblePartsTr = $("#ContentPlaceHolder1_txtEdibleUses")
//         .find("br")
//         .prevAll("a");
//       ediblePartsTr.each((i, el) => {
//         const ediblePart = $(el).text();
//         edibleParts.push(ediblePart);
//       });
//       let ediblePartsClean = [...new Set(edibleParts)];
//       ediblePartsClean = ediblePartsClean.join(", ");
//       if (edibleParts.length > 0) {
//         plantInfo.edible_parts = ediblePartsClean;
//       }

//       for (const key in plantInfo) {
//         if (!plantInfo[key]) {
//           delete plantInfo[key];
//         }
//       }

//       if (plantInfo.known_hazards) {
//         if (plantInfo.known_hazards.includes("None known")) {
//           delete plantInfo.known_hazards;
//         } else {
//           plantInfo.known_hazards = plantInfo.known_hazards.replace(
//             /\[(.*?)\]/g,
//             ""
//           );
//         }
//       }
//       if (Object.keys(plantInfo).length === 0) {
//         res.status(404).send({
//           message: "Plant not found",
//         });
//       } else {
//         res.send(plantInfo);
//       }
//     })
//     .catch(console.error);
// });

// const buildDb = async () => {
//   const letters = "abcdefghijklmnopqrstuvwxyz".split("");
//   let plants = [];
//   // if plants.txt exists read it and insert into plants
//   // if not, scrape pfaf.org and insert into plants

//   if (fs.existsSync("plants.txt")) {
//     const data = fs.readFileSync("plants.txt", "utf8");
//     plants = data.split(",");
//     console.log("Read plants from file");
//   } else {
//     for (const letter of letters) {
//       let plant = [];
//       await axios(
//         `https://pfaf.org/user/DatabaseSearhResult.aspx?LatinName=${letter}`
//       )
//         .then((response) => {
//           const html = response.data;
//           const $ = cheerio.load(html);
//           const plantInfo = $("#ContentPlaceHolder1_gvresults")
//             .get()
//             .reduce((acc, el) => {
//               const cells = $(el).find("td");
//               cells.each((i, cell) => {
//                 const link = $(cell).find("a");
//                 if (link.length) {
//                   const text = link.text();
//                   if (text.toLowerCase().startsWith(letter)) {
//                     plants.push(text);
//                   }
//                 }
//               });
//             }, {});
//         })
//         .then(() => {
//           console.log("Completed letter:", letter);
//         });
//     }
//     fs.writeFileSync("plants.txt", plants.join(","));
//     console.log("Saved plants to file");
//   }

//   console.log(plants.length);

//   for (let i = 0; i < plants.length; i++) {
//     await axios(`http://localhost:5000/api/plants/lookup/${plants[i]}`).then(
//       (response) => {
//         const plant = response.data;
//         if (plant) {
//           db.addPlantInfoToDb(plant);
//           console.log("Added plant:", plant.latin_name);
//         }
//       }
//     );
//   }
// };

// buildDb();
